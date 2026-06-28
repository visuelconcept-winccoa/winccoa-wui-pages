// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stop-cause analysis engine for the Machine Fleet.
 *
 * Decomposes machine downtime into stop causes across multiple machines, over a
 * time window, by cross-referencing two archived datapoint histories per machine:
 *
 *  - the **state** datapoint (numeric → resolved to ok/warn/stop/maint via the
 *    machine's StateMapping). Any state other than `ok` is "non-production".
 *  - the **stop-cause** datapoint (string code; empty during production).
 *
 * For every non-production interval the active cause is attributed to it, with
 * two boundary corrections the real world requires:
 *   1. *Recouvrement* — the cause is still set when the machine resumes
 *      production → the cause's time is **truncated** to the stop interval end.
 *   2. *Cause assignée plus tard* — the stop begins before any cause is set →
 *      the leading gap is **back-filled** to the first cause of the stop
 *      ("ajuster la cause au début de l'arrêt"). Internal/trailing gaps carry
 *      the previously active cause forward, so the whole stop is decomposed.
 *
 * Unknown / out-of-catalog codes fold onto the catalog's default entry
 * (`isDefault`), mirroring {@link formatStopCause}.
 */
import type { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { firstValueFrom } from 'rxjs';
import {
  DEFAULT_STATE_MAPPINGS,
  resolveState,
  type Atelier,
  type StateMapping,
  type StopCause,
  type StopClassification
} from './types.js';
import type { MsInterval } from './closures.js';

/** A machine eligible for analysis (both histories bound). */
export interface AnalysisMachine {
  atelierId: string;
  atelierName: string;
  machineId: string;
  machineName: string;
  stateDp: string;
  stopCauseDp: string;
  mapping: StateMapping | undefined;
}

/** One aggregated cause row of the result table. */
export interface CauseRow {
  /** Grouping key (catalog code, default code, or the synthetic no-cause key). */
  key: string;
  /** Display label, e.g. "12 — Manque matière". */
  label: string;
  classification?: StopClassification;
  /** Cumulated time attributed to this cause, counted on worked (open) time, ms. */
  assignedMs: number;
  /** Total downtime of stops in which this cause appears (union per stop), ms. */
  downtimeMs: number;
  /** Number of stops attributed to this cause. */
  occurrences: number;
  /** Per-machine attributed time (machineId → ms), for the stacked chart. */
  perMachine: Map<string, number>;
}

/** One raw stop record (a contiguous downtime period attributed to a cause). */
export interface RawStop {
  machineId: string;
  machineName: string;
  atelierName: string;
  /** Grouping key (same as the aggregated row's key). */
  causeKey: string;
  /** Display label, e.g. "12 — Manque matière". */
  causeLabel: string;
  classification?: StopClassification;
  /** Period start / end (ms epoch). */
  startMs: number;
  endMs: number;
  durationMs: number;
  /** Portion of the period within worked (open) time — what actually counts, ms. */
  countedMs: number;
}

/** Full analysis output. */
export interface AnalysisResult {
  rows: CauseRow[];
  /** Every individual attributed downtime period (for the raw-data view). */
  rawStops: RawStop[];
  /** Machines that contributed at least one stop (chart series order). */
  machines: { id: string; name: string }[];
  totalAssignedMs: number;
  /** Machines actually queried (with bound histories). */
  queriedMachineCount: number;
  /** True when no archived sample was returned for any machine. */
  noHistory: boolean;
}

/** Sort criteria for the result rows. */
export type SortKey = 'assigned' | 'downtime' | 'occurrences';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;
const MS_PER_DAY = MS_PER_HOUR * HOURS_PER_DAY;

/** Archived-value attribute appended to a DPE for dpGetPeriod. */
const VALUE_ATTR = ':_original.._value';
/** count = 0 → return every archived value in the period. */
const ALL_VALUES = 0;

/** Synthetic key/label for downtime with no cause and no catalog default. */
const NO_CAUSE_KEY = '__none__';
const NO_CAUSE_LABEL = 'Sans cause assignée';

/** A piecewise-constant sample: a value effective from time `t` (ms epoch). */
interface Sample {
  t: number;
  v: unknown;
}

/** Build the list of analysable machines from the selected ateliers/machines. */
export function collectMachines(
  ateliers: Atelier[],
  selectedAtelierIds: Set<string>,
  selectedMachineIds: Set<string>
): AnalysisMachine[] {
  const out: AnalysisMachine[] = [];
  for (const atelier of ateliers) {
    if (selectedAtelierIds.size > 0 && !selectedAtelierIds.has(atelier.id)) continue;
    for (const m of atelier.machines) {
      if (selectedMachineIds.size > 0 && !selectedMachineIds.has(m.id)) continue;
      if (!m.stateDp || !m.stopCauseDp) continue;
      out.push({
        atelierId: atelier.id,
        atelierName: atelier.name,
        machineId: m.id,
        machineName: m.name,
        stateDp: m.stateDp,
        stopCauseDp: m.stopCauseDp,
        mapping:
          atelier.mappings.find((mp) => mp.id === m.stateMappingId) ??
          atelier.mappings[0] ??
          DEFAULT_STATE_MAPPINGS[0]
      });
    }
  }
  return out;
}

/**
 * Run the analysis over [start, end] for the given machines. Queries each
 * machine's state + cause history (looking back one window-length before
 * `start` to know the state/cause active at the boundary), then aggregates.
 *
 * `nonWorked` maps a machineId to its non-worked intervals (closures); downtime
 * falling inside them is **not** counted — a stop straddling a closure is split
 * so only its worked portions are attributed to causes.
 */
export async function analyseStopCauses(
  api: OaRxJsApi | null,
  machines: AnalysisMachine[],
  catalog: StopCause[],
  start: Date,
  end: Date,
  nonWorked: Map<string, MsInterval[]> = new Map()
): Promise<AnalysisResult> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  // Look back one window length so the value active at `start` is known.
  const lookbackStart = new Date(startMs - (endMs - startMs));

  const agg = new Map<string, CauseRow>();
  const contributing = new Map<string, string>();
  const rawStops: RawStop[] = [];
  let anySample = false;

  for (const machine of machines) {
    // eslint-disable-next-line no-await-in-loop -- sequential keeps backend load bounded
    const stateSamples = await queryHistory(api, machine.stateDp, lookbackStart, end);
    // eslint-disable-next-line no-await-in-loop
    const causeSamples = await queryHistory(api, machine.stopCauseDp, lookbackStart, end);
    if (stateSamples.length > 0 || causeSamples.length > 0) anySample = true;

    const closed = mergeClip(nonWorked.get(machine.machineId) ?? [], startMs, endMs);
    const stops = nonProductionIntervals(stateSamples, machine.mapping, startMs, endMs);
    for (const stop of stops) {
      attributeStop(stop, causeSamples, catalog, machine, agg, contributing, rawStops, closed);
    }
  }

  const rows = [...agg.values()];
  const totalAssignedMs = rows.reduce((sum, r) => sum + r.assignedMs, 0);
  const chartMachines = machines
    .filter((m) => contributing.has(m.machineId))
    .map((m) => ({ id: m.machineId, name: m.machineName }));
  // Most recent first.
  rawStops.sort((a, b) => b.startMs - a.startMs);

  return {
    rows,
    rawStops,
    machines: chartMachines,
    totalAssignedMs,
    queriedMachineCount: machines.length,
    noHistory: !anySample
  };
}

/** Sort rows by the chosen criterion (descending), returning a new array. */
export function sortRows(rows: CauseRow[], key: SortKey): CauseRow[] {
  const metric: Record<SortKey, (r: CauseRow) => number> = {
    assigned: (r) => r.assignedMs,
    downtime: (r) => r.downtimeMs,
    occurrences: (r) => r.occurrences
  };
  const value = metric[key];
  return [...rows].sort((a, b) => value(b) - value(a) || a.label.localeCompare(b.label));
}

/** Human-readable duration, e.g. "3 j 04 h", "12 h 30 min", "45 min", "0 s". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0 s';
  const days = Math.floor(ms / MS_PER_DAY);
  const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  if (days > 0) return `${days} j ${pad2(hours)} h`;
  if (hours > 0) return `${hours} h ${pad2(minutes)} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${Math.floor(ms / MS_PER_SECOND)} s`;
}

/** Decimal hours (for chart axes/tooltips). */
export function toHours(ms: number): number {
  return Math.round((ms / MS_PER_HOUR) * 100) / 100;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// --- history query ----------------------------------------------------------

/** Query one DPE's archived values over a period as time-sorted samples. */
export async function queryHistory(
  api: OaRxJsApi | null,
  dpe: string,
  start: Date,
  end: Date
): Promise<Sample[]> {
  if (!api) return [];
  try {
    const raw = await firstValueFrom(api.dpGetPeriod(start, end, ALL_VALUES, dpe + VALUE_ATTR));
    return toSamples(raw);
  } catch {
    return [];
  }
}

/** Normalise the dpGetPeriod payload (single DPE) into sorted samples. */
function toSamples(raw: unknown): Sample[] {
  const payload = raw as { data?: unknown; dataTime?: unknown } | undefined;
  if (!payload || !Array.isArray(payload.data) || !Array.isArray(payload.dataTime)) return [];
  // A single-DPE query yields flat arrays; a multi-DPE query nests them — unwrap.
  const data = (Array.isArray(payload.data[0]) ? payload.data[0] : payload.data) as unknown[];
  const times = (
    Array.isArray(payload.dataTime[0]) ? payload.dataTime[0] : payload.dataTime
  ) as unknown[];
  const samples: Sample[] = [];
  for (const [i, t] of times.entries()) {
    const ms = toMs(t);
    if (Number.isFinite(ms)) samples.push({ t: ms, v: data[i] });
  }
  samples.sort((a, b) => a.t - b.t);
  return samples;
}

/** Coerce a timestamp (ms number, ISO string, or Date) to ms epoch. */
function toMs(t: unknown): number {
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  return new Date(String(t)).getTime();
}

// --- interval algorithm ------------------------------------------------------

/**
 * Build the merged non-production intervals within [windowStart, windowEnd].
 * The state active at `windowStart` is taken from the last sample at-or-before
 * it (the look-back guarantees one exists when the machine was already down).
 */
export function nonProductionIntervals(
  samples: Sample[],
  mapping: StateMapping | undefined,
  windowStart: number,
  windowEnd: number
): { s: number; e: number }[] {
  if (samples.length === 0) return [];
  const intervals: { s: number; e: number }[] = [];
  for (const [i, sample] of samples.entries()) {
    const segStart = Math.max(sample.t, windowStart);
    const segEnd = Math.min(samples[i + 1]?.t ?? windowEnd, windowEnd);
    if (segEnd <= segStart) continue;
    const state = resolveState(mapping, Math.round(toNumber(sample.v)));
    if (state === 'ok') continue;
    const last = intervals.at(-1);
    if (last && last.e >= segStart) last.e = Math.max(last.e, segEnd);
    else intervals.push({ s: segStart, e: segEnd });
  }
  return intervals;
}

/** Clip intervals to [lo, hi] and merge overlaps (sorted, non-overlapping). */
function mergeClip(intervals: MsInterval[], lo: number, hi: number): MsInterval[] {
  const clipped = intervals
    .map((i) => ({ s: Math.max(i.s, lo), e: Math.min(i.e, hi) }))
    .filter((i) => i.e > i.s)
    .sort((a, b) => a.s - b.s);
  const out: MsInterval[] = [];
  for (const i of clipped) {
    const last = out.at(-1);
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e);
    else out.push({ ...i });
  }
  return out;
}

/** Total overlap of [s, e) with a set of (merged) intervals. */
function overlapLength(s: number, e: number, intervals: MsInterval[]): number {
  let sum = 0;
  for (const i of intervals) {
    const a = Math.max(s, i.s);
    const b = Math.min(e, i.e);
    if (b > a) sum += b - a;
  }
  return sum;
}

/**
 * Attribute one stop interval to its cause(s) and fold the result into `agg`.
 * Partitions [s, e) into cause sub-segments (leading back-fill + carry-forward),
 * so the attributed times sum to the stop's length.
 */
// eslint-disable-next-line max-params -- internal aggregator threading several sinks
function attributeStop(
  stop: { s: number; e: number },
  causeSamples: Sample[],
  catalog: StopCause[],
  machine: AnalysisMachine,
  agg: Map<string, CauseRow>,
  contributing: Map<string, string>,
  rawStops: RawStop[],
  closed: MsInterval[] = []
): void {
  // Worked portion of the whole stop (excludes non-worked periods). A stop fully
  // inside a closure counts for nothing and is dropped entirely.
  const workedStopMs = stop.e - stop.s - overlapLength(stop.s, stop.e, closed);
  if (workedStopMs <= 0) return;

  const partition = partitionByCause(stop, causeSamples);
  const perKey = new Map<string, number>();
  for (const seg of partition) {
    const { key, label, classification } = resolveGroup(catalog, seg.code);
    const countedMs = seg.end - seg.start - overlapLength(seg.start, seg.end, closed);
    perKey.set(key, (perKey.get(key) ?? 0) + Math.max(0, countedMs));
    rawStops.push({
      machineId: machine.machineId,
      machineName: machine.machineName,
      atelierName: machine.atelierName,
      causeKey: key,
      causeLabel: label,
      classification,
      startMs: seg.start,
      endMs: seg.end,
      durationMs: seg.end - seg.start,
      countedMs: Math.max(0, countedMs)
    });
  }
  for (const [key, ms] of perKey) {
    if (ms <= 0) continue;
    const row = ensureRow(agg, catalog, key);
    row.assignedMs += ms;
    row.downtimeMs += workedStopMs;
    row.occurrences += 1;
    row.perMachine.set(machine.machineId, (row.perMachine.get(machine.machineId) ?? 0) + ms);
    contributing.set(machine.machineId, machine.machineName);
  }
}

/**
 * Partition [s, e) into contiguous (code) sub-segments. The code active at `s`
 * is the last cause at-or-before `s`; a leading empty span is back-filled with
 * the first non-empty code of the stop; empty spans afterwards carry the
 * previously active code forward.
 */
export function partitionByCause(
  stop: { s: number; e: number },
  causeSamples: Sample[]
): { start: number; end: number; code: string }[] {
  const boundaries = causeBoundaries(stop, causeSamples);
  const segments: { start: number; end: number; code: string }[] = [];
  // Seed with the first real code so leading empty spans back-fill to it; each
  // non-empty span then updates the carried code, empty spans inherit it.
  let carried = firstNonEmpty(boundaries);
  for (const seg of boundaries) {
    const code = seg.code === '' ? carried : seg.code;
    carried = code;
    const last = segments.at(-1);
    if (last && last.code === code) last.end = seg.end;
    else segments.push({ start: seg.start, end: seg.end, code });
  }
  return segments;
}

/** Raw cause spans clipped to [s, e); codes may be empty. */
function causeBoundaries(
  stop: { s: number; e: number },
  causeSamples: Sample[]
): { start: number; end: number; code: string }[] {
  const spans: { start: number; end: number; code: string }[] = [];
  let cursor = stop.s;
  let activeCode = codeAt(causeSamples, stop.s);
  for (const sample of causeSamples) {
    if (sample.t <= stop.s || sample.t >= stop.e) continue;
    if (sample.t > cursor) spans.push({ start: cursor, end: sample.t, code: activeCode });
    cursor = sample.t;
    activeCode = normCode(sample.v);
  }
  if (cursor < stop.e) spans.push({ start: cursor, end: stop.e, code: activeCode });
  return spans;
}

function firstNonEmpty(spans: { code: string }[]): string {
  return spans.find((s) => s.code !== '')?.code ?? '';
}

/** Cause code active at time `t` (last sample at-or-before `t`). */
function codeAt(causeSamples: Sample[], t: number): string {
  let code = '';
  for (const sample of causeSamples) {
    if (sample.t > t) break;
    code = normCode(sample.v);
  }
  return code;
}

function normCode(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Resolve a raw code to its grouping key/label (unknown → catalog default). */
export function resolveGroup(
  catalog: StopCause[],
  code: string
): { key: string; label: string; classification?: StopClassification } {
  if (code !== '') {
    const entry = catalog.find((c) => c.code === code);
    if (entry) {
      return { key: entry.code, label: `${entry.code} — ${entry.description}`, classification: entry.classification };
    }
  }
  const fallback = catalog.find((c) => c.isDefault);
  if (fallback) {
    return {
      key: fallback.code,
      label: `${fallback.code} — ${fallback.description}`,
      classification: fallback.classification
    };
  }
  if (code === '') return { key: NO_CAUSE_KEY, label: NO_CAUSE_LABEL };
  return { key: code, label: code };
}

function ensureRow(agg: Map<string, CauseRow>, catalog: StopCause[], key: string): CauseRow {
  const existing = agg.get(key);
  if (existing) return existing;
  const group = resolveGroup(catalog, key === NO_CAUSE_KEY ? '' : key);
  const row: CauseRow = {
    key,
    label: group.label,
    classification: group.classification,
    assignedMs: 0,
    downtimeMs: 0,
    occurrences: 0,
    perMachine: new Map<string, number>()
  };
  agg.set(key, row);
  return row;
}
