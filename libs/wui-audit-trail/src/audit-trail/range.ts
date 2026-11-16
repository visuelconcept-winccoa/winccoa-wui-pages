// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Range bounds of the Audit Trail (#77): the persisted form and the `ix-datetime-input` form.
 *
 * `AuditTrail_Config` keeps `rangeStart` / `rangeEnd` as local `YYYY-MM-DDTHH:mm[:ss]` (the
 * former `datetime-local` value, still read by older bundles); the picker shows and returns
 * `yyyy/LL/dd HH:mm:ss` ({@link PICKER_FORMAT}, the iX default). Pure, unit-tested.
 */

/** Luxon format of the `ix-datetime-input` pickers (the iX default). */
export const PICKER_FORMAT = 'yyyy/LL/dd HH:mm:ss';

const STORED = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const PICKED = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad(n: number): string {
  return `${n}`.padStart(2, '0');
}

/** A `Date` → stored bound (`YYYY-MM-DDTHH:mm:ss`, local time). */
export function toStoredBound(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Stored bound → picker value; `''` when empty or unreadable. */
export function storedToPicker(stored: string): string {
  const m = STORED.exec(stored.trim());
  if (!m) return '';
  return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}:${m[6] ?? '00'}`;
}

/** Picker value → stored bound; `''` when empty or unreadable (the picker reports invalid input). */
export function pickerToStored(picked: string | undefined | null): string {
  const m = PICKED.exec((picked ?? '').trim());
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
}

/** Date part of a picker value (`yyyy/LL/dd`), for the other picker's `min-date` / `max-date`. */
export function pickerDate(picked: string): string | undefined {
  const d = picked.slice(0, 10);
  return /^\d{4}\/\d{2}\/\d{2}$/.test(d) ? d : undefined;
}

/** A stored bound as a local `Date`, or null. */
export function parseStoredBound(stored: string): Date | null {
  const m = STORED.exec(stored.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The query interval for stored bounds: an empty or unreadable start falls back to `end - window`,
 * an empty or unreadable end to `now`, and an inverted range is put back in order.
 */
export function resolveStoredRange(
  rangeStart: string,
  rangeEnd: string,
  now: Date,
  windowMs: number
): { start: Date; end: Date } {
  const end = parseStoredBound(rangeEnd) ?? now;
  const start = parseStoredBound(rangeStart) ?? new Date(end.getTime() - windowMs);
  return start.getTime() <= end.getTime() ? { start, end } : { start: end, end: start };
}
