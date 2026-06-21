'use strict';

/**
 * AI Assistant — WinCC OA JavaScript Manager hosting an MSA (Manager Service
 * API) vRPC service that proxies a prompt to a third-party LLM provider.
 *
 * Architecture (see project notes):
 *   WebUI (browser) ──HTTP /api/ai/chat──▶ paraWebserver (vRPC stub client)
 *                                              │  MSA vRPC
 *                                              ▼
 *                                   this manager: service "AiAssistant"
 *                                              │  fetch()
 *                                              ▼
 *                          Anthropic / OpenAI / Mistral / Gemini
 *
 * The browser cannot speak vRPC (the WebUI runtime has no MSA client), so
 * paraWebserver bridges HTTP→vRPC. The provider, model and API token are read
 * from the `AI_Assistant_Config` datapoint (token stored in the DP), so they
 * can be configured from the UI without restarting this manager.
 *
 * Register in config/progs, e.g.:
 *   node | always | 30 | 2 | 2 |aiAssistant/index.js
 *
 * The service exposes one unary method:
 *   Chat(Variant<string JSON {provider?, model?, prompt, system?}>)
 *      -> Variant<string JSON {text}>   (throws Vrpc.Error on failure)
 *
 * After editing this file, restart the aiAssistant manager.
 */
const { WinccoaManager, WinccoaDpTypeNode, Vrpc } = require('winccoa-manager');
const mcp = require('./mcp.js');

const winccoa = new WinccoaManager();

const SERVICE_NAME = 'AiAssistant';
const CONFIG_TYPE = 'AI_Assistant_Config';
const CONFIG_DP = 'AI_Assistant_Config';
const SYS = 'System1:';
/** WinccoaElementType enum values (see winccoa-manager dptypenode). */
const ELEM = { Struct: 1, String: 25 };
// Max output tokens. Anthropic REQUIRES this field; a low value truncates long
// answers mid-sentence. OpenAI/Mistral/Gemini paths omit it (provider default).
const MAX_TOKENS = 8192;
const HTTP_OK = 200;
/** Max LLM⇄tool round-trips per chat (agentic MCP loop guard). */
const MAX_TOOL_ROUNDS = 6;
/** Default MCP servers (the WinCC OA MCP server runs on :3000, StreamableHTTP). */
const DEFAULT_MCP_SERVERS = [{ name: 'winccoa', url: 'http://127.0.0.1:3000/mcp', token: '' }];

/** Built-in provider catalog (default model first). Mirrored in the UI. */
const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  openai: { label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'] },
  mistral: { label: 'Mistral AI', models: ['mistral-large-latest', 'mistral-small-latest'] },
  gemini: { label: 'Google Gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] }
};

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[AiAssistant] ${msg}`);
}

function extractString(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

// ---- data model (config DP) ------------------------------------------------

async function ensureConfig() {
  const root = new WinccoaDpTypeNode(CONFIG_TYPE, ELEM.Struct, '', [
    new WinccoaDpTypeNode('provider', ELEM.String),
    new WinccoaDpTypeNode('model', ELEM.String),
    new WinccoaDpTypeNode('token', ELEM.String),
    // JSON array of { name, url, token } MCP servers attached to the provider call.
    new WinccoaDpTypeNode('mcpServers', ELEM.String)
  ]);
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${CONFIG_TYPE}`);
  } catch {
    // Type may already exist — try to add the mcpServers element in place.
    try {
      await winccoa.dpTypeChange(root);
    } catch {
      // ignore — element likely already present
    }
  }
  if (!winccoa.dpExists(`${CONFIG_DP}.provider`)) {
    try {
      await winccoa.dpCreate(CONFIG_DP, CONFIG_TYPE);
      await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.provider`, 'anthropic');
      await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.model`, PROVIDERS.anthropic.models[0]);
      await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.mcpServers`, JSON.stringify(DEFAULT_MCP_SERVERS));
      log(`DP de configuration créé : ${CONFIG_DP}`);
    } catch (e) {
      log(`Échec création DP config : ${e}`);
    }
  } else if (extractString(await winccoa.dpGet(`${SYS}${CONFIG_DP}.mcpServers`).catch(() => '')) === '') {
    // Seed the default MCP server on existing configs that predate this field.
    try {
      await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.mcpServers`, JSON.stringify(DEFAULT_MCP_SERVERS));
    } catch {
      // ignore
    }
  }
}

async function readConfig() {
  try {
    const raw = await winccoa.dpGet([
      `${SYS}${CONFIG_DP}.provider`,
      `${SYS}${CONFIG_DP}.model`,
      `${SYS}${CONFIG_DP}.token`,
      `${SYS}${CONFIG_DP}.mcpServers`
    ]);
    const arr = Array.isArray(raw) ? raw : [raw];
    let mcpServers = [];
    try {
      mcpServers = JSON.parse(extractString(arr[3]) || '[]');
    } catch {
      mcpServers = [];
    }
    return {
      provider: extractString(arr[0]),
      model: extractString(arr[1]),
      token: extractString(arr[2]),
      mcpServers: Array.isArray(mcpServers) ? mcpServers : []
    };
  } catch {
    return { provider: '', model: '', token: '', mcpServers: [] };
  }
}

// ---- provider interfaces (raw HTTP via global fetch) ------------------------

function vrpcError(code, message) {
  return new Vrpc.Error(new Vrpc.Status(Vrpc.StatusCode[code], message));
}

async function postJson(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (res.status !== HTTP_OK) {
    const msg = data?.error?.message || data?.error || data?.message || text || `HTTP ${res.status}`;
    throw vrpcError('Unknown', `Provider HTTP ${res.status}: ${String(msg).slice(0, 300)}`);
  }
  return data;
}

// ---- MCP tools (local agentic loop) ----------------------------------------

/**
 * Connect to every configured MCP server, list its tools, and return a flat
 * tool list + a name→{server,sessionId} routing map. The manager is the MCP
 * client: it executes tool calls locally, so the LLM provider never needs to
 * reach the (often localhost) MCP server. Unreachable servers are skipped.
 */
async function gatherMcpTools(mcpServers) {
  const tools = [];
  const route = new Map();
  for (const server of mcpServers || []) {
    if (!server || !server.url) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const sessionId = await mcp.connect(server);
      // eslint-disable-next-line no-await-in-loop
      const list = await mcp.listTools(server, sessionId);
      for (const t of list) {
        if (route.has(t.name)) continue; // first server wins on name collision
        tools.push({ name: t.name, description: t.description || '', schema: t.inputSchema || { type: 'object', properties: {} } });
        route.set(t.name, { server, sessionId });
      }
    } catch (e) {
      log(`MCP ${server.url} indisponible : ${e.message}`);
    }
  }
  return { tools, route };
}

async function execTool(route, name, args, calls) {
  const target = route.get(name);
  if (!target) {
    calls.push({ name, ok: false });
    return { text: `Outil inconnu : ${name}`, isError: true };
  }
  try {
    const res = await mcp.callTool(target.server, target.sessionId, name, args);
    calls.push({ name, ok: !res.isError });
    return res;
  } catch (e) {
    calls.push({ name, ok: false });
    return { text: `Erreur outil ${name} : ${e.message}`, isError: true };
  }
}

// ---- provider tool-use loops (agentic) -------------------------------------

const TOOL_LIMIT_MSG = "(limite d'itérations d'outils atteinte)";

async function callAnthropic(model, token, prompt, system, tools, route, calls) {
  const headers = { 'content-type': 'application/json', 'x-api-key': token, 'anthropic-version': '2023-06-01' };
  const decls = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
  const messages = [{ role: 'user', content: prompt }];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = { model, max_tokens: MAX_TOKENS, messages };
    if (system) body.system = system;
    if (decls.length > 0) body.tools = decls;
    // eslint-disable-next-line no-await-in-loop
    const data = await postJson('https://api.anthropic.com/v1/messages', headers, body);
    if (data.stop_reason !== 'tool_use') {
      return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    }
    messages.push({ role: 'assistant', content: data.content });
    const results = [];
    for (const block of data.content || []) {
      if (block.type !== 'tool_use') continue;
      // eslint-disable-next-line no-await-in-loop
      const res = await execTool(route, block.name, block.input, calls);
      results.push({ type: 'tool_result', tool_use_id: block.id, content: res.text, is_error: res.isError });
    }
    messages.push({ role: 'user', content: results });
  }
  return TOOL_LIMIT_MSG;
}

async function callOpenAiLike(url, model, token, prompt, system, tools, route, calls) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const fns = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = { model, messages };
    if (fns.length > 0) body.tools = fns;
    // eslint-disable-next-line no-await-in-loop
    const data = await postJson(url, headers, body);
    const msg = data.choices?.[0]?.message;
    if (!msg || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) {
      return msg?.content?.trim() ?? '';
    }
    messages.push(msg);
    for (const tc of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        args = {};
      }
      // eslint-disable-next-line no-await-in-loop
      const res = await execTool(route, tc.function?.name, args, calls);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: res.text });
    }
  }
  return TOOL_LIMIT_MSG;
}

/** Strip JSON-Schema keywords Gemini's functionDeclarations rejects. */
function geminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const clean = JSON.parse(JSON.stringify(schema));
  const scrub = (o) => {
    if (!o || typeof o !== 'object') return;
    delete o.$schema;
    delete o.additionalProperties;
    for (const v of Object.values(o)) scrub(v);
  };
  scrub(clean);
  return clean;
}

async function callGemini(model, token, prompt, system, tools, route, calls) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(token)}`;
  const decls = tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.schema) }));
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (decls.length > 0) body.tools = [{ functionDeclarations: decls }];
    // eslint-disable-next-line no-await-in-loop
    const data = await postJson(url, { 'content-type': 'application/json' }, body);
    const parts = data.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      return parts.map((p) => p.text || '').join('').trim();
    }
    contents.push({ role: 'model', parts });
    const responseParts = [];
    for (const c of calls) {
      // eslint-disable-next-line no-await-in-loop
      const res = await execTool(route, c.functionCall.name, c.functionCall.args || {}, calls);
      responseParts.push({ functionResponse: { name: c.functionCall.name, response: { content: res.text } } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }
  return TOOL_LIMIT_MSG;
}

async function runProvider(provider, model, token, prompt, system, tools, route, calls) {
  switch (provider) {
    case 'anthropic':
      return callAnthropic(model, token, prompt, system, tools, route, calls);
    case 'openai':
      return callOpenAiLike('https://api.openai.com/v1/chat/completions', model, token, prompt, system, tools, route, calls);
    case 'mistral':
      return callOpenAiLike('https://api.mistral.ai/v1/chat/completions', model, token, prompt, system, tools, route, calls);
    case 'gemini':
      return callGemini(model, token, prompt, system, tools, route, calls);
    default:
      throw vrpcError('InvalidArgument', `Provider inconnu : ${provider}`);
  }
}

// ---- MSA vRPC service ------------------------------------------------------

class AiAssistantService extends Vrpc.ServiceBase {
  constructor() {
    super(SERVICE_NAME);
    this.registerFunction('Chat', (ctx, request) => this.chat(ctx, request));
  }

  async chat(serverContext, request) {
    serverContext.cancelSignal.throwIfAborted();
    if (!request.isString() || request.isNull()) {
      throw vrpcError('InvalidArgument', 'La requête doit être une chaîne JSON');
    }
    let req;
    try {
      req = JSON.parse(request.getString());
    } catch {
      throw vrpcError('InvalidArgument', 'JSON de requête invalide');
    }
    const prompt = String(req.prompt ?? '').trim();
    if (!prompt) throw vrpcError('InvalidArgument', 'Le prompt est vide');

    const cfg = await readConfig();
    const provider = String(req.provider || cfg.provider || 'anthropic');
    const model = String(req.model || cfg.model || PROVIDERS[provider]?.models[0] || '');
    const token = cfg.token;
    if (!token) throw vrpcError('FailedPrecondition', "Aucun token API configuré (icône de configuration de l'IA)");
    if (!model) throw vrpcError('FailedPrecondition', 'Aucun modèle configuré');

    const mcpServers = Array.isArray(req.mcpServers) ? req.mcpServers : cfg.mcpServers;
    // The manager is the MCP client: connect locally, expose tools to the LLM,
    // and execute tool calls here (no public exposure of the MCP server needed).
    const { tools, route } = await gatherMcpTools(mcpServers);
    log(`Chat: provider=${provider} model=${model} mcp_tools=${tools.length} (${prompt.length} car.)`);
    const calls = [];
    const text = await runProvider(provider, model, token, prompt, req.system, tools, route, calls);
    return Vrpc.Variant.createString(JSON.stringify({ text, provider, model, toolCalls: calls }));
  }
}

async function run() {
  log('Démarrage du service IA (MSA vRPC)…');
  await ensureConfig();
  const container = new Vrpc.ServiceContainer();
  container.registerService(new AiAssistantService(), new Vrpc.ServiceOptions());
  try {
    await container.startAllServices();
    log(`Service "${SERVICE_NAME}" démarré.`);
  } catch (e) {
    log(`Échec du démarrage du service : ${e}`);
  }
}

run().catch((e) => log(`Erreur fatale : ${e}`));
