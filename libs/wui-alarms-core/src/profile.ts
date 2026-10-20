// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The display profile — how ONE integration of the alarm view is customised
 * without forking it: which columns, which filters, which counters, what the
 * acknowledgement offers, and the filter values it opens on.
 *
 * A profile is plain JSON on purpose, because it comes from three places and is
 * layered in this order (later wins, see {@link mergeProfiles}):
 *
 *  1. the kit's defaults ({@link DEFAULT_PROFILE});
 *  2. the integrating module, in code (`<wui-alarm-view .profile=${…}>`) — what the
 *     module knows about its own alarms (an origin column, a work-order column);
 *  3. engineering: a NAMED profile stored in the alarms configuration datapoint
 *     (`Alarms_Config.profiles`, edited in the Alarms page) and picked with
 *     `profile-name` — what a site adjusts without a rebuild.
 *
 * The filter VALUES a link opens the view on (`#/alarms?class=OOS,AOS&unack=1`)
 * are not a profile: they are the operator's starting point, read by
 * {@link filtersFromSearch}, and the operator may clear them.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import type { AlarmSource } from './query.js';

/** The columns the kit renders itself. */
export const BUILTIN_COLUMNS = [
  'severity',
  'raised',
  'cleared',
  'class',
  'prior',
  'source',
  'dpe',
  'description',
  'text',
  'value',
  'state',
  'ackBy'
] as const;
export type BuiltinColumn = (typeof BUILTIN_COLUMNS)[number];

/**
 * One column of the table.
 *
 * `id` is a built-in column, or the id of an additional column: then `field`
 * names the `extra` key it shows (default: the id) and `label` its header.
 */
export interface AlarmColumn {
  id: string;
  label?: string | MultiLangString;
  field?: string;
  /** CSS width (`8rem`), when the content alone would size it badly. */
  width?: string;
}

/** A column as a profile writes it: a bare id, or the full description. */
export type AlarmColumnRef = string | AlarmColumn;

/**
 * An additional filter: a select over the distinct values of a field — an `extra`
 * key (`origin`) or `abbr` / `system` / `dp`.
 */
export interface AlarmFieldFilter {
  id: string;
  label: string | MultiLangString;
  field?: string;
  /**
   * The choices, with their label. Absent = the distinct values found in the
   * rows, shown as they are.
   */
  options?: readonly { value: string; label: string | MultiLangString }[];
}

/** Filter values — what a view starts on, and what a link may carry. */
export interface AlarmFilterValues {
  source?: AlarmSource;
  /** Level ranks to keep (1 = most urgent); empty = every level. */
  ranks?: number[];
  /** Alert class abbreviations, globs allowed (`OOS`, `A*`). */
  classes?: string[];
  search?: string;
  unackOnly?: boolean;
  /** Values of the field filters, by filter id. */
  fields?: Record<string, string>;
}

export interface AlarmViewProfile {
  /** Columns of the active list, in order. */
  columns?: AlarmColumnRef[];
  /** Columns of the history list; the active list's plus `cleared` and `ackBy` when absent. */
  historyColumns?: AlarmColumnRef[];
  /** Columns of the panel (embedded) layout. */
  panelColumns?: AlarmColumnRef[];
  filters?: {
    /** "Minimum severity" select. */
    severity?: boolean;
    /** Alert class select. */
    classes?: boolean;
    search?: boolean;
    unackOnly?: boolean;
    /** Additional filters (a select each). */
    fields?: AlarmFieldFilter[];
  };
  /** Counter tiles (standing, unacknowledged, one per level) — they double as filters. */
  tiles?: boolean;
  /** EEMUA-191 flood histogram and recurring alarms. */
  stats?: boolean;
  /** What the view opens on. */
  defaults?: AlarmFilterValues;
  ack?: {
    /** "Acknowledge the selection". */
    selection?: boolean;
    /** "Acknowledge all" (every acknowledgeable row the filters keep). */
    all?: boolean;
    /** Ask before acknowledging. */
    confirm?: boolean;
  };
  history?: {
    /** Export of the listed rows as CSV. */
    csv?: boolean;
  };
  /** Registered extensions to activate, by id (see `extensions.ts`). */
  extensions?: string[];
}

/** A profile with every switch resolved — what the view actually reads. */
export interface ResolvedProfile {
  columns: AlarmColumn[];
  historyColumns: AlarmColumn[];
  panelColumns: AlarmColumn[];
  filters: { severity: boolean; classes: boolean; search: boolean; unackOnly: boolean; fields: AlarmFieldFilter[] };
  tiles: boolean;
  stats: boolean;
  defaults: AlarmFilterValues;
  ack: { selection: boolean; all: boolean; confirm: boolean };
  history: { csv: boolean };
  extensions: string[];
}

/** The kit's own reading: the Alarms page of the reference product. */
export const DEFAULT_PROFILE: ResolvedProfile = {
  columns: ['severity', 'raised', 'class', 'source', 'text', 'value', 'state'].map((id) => ({ id })),
  historyColumns: ['severity', 'raised', 'cleared', 'class', 'source', 'text', 'value', 'state', 'ackBy'].map((id) => ({ id })),
  panelColumns: ['raised', 'severity', 'text', 'state'].map((id) => ({ id })),
  filters: { severity: true, classes: true, search: true, unackOnly: true, fields: [] },
  tiles: true,
  stats: true,
  defaults: {},
  ack: { selection: true, all: true, confirm: true },
  history: { csv: true },
  extensions: []
};

/** A column reference as a column. */
export function toColumn(ref: AlarmColumnRef): AlarmColumn {
  return typeof ref === 'string' ? { id: ref } : { ...ref };
}

/** True when the column is drawn by the kit rather than read from `extra`. */
export function isBuiltinColumn(id: string): id is BuiltinColumn {
  return (BUILTIN_COLUMNS as readonly string[]).includes(id);
}

/** The `extra` key an additional column reads. */
export function columnField(column: AlarmColumn): string {
  return column.field ?? column.id;
}

function columns(refs: AlarmColumnRef[] | undefined): AlarmColumn[] | undefined {
  return refs === undefined ? undefined : refs.map((ref) => toColumn(ref));
}

/** The history columns derived from the active ones: the clearing time and who acknowledged added. */
function historyFrom(active: AlarmColumn[]): AlarmColumn[] {
  const out = [...active];
  if (!out.some((column) => column.id === 'cleared')) {
    const at = out.findIndex((column) => column.id === 'raised');
    out.splice(at === -1 ? 0 : at + 1, 0, { id: 'cleared' });
  }
  if (!out.some((column) => column.id === 'ackBy')) out.push({ id: 'ackBy' });
  return out;
}

/**
 * Layer profiles, later wins. Lists (columns, field filters, extensions) are
 * REPLACED, not concatenated — a profile that lists columns means those columns;
 * switches and filter values merge key by key.
 */
export function mergeProfiles(...layers: readonly (AlarmViewProfile | null | undefined)[]): ResolvedProfile {
  let resolved: ResolvedProfile = structuredClone(DEFAULT_PROFILE);
  for (const layer of layers) {
    if (!layer) continue;
    const active = columns(layer.columns);
    resolved = {
      columns: active ?? resolved.columns,
      historyColumns: columns(layer.historyColumns) ?? (active ? historyFrom(active) : resolved.historyColumns),
      panelColumns: columns(layer.panelColumns) ?? resolved.panelColumns,
      filters: {
        severity: layer.filters?.severity ?? resolved.filters.severity,
        classes: layer.filters?.classes ?? resolved.filters.classes,
        search: layer.filters?.search ?? resolved.filters.search,
        unackOnly: layer.filters?.unackOnly ?? resolved.filters.unackOnly,
        fields: layer.filters?.fields ? [...layer.filters.fields] : resolved.filters.fields
      },
      tiles: layer.tiles ?? resolved.tiles,
      stats: layer.stats ?? resolved.stats,
      defaults: { ...resolved.defaults, ...layer.defaults },
      ack: { ...resolved.ack, ...layer.ack },
      history: { ...resolved.history, ...layer.history },
      extensions: layer.extensions ? [...layer.extensions] : resolved.extensions
    };
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLabel(value: unknown): value is string | MultiLangString {
  return typeof value === 'string' || (isRecord(value) && Object.values(value).every((text) => typeof text === 'string'));
}

function parseColumn(value: unknown, errors: string[], where: string): AlarmColumnRef | null {
  if (typeof value === 'string' && value !== '') return value;
  if (isRecord(value) && typeof value['id'] === 'string' && value['id'] !== '') {
    const column: AlarmColumn = { id: value['id'] };
    if (isLabel(value['label'])) column.label = value['label'];
    if (typeof value['field'] === 'string') column.field = value['field'];
    if (typeof value['width'] === 'string') column.width = value['width'];
    return column;
  }
  errors.push(`${where}: a column is an id or { "id": … }`);
  return null;
}

function parseColumns(value: unknown, errors: string[], where: string): AlarmColumnRef[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push(`${where}: a list of columns is expected`);
    return undefined;
  }
  return value.map((entry) => parseColumn(entry, errors, where)).filter((entry): entry is AlarmColumnRef => entry !== null);
}

function parseFieldFilter(value: unknown, errors: string[]): AlarmFieldFilter | null {
  if (!isRecord(value) || typeof value['id'] !== 'string' || !isLabel(value['label'])) {
    errors.push('filters.fields: a filter is { "id": …, "label": … }');
    return null;
  }
  const filter: AlarmFieldFilter = { id: value['id'], label: value['label'] };
  if (typeof value['field'] === 'string') filter.field = value['field'];
  if (Array.isArray(value['options'])) {
    filter.options = value['options']
      .filter((option): option is Record<string, unknown> => isRecord(option) && typeof option['value'] === 'string')
      .map((option) => ({ value: option['value'] as string, label: isLabel(option['label']) ? option['label'] : (option['value'] as string) }));
  }
  return filter;
}

function parseBoolean(value: unknown, errors: string[], where: string): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value;
  errors.push(`${where}: true or false is expected`);
  return undefined;
}

function parseSwitches<K extends string>(
  value: unknown,
  keys: readonly K[],
  errors: string[],
  where: string
): Partial<Record<K, boolean>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push(`${where}: an object is expected`);
    return undefined;
  }
  const out: Partial<Record<K, boolean>> = {};
  for (const key of keys) {
    const parsed = parseBoolean(value[key], errors, `${where}.${key}`);
    if (parsed !== undefined) out[key] = parsed;
  }
  return out;
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined;
}

function parseDefaults(value: unknown, errors: string[]): AlarmFilterValues | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push('defaults: an object is expected');
    return undefined;
  }
  const out: AlarmFilterValues = {};
  if (value['source'] === 'active' || value['source'] === 'history') out.source = value['source'];
  if (Array.isArray(value['ranks'])) out.ranks = value['ranks'].filter((rank): rank is number => Number.isInteger(rank) && rank > 0);
  const classes = stringList(value['classes']);
  if (classes) out.classes = classes;
  if (typeof value['search'] === 'string') out.search = value['search'];
  if (typeof value['unackOnly'] === 'boolean') out.unackOnly = value['unackOnly'];
  if (isRecord(value['fields'])) {
    out.fields = Object.fromEntries(
      Object.entries(value['fields']).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    );
  }
  return out;
}

/**
 * A profile from untrusted JSON (the configuration datapoint, a widget setting):
 * what is understood is kept, what is not is reported and left out — a typo in
 * one switch must not take the whole alarm list down.
 */
export function parseProfile(value: unknown): { profile: AlarmViewProfile; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { profile: {}, errors: ['a profile is a JSON object'] };
  const profile: AlarmViewProfile = {};
  const active = parseColumns(value['columns'], errors, 'columns');
  if (active) profile.columns = active;
  const history = parseColumns(value['historyColumns'], errors, 'historyColumns');
  if (history) profile.historyColumns = history;
  const panel = parseColumns(value['panelColumns'], errors, 'panelColumns');
  if (panel) profile.panelColumns = panel;
  const filters = parseSwitches(value['filters'], ['severity', 'classes', 'search', 'unackOnly'] as const, errors, 'filters');
  if (filters) {
    profile.filters = filters;
    const fields = isRecord(value['filters']) ? value['filters']['fields'] : undefined;
    if (Array.isArray(fields)) {
      profile.filters.fields = fields
        .map((entry) => parseFieldFilter(entry, errors))
        .filter((entry): entry is AlarmFieldFilter => entry !== null);
    }
  }
  const tiles = parseBoolean(value['tiles'], errors, 'tiles');
  if (tiles !== undefined) profile.tiles = tiles;
  const stats = parseBoolean(value['stats'], errors, 'stats');
  if (stats !== undefined) profile.stats = stats;
  const defaults = parseDefaults(value['defaults'], errors);
  if (defaults) profile.defaults = defaults;
  const ack = parseSwitches(value['ack'], ['selection', 'all', 'confirm'] as const, errors, 'ack');
  if (ack) profile.ack = ack;
  const historySwitches = parseSwitches(value['history'], ['csv'] as const, errors, 'history');
  if (historySwitches) profile.history = historySwitches;
  const extensions = stringList(value['extensions']);
  if (extensions) profile.extensions = extensions;
  return { profile, errors };
}

/** Stored profiles, each re-validated: the configuration datapoint is edited by hand too. */
export function normaliseProfiles(profiles: unknown): Record<string, AlarmViewProfile> {
  if (!isRecord(profiles)) return {};
  const out: Record<string, AlarmViewProfile> = {};
  for (const [name, value] of Object.entries(profiles)) {
    if (name.trim() === '') continue;
    out[name] = parseProfile(value).profile;
  }
  return out;
}

function list(value: string | null): string[] {
  return (value ?? '')
    .split(/[,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * The filter values a route's query string carries — how another module opens
 * the Alarms page on ITS alarms (`#/alarms?dp=stma/*&class=OOS,AOS`).
 *
 * | parameter     | meaning                                           |
 * | ------------- | ------------------------------------------------- |
 * | `class`       | class abbreviations, comma separated, globs       |
 * | `rank`        | level ranks, comma separated (`1,2`)              |
 * | `q`           | search                                            |
 * | `unack`       | `1` / `true`: unacknowledged only                 |
 * | `source`      | `active` / `history`                              |
 * | `f.<filter>`  | value of a profile field filter                   |
 *
 * The datapoint scope (`dp`) is read by {@link ./scope.ts scopeFromSearch}: a
 * scope is not a filter the operator clears, it is what the view is about.
 */
export function filtersFromSearch(query: string): AlarmFilterValues {
  const parameters = new URLSearchParams(query);
  const out: AlarmFilterValues = {};
  const classes = list(parameters.get('class'));
  if (classes.length > 0) out.classes = classes;
  const ranks = list(parameters.get('rank'))
    .map(Number)
    .filter((rank) => Number.isInteger(rank) && rank > 0);
  if (ranks.length > 0) out.ranks = ranks;
  const text = parameters.get('q');
  if (text) out.search = text;
  const unack = parameters.get('unack');
  if (unack === '1' || unack === 'true') out.unackOnly = true;
  const source = parameters.get('source');
  if (source === 'active' || source === 'history') out.source = source;
  const fields: Record<string, string> = {};
  for (const [key, value] of parameters) {
    if (key.startsWith('f.') && key.length > 2) fields[key.slice(2)] = value;
  }
  if (Object.keys(fields).length > 0) out.fields = fields;
  return out;
}

/** The name of the stored profile a route asks for (`?profile=msp`), empty when none. */
export function profileNameFromSearch(search: string): string {
  return new URLSearchParams(search).get('profile') ?? '';
}
