// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { css } from 'lit';

/**
 * Styles of the alarm view shell: counter tiles, the filter card, the list card,
 * the confirmation — all read through the alarm tokens (`alarm-tokens.ts`).
 */
// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
export function alarmViewStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
      gap: 0.75rem;
      color: var(--_text);
      font-size: 0.875rem;
    }
    .card {
      background: var(--_surface);
      border: 1px solid var(--_border);
      border-radius: var(--_radius);
      padding: 0.75rem 1rem;
      min-width: 0;
    }
    .list {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    wui-alarm-table {
      flex: 1;
      min-height: 0;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.75rem;
      min-width: 0;
    }
    .bar {
      display: flex;
      flex-direction: column;
      gap: 0.625rem;
    }
    .filters {
      align-items: flex-end;
    }
    .actions {
      display: flex;
      flex-wrap: nowrap;
      gap: 0.5rem;
      margin-left: auto;
    }
    .count {
      align-self: center;
      font-size: 0.75rem;
    }
    .legend {
      font-size: 0.75rem;
      color: var(--_text-soft);
    }

    .stats-none {
      font-size: 0.75rem;
      color: var(--_text-soft);
    }

    /* Counter tiles: what the tab holds, and a filter each. */
    .tiles {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .tile {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.125rem;
      min-width: 8rem;
      padding: 0.625rem 0.875rem;
      background: var(--_surface);
      border: 1px solid var(--_border);
      border-radius: var(--_radius);
      cursor: pointer;
      font: inherit;
      color: inherit;
      text-align: left;
    }
    .tile:hover {
      background: var(--_hover);
    }
    .tile[aria-pressed='true'] {
      border-color: var(--_accent);
      box-shadow: inset 0 0 0 1px var(--_accent);
    }
    .tile .n {
      font-size: 1.5rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
    }
    .tile.unack .n {
      color: var(--_unack);
    }

    /* Tabs: the standing alarms, or the archive of a period. */
    .tabs {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .tab {
      font: inherit;
      font-weight: 600;
      color: var(--_text-soft);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--_radius);
      padding: 0.25rem 0.75rem;
      cursor: pointer;
    }
    .tab[aria-selected='true'] {
      color: var(--_accent);
      border-color: var(--_accent);
    }
    .presets {
      display: flex;
      gap: 0.25rem;
    }
    .preset {
      font: inherit;
      font-size: 0.75rem;
      color: inherit;
      background: transparent;
      border: 1px solid var(--_border);
      border-radius: var(--_radius);
      padding: 0.125rem 0.5rem;
      cursor: pointer;
    }
    .preset[aria-pressed='true'] {
      border-color: var(--_accent);
      color: var(--_accent);
    }
    .ctl {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.75rem;
    }
    .ctl ix-select,
    .ctl ix-date-input {
      min-width: 8.5rem;
    }
    .range {
      font-size: 0.75rem;
    }

    /* A labelled field of the filter bar. */
    .f {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 9rem;
      font-size: 0.75rem;
      color: var(--_text-soft);
    }
    .f.search {
      flex: 1;
      min-width: 14rem;
      max-width: 28rem;
    }
    .f ix-select,
    .f ix-input {
      width: 100%;
    }
    .chk {
      align-self: center;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      color: var(--_text-soft);
      white-space: nowrap;
    }
    .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--_acked);
    }
    .dot.held {
      background: var(--_to-ack);
    }
    .notice,
    .flash {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-radius: var(--_radius);
      background: var(--_surface);
      font-size: 0.8125rem;
    }
    .notice {
      border-left: 3px solid var(--_to-ack);
    }
    .flash {
      border-left: 3px solid var(--_acked);
    }
    .center {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      color: var(--_text-soft);
    }

    /* Confirmation. */
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 9000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--wui-alarm-backdrop, var(--theme-color-backdrop, rgba(0, 0, 0, 0.5)));
    }
    .dialog {
      width: min(30rem, 92vw);
      background: var(--_surface);
      border: 1px solid var(--_border);
      border-radius: var(--_radius);
      box-shadow: var(--wui-alarm-shadow, var(--theme-shadow-4, 0 0.5rem 1.5rem rgba(0, 0, 0, 0.4)));
    }
    .dialog-head {
      padding: 0.75rem 1rem;
      font-size: 1rem;
      font-weight: 700;
      border-bottom: 1px solid var(--_border);
    }
    .dialog-body {
      padding: 1rem;
    }
    .dialog-body p {
      margin: 0 0 0.5rem;
    }
    .dialog-foot {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--_border);
    }

    /* The embedded panel: one dense strip, no cards. */
    :host([layout='panel']) {
      gap: 0.375rem;
      font-size: 0.75rem;
    }
    :host([layout='panel']) .bar {
      gap: 0.375rem;
    }
    :host([layout='panel']) .f.search {
      min-width: 7rem;
    }
  `;
}
