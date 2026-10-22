// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Machine filters. A machine may carry tags — a dimension (e.g. "Line", "Activity") and the
 * values it has in it ({@link MachineDef.tags}). The filter bar offers every dimension found
 * on the machines, with their values; a filter keeps, for each dimension where values are
 * selected, the machines having one of them (OR within a dimension, AND across dimensions).
 * The selection is remembered in the browser, shared by the overview and the atelier views.
 */
import type { MachineDef } from './types.js';

/** Selected values by dimension; a dimension absent or empty does not filter. */
export type FleetFilter = Record<string, string[]>;

/** A dimension of the filter bar and the values found for it. */
export interface FilterDimension {
  key: string;
  values: string[];
}

/** localStorage key of the remembered filter. */
export const FLEET_FILTER_STORAGE_KEY = 'wui.machine-fleet.filter';

/** Dimensions found on the machines, in order of first appearance, values sorted. */
export function filterDimensions(machines: Iterable<Pick<MachineDef, 'tags'>>): FilterDimension[] {
  const dims = new Map<string, Set<string>>();
  for (const m of machines) {
    for (const [key, values] of Object.entries(m.tags ?? {})) {
      const set = dims.get(key) ?? new Set<string>();
      for (const v of values ?? []) if (v !== '') set.add(v);
      dims.set(key, set);
    }
  }
  return [...dims].map(([key, set]) => ({ key, values: [...set].sort((a, b) => a.localeCompare(b)) }));
}

/** True when at least one dimension has selected values. */
export function isFilterActive(filter: FleetFilter): boolean {
  return Object.values(filter).some((v) => v.length > 0);
}

/** True when the machine passes the filter (every filtering dimension has one of its values). */
export function matchesFilter(m: Pick<MachineDef, 'tags'>, filter: FleetFilter): boolean {
  for (const [key, selected] of Object.entries(filter)) {
    if (selected.length === 0) continue;
    const values = m.tags?.[key] ?? [];
    if (!values.some((v) => selected.includes(v))) return false;
  }
  return true;
}

/**
 * The filter restricted to the dimensions and values that still exist (a remembered value
 * may have disappeared), so a stale selection never hides everything silently.
 */
export function pruneFilter(filter: FleetFilter, dims: FilterDimension[]): FleetFilter {
  const out: FleetFilter = {};
  for (const d of dims) {
    const kept = (filter[d.key] ?? []).filter((v) => d.values.includes(v));
    if (kept.length > 0) out[d.key] = kept;
  }
  return out;
}

/** The remembered filter (empty when none, or when the browser storage is unavailable). */
export function loadFleetFilter(): FleetFilter {
  try {
    const raw = globalThis.localStorage?.getItem(FLEET_FILTER_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: FleetFilter = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
    }
    return out;
  } catch {
    return {};
  }
}

/** Remember the filter in the browser (best effort). */
export function saveFleetFilter(filter: FleetFilter): void {
  try {
    globalThis.localStorage?.setItem(FLEET_FILTER_STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // Storage unavailable (private mode, blocked): the filter just isn't remembered.
  }
}
