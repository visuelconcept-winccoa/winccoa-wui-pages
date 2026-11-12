// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Several stop-cause catalogues (#74 of winccoa-wui-pages), one datapoint each, of type
 * `MachineFleet3D_StopCauses` (`json`: the causes, a plain list; `name`: the catalogue's name). The default
 * catalogue is `MachineFleet3D_StopCauses` itself, the single catalogue of before, unchanged for its
 * readers; any other is `MachineFleet3D_StopCauses_<id>`. A machine uses the catalogue named by its
 * `stopCatalogId`, else the default. Pure functions, tested by stop-catalogs.spec.ts.
 */
import type { StopCause, StopCauseCatalog, StopClassification } from './types.js';

/** Type of a catalogue's datapoint, and the default catalogue's datapoint. */
export const STOPCAUSE_TYPE = 'MachineFleet3D_StopCauses';
export const STOPCAUSE_DP = 'MachineFleet3D_StopCauses';
/** Prefix of the datapoint of a catalogue other than the default (`MachineFleet3D_StopCauses_<id>`). */
export const CATALOG_DP_PREFIX = `${STOPCAUSE_DP}_`;

/** Id and name of the default catalogue (its datapoint has no name yet). */
export const DEFAULT_CATALOG_ID = 'default';
export const DEFAULT_CATALOG_NAME = 'Référentiel par défaut';

const CLASSIFICATIONS = new Set<StopClassification>(['unplanned', 'planned', 'production']);

/** A JSON text, or the value itself. */
function decode(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  if (raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** A cause as stored, made valid (unknown classification → unplanned). */
export function normaliseCause(raw: unknown): StopCause {
  const e = (raw ?? {}) as Partial<StopCause>;
  return {
    code: String(e.code ?? '').trim(),
    description: String(e.description ?? ''),
    classification: CLASSIFICATIONS.has(e.classification as StopClassification) ? (e.classification as StopClassification) : 'unplanned',
    ...(e.isDefault === true ? { isDefault: true } : {})
  };
}

/** A list of causes (an array, or `{ causes: [...] }`, as text or value), each made valid. */
export function causesOf(raw: unknown): StopCause[] {
  const v = decode(raw);
  const list = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as { causes?: unknown }).causes) ? (v as { causes: unknown[] }).causes : [];
  return list.map(normaliseCause);
}

/** The datapoint of a catalogue. */
export function catalogDp(id: string): string {
  return id === DEFAULT_CATALOG_ID ? STOPCAUSE_DP : `${CATALOG_DP_PREFIX}${id}`;
}

/** The catalogue id of a datapoint name (system and trailing dot allowed), null for another datapoint. */
export function catalogIdOfDp(name: string): string | null {
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  const dp = local.endsWith('.') ? local.slice(0, -1) : local;
  if (dp === STOPCAUSE_DP) return DEFAULT_CATALOG_ID;
  if (dp.startsWith(CATALOG_DP_PREFIX) && dp.length > CATALOG_DP_PREFIX.length) return dp.slice(CATALOG_DP_PREFIX.length);
  return null;
}

/** A readable id from a name, unused among `taken` ("Fours inox" → "fours-inox", then "fours-inox-2"…). */
export function newCatalogId(name: string, taken: readonly string[]): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'referentiel';
  const used = new Set([DEFAULT_CATALOG_ID, ...taken]);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/**
 * Catalogues made valid: the default one first (always there, `isDefault`), then the others by name, each
 * with a unique id fit for a datapoint name and a name.
 */
export function normaliseCatalogs(catalogs: readonly Partial<StopCauseCatalog>[]): StopCauseCatalog[] {
  const given = catalogs.find((c) => String(c.id ?? '').trim() === DEFAULT_CATALOG_ID);
  const def: StopCauseCatalog = {
    id: DEFAULT_CATALOG_ID,
    name: String(given?.name ?? '').trim() || DEFAULT_CATALOG_NAME,
    causes: (given?.causes ?? []).map(normaliseCause),
    isDefault: true
  };
  const others: StopCauseCatalog[] = [];
  for (const c of catalogs) {
    if (c === given) continue;
    const name = String(c.name ?? '').trim() || String(c.id ?? '').trim() || DEFAULT_CATALOG_NAME;
    const wanted = String(c.id ?? '').trim();
    const fit = /^[a-z0-9][a-z0-9-]*$/.test(wanted) && wanted !== DEFAULT_CATALOG_ID && !others.some((o) => o.id === wanted);
    const id = fit ? wanted : newCatalogId(name, others.map((o) => o.id));
    others.push({ id, name, causes: (c.causes ?? []).map(normaliseCause) });
  }
  others.sort((a, b) => a.name.localeCompare(b.name));
  return [def, ...others];
}

/** One catalogue's datapoint as read: its name, its `json` and its `name` values. */
export interface CatalogDpValues {
  dp: string;
  json?: unknown;
  name?: unknown;
}

/** The catalogues from their datapoints (the default one is there even when its datapoint is not). */
export function catalogsFromDps(entries: readonly CatalogDpValues[]): StopCauseCatalog[] {
  const list: Partial<StopCauseCatalog>[] = [];
  for (const e of entries) {
    const id = catalogIdOfDp(e.dp);
    if (id === null) continue;
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    list.push({ id, name: name || (id === DEFAULT_CATALOG_ID ? DEFAULT_CATALOG_NAME : id), causes: causesOf(e.json) });
  }
  return normaliseCatalogs(list);
}

/**
 * Catalogues handed over as values (`[{ id, name, causes }]`, as an embedding host gets them), else — none
 * given — the default catalogue alone, with the causes `legacy` (a plain list).
 */
export function parseCatalogs(raw: unknown, legacy?: unknown): StopCauseCatalog[] {
  const v = decode(raw);
  const list = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as { catalogs?: unknown }).catalogs) ? (v as { catalogs: unknown[] }).catalogs : null;
  if (list && list.length > 0) return normaliseCatalogs(list as Partial<StopCauseCatalog>[]);
  return normaliseCatalogs([{ id: DEFAULT_CATALOG_ID, causes: causesOf(legacy) }]);
}

/** The default catalogue (an empty one when there is none). */
export function defaultCatalog(catalogs: readonly StopCauseCatalog[]): StopCauseCatalog {
  return (
    catalogs.find((c) => c.id === DEFAULT_CATALOG_ID) ??
    catalogs.find((c) => c.isDefault) ??
    catalogs[0] ?? { id: DEFAULT_CATALOG_ID, name: DEFAULT_CATALOG_NAME, causes: [], isDefault: true }
  );
}

/** The catalogue of a machine: the one named by `id`, else the default. */
export function catalogFor(catalogs: readonly StopCauseCatalog[], id?: string): StopCauseCatalog {
  return (id ? catalogs.find((c) => c.id === id) : undefined) ?? defaultCatalog(catalogs);
}

/** The causes of a machine's catalogue. */
export function causesFor(catalogs: readonly StopCauseCatalog[], id?: string): StopCause[] {
  return catalogFor(catalogs, id).causes;
}
