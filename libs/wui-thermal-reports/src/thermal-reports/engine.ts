// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Thermal-report engine (pure logic): build the setpoint staircase + tolerance
 * band from a recipe, read the *actual* temperature curve from a DPE's
 * NGA-archived history (same `dpGetPeriod` mechanism as the audit-trail / fleet
 * pages), evaluate how well the charge held its band, and — when no archived
 * data is available (offline / unarchived) — synthesise a plausible curve so the
 * report still illustrates the cycle.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { firstValueFrom } from 'rxjs';
import type { ThermalStep } from './types.js';

/** Archived-value attribute appended to a DPE for dpGetPeriod. */
const VALUE_ATTR = ':_original.._value';
/** count = 0 → every archived value in the period. */
const ALL_VALUES = 0;
const MIN_MS = 60_000;
const AMBIENT_C = 20;
/** Target number of synthesised samples across the cycle. */
const SYNTH_POINTS = 360;
/** First-order lag factor for the synthesised curve (0..1 per minute). */
const SYNTH_LAG = 0.18;
const SYNTH_WOBBLE_C = 4;
const FULL_PCT = 100;

export interface Sample {
  /** Epoch ms. */
  t: number;
  /** Temperature (°C). */
  v: number;
}

/** One point of the setpoint staircase + its tolerance band. */
export interface ProfilePoint {
  t: number;
  setpoint: number;
  /** Lower band edge (°C). */
  lo: number;
  /** Upper band edge (°C). */
  hi: number;
}

export interface CycleSummary {
  /** Samples evaluated against the band. */
  count: number;
  /** Percentage of samples inside the tolerance band (0..100). */
  inBandPct: number;
  /** Largest absolute deviation from setpoint over the cycle (°C). */
  maxDeviation: number;
  /** Min / max measured temperature (°C). */
  minTemp: number;
  maxTemp: number;
}

function toMs(t: unknown): number {
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  return new Date(String(t)).getTime();
}

/** Normalise a dpGetPeriod payload (`{data, dataTime}`) into ascending samples. */
function toSamples(raw: unknown): Sample[] {
  const payload = raw as { data?: unknown; dataTime?: unknown } | undefined;
  if (!payload || !Array.isArray(payload.data) || !Array.isArray(payload.dataTime)) return [];
  const data = (Array.isArray(payload.data[0]) ? payload.data[0] : payload.data) as unknown[];
  const times = (
    Array.isArray(payload.dataTime[0]) ? payload.dataTime[0] : payload.dataTime
  ) as unknown[];
  const samples: Sample[] = [];
  for (const [i, t] of times.entries()) {
    const ms = toMs(t);
    const v = Number(data[i]);
    if (Number.isFinite(ms) && Number.isFinite(v)) samples.push({ t: ms, v });
  }
  samples.sort((a, b) => a.t - b.t);
  return samples;
}

/** Read the archived temperature history of a DPE over [start, end]. */
export async function readActualCurve(
  api: OaRxJsApi | null,
  tempDp: string,
  start: Date,
  end: Date
): Promise<Sample[]> {
  if (!api || !tempDp) return [];
  try {
    const raw = await firstValueFrom(api.dpGetPeriod(start, end, ALL_VALUES, tempDp + VALUE_ATTR));
    return toSamples(raw);
  } catch {
    return [];
  }
}

/** Total recipe duration in milliseconds. */
export function recipeDurationMs(steps: ThermalStep[]): number {
  return steps.reduce((sum, s) => sum + Math.max(0, s.durationMin) * MIN_MS, 0);
}

/**
 * Build the setpoint staircase + tolerance band. Two points per step (start and
 * end at the same setpoint) so a `step:'end'` line draws flat holds with vertical
 * transitions. Returns an empty array when there are no steps.
 */
export function buildProfile(steps: ThermalStep[], startMs: number): ProfilePoint[] {
  const pts: ProfilePoint[] = [];
  let t = startMs;
  for (const step of steps) {
    const lo = step.setpoint - Math.abs(step.tolMinus);
    const hi = step.setpoint + Math.abs(step.tolPlus);
    pts.push({ t, setpoint: step.setpoint, lo, hi });
    t += Math.max(0, step.durationMin) * MIN_MS;
    pts.push({ t, setpoint: step.setpoint, lo, hi });
  }
  return pts;
}

/** Setpoint (and band) active at time `t` along the staircase. */
function bandAt(steps: ThermalStep[], startMs: number, t: number): ProfilePoint | null {
  let cursor = startMs;
  for (const step of steps) {
    const next = cursor + Math.max(0, step.durationMin) * MIN_MS;
    if (t >= cursor && t <= next) {
      return {
        t,
        setpoint: step.setpoint,
        lo: step.setpoint - Math.abs(step.tolMinus),
        hi: step.setpoint + Math.abs(step.tolPlus)
      };
    }
    cursor = next;
  }
  return null;
}

/**
 * Synthesise a plausible actual curve that tracks the setpoint with a first-order
 * lag plus a small deterministic wobble — used when no archived data exists, so a
 * demo report still shows a meaningful cycle. Deterministic (no RNG) → stable
 * across re-renders.
 */
export function synthesizeActual(steps: ThermalStep[], startMs: number): Sample[] {
  const durationMs = recipeDurationMs(steps);
  if (durationMs <= 0) return [];
  const stepMs = Math.max(MIN_MS, Math.round(durationMs / SYNTH_POINTS));
  const samples: Sample[] = [];
  let temp = AMBIENT_C;
  for (let t = startMs; t <= startMs + durationMs; t += stepMs) {
    const band = bandAt(steps, startMs, t);
    const target = band ? band.setpoint : temp;
    temp += (target - temp) * SYNTH_LAG;
    const wobble = Math.sin((t - startMs) / (stepMs * 7)) * SYNTH_WOBBLE_C;
    samples.push({ t, v: Math.round((temp + wobble) * 10) / 10 });
  }
  return samples;
}

/** Evaluate how well the actual curve held the recipe's tolerance band. */
export function evaluateCycle(actual: Sample[], steps: ThermalStep[], startMs: number): CycleSummary {
  if (actual.length === 0) {
    return { count: 0, inBandPct: 0, maxDeviation: 0, minTemp: 0, maxTemp: 0 };
  }
  let inBand = 0;
  let evaluated = 0;
  let maxDeviation = 0;
  let minTemp = Number.POSITIVE_INFINITY;
  let maxTemp = Number.NEGATIVE_INFINITY;
  for (const s of actual) {
    minTemp = Math.min(minTemp, s.v);
    maxTemp = Math.max(maxTemp, s.v);
    const band = bandAt(steps, startMs, s.t);
    if (!band) continue;
    evaluated += 1;
    if (s.v >= band.lo && s.v <= band.hi) inBand += 1;
    maxDeviation = Math.max(maxDeviation, Math.abs(s.v - band.setpoint));
  }
  return {
    count: evaluated,
    inBandPct: evaluated === 0 ? 0 : Math.round((inBand / evaluated) * FULL_PCT),
    maxDeviation: Math.round(maxDeviation * 10) / 10,
    minTemp: Number.isFinite(minTemp) ? Math.round(minTemp) : 0,
    maxTemp: Number.isFinite(maxTemp) ? Math.round(maxTemp) : 0
  };
}
