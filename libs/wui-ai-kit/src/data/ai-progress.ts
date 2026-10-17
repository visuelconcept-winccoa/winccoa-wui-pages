// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Live progress of a running prompt: the reasoning as it unfolds, and the tools as
 * they are called.
 *
 * `POST /api/ai/chat` is a single request that returns once, because the bridge
 * underneath it is a unary vRPC call — nothing can be reported *on* it while the
 * agentic loop runs. So the loop narrates itself into the `AI_Assistant_Progress`
 * datapoint and the browser reads that with the same authenticated `dpConnect` it
 * uses for every other live value. No new endpoint, no polling, no extra auth
 * surface.
 *
 * Two properties make the channel simple and robust:
 *
 * - **Each write is cumulative.** The manager republishes the whole event list, so a
 *   write coalesced away by the notification layer loses nothing: whatever value
 *   arrives is complete as of that instant. There is no sequencing to get wrong.
 * - **One datapoint for the project, filtered by id.** A caller passes the
 *   `progressId` it generated, and events for any other prompt are ignored. Which
 *   is also why the manager publishes tool *outcomes* and never tool *results*:
 *   this datapoint is readable by every client, while the full trace comes back on
 *   the caller's own response.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
const PROGRESS_DPE = 'AI_Assistant_Progress.json';

/** Above this, an exact count is noise: the order of magnitude is the information. */
const TOKENS_EXACT_BELOW = 10_000;
const THOUSAND = 1000;

/**
 * Token consumption, summed over the rounds of one prompt.
 *
 * Each round re-sends the whole conversation, so its input counts the previous rounds
 * again — which is exactly what the provider bills, and why the input of a tool-heavy
 * prompt grows much faster than its output.
 *
 * The manager publishes the running total on this channel while the prompt runs, and
 * returns the final one with the answer (`ai-store.ts`): same shape both times, so a
 * panel shows the same line live and after the fact, and adds up a conversation from
 * its answers. Rendering it as text belongs to `ai-usage.ts` — that one localizes, and
 * this module must stay importable without the translation runtime.
 */
export interface AiUsage {
  /** Prompt tokens read by the model, cached part included. */
  tokensIn: number;
  /** Tokens the model produced — reasoning included, where the provider counts it. */
  tokensOut: number;
  /** The part of `tokensIn` the provider served from its own prompt cache. */
  tokensCached: number;
  /** How many model calls (LLM⇄tool round-trips) it took. */
  rounds: number;
}

/** A usage that has counted nothing yet — the neutral element of {@link addUsage}. */
export function emptyUsage(): AiUsage {
  return { tokensIn: 0, tokensOut: 0, tokensCached: 0, rounds: 0 };
}

/** Sum of two usages — how a conversation total is built from its answers. */
export function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    tokensCached: a.tokensCached + b.tokensCached,
    rounds: a.rounds + b.rounds
  };
}

/**
 * A token count, grouped by the browser locale and shortened past ten thousand
 * (`12,3 k`): the last three digits of a live counter change every round and read as
 * noise, while the magnitude is the thing worth watching.
 */
export function formatTokens(count: number): string {
  if (count < TOKENS_EXACT_BELOW) return new Intl.NumberFormat().format(count);
  const thousands = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
    count / THOUSAND
  );
  return `${thousands} k`;
}

/** One narrated step of a running prompt. */
export interface AiProgressEvent {
  type: 'start' | 'mcp' | 'model' | 'thinking' | 'tool-start' | 'tool' | 'usage' | 'done' | 'error';
  /** `model`: which round of the agentic loop (1-based). */
  round?: number;
  /**
   * `usage`: the running token total. There is at most ONE such event in the list —
   * the manager updates it in place rather than appending one per round.
   */
  tokensIn?: number;
  tokensOut?: number;
  tokensCached?: number;
  rounds?: number;
  model?: string;
  provider?: string;
  /** `mcp`: how many tools were offered, and in which exposure mode. */
  count?: number;
  mode?: string;
  /** `tool-start` / `tool`: which tool, on which server, and how it ended. */
  name?: string;
  server?: string;
  ok?: boolean;
  /** `thinking`: the round's reasoning summary. */
  text?: string;
  /** `error`: why the prompt failed. */
  message?: string;
}

/**
 * The running token total carried by a progress list, or `null` while the first
 * round is still in flight (and on a manager that predates the counter).
 */
export function progressUsage(events: readonly AiProgressEvent[]): AiUsage | null {
  const event = events.find((step) => step.type === 'usage');
  if (!event) return null;
  return {
    tokensIn: event.tokensIn ?? 0,
    tokensOut: event.tokensOut ?? 0,
    tokensCached: event.tokensCached ?? 0,
    rounds: event.rounds ?? 0
  };
}

/** A fresh id for one prompt. Not a secret — just something to filter on. */
export function newProgressId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `p${Date.now().toString(36)}${random}`;
}

/**
 * Read one prompt's progress out of a raw datapoint value.
 *
 * Exported for the unit tests, and because the filtering is the whole contract:
 * anything that is not this prompt's payload must yield `null` so a caller never
 * renders another conversation's steps.
 */
export function parseProgress(raw: unknown, progressId: string): AiProgressEvent[] | null {
  const text = typeof raw === 'string' ? raw : '';
  if (!text || !progressId) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object') return null;
  const payload = data as { id?: unknown; events?: unknown };
  if (payload.id !== progressId || !Array.isArray(payload.events)) return null;
  return payload.events.filter(
    (event): event is AiProgressEvent =>
      event !== null && typeof event === 'object' && typeof (event as AiProgressEvent).type === 'string'
  );
}

function noop(): void {
  // nothing to unsubscribe
}

function resolveApi(): OaRxJsApi | null {
  try {
    return container.resolve<OaRxJsApi>(OaRxJsApi);
  } catch {
    return null;
  }
}

/**
 * Follow one prompt's progress until the returned function is called.
 *
 * Never throws and never rejects: an absent datapoint (a project whose manager
 * predates the progress channel) simply means no progress is ever reported, and the
 * answer still arrives normally. Silence is the correct degraded mode here.
 */
export function subscribeAiProgress(
  progressId: string,
  onEvents: (events: AiProgressEvent[]) => void
): () => void {
  const api = resolveApi();
  // No API in the container (isolated dev, or a page mounted outside the shell):
  // the caller still gets an unsubscribe it can call unconditionally.
  if (!api) return noop;
  const subscription = new Subscription();
  try {
    subscription.add(
      api.dpConnect(PROGRESS_DPE, true).subscribe({
        next: (emission: { value?: unknown[] }) => {
          const events = parseProgress(emission.value?.[0], progressId);
          if (events) onEvents(events);
        },
        error: () => {
          // No such datapoint, or no read right: no live progress, no failure.
        }
      })
    );
  } catch {
    // dpConnect refused outright — same degraded mode.
  }
  return () => subscription.unsubscribe();
}
