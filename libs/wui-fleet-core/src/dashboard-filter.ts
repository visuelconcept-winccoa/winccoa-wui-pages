// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Machine dashboard filters.
 *
 *   - context: the production context over time — the work order, and the parameters marked
 *     `filterable` (article, contract…). Selecting values keeps only the time when the
 *     context had one of them (OR within a dimension, AND across dimensions); the Gantt, the
 *     stops and the Pareto then cover those periods only.
 *   - states: the stops starting in one of the selected states;
 *   - causes: the stops attributed to one of the selected causes (grouping keys).
 *
 * The selection is remembered in the browser; a value that no longer appears is ignored.
 */
import type { CauseRow, RawStop } from './engine.js';

export interface MsSpan {
  s: number;
  e: number;
}

/** A context value over a span of time. */
export interface ValueSpan extends MsSpan {
  v: string;
}

export interface DashboardFilter {
  states: string[];
  causes: string[];
  /** Context dimension key → selected values. */
  context: Record<string, string[]>;
}

export const EMPTY_DASHBOARD_FILTER: DashboardFilter = { states: [], causes: [], context: {} };

/** localStorage key of the remembered dashboard filter (shared by every machine). */
export const DASHBOARD_FILTER_STORAGE_KEY = 'wui.machine-fleet.dashboard-filter';

/** A piecewise-constant text history → spans of each value within [start, end] (empty values dropped). */
export function valueSpans(samples: readonly { t: number; v: unknown }[], start: number, end: number): ValueSpan[] {
  const out: ValueSpan[] = [];
  for (const [i, sample] of samples.entries()) {
    const s = Math.max(sample.t, start);
    const e = Math.min(samples[i + 1]?.t ?? end, end);
    const v = sample.v == null ? '' : String(sample.v).trim();
    if (e <= s || v === '') continue;
    const last = out.at(-1);
    if (last && last.v === v && last.e >= s) last.e = Math.max(last.e, e);
    else out.push({ s, e, v });
  }
  return out;
}

/** Distinct values of a dimension, sorted. */
export function spanValues(spans: readonly ValueSpan[]): string[] {
  return [...new Set(spans.map((x) => x.v))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function mergeSpans(list: MsSpan[]): MsSpan[] {
  const sorted = list.filter((x) => x.e > x.s).sort((a, b) => a.s - b.s);
  const out: MsSpan[] = [];
  for (const x of sorted) {
    const last = out.at(-1);
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e);
    else out.push({ s: x.s, e: x.e });
  }
  return out;
}

function intersect(a: MsSpan[], b: MsSpan[]): MsSpan[] {
  const out: MsSpan[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x.s, y.s);
    const e = Math.min(x.e, y.e);
    if (e > s) out.push({ s, e });
  }
  return mergeSpans(out);
}

/**
 * The periods the context selection keeps, or null when no context value is selected (no
 * restriction). A selected dimension without history keeps nothing.
 */
export function allowedSpans(
  dims: Readonly<Record<string, readonly ValueSpan[]>>,
  selected: Readonly<Record<string, readonly string[]>>
): MsSpan[] | null {
  let allowed: MsSpan[] | null = null;
  for (const [key, values] of Object.entries(selected)) {
    if (values.length === 0) continue;
    const kept = mergeSpans((dims[key] ?? []).filter((x) => values.includes(x.v)).map((x) => ({ s: x.s, e: x.e })));
    allowed = allowed === null ? kept : intersect(allowed, kept);
  }
  return allowed;
}

/** Clip timed records to the allowed periods (a record straddling a boundary is cut). */
export function clipToSpans<T extends { startMs: number; endMs: number }>(items: readonly T[], allowed: MsSpan[] | null): T[] {
  if (allowed === null) return [...items];
  const out: T[] = [];
  for (const item of items) {
    for (const a of allowed) {
      const s = Math.max(item.startMs, a.s);
      const e = Math.min(item.endMs, a.e);
      if (e > s) out.push({ ...item, startMs: s, endMs: e, ...('durationMs' in item ? { durationMs: e - s } : {}) });
    }
  }
  return out;
}

/** Pareto rows recomputed from (filtered) stops: time and number of stops per cause. */
export function paretoFromStops(stops: readonly RawStop[]): CauseRow[] {
  const rows = new Map<string, CauseRow>();
  for (const s of stops) {
    const row = rows.get(s.causeKey) ?? {
      key: s.causeKey,
      label: s.causeLabel,
      classification: s.classification ?? 'unplanned',
      assignedMs: 0,
      downtimeMs: 0,
      occurrences: 0,
      perMachine: new Map<string, number>()
    };
    row.assignedMs += s.countedMs;
    row.downtimeMs += s.durationMs;
    row.occurrences += 1;
    row.perMachine.set(s.machineId, (row.perMachine.get(s.machineId) ?? 0) + s.countedMs);
    rows.set(s.causeKey, row);
  }
  return [...rows.values()];
}

/** The remembered filter (empty when none or unreadable). */
export function loadDashboardFilter(): DashboardFilter {
  try {
    const raw = globalThis.localStorage?.getItem(DASHBOARD_FILTER_STORAGE_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<DashboardFilter>) : {};
    const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
    const context: Record<string, string[]> = {};
    if (p.context && typeof p.context === 'object') for (const [k, v] of Object.entries(p.context)) context[k] = strings(v);
    return { states: strings(p.states), causes: strings(p.causes), context };
  } catch {
    return { states: [], causes: [], context: {} };
  }
}

export function saveDashboardFilter(filter: DashboardFilter): void {
  try {
    globalThis.localStorage?.setItem(DASHBOARD_FILTER_STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // Storage unavailable: the filter just isn't remembered.
  }
}
