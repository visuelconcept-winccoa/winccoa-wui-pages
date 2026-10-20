// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The alarm query — one definition of what a filter means.
 *
 * An alarm flood is thousands of rows and an operator reads twenty-five of them,
 * so filtering, sorting and paging are one pure function over a snapshot: the
 * live view, the archived view and the embedded panel cannot disagree about what
 * "unacknowledged only, P1–P2, page 3" is.
 *
 * The snapshot itself comes from the store — live (`AlertService.connect`) or
 * archived (`getAlertArchive` over a period). {@link applyQuery} does not care
 * which: that is precisely why the same component serves both.
 */
import { compareAlarms, type SortDir, type SortField } from './severity.js';
import { globToRegExp, inScope } from './scope.js';
import type { Alarm } from './types.js';

/** Which snapshot the view reads: standing alarms, or an archived period. */
export type AlarmSource = 'active' | 'history';

export interface AlarmQuery {
  /** `active` keeps standing alarms only; `history` keeps every row. */
  source: AlarmSource;
  /** Datapoint scope (see {@link ../scope.ts}); empty = the whole system. */
  scope?: readonly string[];
  /** Range ranks to keep; empty = every range. */
  ranks?: readonly number[];
  /**
   * Alert classes to keep, by ABBREVIATION (`OOS`, `A*`) — the one name of the
   * class an alert carries. Case-insensitive, `*` / `?` globs; empty = every class.
   */
  classes?: readonly string[];
  /**
   * Exact values to keep per field — a profile filter (`{ origin: 'ua' }`). The key
   * is an `extra` key of the row, or one of `abbr`, `system`, `dp`; an empty value
   * keeps every row.
   */
  fields?: Readonly<Record<string, string>>;
  /**
   * Free text over the readable fields of the row (datapoint element, text,
   * description, class, value and the `extra` values): every word must appear,
   * case and accents ignored.
   */
  search?: string;
  /** Only alarms nobody has taken over. */
  unacknowledgedOnly?: boolean;
  sort?: SortField;
  dir?: SortDir;
  page?: number;
  pageSize?: number;
}

export interface AlarmPage {
  rows: readonly Alarm[];
  /** Rows matching the filters — the "296" of "296 of 2,727". */
  filtered: number;
  /** Rows in the snapshot before filtering — the "2,727". */
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  updatedAt: number;
}

export const DEFAULT_PAGE_SIZE = 25;

/**
 * Rows the source keeps: the OPEN alarms, or everything.
 *
 * An alarm leaves the active list when it is cleared AND acknowledged — never on
 * the clearing alone. A condition that came and went while nobody took it over is
 * exactly the one an operator must still see and answer for: dropping it on the
 * WENT event would make it vanish silently, which is the failure mode alarm
 * management exists to prevent (ISA-18.2 / EEMUA-191 read the state machine the
 * same way, and so does WinCC OA's own alert screen).
 */
export function inSource(alarm: Alarm, source: AlarmSource): boolean {
  if (source !== 'active') return true;
  return alarm.cleared === null || !alarm.acked;
}

/** Lower case without accents — `Température` and `temperature` are the same word. */
export function fold(text: string): string {
  return text.normalize('NFD').replaceAll(/[\u0300-\u036F]/g, '').toLowerCase();
}

/** The words of a search, folded. */
export function searchWords(search: string): string[] {
  return fold(search.trim()).split(/\s+/).filter((word) => word !== '');
}

/** True when every word of the search is somewhere in the alarm's readable fields. */
export function matchesSearch(alarm: Alarm, needle: string | readonly string[]): boolean {
  const words = typeof needle === 'string' ? searchWords(needle) : needle;
  if (words.length === 0) return true;
  const extra = Object.values(alarm.extra ?? {}).join(' ');
  const haystack = fold(`${alarm.dpe} ${alarm.text} ${alarm.description} ${alarm.abbr} ${alarm.value} ${extra}`);
  return words.every((word) => haystack.includes(word));
}

/** True when the alarm's class abbreviation is one of the patterns (empty = every class). */
export function matchesClasses(alarm: Pick<Alarm, 'abbr'>, classes: readonly string[] | undefined): boolean {
  const patterns = (classes ?? []).map((entry) => entry.trim()).filter((entry) => entry !== '');
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => globToRegExp(pattern).test(alarm.abbr));
}

/** The value of a filterable field: an `extra` key first, then the built-in ones. */
export function fieldValue(alarm: Alarm, key: string): string {
  const extra = alarm.extra?.[key];
  if (extra !== undefined) return extra;
  switch (key) {
    case 'abbr': {
      return alarm.abbr;
    }
    case 'system': {
      return alarm.system;
    }
    case 'dp': {
      return alarm.dp;
    }
    default: {
      return '';
    }
  }
}

function matchesFields(alarm: Alarm, fields: Readonly<Record<string, string>> | undefined): boolean {
  if (!fields) return true;
  return Object.entries(fields).every(([key, value]) => value === '' || fieldValue(alarm, key) === value);
}

/** Filter + sort + paginate. The single definition of what a query means. */
export function applyQuery(all: readonly Alarm[], query: AlarmQuery, now: number): AlarmPage {
  const inSnapshot = all.filter((alarm) => inSource(alarm, query.source));
  const words = searchWords(query.search ?? '');
  const ranks = query.ranks && query.ranks.length > 0 ? new Set<number>(query.ranks) : null;

  const filtered = inSnapshot.filter((alarm) => {
    if (!inScope(alarm, query.scope)) return false;
    if (ranks && !ranks.has(alarm.rank)) return false;
    if (query.unacknowledgedOnly === true && alarm.acked) return false;
    if (!matchesClasses(alarm, query.classes)) return false;
    if (!matchesFields(alarm, query.fields)) return false;
    return matchesSearch(alarm, words);
  });

  const sort = query.sort ?? 'raised';
  const dir = query.dir ?? 'desc';
  const sorted = [...filtered].sort((first, second) => compareAlarms(first, second, sort, dir));

  const pageSize = Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);
  const start = (page - 1) * pageSize;

  return {
    rows: sorted.slice(start, start + pageSize),
    filtered: sorted.length,
    total: inSnapshot.length,
    page,
    pageSize,
    pages,
    updatedAt: now
  };
}

/** The rows a query selects, unpaged — what "acknowledge everything visible" means. */
export function selectAll(all: readonly Alarm[], query: AlarmQuery): readonly Alarm[] {
  const unpaged: AlarmQuery = { ...query, page: 1, pageSize: Math.max(1, all.length) };
  return applyQuery(all, unpaged, 0).rows;
}
