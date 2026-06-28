// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AI Assistant client store.
 *
 * Bridges the WebUI to the AI feature:
 *  - chat goes to `POST /api/ai/chat` (the dashboard webserver forwards it over
 *    MSA vRPC to the `AiAssistant` manager, which calls the LLM provider);
 *  - the provider / model / API token / MCP servers are persisted in the
 *    `AI_Assistant_Config` datapoint — written via the PARA REST API
 *    (`/api/para/dp/set`, since OaRxJsApi is read-only here) and read via
 *    `OaRxJsApi.dpGet`. The `aiAssistant` manager creates the DP/type on start;
 *    we still best-effort ensure it so the config UI works even before then.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';

const CONFIG_DP = 'AI_Assistant_Config';
const CONFIG_TYPE = 'AI_Assistant_Config';
const DP_SET_URL = '/api/para/dp/set';
const CREATE_TYPE_URL = '/api/para/dptype/create';
const CREATE_DP_URL = '/api/para/dp/create';
const CHAT_URL = '/api/ai/chat';

/** One MCP server attached to the provider call. */
export interface McpServer {
  name: string;
  url: string;
  token?: string;
}

export interface AiConfig {
  provider: string;
  model: string;
  token: string;
  mcpServers: McpServer[];
}

/** Provider catalog (default model first) — mirrors the aiAssistant manager. */
export const AI_PROVIDERS: Record<string, { label: string; models: string[] }> = {
  anthropic: { label: 'Anthropic (Claude)', models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  openai: { label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'] },
  mistral: { label: 'Mistral AI', models: ['mistral-large-latest', 'mistral-small-latest'] },
  gemini: { label: 'Google Gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] }
};

/** Default MCP server (the WinCC OA MCP server, StreamableHTTP on :3000). */
export const DEFAULT_MCP_SERVER: McpServer = { name: 'winccoa', url: 'http://127.0.0.1:3000/mcp', token: '' };

function resolveApi(): OaRxJsApi | null {
  try {
    return container.resolve<OaRxJsApi>(OaRxJsApi);
  } catch {
    return null;
  }
}

function scalar(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const s = scalar(item);
      if (s) return s;
    }
    return '';
  }
  if (raw && typeof raw === 'object' && 'value' in raw) return scalar((raw as { value: unknown }).value);
  return raw == null ? '' : String(raw);
}

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Read the AI config from the datapoint. */
export async function loadAiConfig(): Promise<AiConfig> {
  const api = resolveApi();
  const fallback: AiConfig = { provider: 'anthropic', model: AI_PROVIDERS['anthropic'].models[0], token: '', mcpServers: [DEFAULT_MCP_SERVER] };
  if (!api) return fallback;
  try {
    const raw = await firstValueFrom(
      api.dpGet([`${CONFIG_DP}.provider`, `${CONFIG_DP}.model`, `${CONFIG_DP}.token`, `${CONFIG_DP}.mcpServers`])
    );
    const arr = Array.isArray(raw) ? raw : [raw];
    let mcpServers: McpServer[] = [];
    try {
      const parsed = JSON.parse(scalar(arr[3]) || '[]') as McpServer[];
      mcpServers = Array.isArray(parsed) ? parsed : [];
    } catch {
      mcpServers = [];
    }
    return {
      provider: scalar(arr[0]) || fallback.provider,
      model: scalar(arr[1]) || fallback.model,
      token: scalar(arr[2]),
      mcpServers
    };
  } catch {
    return fallback;
  }
}

async function send(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status}`);
}

/** Persist the AI config to the datapoint (best-effort ensure type/dp first). */
export async function saveAiConfig(cfg: AiConfig): Promise<void> {
  try {
    await fetch(
      CREATE_TYPE_URL,
      jsonPost({
        typeName: CONFIG_TYPE,
        structure: {
          name: CONFIG_TYPE,
          type: 'Struct',
          children: [
            { name: 'provider', type: 'String', refName: '' },
            { name: 'model', type: 'String', refName: '' },
            { name: 'token', type: 'String', refName: '' },
            { name: 'mcpServers', type: 'String', refName: '' }
          ]
        }
      })
    );
    await fetch(CREATE_DP_URL, jsonPost({ dpName: CONFIG_DP, dpType: CONFIG_TYPE }));
  } catch {
    // type/dp likely already exist (created by the manager) — proceed to set.
  }
  await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.provider`, value: cfg.provider }));
  await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.model`, value: cfg.model }));
  await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.token`, value: cfg.token }));
  await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.mcpServers`, value: JSON.stringify(cfg.mcpServers) }));
}

/** Send a prompt to the AI; returns the answer text or throws with the error message. */
/** One tool the AI invoked during the answer (via the local MCP loop). */
export interface ToolCall {
  name: string;
  ok: boolean;
}

export interface AiAnswer {
  text: string;
  toolCalls: ToolCall[];
}

/** Optional per-call overrides. `system` scopes the assistant (page context + guard-rails). */
export interface AskAiOptions {
  system?: string;
  provider?: string;
  model?: string;
  /**
   * Per-call MCP server override. Pass `[]` to run the prompt with NO tools, so
   * the assistant can only answer/propose and never mutate the project. When
   * omitted, the AiAssistant manager uses its configured servers.
   */
  mcpServers?: McpServer[];
}

export async function askAi(prompt: string, options: AskAiOptions = {}): Promise<AiAnswer> {
  const body: { prompt: string } & AskAiOptions = { prompt };
  if (options.system) body.system = options.system;
  if (options.provider) body.provider = options.provider;
  if (options.model) body.model = options.model;
  if (options.mcpServers) body.mcpServers = options.mcpServers;
  const res = await fetch(CHAT_URL, jsonPost(body));
  let data: { ok?: boolean; text?: string; error?: string; toolCalls?: ToolCall[] };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error(`Réponse invalide (HTTP ${res.status})`);
  }
  if (!res.ok || !data.ok) throw new Error(data.error || `Erreur IA (HTTP ${res.status})`);
  return { text: data.text ?? '', toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : [] };
}
