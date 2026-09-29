// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

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
 *   Chat(Variant<string JSON {provider?, model?, prompt, system?, mcpServers?,
 *                             mcpMode?, webSearch?, effort?, maxTokens?,
 *                             progressId?}>)
 *      -> Variant<string JSON {text, truncated, mcpTools, …}>
 *                                              (throws Vrpc.Error on failure)
 *
 * With a `progressId`, the loop narrates itself live into the
 * `AI_Assistant_Progress` datapoint (see the constant below) — the reply itself
 * cannot report progress, being a single unary call.
 *
 * After editing this file, restart the aiAssistant manager.
 */
const { WinccoaManager, WinccoaDpTypeNode, Vrpc } = require('winccoa-manager');
const mcp = require('./mcp.js');

const winccoa = new WinccoaManager();

const SERVICE_NAME = 'AiAssistant';
const CONFIG_TYPE = 'AI_Assistant_Config';
const CONFIG_DP = 'AI_Assistant_Config';
/**
 * Live-progress channel.
 *
 * `Chat` is a UNARY vRPC call: the whole agentic loop runs before it answers, so
 * there is no way to report progress on the reply itself. Rather than invent an
 * HTTP callback into the webserver (a new URL to configure, a new unauthenticated
 * surface to protect), progress is published to a datapoint — the WebUI already
 * has an authenticated live subscription to those, so the browser reads it with
 * the same `dpConnect` it uses for every other live value.
 *
 * Each write carries the CUMULATIVE event list for one prompt, not a delta: if two
 * writes land faster than the client's notification, or one is coalesced away, the
 * latest value still holds everything. That makes the channel lossless without any
 * sequencing protocol.
 */
const PROGRESS_TYPE = 'AI_Assistant_Progress';
const PROGRESS_DP = 'AI_Assistant_Progress';
/** Events kept per prompt, and the size ceiling of one write. */
const PROGRESS_MAX_EVENTS = 60;
const PROGRESS_MAX_CHARS = 12_000;
const SYS = 'System1:';
/** WinccoaElementType enum values (see winccoa-manager dptypenode). */
const ELEM = { Struct: 1, String: 25 };
// Output budget. Anthropic REQUIRES this field; too low a value truncates long
// answers mid-sentence — and a truncated ```json block is an unusable proposal,
// which is the failure that actually hurts. On the Claude 5 family thinking is ON
// by default and the budget caps thinking PLUS response text, so it must be
// generous. Configurable per project (`maxTokens` element); this is the default.
const DEFAULT_MAX_TOKENS = 32_768;
/** Bounds for the configured budget: below 1k nothing useful fits, 128k is the model ceiling. */
const MAX_TOKENS_MIN = 1024;
const MAX_TOKENS_MAX = 128_000;
/**
 * Appended when the provider stopped because the budget ran out. Silence here is
 * the worst outcome: the caller cannot tell a complete answer from a cut one.
 */
const TRUNCATED_MSG =
  "\n\n_(réponse tronquée : budget de sortie atteint — augmentez « Budget de sortie » dans la configuration de l'IA, ou demandez une proposition plus petite.)_";
const HTTP_OK = 200;
const JSON_CT = 'application/json';
/** Max LLM⇄tool round-trips per chat (agentic MCP loop guard). */
const MAX_TOOL_ROUNDS = 6;
/** Default MCP servers (the WinCC OA MCP server runs on :3000, StreamableHTTP). */
const DEFAULT_MCP_SERVERS = [{ name: 'winccoa', url: 'http://127.0.0.1:3000/mcp', token: '' }];
/** Max provider-side web searches per chat (cost guard). */
const WEB_SEARCH_MAX_USES = 5;
/**
 * Tool-exposure modes. `read-only` is what makes MCP usable from the
 * *proposal-only* pages (GIS, Ampère, PARA): they need to READ the project — the
 * datapoints that exist, a type's structure, maybe a geocoder — while keeping the
 * guarantee that the assistant cannot change anything. The filtering happens HERE
 * rather than in the page: a tool that is never declared to the model cannot be
 * called, whereas a page-side rule is one prompt away from being ignored.
 */
const MCP_MODES = new Set(['full', 'read-only']);
const DEFAULT_MCP_MODE = 'full';
/**
 * Fallback when a tool carries no MCP `annotations.readOnlyHint`: refuse the names
 * that read like a mutation. Deliberately over-cautious — dropping a harmless tool
 * costs a capability, keeping a mutating one costs the guarantee. Matched on word
 * boundaries so `set-value` and `dpSet` are caught but `get-dpTypes` is not.
 */
const MUTATION_VERBS =
  /(^|[^a-z])(set|create|add|new|write|update|edit|patch|put|delete|remove|del|drop|clear|purge|rename|move|copy|import|insert|kill|start|stop|restart|run|exec|execute|call|send|post|ack|acknowledge|save|apply|deploy|upload)([^a-z]|$)/i;
/**
 * Claude models supporting the dynamic-filtering web-search tool
 * (`web_search_20260209`); older ones only take the basic `web_search_20250305`.
 */
const CLAUDE_MODERN_SEARCH = /^claude-(opus-(5|4-8|4-7|4-6)|sonnet-(5|4-6)|fable-5|mythos-5)/;
/**
 * Reasoning effort — the latency/cost lever. Lower = faster and cheaper, less
 * deliberation. `medium` is the default here (the Claude API's own default is
 * `high`, which is noticeably slower for the short operator questions this
 * assistant answers).
 */
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const DEFAULT_EFFORT = 'medium';
/** Claude models that accept `output_config.effort` (it errors on Haiku 4.5). */
const CLAUDE_EFFORT = /^claude-(opus-(5|4-8|4-7|4-6|4-5)|sonnet-(5|4-6)|fable-5|mythos-5)/;
/**
 * Claude models that accept adaptive thinking — the ones we can ask for a readable
 * reasoning summary (`thinking.display`). Sending it to an older model is a 400.
 */
const CLAUDE_ADAPTIVE = /^claude-(opus-(5|4-8|4-7|4-6)|sonnet-(5|4-6)|fable-5|mythos-5)/;
/** …and those that accept the `xhigh` level (added with Opus 4.7). */
const CLAUDE_EFFORT_XHIGH = /^claude-(opus-(5|4-8|4-7)|sonnet-5|fable-5|mythos-5)/;
/** OpenAI reasoning models that accept `reasoning_effort` (low|medium|high). */
const OPENAI_EFFORT = /^(o\d|gpt-5)/;

/** Built-in provider catalog (default model first). Mirrored in the UI. */
const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']
  },
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

/**
 * Web search is opt-OUT: an empty element (config predating the field, or a DP
 * created before the UI ever saved) means enabled.
 */
function parseWebSearch(raw) {
  return extractString(raw).trim().toLowerCase() !== 'false';
}

/** Effort level from the config DP / request; unknown or empty -> the default. */
function parseEffort(raw) {
  const value = extractString(raw).trim().toLowerCase();
  return EFFORTS.has(value) ? value : DEFAULT_EFFORT;
}

/** Output budget from the config DP / request, clamped; unparsable -> the default. */
function parseMaxTokens(raw) {
  const value = Number.parseInt(extractString(raw).trim(), 10);
  if (!Number.isFinite(value)) return DEFAULT_MAX_TOKENS;
  return Math.min(Math.max(value, MAX_TOKENS_MIN), MAX_TOKENS_MAX);
}

/**
 * Effort as the target model accepts it, or '' when it accepts none: sending
 * the field to a model that lacks it is a 400, so it is dropped rather than
 * approximated. `xhigh` degrades to `high` on models that stop one level short.
 */
function claudeEffort(model, effort) {
  if (!CLAUDE_EFFORT.test(model)) return '';
  if (effort === 'xhigh' && !CLAUDE_EFFORT_XHIGH.test(model)) return 'high';
  return effort;
}

/** OpenAI only knows low|medium|high — the two top levels collapse to `high`. */
function openAiEffort(model, effort) {
  if (!OPENAI_EFFORT.test(model)) return '';
  return effort === 'xhigh' || effort === 'max' ? 'high' : effort;
}

// ---- data model (config DP) ------------------------------------------------

/**
 * The progress datapoint: one String element holding the current prompt's event
 * list as JSON. One DP for the project, not one per session — creating and deleting
 * a datapoint per chat would be far more expensive than a payload the clients
 * filter on its `id`.
 */
async function ensureProgress() {
  const root = new WinccoaDpTypeNode(PROGRESS_TYPE, ELEM.Struct, '', [
    new WinccoaDpTypeNode('json', ELEM.String)
  ]);
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${PROGRESS_TYPE}`);
  } catch {
    try {
      await winccoa.dpTypeChange(root);
    } catch {
      // already up to date
    }
  }
  if (!winccoa.dpExists(`${PROGRESS_DP}.json`)) {
    try {
      await winccoa.dpCreate(PROGRESS_DP, PROGRESS_TYPE);
      log(`DP de progression créé : ${PROGRESS_DP}`);
    } catch (e) {
      log(`Échec création DP de progression (progression live indisponible) : ${e}`);
    }
  }
}

async function ensureConfig() {
  const root = new WinccoaDpTypeNode(CONFIG_TYPE, ELEM.Struct, '', [
    new WinccoaDpTypeNode('provider', ELEM.String),
    new WinccoaDpTypeNode('model', ELEM.String),
    new WinccoaDpTypeNode('token', ELEM.String),
    // JSON array of { name, url, token } MCP servers attached to the provider call.
    new WinccoaDpTypeNode('mcpServers', ELEM.String),
    // 'true' | 'false' — provider-side web search. Empty means enabled (default).
    new WinccoaDpTypeNode('webSearch', ELEM.String),
    // 'low'|'medium'|'high'|'xhigh'|'max' — reasoning effort (latency lever).
    new WinccoaDpTypeNode('effort', ELEM.String),
    // Output budget in tokens (decimal string). Empty -> DEFAULT_MAX_TOKENS.
    new WinccoaDpTypeNode('maxTokens', ELEM.String)
  ]);
  await ensureProgress();
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${CONFIG_TYPE}`);
  } catch {
    // Type already exists — add whatever elements it is missing IN PLACE
    // (mcpServers on the oldest configs, webSearch/effort on the previous one).
    // dpTypeChange also propagates new elements to the existing DP.
    try {
      await winccoa.dpTypeChange(root);
    } catch (e) {
      log(`Type ${CONFIG_TYPE} non mis à jour — webSearch/effort peuvent manquer : ${e}`);
    }
  }
  if (!winccoa.dpExists(`${CONFIG_DP}.provider`)) {
    try {
      await winccoa.dpCreate(CONFIG_DP, CONFIG_TYPE);
      await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.provider`, 'anthropic');
      await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.model`, PROVIDERS.anthropic.models[0]);
      await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.mcpServers`, JSON.stringify(DEFAULT_MCP_SERVERS));
      await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.webSearch`, 'true');
      await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.effort`, DEFAULT_EFFORT);
      await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.maxTokens`, String(DEFAULT_MAX_TOKENS));
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

/** Defaults for the elements added after the first release. */
function lateDefaults() {
  return { webSearch: true, effort: DEFAULT_EFFORT, maxTokens: DEFAULT_MAX_TOKENS };
}

/**
 * The late elements in their OWN dpGet: a single dpGet fails as a whole when any
 * element is unknown, so reading them next to the token would blank the whole
 * config on a type that predates them (and report "no API token configured").
 */
async function readLateConfig() {
  try {
    const raw = await winccoa.dpGet([
      `${SYS}${CONFIG_DP}.webSearch`,
      `${SYS}${CONFIG_DP}.effort`,
      `${SYS}${CONFIG_DP}.maxTokens`
    ]);
    const arr = Array.isArray(raw) ? raw : [raw];
    return { webSearch: parseWebSearch(arr[0]), effort: parseEffort(arr[1]), maxTokens: parseMaxTokens(arr[2]) };
  } catch {
    return lateDefaults();
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
      mcpServers: Array.isArray(mcpServers) ? mcpServers : [],
      ...(await readLateConfig())
    };
  } catch {
    return { provider: '', model: '', token: '', mcpServers: [], ...lateDefaults() };
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

// ---- live progress ---------------------------------------------------------

/**
 * A progress publisher for one prompt, or an inert one when the caller asked for
 * none (`progressId` absent) — so a page that does not display progress costs
 * nothing.
 *
 * Every `step()` republishes the whole list. Failures are swallowed: progress is a
 * courtesy, and a chat must never fail because its narration could not be written.
 */
function makeProgress(progressId) {
  if (!progressId) return { on: false, step: () => undefined, events: [] };
  const events = [];
  const publish = async () => {
    // Drop the oldest first: on a long loop the recent steps are the interesting
    // ones, and the final answer carries the authoritative trace anyway.
    while (events.length > PROGRESS_MAX_EVENTS) events.shift();
    let payload = JSON.stringify({ id: progressId, events });
    while (payload.length > PROGRESS_MAX_CHARS && events.length > 1) {
      events.shift();
      payload = JSON.stringify({ id: progressId, events });
    }
    try {
      await winccoa.dpSetWait(`${SYS}${PROGRESS_DP}.json`, payload);
    } catch {
      // best effort
    }
  };
  return {
    on: true,
    events,
    step(event) {
      events.push(event);
      // Not awaited: the loop must not wait on a datapoint write to keep working.
      void publish();
    }
  };
}

// ---- MCP tools (local agentic loop) ----------------------------------------

/**
 * Whether a tool may be exposed in `read-only` mode.
 *
 * The MCP `annotations` are the authoritative signal when the server sends them:
 * `readOnlyHint: true` means the tool does not modify its environment, and
 * `destructiveHint`/`readOnlyHint: false` mean it does. They are HINTS, so they are
 * trusted only to *refuse* faster or to *allow* an explicitly read-only tool; a tool
 * with no annotation at all falls back to its name.
 */
function isReadOnlyTool(tool) {
  const hints = tool.annotations || {};
  if (hints.readOnlyHint === true) return true;
  if (hints.readOnlyHint === false || hints.destructiveHint === true) return false;
  return !MUTATION_VERBS.test(String(tool.name || ''));
}

/**
 * Connect to every configured MCP server, list its tools, and return a flat
 * tool list + a name→{server,sessionId} routing map. The manager is the MCP
 * client: it executes tool calls locally, so the LLM provider never needs to
 * reach the (often localhost) MCP server. Unreachable servers are skipped.
 *
 * In `read-only` mode the mutating tools are dropped BEFORE the model is told they
 * exist — that is the whole mechanism behind a proposal-only page keeping its
 * guarantee while still being able to read the project.
 */
async function gatherMcpTools(mcpServers, mode) {
  const readOnly = mode === 'read-only';
  const tools = [];
  const route = new Map();
  let filtered = 0;
  for (const server of mcpServers || []) {
    if (!server || !server.url) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const sessionId = await mcp.connect(server);
      // eslint-disable-next-line no-await-in-loop
      const list = await mcp.listTools(server, sessionId);
      for (const t of list) {
        if (route.has(t.name)) continue; // first server wins on name collision
        if (readOnly && !isReadOnlyTool(t)) {
          filtered++;
          continue;
        }
        tools.push({ name: t.name, description: t.description || '', schema: t.inputSchema || { type: 'object', properties: {} } });
        route.set(t.name, { server, sessionId });
      }
    } catch (e) {
      log(`MCP ${server.url} indisponible : ${e.message}`);
    }
  }
  if (filtered > 0) log(`MCP lecture seule : ${filtered} outil(s) mutant(s) écarté(s).`);
  return { tools, route };
}

/**
 * Trace of one tool call, returned to the UI so the user can audit what the
 * assistant actually looked at. The result is capped: a `get-datapoints` on a real
 * project answers with thousands of lines, and the trace travels through vRPC and
 * JSON to a chat panel — the head of it is what makes the call reviewable.
 */
const TRACE_MAX = 4000;

function trace(text) {
  const value = String(text ?? '');
  return value.length > TRACE_MAX ? `${value.slice(0, TRACE_MAX)}\n…(tronqué)` : value;
}

async function execTool(route, name, args, calls, progress) {
  const target = route.get(name);
  const server = target ? target.server.name || target.server.url : '';
  // Announced BEFORE it runs: a tool that takes ten seconds is exactly when the
  // user wants to know what is being waited on.
  progress.step({ type: 'tool-start', name, server });
  if (!target) {
    calls.push({ name, ok: false, server, args, result: `Outil inconnu : ${name}` });
    progress.step({ type: 'tool', name, server, ok: false });
    return { text: `Outil inconnu : ${name}`, isError: true };
  }
  try {
    const res = await mcp.callTool(target.server, target.sessionId, name, args);
    calls.push({ name, ok: !res.isError, server, args, result: trace(res.text) });
    // Only the outcome goes on the progress channel, never the result: that
    // datapoint is readable by every client, whereas the full trace travels back
    // on the caller's own response.
    progress.step({ type: 'tool', name, server, ok: !res.isError });
    return res;
  } catch (e) {
    const text = `Erreur outil ${name} : ${e.message}`;
    calls.push({ name, ok: false, server, args, result: text });
    progress.step({ type: 'tool', name, server, ok: false });
    return { text, isError: true };
  }
}

// ---- provider tool-use loops (agentic) -------------------------------------

const TOOL_LIMIT_MSG = "(limite d'itérations d'outils atteinte)";

/** Mark an answer the provider cut short, so the UI can say so instead of guessing. */
function truncated(text) {
  return `${text}${TRUNCATED_MSG}`;
}

/** Longest reasoning summary published per round — a paragraph, not an essay. */
const THINKING_MAX = 600;

/**
 * Publish this round's reasoning summary, when the provider returned one.
 *
 * This is per ROUND, not per token: the call is non-streaming, so the summary of a
 * round arrives with that round's response. On an agentic loop that still means the
 * user sees the model's reasoning unfold step by step instead of waiting in silence.
 */
function publishThinking(progress, content) {
  if (!progress.on) return;
  const text = (content || [])
    .filter((block) => block.type === 'thinking' && block.thinking)
    .map((block) => block.thinking)
    .join('\n')
    .trim();
  if (!text) return;
  progress.step({
    type: 'thinking',
    text: text.length > THINKING_MAX ? `${text.slice(0, THINKING_MAX)}…` : text
  });
}

/**
 * Anthropic server-side web search tool. It runs on Anthropic's infrastructure
 * (no local execution, no MCP), so it appears in `tools` next to the MCP
 * declarations and never goes through `execTool`.
 */
function anthropicWebSearchTool(model) {
  return {
    type: CLAUDE_MODERN_SEARCH.test(model) ? 'web_search_20260209' : 'web_search_20250305',
    name: 'web_search',
    max_uses: WEB_SEARCH_MAX_USES
  };
}

async function callAnthropic(model, token, prompt, system, tools, route, calls, options) {
  const headers = { 'content-type': JSON_CT, 'x-api-key': token, 'anthropic-version': '2023-06-01' };
  const decls = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
  if (options.webSearch) decls.push(anthropicWebSearchTool(model));
  const level = claudeEffort(model, options.effort);
  const { progress } = options;
  const messages = [{ role: 'user', content: prompt }];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = { model, max_tokens: options.maxTokens, messages };
    if (system) body.system = system;
    if (decls.length > 0) body.tools = decls;
    if (level) body.output_config = { effort: level };
    // Ask for a readable reasoning summary ONLY when someone is watching: on the
    // models where thinking is off by default this turns it on, which costs
    // thinking tokens. The default (`omitted`) returns empty thinking blocks.
    if (progress.on && CLAUDE_ADAPTIVE.test(model)) {
      body.thinking = { type: 'adaptive', display: 'summarized' };
    }
    progress.step({ type: 'model', round: round + 1, model });
    // eslint-disable-next-line no-await-in-loop
    const data = await postJson('https://api.anthropic.com/v1/messages', headers, body);
    publishThinking(progress, data.content);
    if (data.stop_reason === 'pause_turn') {
      // A server-side tool (web search) hit the provider's own iteration limit.
      // Echo the assistant turn back with NO user message: the trailing
      // server_tool_use block tells the API to resume where it paused.
      messages.push({ role: 'assistant', content: data.content });
      continue;
    }
    if (data.stop_reason !== 'tool_use') {
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      return data.stop_reason === 'max_tokens' ? truncated(text) : text;
    }
    messages.push({ role: 'assistant', content: data.content });
    const results = [];
    for (const block of data.content || []) {
      if (block.type !== 'tool_use') continue;
      // eslint-disable-next-line no-await-in-loop
      const res = await execTool(route, block.name, block.input, calls, progress);
      results.push({ type: 'tool_result', tool_use_id: block.id, content: res.text, is_error: res.isError });
    }
    messages.push({ role: 'user', content: results });
  }
  return TOOL_LIMIT_MSG;
}

async function callOpenAiLike(url, model, token, prompt, system, tools, route, calls, options) {
  const headers = { 'content-type': JSON_CT, authorization: `Bearer ${token}` };
  const fns = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
  const level = options.effort ? openAiEffort(model, options.effort) : '';
  const { progress } = options;
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = { model, messages };
    if (fns.length > 0) body.tools = fns;
    if (level) body.reasoning_effort = level;
    progress.step({ type: 'model', round: round + 1, model });
    // eslint-disable-next-line no-await-in-loop
    const data = await postJson(url, headers, body);
    const msg = data.choices?.[0]?.message;
    if (!msg || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) {
      const text = msg?.content?.trim() ?? '';
      return data.choices?.[0]?.finish_reason === 'length' ? truncated(text) : text;
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
      const res = await execTool(route, tc.function?.name, args, calls, progress);
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

async function callGemini(model, token, prompt, system, tools, route, calls, options) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(token)}`;
  const decls = tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.schema) }));
  const { progress } = options;
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = { contents, generationConfig: { maxOutputTokens: options.maxTokens } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const toolDecls = [];
    if (decls.length > 0) toolDecls.push({ functionDeclarations: decls });
    // Grounding with Google Search — a Gemini-side tool, listed alongside the
    // function declarations (supported from Gemini 2.x on).
    if (options.webSearch) toolDecls.push({ google_search: {} });
    if (toolDecls.length > 0) body.tools = toolDecls;
    progress.step({ type: 'model', round: round + 1, model });
    // eslint-disable-next-line no-await-in-loop
    const data = await postJson(url, { 'content-type': JSON_CT }, body);
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const fnCalls = parts.filter((p) => p.functionCall);
    if (fnCalls.length === 0) {
      const text = parts.map((p) => p.text || '').join('').trim();
      return candidate?.finishReason === 'MAX_TOKENS' ? truncated(text) : text;
    }
    contents.push({ role: 'model', parts });
    const responseParts = [];
    for (const c of fnCalls) {
      // eslint-disable-next-line no-await-in-loop
      const res = await execTool(route, c.functionCall.name, c.functionCall.args || {}, calls, progress);
      responseParts.push({ functionResponse: { name: c.functionCall.name, response: { content: res.text } } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }
  return TOOL_LIMIT_MSG;
}

/**
 * Dispatch to the provider. `options` = { webSearch, effort, maxTokens }, each
 * honored wherever the provider's API exposes it on this transport: web search on
 * Anthropic and Gemini, effort on Anthropic and the OpenAI reasoning models, the
 * output budget on Anthropic and Gemini. OpenAI/Mistral keep their own default
 * budget (the field name differs across their model families, and getting it
 * wrong is a 400) — a setting with no equivalent is simply ignored.
 */
async function runProvider(provider, model, token, prompt, system, tools, route, calls, options) {
  switch (provider) {
    case 'anthropic':
      return callAnthropic(model, token, prompt, system, tools, route, calls, options);
    case 'openai':
      return callOpenAiLike('https://api.openai.com/v1/chat/completions', model, token, prompt, system, tools, route, calls, options);
    case 'mistral':
      return callOpenAiLike('https://api.mistral.ai/v1/chat/completions', model, token, prompt, system, tools, route, calls, { ...options, effort: '' });
    case 'gemini':
      return callGemini(model, token, prompt, system, tools, route, calls, options);
    default:
      throw vrpcError('InvalidArgument', `Provider inconnu : ${provider}`);
  }
}

// ---- MSA vRPC service ------------------------------------------------------

/**
 * Merge the per-call request over the config DP. A page may legitimately want a
 * toolless, search-free or low-latency prompt (PARA sends `mcpServers: []`), so
 * anything the caller set wins; everything else falls back to the config.
 */
function resolveOverrides(req, cfg) {
  return {
    mcpServers: Array.isArray(req.mcpServers) ? req.mcpServers : cfg.mcpServers,
    // A page asks for an exposure MODE, not for a server list: the servers stay the
    // project's configuration, so adding one benefits every page at once.
    mcpMode: MCP_MODES.has(req.mcpMode) ? req.mcpMode : DEFAULT_MCP_MODE,
    webSearch: typeof req.webSearch === 'boolean' ? req.webSearch : cfg.webSearch,
    effort: req.effort ? parseEffort(req.effort) : cfg.effort,
    maxTokens: req.maxTokens ? parseMaxTokens(req.maxTokens) : cfg.maxTokens
  };
}

/** Validate the vRPC payload into a request object, or throw a vRPC error. */
function parseChatRequest(request) {
  if (!request.isString() || request.isNull()) {
    throw vrpcError('InvalidArgument', 'La requête doit être une chaîne JSON');
  }
  let req;
  try {
    req = JSON.parse(request.getString());
  } catch {
    throw vrpcError('InvalidArgument', 'JSON de requête invalide');
  }
  if (!String(req.prompt ?? '').trim()) throw vrpcError('InvalidArgument', 'Le prompt est vide');
  return req;
}

class AiAssistantService extends Vrpc.ServiceBase {
  constructor() {
    super(SERVICE_NAME);
    this.registerFunction('Chat', (ctx, request) => this.chat(ctx, request));
  }

  async chat(serverContext, request) {
    serverContext.cancelSignal.throwIfAborted();
    const req = parseChatRequest(request);
    const prompt = String(req.prompt).trim();

    const cfg = await readConfig();
    const provider = String(req.provider || cfg.provider || 'anthropic');
    const model = String(req.model || cfg.model || PROVIDERS[provider]?.models[0] || '');
    const token = cfg.token;
    if (!token) throw vrpcError('FailedPrecondition', "Aucun token API configuré (icône de configuration de l'IA)");
    if (!model) throw vrpcError('FailedPrecondition', 'Aucun modèle configuré');

    const { mcpServers, mcpMode, ...options } = resolveOverrides(req, cfg);
    // Inert unless the caller passed a `progressId`, so a page that shows no
    // progress pays nothing for the channel.
    const progress = makeProgress(String(req.progressId ?? ''));
    options.progress = progress;
    progress.step({ type: 'start', provider, model });
    // The manager is the MCP client: connect locally, expose tools to the LLM,
    // and execute tool calls here (no public exposure of the MCP server needed).
    const { tools, route } = await gatherMcpTools(mcpServers, mcpMode);
    progress.step({ type: 'mcp', count: tools.length, mode: mcpMode });
    log(
      `Chat: provider=${provider} model=${model} mcp=${mcpMode} mcp_tools=${tools.length} ` +
        `web_search=${options.webSearch} effort=${options.effort} max_tokens=${options.maxTokens} ` +
        `progress=${progress.on} (${prompt.length} car.)`
    );
    const calls = [];
    try {
      const text = await runProvider(provider, model, token, prompt, req.system, tools, route, calls, options);
      progress.step({ type: 'done' });
      return Vrpc.Variant.createString(
        JSON.stringify({
          text,
          provider,
          model,
          mcpMode,
          // How many tools the model was actually offered: a page that expected read
          // access can tell "no server reachable" from "server up, tools filtered".
          mcpTools: tools.length,
          ...options,
          progress: undefined,
          truncated: text.endsWith(TRUNCATED_MSG),
          toolCalls: calls
        })
      );
    } catch (e) {
      // Close the narration on failure too: a progress list left hanging would
      // read as "still working" for as long as the panel is open.
      progress.step({ type: 'error', message: String(e?.status?.text ?? e?.message ?? e) });
      throw e;
    }
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
