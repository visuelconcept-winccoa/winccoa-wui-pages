// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Data access for the Poseidon page.
 *
 *  - **Live values**: `OaRxJsApi.dpConnect` on the station sensor DPEs and every
 *    equipment DPE (the values the `poseidon` simulator manager writes). Same
 *    mechanism the other dashboard pages use; offline-tolerant (falls back to
 *    the last-known values when the backend is not connected).
 *  - **History**: `OaRxJsApi.dpGetPeriod` for the trend curves.
 *  - **Control & summaries**: the `/api/poseidon` backend route (equipment
 *    start/stop/auto-manual, and the server-side KPI / regulatory report).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { firstValueFrom } from 'rxjs';
import type { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import {
  ALL_SENSOR_PATHS,
  EQUIP_PREFIX,
  STATION_DP,
  equipPaths
} from '../model.js';
import type { ControlAction, EquipmentState, EquipmentStates, KpiSummary, SensorValues, TrendSample } from '../types.js';

const BASE = '/api/poseidon';
/** Archived-value attribute appended to a DPE for dpGetPeriod. */
const VALUE_ATTR = ':_original.._value';
/** count = 0 → every archived value in the period. */
const ALL_VALUES = 0;

interface DpEmission {
  dp: string[];
  value: unknown[];
}

/** Resolve the shared OaRxJsApi, or null when unavailable (isolated dev / no DI). */
export function resolveApi(): OaRxJsApi | null {
  try {
    return container.resolve<OaRxJsApi>(OaRxJsApi);
  } catch {
    return null;
  }
}

/** Strip system prefix + config suffix + trailing dot from a dpConnect dp string. */
function bareDpe(dp: string): string {
  let s = dp.replace(/^[^:]+:/, ''); // drop "System1:"
  const cfg = s.indexOf(':'); // drop ":_online.._value"
  if (cfg !== -1) s = s.slice(0, cfg);
  return s.replace(/\.$/, '');
}

function toNumber(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Subscribe to the station sensor DPEs. `cb` receives the full merged
 * {@link SensorValues} (keyed by "group.field") on every emission.
 * Returns the Subscription (or null when the backend is unavailable).
 */
export function connectSensors(cb: (values: SensorValues) => void): Subscription | null {
  const api = resolveApi();
  if (!api) return null;
  const dpes = ALL_SENSOR_PATHS.map((p) => `${STATION_DP}.${p}`);
  const values: SensorValues = {};
  try {
    return api.dpConnect(dpes, true).subscribe({
      next: (e: DpEmission) => {
        for (const [i, dp] of e.dp.entries()) {
          const path = bareDpe(dp).replace(`${STATION_DP}.`, '');
          values[path] = toNumber(e.value[i]);
        }
        cb({ ...values });
      },
      error: () => {
        /* live channel dropped — keep the last-known values */
      }
    });
  } catch {
    return null;
  }
}

/**
 * Subscribe to every equipment DPE. `cb` receives the full {@link EquipmentStates}
 * (keyed by equipment id) on every emission.
 */
export function connectEquipment(cb: (states: EquipmentStates) => void): Subscription | null {
  const api = resolveApi();
  if (!api) return null;
  const dpes = equipPaths();
  const states: EquipmentStates = {};
  try {
    return api.dpConnect(dpes, true).subscribe({
      next: (e: DpEmission) => {
        for (const [i, dp] of e.dp.entries()) {
          const bare = bareDpe(dp).slice(EQUIP_PREFIX.length); // "liftPump1.state"
          const dot = bare.lastIndexOf('.');
          if (dot === -1) continue;
          const id = bare.slice(0, dot);
          const elem = bare.slice(dot + 1);
          const cur: EquipmentState = states[id] ?? { state: 0, mode: 1, feedback: 0, current: 0, runningHours: 0 };
          (cur as Record<string, number>)[elem] = toNumber(e.value[i]);
          states[id] = cur;
        }
        cb({ ...states });
      },
      error: () => {
        /* keep the last-known states */
      }
    });
  } catch {
    return null;
  }
}

/** Query one sensor path's archived values over [from, to] as time-sorted samples. */
export async function loadTrend(path: string, from: Date, to: Date): Promise<TrendSample[]> {
  const api = resolveApi();
  if (!api) return [];
  try {
    const raw = await firstValueFrom(api.dpGetPeriod(from, to, ALL_VALUES, `${STATION_DP}.${path}${VALUE_ATTR}`));
    return toSamples(raw);
  } catch {
    return [];
  }
}

/** Normalise the dpGetPeriod payload (single DPE) into sorted {t, v} samples. */
function toSamples(raw: unknown): TrendSample[] {
  const payload = raw as { data?: unknown; dataTime?: unknown } | undefined;
  if (!payload || !Array.isArray(payload.data) || !Array.isArray(payload.dataTime)) return [];
  const data = (Array.isArray(payload.data[0]) ? payload.data[0] : payload.data) as unknown[];
  const times = (Array.isArray(payload.dataTime[0]) ? payload.dataTime[0] : payload.dataTime) as unknown[];
  const out: TrendSample[] = [];
  for (const [i, t] of times.entries()) {
    const ms = toMs(t);
    const v = Number(Array.isArray(data[i]) ? (data[i] as unknown[])[0] : data[i]);
    if (Number.isFinite(ms) && Number.isFinite(v)) out.push({ t: ms, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function toMs(t: unknown): number {
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  return new Date(String(t)).getTime();
}

// --- backend route ----------------------------------------------------------

async function postJson<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** Send an equipment command (start/stop/auto/manual) through the backend. */
export function controlEquipment(equipment: string, action: ControlAction): Promise<{ ok: boolean }> {
  return postJson(`${BASE}/control`, { equipment, action });
}

/** Fetch the server-computed KPI summary. */
export async function fetchKpi(): Promise<KpiSummary | null> {
  try {
    const res = await fetch(`${BASE}/kpi`);
    const data = (await res.json()) as { ok?: boolean; kpi?: KpiSummary };
    return res.ok && data.ok && data.kpi ? data.kpi : null;
  } catch {
    return null;
  }
}
