// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { ganttTicks, tickLabel } from './gantt-ticks.js';

describe('Gantt ticks', () => {
  it('always keeps the start and the end', () => {
    expect(ganttTicks([0, 100]).map((t) => [t.pct, t.align])).toEqual([
      [0, 'start'],
      [100, 'end']
    ]);
  });

  it('keeps the state changes that do not overlap the previous label or the end', () => {
    const ticks = ganttTicks([0, 5, 20, 25, 50, 95, 100], 10);
    expect(ticks.map((t) => t.ms)).toEqual([0, 20, 50, 100]);
  });

  it('has nothing to show without a segment', () => {
    expect(ganttTicks([])).toEqual([]);
    expect(ganttTicks([42])).toEqual([]);
  });

  it('writes the time alone over a day, the day too beyond', () => {
    const ms = new Date(2026, 10, 5, 8, 7).getTime();
    expect(tickLabel(ms, 3600 * 1000)).toBe('08:07');
    expect(tickLabel(ms, 7 * 24 * 3600 * 1000)).toBe('05/11 08:07');
  });
});
