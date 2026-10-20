// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The columns of a profile as text: their header, the field they sort on, and
 * what a cell says — the table draws them, the CSV export writes them, and both
 * must say the same thing.
 */
import { localizeDate } from '@wincc-oa/wui-i18n-shared/localize-date.js';
import { DatetimeFormat } from '@wincc-oa/wui-models/enums/wui-i18n/datetime-format.js';
import { MSG, localize } from './i18n.js';
import { columnField, isBuiltinColumn, type AlarmColumn, type BuiltinColumn } from './profile.js';
import { extraSortField, type SortField } from './severity.js';
import { rangeAt, type Alarm, type AlarmRange } from './types.js';

const HEADERS: Record<BuiltinColumn, keyof typeof MSG.table> = {
  severity: 'severity',
  raised: 'raised',
  cleared: 'cleared',
  class: 'class',
  prior: 'prior',
  source: 'source',
  dpe: 'dpe',
  description: 'description',
  text: 'text',
  value: 'value',
  state: 'status',
  ackBy: 'ackBy'
};

const SORTS: Partial<Record<BuiltinColumn, SortField>> = {
  severity: 'rank',
  raised: 'raised',
  cleared: 'cleared',
  prior: 'prior',
  source: 'dp',
  dpe: 'dp',
  text: 'text',
  value: 'value',
  state: 'status'
};

/** The column header, in the reader's language. */
export function columnLabel(column: AlarmColumn): string {
  if (column.label !== undefined) return typeof column.label === 'string' ? column.label : localize(column.label);
  if (isBuiltinColumn(column.id)) return localize(MSG.table[HEADERS[column.id]]);
  return column.id;
}

/** The field a click on the header sorts on; `null` = not sortable. */
export function columnSort(column: AlarmColumn): SortField | null {
  if (isBuiltinColumn(column.id)) return SORTS[column.id] ?? null;
  return extraSortField(columnField(column));
}

/** A date and time in the reader's locale; empty for none. */
export function dateTimeText(ms: number | null | undefined): string {
  if (!ms) return '';
  return localizeDate(new Date(ms), undefined, DatetimeFormat.Default);
}

/** The level name of a rank: its label, else its abbreviation. */
export function levelLabel(rank: number, ranges: readonly AlarmRange[]): string {
  const range = rangeAt(rank, ranges);
  return range.label || range.abbr;
}

/** "came" / "went" — the direction of the occurrence, as the operator reads it. */
export function directionText(alarm: Alarm): string {
  return localize(alarm.cleared === null ? MSG.state.came : MSG.state.went);
}

/** "to acknowledge" / "acknowledged" / "" (a class without acknowledgement). */
export function ackText(alarm: Alarm): string {
  if (alarm.acked) return localize(MSG.state.acked);
  return alarm.ackable ? localize(MSG.state.toAck) : '';
}

/** What a cell says, as plain text. */
export function columnText(alarm: Alarm, column: AlarmColumn, ranges: readonly AlarmRange[]): string {
  switch (column.id) {
    case 'severity': {
      return levelLabel(alarm.rank, ranges);
    }
    case 'raised': {
      return dateTimeText(alarm.raised);
    }
    case 'cleared': {
      return dateTimeText(alarm.cleared);
    }
    case 'class': {
      return alarm.abbr;
    }
    case 'prior': {
      return String(alarm.prior);
    }
    case 'source':
    case 'dpe': {
      return alarm.dpe;
    }
    case 'description': {
      return alarm.description;
    }
    case 'text': {
      return alarm.text;
    }
    case 'value': {
      return alarm.value;
    }
    case 'state': {
      return [directionText(alarm), ackText(alarm)].filter((text) => text !== '').join(' · ');
    }
    case 'ackBy': {
      return [alarm.ackBy ?? '', dateTimeText(alarm.ackAt)].filter((text) => text !== '').join(' ');
    }
    default: {
      return alarm.extra?.[columnField(column)] ?? '';
    }
  }
}

function csvCell(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * The rows as CSV: `;` separated and with a byte-order mark, which is what a
 * French or German Excel opens without an import wizard. The `source` column
 * adds the description next to the datapoint element.
 */
export function toCsv(alarms: readonly Alarm[], columns: readonly AlarmColumn[], ranges: readonly AlarmRange[]): string {
  const expanded = columns.flatMap((column) =>
    column.id === 'source' ? [column, { id: 'description' } satisfies AlarmColumn] : [column]
  );
  const header = expanded.map((column) => csvCell(columnLabel(column))).join(';');
  const lines = alarms.map((alarm) => expanded.map((column) => csvCell(columnText(alarm, column, ranges))).join(';'));
  return `﻿${[header, ...lines].join('\r\n')}`;
}
