// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Colour rules shared by every part of the alarm view.
 *
 * TWO colours coexist on a row, and they answer two different questions:
 *
 *  - the RANGE colour ({@link rangeColor}) — the project's own severity scale,
 *    edited in the page and stored in the configuration datapoint. It carries the
 *    row's left border and its range pill: the "how bad is this" read at a glance.
 *  - the ALERT CLASS colour ({@link alarmColor}) — what WinCC OA returns for the
 *    class (`Alert.color`). It stays on the class pill and the state chip,
 *    untouched: the project configured it in the engineering, and the view is not
 *    the place to reinterpret it.
 */
import { css } from 'lit';
import { rangeAt, type Alarm, type AlarmRange } from '../types.js';

/** Neutral fallback when a range carries no colour. */
const FALLBACK_COLOR = 'var(--theme-color-soft-text)';

/** Layout helpers shared by the view, the table and the statistics. */
export function severityTokens(): ReturnType<typeof css> {
  return css`
    .pill {
      display: inline-block;
      border-radius: 0.125rem;
      padding: 0 0.25rem;
      font-size: 0.625rem;
      font-weight: 700;
      line-height: 1.4;
      color: var(--theme-color-1);
      white-space: nowrap;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .mono {
      font-family: var(--theme-font-family-monospace, ui-monospace, monospace);
      font-variant-numeric: tabular-nums;
    }
    .grow {
      flex: 1;
    }
    .ell {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
}

/** The configured colour of the range an alarm falls in. */
export function rangeColor(rank: number, ranges: readonly AlarmRange[]): string {
  return rangeAt(rank, ranges).color || FALLBACK_COLOR;
}

/** The configured short label of the range an alarm falls in. */
export function rangeAbbr(rank: number, ranges: readonly AlarmRange[]): string {
  return rangeAt(rank, ranges).abbr || `P${rank}`;
}

/** The colour WinCC OA returns for the alarm's class; the range colour when it has none. */
export function alarmColor(alarm: Pick<Alarm, 'color' | 'rank'>, ranges: readonly AlarmRange[]): string {
  return alarm.color === '' ? rangeColor(alarm.rank, ranges) : alarm.color;
}
