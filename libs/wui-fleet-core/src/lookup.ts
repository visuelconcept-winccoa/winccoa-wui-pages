// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A line value translated through a table (winccoa-fra-msp-stma#373): the value of the line's datapoint is looked up
 * in a table held by another datapoint — a JSON array of rows, e.g. the MSP article catalogue — and the line shows a
 * field of the row found instead. The site's contract line is the article of the workcenter's context, translated by
 * the catalogue into its « Contrat » specification (SDS 2.2 SL-SRC-00), computed where it is shown: no copy, no
 * process to keep one. Pure: the views read the two values, this gives what to show.
 */
import type { KpiLookup } from './types.js';

/** Parsed tables by their raw text: a catalogue is parsed once per change, whatever the number of lines using it. */
const parsed = new Map<string, unknown[]>();
const MAX_TABLES = 8;

function rows(table: unknown): unknown[] {
  if (Array.isArray(table)) return table;
  const raw = typeof table === 'string' ? table : '';
  if (!raw) return [];
  const hit = parsed.get(raw);
  if (hit) return hit;
  let v: unknown = [];
  try {
    v = JSON.parse(raw);
  } catch {
    v = [];
  }
  const list = Array.isArray(v) ? v : [];
  if (parsed.size >= MAX_TABLES) parsed.clear();
  parsed.set(raw, list);
  return list;
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/**
 * What a line translated by `lookup` shows for `value`: the field `lookup.field` of the first row of `table` whose
 * field `lookup.key` (default `id`) equals the value; '' when the value is empty, no row matches, or the row has no
 * such field. `table`: the table datapoint's value (JSON text or array), as received.
 */
export function lookupValue(value: unknown, table: unknown, lookup: KpiLookup | undefined): string {
  const v = text(Array.isArray(value) ? value[0] : value);
  if (!lookup || !v || !lookup.field) return '';
  const key = lookup.key || 'id';
  const row = rows(Array.isArray(table) && table.length === 1 && typeof table[0] === 'string' ? table[0] : table)
    .find((r) => !!r && typeof r === 'object' && text((r as Record<string, unknown>)[key]) === v) as Record<string, unknown> | undefined;
  return row && row[lookup.field] != null ? String(row[lookup.field]) : '';
}

/** The datapoints a line needs: its own, and its table's when it is translated. */
export function lineDps(k: { dp?: string; lookup?: KpiLookup }): string[] {
  return [k.dp, k.lookup?.dp].filter((d): d is string => typeof d === 'string' && d.trim() !== '');
}
