// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Shared list-table styles for the report-builder tables. */
import { css, type CSSResult } from 'lit';

// eslint-disable-next-line max-lines-per-function -- single shared stylesheet literal
export function tableStyles(): CSSResult {
  return css`
    :host {
      display: block;
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    thead th {
      text-align: left;
      padding: 0.5rem 0.6rem;
      border-bottom: 2px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-weight: 600;
      white-space: nowrap;
      position: sticky;
      top: 0;
      background: var(--theme-color-1);
      z-index: 1;
    }
    tbody td {
      padding: 0.45rem 0.6rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      vertical-align: middle;
    }
    tr.clickable {
      cursor: pointer;
    }
    tbody tr:hover {
      background: var(--theme-color-2);
    }
    .strong {
      font-weight: 600;
    }
    .muted {
      color: var(--theme-color-soft-text);
      font-size: 0.78rem;
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.82rem;
    }
    .chip {
      display: inline-block;
      white-space: nowrap;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--c);
      border: 1px solid var(--c);
      border-radius: 999px;
      padding: 0.05rem 0.5rem;
    }
    .chip.solid {
      color: #fff;
      background: var(--c);
      border-color: var(--c);
    }
    .actions-col {
      white-space: nowrap;
      width: 1%;
      text-align: right;
      /* Hidden until the row is hovered/focused so the destructive buttons are
         not accidentally hit when clicking a row to open it; pointer-events:none
         lets such clicks fall through to the row's "open" handler. */
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.12s ease;
    }
    tr:hover .actions-col,
    tr:focus-within .actions-col {
      opacity: 1;
      pointer-events: auto;
    }
  `;
}
