// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Audit-trail engine: read the NGA value history of the fixed `_AuditTrail` leaf
 * elements over a period and pivot them into a time × element table where every
 * archived record is a row showing the carried-forward value of each column.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { firstValueFrom } from 'rxjs';
import { AUDIT_FIELDS, type AuditColumn, type AuditRow } from './types.js';

/** Archived-value attribute appended to a DPE for dpGetPeriod. */
const VALUE_ATTR = ':_original.._value';
/** count = 0 → every archived value in the period. */
const ALL_VALUES = 0;

interface Sample {
  t: number;
  v: unknown;
}

function toMs(t: unknown): number {
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  return new Date(String(t)).getTime();
}

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
    if (Number.isFinite(ms)) samples.push({ t: ms, v: data[i] });
  }
  samples.sort((a, b) => a.t - b.t);
  return samples;
}

/** Archived history of one DPE over [start, end] (ascending by time). */
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

/** Coerce an archived value to a table cell (scalar) value. */
function cell(v: unknown): string | number | null {
  if (v == null) return null;
  return typeof v === 'number' || typeof v === 'string' ? v : String(v);
}

/** Value carried forward to time `t` (last sample with `sample.t <= t`). */
function valueAt(samples: Sample[], t: number): string | number | null {
  let lo = 0;
  let hi = samples.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx === -1 ? null : cell(samples[idx].v);
}

export interface PivotResult {
  rows: AuditRow[];
  /** True when the history exceeded `maxRows` and was truncated to the latest. */
  truncated: boolean;
  /** True when at least one column returned archived data. */
  hasData: boolean;
}

/**
 * Build the pivot: query every column's history, take the union of all change
 * timestamps (most recent first, capped to `maxRows`), and fill each row with
 * the carried-forward value of every column at that timestamp.
 */
export async function buildPivot(
  api: OaRxJsApi | null,
  columns: AuditColumn[],
  start: Date,
  end: Date,
  maxRows: number
): Promise<PivotResult> {
  if (columns.length === 0) return { rows: [], truncated: false, hasData: false };
  const histories = await Promise.all(columns.map((c) => queryHistory(api, c.dpe, start, end)));
  const hasData = histories.some((h) => h.length > 0);
  const timeSet = new Set<number>();
  for (const h of histories) for (const s of h) timeSet.add(s.t);
  const allTimes = [...timeSet].sort((a, b) => b - a);
  const truncated = allTimes.length > maxRows;
  const times = allTimes.slice(0, maxRows);
  const rows: AuditRow[] = times.map((t) => ({
    t,
    values: histories.map((h) => valueAt(h, t))
  }));
  return { rows, truncated, hasData };
}

/** Fixed `_AuditTrail` columns of one DP, in display order. */
export function auditColumns(dpName: string): AuditColumn[] {
  return AUDIT_FIELDS.map((f) => ({ dpe: `${dpName}.${f.key}`, label: f.label }));
}

/**
 * Merged multi-DP pivot: build the pivot of EVERY selected datapoint, tag each
 * row with its source DP, then interleave everything by timestamp (most recent
 * first, capped to `maxRows`) — the "mixed" audit log across datapoints.
 */
export async function buildMergedPivot(
  api: OaRxJsApi | null,
  dpNames: string[],
  start: Date,
  end: Date,
  maxRows: number
): Promise<PivotResult> {
  if (dpNames.length === 0) return { rows: [], truncated: false, hasData: false };
  const results = await Promise.all(dpNames.map((dp) => buildPivot(api, auditColumns(dp), start, end, maxRows)));
  const merged: AuditRow[] = [];
  for (const [i, res] of results.entries()) {
    for (const row of res.rows) merged.push({ ...row, source: dpNames[i] });
  }
  merged.sort((a, b) => b.t - a.t);
  const truncated = merged.length > maxRows || results.some((r) => r.truncated);
  return {
    rows: merged.slice(0, maxRows),
    truncated,
    hasData: results.some((r) => r.hasData)
  };
}
