// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Period resolution for the archived view.
 *
 * The same vocabulary as the Machine Fleet dashboards (`today`, `24h`, `7d`,
 * `30d`, `week`, `month`, `custom`) so an embedded alarm panel can be driven by
 * the host page's existing period selector instead of growing a second one, and
 * so a shifted window ("previous week") means the same thing on both sides.
 */

export type AlarmPeriod = 'today' | '24h' | '7d' | '30d' | 'week' | 'month' | 'custom';

export const ALARM_PERIODS: readonly AlarmPeriod[] = ['today', '24h', '7d', '30d', 'week', 'month', 'custom'];

export interface Range {
  start: number;
  end: number;
}

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
const END_OF_DAY_MS = DAY_MS - 1;

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Monday 00:00 of the week containing `ms` (ISO week, as the fleet pages read it). */
function startOfWeek(ms: number): number {
  const date = new Date(startOfDay(ms));
  const isoDay = (date.getDay() + 6) % WEEK_DAYS;
  date.setDate(date.getDate() - isoDay);
  return date.getTime();
}

function startOfMonth(ms: number): number {
  const date = new Date(startOfDay(ms));
  date.setDate(1);
  return date.getTime();
}

/** `YYYY-MM-DD` (the `ix-date-input` format) at local midnight; `NaN` when unparsable. */
export function parseDateInput(value: string, endOfDay = false): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return Number.NaN;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return endOfDay ? date.getTime() + END_OF_DAY_MS : date.getTime();
}

/** A `Date` as the `YYYY-MM-DD` value an `ix-date-input` expects. */
export function toDateInput(ms: number): string {
  const date = new Date(ms);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface PeriodOptions {
  /** How far back the window is shifted, in whole periods. 0 = the current one. */
  shift?: number;
  /** `YYYY-MM-DD` bounds, for `custom`. */
  customStart?: string;
  customEnd?: string;
}

function currentRange(period: AlarmPeriod, now: number): Range {
  switch (period) {
    case 'today': {
      return { start: startOfDay(now), end: startOfDay(now) + END_OF_DAY_MS };
    }
    case '24h': {
      return { start: now - DAY_MS, end: now };
    }
    case '7d': {
      return { start: now - WEEK_DAYS * DAY_MS, end: now };
    }
    case '30d': {
      return { start: now - 30 * DAY_MS, end: now };
    }
    case 'week': {
      return { start: startOfWeek(now), end: startOfWeek(now) + WEEK_DAYS * DAY_MS - 1 };
    }
    case 'month': {
      const start = startOfMonth(now);
      const next = new Date(start);
      next.setMonth(next.getMonth() + 1);
      return { start, end: next.getTime() - 1 };
    }
    default: {
      return { start: startOfDay(now), end: now };
    }
  }
}

/** Shift a resolved range back by `shift` whole periods. */
function shiftRange(period: AlarmPeriod, range: Range, shift: number): Range {
  if (shift <= 0) return range;
  if (period === 'month') {
    const start = new Date(range.start);
    start.setMonth(start.getMonth() - shift);
    const end = new Date(range.start);
    end.setMonth(end.getMonth() - shift + 1);
    return { start: start.getTime(), end: end.getTime() - 1 };
  }
  const span = range.end - range.start + 1;
  return { start: range.start - shift * span, end: range.end - shift * span };
}

/**
 * Resolve a period into an absolute epoch-ms range.
 *
 * `custom` without both bounds falls back to the day so an incomplete form never
 * queries an empty or inverted interval.
 */
export function resolvePeriod(period: AlarmPeriod, now: number, options: PeriodOptions = {}): Range {
  if (period === 'custom') {
    const start = parseDateInput(options.customStart ?? '');
    const end = parseDateInput(options.customEnd ?? '', true);
    if (Number.isNaN(start) || Number.isNaN(end)) return currentRange('today', now);
    return start <= end ? { start, end } : { start: end, end: start };
  }
  return shiftRange(period, currentRange(period, now), options.shift ?? 0);
}

/** True when the range still touches now — a live subscription can serve it. */
export function isLiveRange(range: Range, now: number): boolean {
  return range.end >= now;
}
