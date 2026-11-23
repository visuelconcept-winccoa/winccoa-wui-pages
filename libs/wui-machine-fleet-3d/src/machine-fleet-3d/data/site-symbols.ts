// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The site's machines for « Add a symbol › From the site » (winccoa-fra-msp-stma#381), replacing the site catalogue
 * the module no longer keeps (winccoa-fra-msp-stma#349): the site declares, in the module settings
 * (`siteSymbolsUrl`), a path of its web server answering a GET with `{ ok, text, data, groups? }` — `data` a
 * `machine-fleet-symbols` file (as a workcenter's export, #337) holding every machine of the site, `groups` the label
 * of each workcenter by its datapoint, to list the machines by workcenter. Read with the user's token, a time limit
 * and an explicit error (never a wait without end); never throws.
 */
import { parseSymbolImport } from '../symbol-import.js';
import type { MachineDef, StateMapping } from '../types.js';

export const SITE_SYMBOLS_TIMEOUT_MS = 15_000;

export type SiteSymbols =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'error'; text: string }
  | { state: 'ok'; symbols: MachineDef[]; mappings: StateMapping[]; groups: Record<string, string> };

/** The answer of the site's route, read: its machines, or why there are none. */
export function readSiteSymbols(status: number, body: unknown): SiteSymbols {
  if (status === 404) return { state: 'error', text: `the site serves no machines at this address (HTTP 404)` };
  if (status === 401 || status === 403) return { state: 'error', text: `access refused (HTTP ${status})` };
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (!b) return { state: 'error', text: `unreadable answer (HTTP ${status})` };
  const text = typeof b['text'] === 'string' ? b['text'] : '';
  if (b['ok'] !== true) return { state: 'error', text: text || `HTTP ${status}` };
  const parsed = parseSymbolImport(JSON.stringify(b['data'] ?? null));
  if (!parsed.ok) {
    // A site without any machine answers an empty list: nothing to offer, not an error.
    if (parsed.reason === 'noSymbol') return { state: 'ok', symbols: [], mappings: [], groups: {} };
    return { state: 'error', text: `not a machine-fleet-symbols file (${parsed.reason})` };
  }
  const groups: Record<string, string> = {};
  const g = b['groups'];
  if (g && typeof g === 'object' && !Array.isArray(g)) {
    for (const [k, v] of Object.entries(g as Record<string, unknown>)) if (typeof v === 'string' && v.trim()) groups[k] = v.trim();
  }
  return { state: 'ok', symbols: parsed.symbols, mappings: parsed.mappings, groups };
}

/** The site's machines, from the path its settings declare ('' or absent: none declared). */
export async function loadSiteSymbols(
  path: string | undefined,
  headers: Record<string, string> = {},
  fetchFn: typeof fetch = fetch,
  timeoutMs = SITE_SYMBOLS_TIMEOUT_MS
): Promise<SiteSymbols> {
  if (!path) return { state: 'none' };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchFn(path, { method: 'GET', cache: 'no-store', headers, signal: abort.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return readSiteSymbols(res.status, body);
  } catch (error) {
    const why = abort.signal.aborted ? `no answer in ${timeoutMs / 1000} s` : error instanceof Error ? error.message : String(error);
    return { state: 'error', text: why };
  } finally {
    clearTimeout(timer);
  }
}

/** The label a site machine is listed under: its workcenter's, else the workcenter's datapoint, else ''. */
export function siteGroupOf(def: MachineDef, groups: Readonly<Record<string, string>>): string {
  const wc = typeof def.workcenter === 'string' ? def.workcenter : '';
  return (wc && groups[wc]) || wc.replace(/^WC_/, '') || '';
}

/** The state mappings the given symbols use, among those of the site's file. */
export function mappingsOf(defs: readonly MachineDef[], mappings: readonly StateMapping[]): StateMapping[] {
  const used = new Set(defs.map((d) => d.stateMappingId).filter((id): id is string => !!id));
  return mappings.filter((m) => used.has(m.id));
}
