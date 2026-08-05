// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { css } from 'lit';

/** Styles of the alarm table (dense log table + pager). */
// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
export function alarmTableStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      color: var(--theme-color-std-text);
    }
    .wrap {
      flex: 1;
      min-height: 0;
      overflow: auto;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.75rem;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--theme-color-2);
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      text-align: left;
      font-size: 0.625rem;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--theme-color-soft-text);
      padding: 0.25rem 0.375rem;
      white-space: nowrap;
    }
    thead th.sortable {
      cursor: pointer;
      user-select: none;
    }
    thead th.sortable:hover {
      color: var(--theme-color-primary);
    }
    tbody td {
      padding: 0.125rem 0.375rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      white-space: nowrap;
      vertical-align: middle;
    }
    tbody tr {
      border-left: 0.1875rem solid transparent;
    }
    tbody tr:hover {
      background: color-mix(in srgb, var(--theme-color-primary) 8%, transparent);
    }
    tbody tr.unacked {
      font-weight: 600;
    }
    tbody tr.cleared {
      color: var(--theme-color-soft-text);
    }
    td.text {
      white-space: normal;
      min-width: 12rem;
    }
    td.num {
      text-align: right;
    }
    .state {
      font-size: 0.625rem;
      letter-spacing: 0.04em;
      border: 1px solid currentcolor;
      border-radius: 0.125rem;
      padding: 0 0.25rem;
      white-space: nowrap;
    }
    .state.ok {
      color: var(--theme-color-success);
    }
    .state.gone {
      color: var(--theme-color-soft-text);
    }
    .empty {
      padding: 1.5rem;
      text-align: center;
      color: var(--theme-color-soft-text);
    }
    .pager {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding-top: 0.375rem;
      font-size: 0.75rem;
      flex-wrap: wrap;
    }
    .pager button {
      background: transparent;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 0.125rem;
      color: inherit;
      font: inherit;
      font-size: 0.6875rem;
      min-width: 1.5rem;
      cursor: pointer;
    }
    .pager button[aria-current='true'] {
      border-color: var(--theme-color-primary);
      color: var(--theme-color-primary);
    }
    .pager button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    :host([compact]) table {
      font-size: 0.6875rem;
    }
    :host([compact]) td.text {
      min-width: 8rem;
    }
  `;
}
