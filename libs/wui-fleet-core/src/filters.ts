// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Machine filters. A machine may carry tags — a dimension (e.g. "Line", "Activity") and the
 * values it has in it ({@link MachineDef.tags}). The filter bar offers every dimension found
 * on the machines, with their values; a filter keeps, for each dimension where values are
 * selected, the machines having one of them (OR within a dimension, AND across dimensions).
 * The selection is remembered in the user's WinCC OA settings (settings-cache.ts), shared by
 * the overview and the atelier views.
 * The free tags the user puts on a machine of an atelier ({@link MachineDef.cardTags}) are one
 * more dimension, {@link CARD_TAGS_DIMENSION}.
 */
import { settingObject, settingsCache, stringList } from './settings-cache.js';
import type { MachineDef } from './types.js';

/** Dimension of the free tags put on the machines of an atelier ({@link MachineDef.cardTags}). */
export const CARD_TAGS_DIMENSION = 'Étiquettes';

/** Every tag of a machine, by dimension: its tags, plus its free tags of the atelier. */
export function machineFilterTags(m: Pick<MachineDef, 'tags' | 'cardTags'>): Record<string, string[]> {
  const cardTags = (m.cardTags ?? []).filter((t) => t !== '');
  if (cardTags.length === 0) return m.tags ?? {};
  return { ...m.tags, [CARD_TAGS_DIMENSION]: [...(m.tags?.[CARD_TAGS_DIMENSION] ?? []), ...cardTags] };
}

/** Selected values by dimension; a dimension absent or empty does not filter. */
export type FleetFilter = Record<string, string[]>;

/** A dimension of the filter bar and the values found for it. */
export interface FilterDimension {
  key: string;
  values: string[];
}

/** User setting holding the tag filter and the state filter (`{ tags, states }`). */
export const FLEET_FILTER_SETTING = 'fleet-filter';

/** Dimensions found on the machines, in order of first appearance, values sorted. */
export function filterDimensions(machines: Iterable<Pick<MachineDef, 'tags' | 'cardTags'>>): FilterDimension[] {
  const dims = new Map<string, Set<string>>();
  for (const m of machines) {
    for (const [key, values] of Object.entries(machineFilterTags(m))) {
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
export function matchesFilter(m: Pick<MachineDef, 'tags' | 'cardTags'>, filter: FleetFilter): boolean {
  const tags = machineFilterTags(m);
  for (const [key, selected] of Object.entries(filter)) {
    if (selected.length === 0) continue;
    const values = tags[key] ?? [];
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

/** A tag filter as stored (unknown shape tolerated): dimension → selected values. */
export function parseFleetFilter(raw: unknown): FleetFilter {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: FleetFilter = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = stringList(v);
  }
  return out;
}

/** The user's tag filter (empty when none, or before their settings are loaded). */
export function loadFleetFilter(): FleetFilter {
  return parseFleetFilter(settingObject(FLEET_FILTER_SETTING)['tags']);
}

/** Remember the tag filter in the user's settings. */
export function saveFleetFilter(filter: FleetFilter): void {
  settingsCache.set(FLEET_FILTER_SETTING, { ...settingObject(FLEET_FILTER_SETTING), tags: filter });
}

/** The user's state filter of the atelier views (state keys; empty when none). */
export function loadStateFilter(): string[] {
  return stringList(settingObject(FLEET_FILTER_SETTING)['states']);
}

/** Remember the state filter of the atelier views in the user's settings. */
export function saveStateFilter(keys: string[]): void {
  settingsCache.set(FLEET_FILTER_SETTING, { ...settingObject(FLEET_FILTER_SETTING), states: keys });
}
