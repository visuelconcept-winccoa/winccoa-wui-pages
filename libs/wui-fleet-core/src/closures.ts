// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Non-worked period model for the KPI page.
 *
 * Closures (jours/plages non travaillés) reduce a machine's **opening time**,
 * i.e. the denominator of the availability-TRS. They can be defined for a whole
 * atelier (applies implicitly to all its machines) or for a single machine; the
 * effective set for a machine is the union of both.
 *
 * Persisted as one app-level JSON datapoint (`MachineFleet3D_Closures`) via the
 * FleetStore, keyed by atelier id and machine id.
 */

/** One non-worked period — local datetime strings `yyyy-MM-ddTHH:mm`. */
export interface ClosureRange {
  start: string;
  end: string;
}

/** Closures keyed by scope: atelier-wide and per-machine. */
export interface ClosureConfig {
  ateliers: Record<string, ClosureRange[]>;
  machines: Record<string, ClosureRange[]>;
}

/** A resolved interval in epoch milliseconds. */
export interface MsInterval {
  s: number;
  e: number;
}

export function emptyClosureConfig(): ClosureConfig {
  return { ateliers: {}, machines: {} };
}

/** Coerce a parsed JSON blob into a valid {@link ClosureConfig}. */
export function normaliseClosures(raw: unknown): ClosureConfig {
  const cfg = (raw ?? {}) as Partial<ClosureConfig>;
  return {
    ateliers: normaliseScope(cfg.ateliers),
    machines: normaliseScope(cfg.machines)
  };
}

function normaliseScope(scope: unknown): Record<string, ClosureRange[]> {
  const out: Record<string, ClosureRange[]> = {};
  if (scope && typeof scope === 'object') {
    for (const [key, value] of Object.entries(scope as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        out[key] = value.map((r) => normaliseRange(r)).filter((r) => r.start !== '');
      }
    }
  }
  return out;
}

function normaliseRange(raw: unknown): ClosureRange {
  const r = (raw ?? {}) as Partial<ClosureRange>;
  return { start: String(r.start ?? ''), end: String(r.end ?? '') };
}

/** Effective closures for a machine = atelier-wide ranges ∪ machine ranges. */
export function closuresForMachine(
  config: ClosureConfig,
  atelierId: string,
  machineId: string
): ClosureRange[] {
  return [...(config.ateliers[atelierId] ?? []), ...(config.machines[machineId] ?? [])];
}

/** Parse closure ranges to epoch-ms intervals, dropping invalid/empty ones. */
export function toIntervals(ranges: ClosureRange[]): MsInterval[] {
  const out: MsInterval[] = [];
  for (const r of ranges) {
    const s = Date.parse(r.start);
    const e = Date.parse(r.end);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push({ s, e });
  }
  return out;
}

/** True when two closure ranges overlap in time (touching edges don't count). */
export function rangesOverlap(a: ClosureRange, b: ClosureRange): boolean {
  const as = Date.parse(a.start);
  const ae = Date.parse(a.end);
  const bs = Date.parse(b.start);
  const be = Date.parse(b.end);
  if (![as, ae, bs, be].every((n) => Number.isFinite(n))) return false;
  return as < be && bs < ae;
}

/**
 * True when `outer` fully covers `inner` AND is strictly larger on at least one
 * side — i.e. `inner` is redundant (subsumed). Equal ranges are NOT contained
 * (neither subsumes the other), so this never flags both of two duplicates.
 */
export function strictlyContains(outer: ClosureRange, inner: ClosureRange): boolean {
  const os = Date.parse(outer.start);
  const oe = Date.parse(outer.end);
  const is = Date.parse(inner.start);
  const ie = Date.parse(inner.end);
  if (![os, oe, is, ie].every((n) => Number.isFinite(n))) return false;
  return os <= is && oe >= ie && (os < is || oe > ie);
}

/** True when any incoming range overlaps an existing range within the same scope. */
export function hasOverlap(existing: ClosureConfig, incoming: ClosureConfig): boolean {
  const scopes: ('ateliers' | 'machines')[] = ['ateliers', 'machines'];
  for (const scope of scopes) {
    for (const [key, incomingRanges] of Object.entries(incoming[scope])) {
      const existingRanges = existing[scope][key] ?? [];
      for (const inc of incomingRanges) {
        if (existingRanges.some((ex) => rangesOverlap(ex, inc))) return true;
      }
    }
  }
  return false;
}

/**
 * Merge `incoming` into `existing`.
 * - `'replace'`: incoming fully replaces existing.
 * - `'ignore'`: keep existing; add only incoming ranges that don't overlap any
 *   existing range within the same scope (union of the non-conflicting parts).
 */
export function mergeClosures(
  existing: ClosureConfig,
  incoming: ClosureConfig,
  mode: 'replace' | 'ignore'
): ClosureConfig {
  if (mode === 'replace') return normaliseClosures(incoming);
  const out = structuredClone(existing);
  const scopes: ('ateliers' | 'machines')[] = ['ateliers', 'machines'];
  for (const scope of scopes) {
    for (const [key, incomingRanges] of Object.entries(incoming[scope])) {
      const current = out[scope][key] ?? [];
      const additions = incomingRanges.filter((inc) => !current.some((ex) => rangesOverlap(ex, inc)));
      if (additions.length > 0) out[scope][key] = [...current, ...additions];
    }
  }
  return out;
}

/** Build the machineId → non-worked-intervals map for a set of machines. */
export function buildNonWorkedMap(
  config: ClosureConfig,
  machines: { atelierId: string; machineId: string }[]
): Map<string, MsInterval[]> {
  const map = new Map<string, MsInterval[]>();
  for (const m of machines) {
    const intervals = toIntervals(closuresForMachine(config, m.atelierId, m.machineId));
    if (intervals.length > 0) map.set(m.machineId, intervals);
  }
  return map;
}
