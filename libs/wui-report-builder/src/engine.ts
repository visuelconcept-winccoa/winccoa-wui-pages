/**
 * Report-builder engine (pure logic): read a datapoint's archived history over a
 * period and aggregate it (avg/min/max/sum/last/count/stddev), plus the workflow
 * helpers that gate signing (checklist completion + permission) and apply
 * signatures / rejects to a report instance.
 *
 * The archive read uses the same `dpGetPeriod(... ':_original.._value')`
 * mechanism as the thermal-reports / audit-trail pages.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { firstValueFrom } from 'rxjs';
import {
  nowLocal,
  uid,
  type AggOp,
  type DatasetResult,
  type RejectTransition,
  type Report,
  type SignatureRecord,
  type WorkflowState
} from './types.js';

/** Archived-value attribute appended to a DPE for dpGetPeriod. */
const VALUE_ATTR = ':_original.._value';
/** count = 0 → every archived value in the period. */
const ALL_VALUES = 0;
const ROUND = 1000;

export interface Sample {
  t: number;
  v: number;
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
  const times = (Array.isArray(payload.dataTime[0]) ? payload.dataTime[0] : payload.dataTime) as unknown[];
  const samples: Sample[] = [];
  for (const [i, t] of times.entries()) {
    const ms = toMs(t);
    const v = Number(data[i]);
    if (Number.isFinite(ms) && Number.isFinite(v)) samples.push({ t: ms, v });
  }
  samples.sort((a, b) => a.t - b.t);
  return samples;
}

/** Read the archived history of a DPE over [start, end]. Empty on error / no data. */
export async function readSeries(
  api: OaRxJsApi | null,
  dp: string,
  start: Date,
  end: Date
): Promise<Sample[]> {
  if (!api || !dp) return [];
  try {
    const raw = await firstValueFrom(api.dpGetPeriod(start, end, ALL_VALUES, dp + VALUE_ATTR));
    return toSamples(raw);
  } catch {
    return [];
  }
}

function round(v: number): number {
  return Math.round(v * ROUND) / ROUND;
}

/** Compute one aggregation over the sample values (loop-based, no spread). */
function computeOp(op: AggOp, samples: Sample[]): number {
  const n = samples.length;
  if (op === 'count') return n;
  if (n === 0) return 0;
  if (op === 'last') return round(samples[n - 1].v);
  let sum = 0;
  let min = samples[0].v;
  let max = samples[0].v;
  for (const s of samples) {
    sum += s.v;
    if (s.v < min) min = s.v;
    if (s.v > max) max = s.v;
  }
  const mean = sum / n;
  switch (op) {
    case 'avg': {
      return round(mean);
    }
    case 'min': {
      return round(min);
    }
    case 'max': {
      return round(max);
    }
    case 'sum': {
      return round(sum);
    }
    case 'stddev': {
      let variance = 0;
      for (const s of samples) variance += (s.v - mean) ** 2;
      return round(Math.sqrt(variance / n));
    }
    default: {
      return 0;
    }
  }
}

/** Aggregate a dataset over the period; returns a snapshot {agg, n, computedAt}. */
export async function computeDataset(
  api: OaRxJsApi | null,
  dp: string,
  start: Date,
  end: Date,
  ops: AggOp[]
): Promise<DatasetResult> {
  const samples = await readSeries(api, dp, start, end);
  const agg: Partial<Record<AggOp, number>> = {};
  for (const op of ops) agg[op] = computeOp(op, samples);
  return { agg, n: samples.length, computedAt: new Date().toISOString() };
}

// --- workflow ---------------------------------------------------------------

export function findState(report: Report, id: string): WorkflowState | undefined {
  return report.workflow.find((s) => s.id === id);
}

export function currentState(report: Report): WorkflowState | undefined {
  return findState(report, report.currentStateId);
}

/** A final state freezes the report (read-only). */
export function isLocked(report: Report): boolean {
  return currentState(report)?.kind === 'final';
}

/** All `required` checklist items across the report are checked. */
export function checklistComplete(report: Report): boolean {
  for (const section of report.sections) {
    if (section.kind !== 'checklist') continue;
    const checked = report.data[section.id]?.checked ?? {};
    for (const item of section.items ?? []) {
      if (item.required && checked[item.id] !== true) return false;
    }
  }
  return true;
}

export interface AdvanceCheck {
  ok: boolean;
  reason: string;
}

/** Whether the report can advance to the next state right now (and why not). */
export function canAdvance(report: Report, canPublish: boolean): AdvanceCheck {
  const advance = currentState(report)?.advance;
  if (!advance) return { ok: false, reason: 'Aucune transition depuis cet état.' };
  if (advance.requirePermission && !canPublish) {
    return { ok: false, reason: 'Permission de publication requise pour signer.' };
  }
  if (advance.requireChecklist && !checklistComplete(report)) {
    return { ok: false, reason: 'Checklist incomplète : cochez tous les points obligatoires.' };
  }
  return { ok: true, reason: '' };
}

/** Append a signature for the current state's sign-off and move to the next state. */
export function applySignature(
  report: Report,
  signer: { name: string; id: string },
  comment: string
): Report {
  const state = currentState(report);
  const advance = state?.advance;
  if (!state || !advance) return report;
  const signature: SignatureRecord = {
    id: uid('sig'),
    fromStateId: state.id,
    toStateId: advance.toStateId,
    level: advance.level,
    roleLabel: advance.roleLabel,
    signerName: signer.name || 'Utilisateur',
    signerId: signer.id,
    timestamp: new Date().toISOString(),
    comment
  };
  return {
    ...report,
    currentStateId: advance.toStateId,
    signatures: [...report.signatures, signature],
    updatedAt: nowLocal()
  };
}

/** Apply a (backward) reject transition. */
export function applyReject(report: Report, reject: RejectTransition): Report {
  return { ...report, currentStateId: reject.toStateId, updatedAt: nowLocal() };
}
