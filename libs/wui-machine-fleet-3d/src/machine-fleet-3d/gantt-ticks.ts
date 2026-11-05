// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dates shown under the machine-state Gantt without hovering it (#279): the start, the end and the
 * state changes in between, each one skipped when it would overlap the previous label.
 */

/** A date written under the Gantt, at `pct` % of its width. */
export interface GanttTick {
  ms: number;
  pct: number;
  /** Where the label anchors: the first one left-aligned, the last right-aligned. */
  align: 'start' | 'middle' | 'end';
}

/** Minimum distance between two labels, in % of the Gantt width. */
export const TICK_MIN_GAP_PCT = 9;

/**
 * Ticks of the Gantt for the segments' boundaries (`[start₁, start₂, …, endₙ]`, ascending): the
 * first and the last always, a change only at `minGap` % at least from the previous label and from
 * the last one.
 */
export function ganttTicks(bounds: readonly number[], minGap = TICK_MIN_GAP_PCT): GanttTick[] {
  if (bounds.length < 2) return [];
  const start = bounds[0];
  const end = bounds[bounds.length - 1];
  const total = end - start || 1;
  const pct = (ms: number): number => ((ms - start) / total) * 100;
  const ticks: GanttTick[] = [{ ms: start, pct: 0, align: 'start' }];
  for (const ms of bounds.slice(1, -1)) {
    const p = pct(ms);
    if (p - ticks[ticks.length - 1].pct >= minGap && 100 - p >= minGap) ticks.push({ ms, pct: p, align: 'middle' });
  }
  ticks.push({ ms: end, pct: 100, align: 'end' });
  return ticks;
}

/** Label of a tick: the time alone over one day at most, else the day and the time. */
export function tickLabel(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return spanMs <= 24 * 3600 * 1000 ? time : `${two(d.getDate())}/${two(d.getMonth() + 1)} ${time}`;
}
