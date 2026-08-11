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
import { AI_MSG, localize } from '../i18n.js';

const CONFIG_DP = 'AI_Assistant_Config';
const CONFIG_TYPE = 'AI_Assistant_Config';
const DP_SET_URL = '/api/para/dp/set';
const CREATE_TYPE_URL = '/api/para/dptype/create';
const CHANGE_TYPE_URL = '/api/para/dptype/change';
const CREATE_DP_URL = '/api/para/dp/create';
const CHAT_URL = '/api/ai/chat';

/** The config elements, in DP-type order. All String — the manager parses them. */
const CONFIG_ELEMENTS = ['provider', 'model', 'token', 'mcpServers', 'webSearch', 'effort', 'maxTokens'] as const;

/**
 * Elements added after the first release. They are read and written apart from the
 * core four, because a deployed type may not carry them yet — see
 * {@link loadLateElements} and {@link setLateElements}.
 */
const LATE_ELEMENTS = ['webSearch', 'effort', 'maxTokens'] as const;

/** Output-budget bounds, mirrored from the manager (which clamps authoritatively). */
export const AI_MAX_TOKENS_MIN = 1024;
export const AI_MAX_TOKENS_MAX = 128_000;
/** Generous by default: a truncated JSON proposal is worse than a slow answer. */
export const DEFAULT_AI_MAX_TOKENS = 32_768;

/** One MCP server attached to the provider call. */
export interface McpServer {
  name: string;
  url: string;
  token?: string;
}

/** Reasoning effort — the latency lever (lower = faster answer, less depth). */
export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AiConfig {
  provider: string;
  model: string;
  token: string;
  mcpServers: McpServer[];
  /** Provider-side web search (Anthropic, Gemini). Enabled by default. */
  webSearch: boolean;
  /** Reasoning effort; honored by Anthropic and the OpenAI reasoning models. */
  effort: AiEffort;
  /** Output budget in tokens — what cuts a long proposal short when too low. */
  maxTokens: number;
}

/** Provider catalog (default model first) — mirrors the aiAssistant manager. */
export const AI_PROVIDERS: Record<string, { label: string; models: string[] }> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']
  },
  openai: { label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'] },
  mistral: { label: 'Mistral AI', models: ['mistral-large-latest', 'mistral-small-latest'] },
  gemini: { label: 'Google Gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] }
};

/** Selectable effort levels, fastest first. */
export const AI_EFFORTS: AiEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Manager-side default: faster than the providers' own `high` default. */
export const DEFAULT_AI_EFFORT: AiEffort = 'medium';

function toEffort(raw: string): AiEffort {
  const value = raw.trim().toLowerCase() as AiEffort;
  return AI_EFFORTS.includes(value) ? value : DEFAULT_AI_EFFORT;
}

/** Clamp a budget into the accepted range; unparsable -> the default. */
export function toMaxTokens(raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value)) return DEFAULT_AI_MAX_TOKENS;
  return Math.min(Math.max(Math.round(value), AI_MAX_TOKENS_MIN), AI_MAX_TOKENS_MAX);
}

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
  const fallback: AiConfig = {
    provider: 'anthropic',
    model: AI_PROVIDERS['anthropic'].models[0],
    token: '',
    mcpServers: [DEFAULT_MCP_SERVER],
    ...lateDefaults()
  };
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
    const late = await loadLateElements(api);
    return {
      provider: scalar(arr[0]) || fallback.provider,
      model: scalar(arr[1]) || fallback.model,
      token: scalar(arr[2]),
      mcpServers,
      ...late
    };
  } catch {
    return fallback;
  }
}

type LateConfig = Pick<AiConfig, 'webSearch' | 'effort' | 'maxTokens'>;

/** Defaults for the late elements — mirrored from the manager. */
function lateDefaults(): LateConfig {
  return { webSearch: true, effort: DEFAULT_AI_EFFORT, maxTokens: DEFAULT_AI_MAX_TOKENS };
}

/**
 * Read the elements added after the first release, in their OWN dpGet.
 * A single dpGet fails as a whole when any element is unknown, so reading them
 * next to the core ones would make a type that predates them look like a blank
 * config — including an empty token, which the next save would then persist.
 * Missing or empty falls back to the same defaults as the manager.
 */
async function loadLateElements(api: OaRxJsApi): Promise<LateConfig> {
  try {
    const raw = await firstValueFrom(
      api.dpGet(LATE_ELEMENTS.map((element) => `${CONFIG_DP}.${element}`))
    );
    const arr = Array.isArray(raw) ? raw : [raw];
    return {
      webSearch: scalar(arr[0]).trim().toLowerCase() !== 'false',
      effort: toEffort(scalar(arr[1])),
      maxTokens: toMaxTokens(scalar(arr[2]))
    };
  } catch {
    return lateDefaults();
  }
}

async function send(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status}`);
}

/** Swallow a rejected ensure-step: the write that follows is the real check. */
async function ignoreFailure(call: Promise<unknown>): Promise<void> {
  try {
    await call;
  } catch {
    // best effort
  }
}

/** The full expected type definition — used to create it AND to heal it. */
function configStructure(): object {
  return {
    name: CONFIG_TYPE,
    type: 'Struct',
    children: CONFIG_ELEMENTS.map((name) => ({ name, type: 'String', refName: '' }))
  };
}

/**
 * Make sure the type carries every element we are about to write, and that the
 * DP exists. Three cases:
 *  - fresh project: `dptype/create` succeeds, then `dp/create`;
 *  - type already complete: both calls fail (409/400) and nothing is needed;
 *  - type predates `webSearch`/`effort`: `dptype/change` adds them **in place**,
 *    which also adds them to the existing DP (that is why create alone was not
 *    enough — it fails as soon as the type exists, so the missing elements were
 *    never added and `dp/set` then answered 400 on them).
 *
 * All three are best-effort: `dptype/change` requires the `para:edit-types` role,
 * so a user who lacks it gets a 403 here and a precise message from the caller.
 */
async function ensureConfigDp(): Promise<void> {
  const structure = configStructure();
  const created = await fetch(CREATE_TYPE_URL, jsonPost({ typeName: CONFIG_TYPE, structure }))
    .then((res) => res.ok)
    .catch(() => false);
  if (!created) {
    await ignoreFailure(fetch(CHANGE_TYPE_URL, jsonPost({ typeName: CONFIG_TYPE, structure })));
  }
  await ignoreFailure(fetch(CREATE_DP_URL, jsonPost({ dpName: CONFIG_DP, dpType: CONFIG_TYPE })));
}

/**
 * Write the elements added after the first release. They are written separately
 * and tolerantly: when the deployed type could not be healed the core settings
 * must still be saved, and the caller reports which ones stayed behind.
 */
async function setLateElements(cfg: AiConfig): Promise<string[]> {
  const writes: [string, string][] = [
    ['webSearch', cfg.webSearch ? 'true' : 'false'],
    ['effort', cfg.effort],
    ['maxTokens', String(toMaxTokens(cfg.maxTokens))]
  ];
  const missing: string[] = [];
  for (const [element, value] of writes) {
    try {
      // eslint-disable-next-line no-await-in-loop -- two sequential dpSetWait calls
      await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.${element}`, value }));
    } catch {
      missing.push(element);
    }
  }
  return missing;
}

/** Persist the AI config to the datapoint (best-effort ensure type/dp first). */
export async function saveAiConfig(cfg: AiConfig): Promise<void> {
  await ensureConfigDp();
  await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.provider`, value: cfg.provider }));
  await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.model`, value: cfg.model }));
  await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.token`, value: cfg.token }));
  await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.mcpServers`, value: JSON.stringify(cfg.mcpServers) }));
  const missing = await setLateElements(cfg);
  if (missing.length > 0) {
    // The provider/model/token/MCP part IS saved; say so, and say what to do,
    // instead of surfacing a bare "dp/set → 400".
    throw new Error(`${localize(AI_MSG.saveLateFailed)} (${missing.join(', ')})`);
  }
}

/** Send a prompt to the AI; returns the answer text or throws with the error message. */
/**
 * One tool the AI invoked during the answer (via the local MCP loop), with enough
 * trace to be audited: which server answered, what was asked, what came back. The
 * result is capped by the manager — the head of a large answer is what makes the call
 * reviewable, not the whole of it.
 */
export interface ToolCall {
  name: string;
  ok: boolean;
  /** MCP server that served it (its configured name, else its URL). */
  server?: string;
  /** The arguments the model passed. */
  args?: unknown;
  /** The tool's textual result, truncated. */
  result?: string;
}

export interface AiAnswer {
  text: string;
  toolCalls: ToolCall[];
  /**
   * How many MCP tools the model was actually offered. Lets a page tell "no server
   * reachable" (0) from "server up, mutating tools filtered out" — the two look
   * identical in the answer text otherwise.
   */
  mcpTools: number;
  /**
   * The provider stopped because the output budget ran out, so `text` is cut —
   * any JSON proposal inside it is incomplete and must not be trusted.
   */
  truncated: boolean;
}

/**
 * How much of the configured MCP tooling a prompt is allowed to see.
 *
 * `read-only` is what a *proposal-only* page asks for: it gets the project's
 * configured servers, but the manager drops every mutating tool before the model is
 * told it exists (MCP `readOnlyHint` annotation, else a mutation-verb name check).
 * The assistant can therefore look things up — which datapoints exist, a type's
 * structure, a geocoder — and still cannot change anything.
 */
export type McpMode = 'full' | 'read-only';

/** Optional per-call overrides. `system` scopes the assistant (page context + guard-rails). */
export interface AskAiOptions {
  system?: string;
  provider?: string;
  model?: string;
  /**
   * Per-call MCP server override. Pass `[]` to run the prompt with NO tools at all.
   * Prefer `mcpMode: 'read-only'`: it keeps the project's configured servers — so a
   * server added in the config benefits every page — while still forbidding writes.
   * When omitted, the AiAssistant manager uses its configured servers.
   */
  mcpServers?: McpServer[];
  /** Tool-exposure mode; defaults to `full` (every configured tool). */
  mcpMode?: McpMode;
  /** Per-call web-search override (e.g. `false` for a project-only prompt). */
  webSearch?: boolean;
  /** Per-call effort override (e.g. `'low'` for a short, latency-bound prompt). */
  effort?: AiEffort;
  /** Per-call output-budget override (e.g. a page that expects a large proposal). */
  maxTokens?: number;
  /**
   * Id of the live-progress channel for this prompt, from `newProgressId()`. When
   * set, the manager narrates its loop into the `AI_Assistant_Progress` datapoint —
   * see `./ai-progress.ts`. Omit it and nothing is published at all.
   */
  progressId?: string;
}

export async function askAi(prompt: string, options: AskAiOptions = {}): Promise<AiAnswer> {
  const body: { prompt: string } & AskAiOptions = { prompt };
  if (options.system) body.system = options.system;
  if (options.provider) body.provider = options.provider;
  if (options.model) body.model = options.model;
  if (options.mcpServers) body.mcpServers = options.mcpServers;
  if (options.mcpMode) body.mcpMode = options.mcpMode;
  if (typeof options.webSearch === 'boolean') body.webSearch = options.webSearch;
  if (options.effort) body.effort = options.effort;
  if (options.maxTokens) body.maxTokens = options.maxTokens;
  if (options.progressId) body.progressId = options.progressId;
  const res = await fetch(CHAT_URL, jsonPost(body));
  let data: {
    ok?: boolean;
    text?: string;
    error?: string;
    toolCalls?: ToolCall[];
    truncated?: boolean;
    mcpTools?: number;
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error(`Réponse invalide (HTTP ${res.status})`);
  }
  if (!res.ok || !data.ok) throw new Error(data.error || `Erreur IA (HTTP ${res.status})`);
  return {
    text: data.text ?? '',
    toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : [],
    truncated: data.truncated === true,
    mcpTools: typeof data.mcpTools === 'number' ? data.mcpTools : 0
  };
}
