/** Styles for the Fleet Stop-Cause Analysis page (kept out of the component file). */
import { css } from 'lit';

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
export function pageStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      color: var(--theme-color-std-text);
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      flex: 1;
      min-height: 0;
      padding: 1rem;
      box-sizing: border-box;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.75rem;
    }
    .sep {
      width: 1px;
      align-self: stretch;
      background: var(--theme-color-soft-bdr);
    }
    .grow {
      flex: 1;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 11rem;
    }
    .lbl {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-warning) 18%, transparent);
      border: 1px solid var(--theme-color-warning);
    }
    .center {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .table-wrap {
      flex: 1;
      min-height: 0;
      overflow: auto;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    .tbl {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    .tbl th,
    .tbl td {
      padding: 0.5rem 0.75rem;
      text-align: left;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .tbl thead th {
      position: sticky;
      top: 0;
      background: var(--theme-color-2);
      z-index: 1;
    }
    .tbl .num {
      text-align: right;
      white-space: nowrap;
    }
    .tbl .nowrap {
      white-space: nowrap;
    }
    .tbl th.sortable {
      cursor: pointer;
      user-select: none;
    }
    .tbl th.sortable:hover {
      color: var(--theme-color-primary);
    }
    .raw-area {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .raw-tools {
      display: flex;
    }
    .raw-search {
      width: 18rem;
      max-width: 100%;
    }
    .tbl tfoot td {
      font-weight: 600;
      border-top: 2px solid var(--theme-color-soft-bdr);
      border-bottom: none;
    }
    .tbl tbody tr:hover {
      background: color-mix(in srgb, var(--theme-color-primary) 8%, transparent);
    }
    .bar-cell {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.5rem;
    }
    .bar-cell em {
      color: var(--theme-color-soft-text);
      font-style: normal;
    }
    .bar {
      height: 0.5rem;
      width: var(--p, 0%);
      min-width: 2px;
      border-radius: 0.25rem;
      background: var(--theme-color-primary);
    }
    .chip {
      display: inline-block;
      padding: 0.1rem 0.5rem;
      border-radius: 0.7rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: #fff;
    }
    .chip--unplanned {
      background: var(--theme-color-alarm, #ef4444);
    }
    .chip--planned {
      background: var(--theme-color-warning, #f59e0b);
    }
    .chip--production {
      background: var(--theme-color-success, #10b981);
    }
    .chart-area {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .chart-tools {
      display: flex;
      justify-content: flex-end;
    }
    .field--inline {
      flex-direction: row;
      align-items: center;
      min-width: 0;
    }
    .chart {
      flex: 1;
      min-height: 0;
      width: 100%;
    }
  `;
}
