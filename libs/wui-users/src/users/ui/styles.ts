// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Styles shared by the Users page's tabs: toolbar, table, tags, permission grid. */
import { css, type CSSResult } from 'lit';

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
export function listStyles(): CSSResult {
  return css`
    :host {
      display: block;
      color: var(--theme-color-std-text);
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding-bottom: 0.6rem;
      flex-wrap: wrap;
    }
    .toolbar ix-input {
      width: 260px;
    }
    .grow {
      flex: 1;
    }
    .hint {
      font-size: 0.82rem;
      color: var(--theme-color-soft-text);
      margin: 0.25rem 0 0.6rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      vertical-align: top;
    }
    th {
      color: var(--theme-color-soft-text);
      font-weight: 600;
      position: sticky;
      top: 0;
      background: var(--theme-color-2);
    }
    tr.off td {
      opacity: 0.55;
    }
    td.actions {
      white-space: nowrap;
      text-align: right;
    }
    .tag {
      display: inline-block;
      padding: 0.05rem 0.45rem;
      margin: 0 0.25rem 0.15rem 0;
      border-radius: 999px;
      font-size: 0.75rem;
      background: var(--theme-color-component-1);
      border: 1px solid var(--theme-color-soft-bdr);
    }
    .tag.ad {
      border-color: var(--theme-color-primary);
    }
    .section {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.75rem 1rem;
      margin-bottom: 1rem;
      background: var(--theme-color-1);
    }
    .section h3 {
      margin: 0 0 0.5rem;
      font-size: 1rem;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin: 0.4rem 0;
    }
    .scroll {
      max-height: 360px;
      overflow: auto;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
  `;
}
