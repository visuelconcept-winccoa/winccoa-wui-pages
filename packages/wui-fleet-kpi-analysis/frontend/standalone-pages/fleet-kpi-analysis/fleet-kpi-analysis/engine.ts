/**
 * KPI (TRS / OEE) analysis engine for the Machine Fleet.
 *
 * Computes, per machine over a period, the **availability-based TRS**:
 *
 *   Temps requis      = période − arrêts planifiés
 *   Disponibilité     = (Temps requis − arrêts non planifiés) / Temps requis
 *   TRS (dispo seule) = Disponibilité            (performance & qualité = 100 %)
 *
 * Downtime is decomposed exactly like the stop-cause page: non-production
 * intervals (state ≠ ok) are partitioned by active cause, and each sub-segment
 * is bucketed by the cause's catalog **classification**:
 *   - `planned`     → arrêt planifié (subtracted from the required time)
 *   - `production`  → counted as available (neither planned nor unplanned)
 *   - everything else (`unplanned`, unknown code, no cause) → arrêt non planifié
 *
 * Reuses the stop-cause engine's history-query + interval algorithm so both
 * pages share one source of truth.
 */
import type { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import {
  nonProductionIntervals,
  partitionByCause,
  queryHistory,
  resolveGroup,
  type AnalysisMachine
} from '../_vendor/wui-fleet-core/engine.js';
import type { StopCause } from '../_vendor/wui-fleet-core/types.js';
import type { MsInterval } from './closures.js';

export {
  collectMachines,
  formatDuration,
  toHours,
  type AnalysisMachine
} from '../_vendor/wui-fleet-core/engine.js';

/** One machine's availability KPIs over the period. */
export interface KpiRow {
  id: string;
  name: string;
  atelierName: string;
  /** Window length (ms) — identical for every machine. */
  totalMs: number;
  /** Opening time (ms) = window − non-worked periods (the TRS denominator base). */
  openingMs: number;
  /** Planned downtime (ms) — excluded from the required time. */
  plannedMs: number;
  /** Unplanned downtime (ms) — the availability loss. */
  unplannedMs: number;
  /** Required production time (ms) = total − planned. */
  requiredMs: number;
  /** Availability-based TRS in [0, 1]. */
  availability: number;
  /** False when the machine has no archived history on the period. */
  hasData: boolean;
}

export interface KpiResult {
  rows: KpiRow[];
  queriedMachineCount: number;
  noHistory: boolean;
}

/**
 * Run the availability-TRS analysis over [start, end] for the given machines.
 *
 * `nonWorked` maps a machineId to its non-worked intervals (closures); time
 * inside them is removed from the opening time (TRS denominator) and downtime
 * overlapping them is not counted.
 */
export async function analyseKpi(
  api: OaRxJsApi | null,
  machines: AnalysisMachine[],
  catalog: StopCause[],
  start: Date,
  end: Date,
  nonWorked: Map<string, MsInterval[]> = new Map()
): Promise<KpiResult> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const totalMs = endMs - startMs;
  // Look back one window length so the state/cause active at `start` is known.
  const lookbackStart = new Date(startMs - totalMs);

  const rows: KpiRow[] = [];
  let anySample = false;

  for (const machine of machines) {
    // eslint-disable-next-line no-await-in-loop -- sequential keeps backend load bounded
    const stateSamples = await queryHistory(api, machine.stateDp, lookbackStart, end);
    // eslint-disable-next-line no-await-in-loop
    const causeSamples = await queryHistory(api, machine.stopCauseDp, lookbackStart, end);
    const hasData = stateSamples.length > 0 || causeSamples.length > 0;
    if (hasData) anySample = true;

    const closed = mergeClip(nonWorked.get(machine.machineId) ?? [], startMs, endMs);
    const openingMs = Math.max(0, totalMs - sumLength(closed));

    let plannedMs = 0;
    let unplannedMs = 0;
    for (const stop of nonProductionIntervals(stateSamples, machine.mapping, startMs, endMs)) {
      for (const seg of partitionByCause(stop, causeSamples)) {
        // Only count downtime that falls within worked (open) time.
        const worked = seg.end - seg.start - overlapLength(seg.start, seg.end, closed);
        if (worked <= 0) continue;
        const classification = resolveGroup(catalog, seg.code).classification;
        if (classification === 'planned') plannedMs += worked;
        else if (classification === 'production') continue; // available
        else unplannedMs += worked; // unplanned / unknown / no cause
      }
    }

    const requiredMs = Math.max(0, openingMs - plannedMs);
    const availability =
      requiredMs > 0 ? Math.max(0, (requiredMs - unplannedMs) / requiredMs) : 1;
    rows.push({
      id: machine.machineId,
      name: machine.machineName,
      atelierName: machine.atelierName,
      totalMs,
      openingMs,
      plannedMs,
      unplannedMs,
      requiredMs,
      availability,
      hasData
    });
  }

  return { rows, queriedMachineCount: machines.length, noHistory: !anySample };
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

function sumLength(intervals: MsInterval[]): number {
  return intervals.reduce((sum, i) => sum + (i.e - i.s), 0);
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

/** Sort rows by TRS ascending (worst first) so problem machines surface. */
export function sortByTrs(rows: KpiRow[]): KpiRow[] {
  return [...rows].sort(
    (a, b) => a.availability - b.availability || a.name.localeCompare(b.name)
  );
}

/** Format an availability ratio [0,1] as a percentage string, e.g. "92.4 %". */
export function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)} %`;
}
