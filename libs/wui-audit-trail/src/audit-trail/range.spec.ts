import { describe, expect, it } from 'vitest';
import { parseStoredBound, pickerDate, pickerToStored, resolveStoredRange, storedToPicker, toStoredBound } from './range.js';

const DAY = 24 * 3600 * 1000;

describe('Audit Trail range bounds (#77)', () => {
  it('converts the stored bound to the picker value and back', () => {
    expect(storedToPicker('2026-11-12T08:05')).toBe('2026/11/12 08:05:00');
    expect(storedToPicker('2026-11-12T08:05:42')).toBe('2026/11/12 08:05:42');
    expect(pickerToStored('2026/11/12 08:05:42')).toBe('2026-11-12T08:05:42');
    expect(pickerToStored(storedToPicker('2026-01-02T03:04:05'))).toBe('2026-01-02T03:04:05');
  });

  it('empty or unreadable values give an empty bound', () => {
    expect(storedToPicker('')).toBe('');
    expect(storedToPicker('garbage')).toBe('');
    expect(pickerToStored(undefined)).toBe('');
    expect(pickerToStored('12/11/2026')).toBe('');
  });

  it('formats a local date with seconds and reads it back', () => {
    const d = new Date(2026, 10, 12, 9, 7, 3);
    expect(toStoredBound(d)).toBe('2026-11-12T09:07:03');
    expect(parseStoredBound(toStoredBound(d))?.getTime()).toBe(d.getTime());
    expect(pickerDate('2026/11/12 09:07:03')).toBe('2026/11/12');
    expect(pickerDate('')).toBeUndefined();
  });

  it('resolves the interval: defaults, and an inverted range put back in order', () => {
    const now = new Date(2026, 10, 12, 12, 0, 0);
    expect(resolveStoredRange('', '', now, DAY)).toEqual({ start: new Date(now.getTime() - DAY), end: now });
    const r = resolveStoredRange('2026-11-12T10:00', '2026-11-11T10:00', now, DAY);
    expect(r.start).toEqual(new Date(2026, 10, 11, 10, 0, 0));
    expect(r.end).toEqual(new Date(2026, 10, 12, 10, 0, 0));
  });
});
