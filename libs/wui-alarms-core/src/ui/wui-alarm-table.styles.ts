// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { css } from 'lit';

/** Styles of the alarm table (log table + pager), read through the alarm tokens. */
// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
export function alarmTableStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      color: var(--_text);
    }
    .wrap {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--_surface-raised);
      color: var(--_text);
      font-weight: 600;
      text-align: left;
      padding: 0.375rem 0.5rem;
      border-bottom: 1px solid var(--_border);
      white-space: nowrap;
    }
    thead th.sortable {
      cursor: pointer;
      user-select: none;
    }
    thead th.sortable:hover {
      color: var(--_accent);
    }
    th.chk,
    td.chk {
      width: 1.5rem;
    }
    td.chk .ack-one {
      margin: -0.25rem 0;
    }
    tbody td {
      padding: 0.375rem 0.5rem;
      border-bottom: 1px solid var(--_border);
      vertical-align: middle;
    }
    tbody tr:hover td {
      background: var(--_hover);
    }
    tbody tr.sel td {
      background: var(--_selected);
    }
    /* An unacknowledged row: an edge in the "unacknowledged" colour. */
    tbody tr.unacked td:first-child {
      box-shadow: inset 3px 0 0 var(--_unack);
    }
    /* A gone row is read after the standing ones. */
    tbody tr.went td {
      color: var(--_text-soft);
    }
    td.nowrap {
      white-space: nowrap;
    }
    td.wrap {
      white-space: normal;
      word-break: break-word;
    }
    td.text {
      min-width: 12rem;
    }
    td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    td.dpe {
      max-width: 14rem;
    }
    code {
      font-family: var(--_mono);
      font-size: 0.8125rem;
      background: var(--_surface-raised);
      padding: 0 0.25rem;
      border-radius: 3px;
    }
    .legend {
      font-size: 0.75rem;
      color: var(--_text-soft);
    }
    .empty {
      padding: 2rem;
      text-align: center;
      color: var(--_text-soft);
    }
    .pager {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding-top: 0.5rem;
      font-size: 0.75rem;
      flex-wrap: wrap;
    }
    .pager button {
      background: transparent;
      border: 1px solid var(--_border);
      border-radius: var(--_radius);
      color: inherit;
      font: inherit;
      font-size: 0.75rem;
      min-width: 1.75rem;
      min-height: 1.5rem;
      cursor: pointer;
    }
    .pager button[aria-current='true'] {
      border-color: var(--_accent);
      color: var(--_accent);
    }
    .pager button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    :host([compact]) table {
      font-size: 0.75rem;
    }
    :host([compact]) tbody td,
    :host([compact]) thead th {
      padding: 0.1875rem 0.375rem;
    }
    :host([compact]) td.text {
      min-width: 8rem;
    }
    :host([compact]) .badge {
      font-size: 0.6875rem;
      padding: 0 0.375rem;
    }
  `;
}
