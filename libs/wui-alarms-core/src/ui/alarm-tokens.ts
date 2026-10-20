// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The alarm view's design tokens, and the colour rules shared by its parts.
 *
 * TOKENS. Every colour, surface and radius of the view is a public custom
 * property `--wui-alarm-*` with a Siemens iX default (`--theme-*`). A site
 * restyles the view from its charter by setting those properties on `:root` (or
 * on any ancestor) — nothing else:
 *
 * ```css
 * :root {
 *   --wui-alarm-level-1: var(--fr-severity-alarm);
 *   --wui-alarm-surface: var(--fr-surface-base);
 * }
 * ```
 *
 * They are READ through private properties (`--_level-1`…) declared on each
 * component's host. Declaring the public names on `:host` instead would shadow
 * the site's values, since an element's own declaration beats an inherited one.
 *
 * | token                                 | iX default                       | what                              |
 * | ------------------------------------- | -------------------------------- | --------------------------------- |
 * | `--wui-alarm-surface`                 | `--theme-color-2`                | cards                             |
 * | `--wui-alarm-surface-raised`          | `--theme-color-3`                | table header, badges              |
 * | `--wui-alarm-surface-sunken`          | `--theme-color-1`                | fields                            |
 * | `--wui-alarm-surface-hover`           | `--theme-color-ghost--hover`     | row under the pointer             |
 * | `--wui-alarm-surface-selected`        | `--theme-color-ghost--selected`  | selected row                      |
 * | `--wui-alarm-border`                  | `--theme-color-soft-bdr`         | card and cell borders             |
 * | `--wui-alarm-border-strong`           | `--theme-color-std-bdr`          | field borders                     |
 * | `--wui-alarm-text`                    | `--theme-color-std-text`         | text                              |
 * | `--wui-alarm-text-secondary`          | `--theme-color-soft-text`        | captions, gone rows               |
 * | `--wui-alarm-accent`                  | `--theme-color-primary`          | pressed tile, active tab, sort    |
 * | `--wui-alarm-radius`                  | `--theme-default-border-radius`  | corners                           |
 * | `--wui-alarm-level-1` … `-6`          | alarm, warning, info, neutral…   | the levels, most urgent first     |
 * | `--wui-alarm-on-level`                | `--theme-color-1`                | text on a level pill              |
 * | `--wui-alarm-unacknowledged`          | `--theme-color-alarm`            | edge of an unacknowledged row     |
 * | `--wui-alarm-state-came`              | `--theme-color-alarm`            | "came" badge                      |
 * | `--wui-alarm-state-went`              | `--theme-color-std-bdr`          | "went" badge                      |
 * | `--wui-alarm-state-to-ack`            | `--theme-color-warning`          | "to acknowledge" badge            |
 * | `--wui-alarm-state-acked`             | `--theme-color-success`          | "acknowledged" badge              |
 * | `--wui-alarm-chart-bar`               | `--theme-color-primary`          | histogram bar                     |
 * | `--wui-alarm-chart-over`              | level 1                          | bar above the EEMUA ceiling       |
 * | `--wui-alarm-chart-threshold`         | `--theme-color-warning`          | the ceiling line                  |
 * | `--wui-alarm-font-mono`               | `--theme-font-family-monospace`  | times, values, element names      |
 * | `--wui-alarm-backdrop`                | `--theme-color-backdrop`         | behind the confirmation           |
 * | `--wui-alarm-shadow`                  | `--theme-shadow-4`               | the confirmation                  |
 *
 * COLOURS OF A ROW. Two colours coexist, and they answer two different
 * questions:
 *
 *  - the LEVEL colour ({@link rangeColor}) — the project's own severity scale. It
 *    is the level's token, unless the level carries a colour of its own (edited
 *    in the page, stored in the configuration datapoint);
 *  - the ALERT CLASS colour ({@link alarmColor}) — what WinCC OA returns for the
 *    class (`Alert.color`). It stays on the class pill, untouched: the project
 *    configured it in the engineering, and the view is not the place to
 *    reinterpret it.
 */
import { css } from 'lit';
import { rangeAt, type Alarm, type AlarmRange } from '../types.js';

/** Levels with a token of their own; deeper ones share the last. */
export const LEVEL_TOKENS = 6;

/** The private token of a level's colour (resolvable by `getComputedStyle` too). */
export function levelToken(rank: number): string {
  return `--_level-${Math.min(Math.max(1, rank), LEVEL_TOKENS)}`;
}

/** The token declarations — include FIRST in every component's styles. */
export function alarmTokens(): ReturnType<typeof css> {
  return css`
    :host {
      --_surface: var(--wui-alarm-surface, var(--theme-color-2));
      --_surface-raised: var(--wui-alarm-surface-raised, var(--theme-color-3));
      --_surface-sunken: var(--wui-alarm-surface-sunken, var(--theme-color-1));
      --_hover: var(--wui-alarm-surface-hover, var(--theme-color-ghost--hover));
      --_selected: var(--wui-alarm-surface-selected, var(--theme-color-ghost--selected));
      --_border: var(--wui-alarm-border, var(--theme-color-soft-bdr));
      --_border-strong: var(--wui-alarm-border-strong, var(--theme-color-std-bdr));
      --_text: var(--wui-alarm-text, var(--theme-color-std-text));
      --_text-soft: var(--wui-alarm-text-secondary, var(--theme-color-soft-text));
      --_accent: var(--wui-alarm-accent, var(--theme-color-primary));
      --_radius: var(--wui-alarm-radius, var(--theme-default-border-radius, 4px));
      --_mono: var(--wui-alarm-font-mono, var(--theme-font-family-monospace, ui-monospace, monospace));
      --_level-1: var(--wui-alarm-level-1, var(--theme-color-alarm));
      --_level-2: var(--wui-alarm-level-2, var(--theme-color-warning));
      --_level-3: var(--wui-alarm-level-3, var(--theme-color-info));
      --_level-4: var(--wui-alarm-level-4, var(--theme-color-neutral, var(--theme-color-soft-text)));
      --_level-5: var(--wui-alarm-level-5, var(--theme-color-soft-text));
      --_level-6: var(--wui-alarm-level-6, var(--theme-color-weak-text, var(--theme-color-soft-text)));
      --_on-level: var(--wui-alarm-on-level, var(--theme-color-1));
      --_unack: var(--wui-alarm-unacknowledged, var(--theme-color-alarm));
      --_came: var(--wui-alarm-state-came, var(--theme-color-alarm));
      --_went: var(--wui-alarm-state-went, var(--theme-color-std-bdr));
      --_to-ack: var(--wui-alarm-state-to-ack, var(--theme-color-warning));
      --_acked: var(--wui-alarm-state-acked, var(--theme-color-success));
      --_bar: var(--wui-alarm-chart-bar, var(--theme-color-primary));
      --_bar-over: var(--wui-alarm-chart-over, var(--_level-1));
      --_threshold: var(--wui-alarm-chart-threshold, var(--theme-color-warning));
    }
  `;
}

/** Layout helpers shared by the view, the table and the statistics. */
export function severityTokens(): ReturnType<typeof css> {
  return css`
    ${alarmTokens()}
    .pill {
      display: inline-block;
      border-radius: 0.125rem;
      padding: 0 0.25rem;
      font-size: 0.625rem;
      font-weight: 700;
      line-height: 1.4;
      color: var(--_on-level);
      white-space: nowrap;
    }
    .muted {
      color: var(--_text-soft);
    }
    .mono {
      font-family: var(--_mono);
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
    /* A level: its colour AND its name, never the colour alone. */
    .sev {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-weight: 600;
      font-size: 0.75rem;
      white-space: nowrap;
    }
    .sev::before {
      content: '';
      flex: none;
      width: 0.625rem;
      height: 0.625rem;
      border-radius: 2px;
      background: var(--sev-color, var(--_text-soft));
    }
    .sev.top::before {
      outline: 2px solid var(--sev-color, var(--_text-soft));
      outline-offset: 1px;
    }
    /* A state: a dot and a word. */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.0625rem 0.5rem;
      border-radius: 999px;
      border: 1px solid var(--_border);
      background: var(--_surface-raised);
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge::before {
      content: '';
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--_went);
    }
    .badge.came {
      border-color: var(--_came);
    }
    .badge.came::before {
      background: var(--_came);
    }
    .badge.to-ack {
      border-color: var(--_to-ack);
    }
    .badge.to-ack::before {
      background: var(--_to-ack);
    }
    .badge.acked::before {
      background: var(--_acked);
    }
  `;
}

/** The colour of a level: its own when it carries one, else the level's token. */
export function rangeColor(rank: number, ranges: readonly AlarmRange[]): string {
  const color = rangeAt(rank, ranges).color;
  return color || `var(${levelToken(rank)})`;
}

/** The configured short label of the range an alarm falls in. */
export function rangeAbbr(rank: number, ranges: readonly AlarmRange[]): string {
  return rangeAt(rank, ranges).abbr || `P${rank}`;
}

/** The colour WinCC OA returns for the alarm's class; the level colour when it has none. */
export function alarmColor(alarm: Pick<Alarm, 'color' | 'rank'>, ranges: readonly AlarmRange[]): string {
  return alarm.color === '' ? rangeColor(alarm.rank, ranges) : alarm.color;
}
