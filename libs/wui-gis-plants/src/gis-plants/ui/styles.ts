// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layout of the Power plants page: the fleet summary strip over a grid of plant cards.
 */
import { css, type CSSResult } from 'lit';

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
export function pageStyles(): CSSResult {
  return css`
    :host {
      display: block;
      height: 100%;
      color: var(--theme-color-std-text);
    }
    .page {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      gap: 0.75rem;
      padding: 0 1rem 1rem;
      box-sizing: border-box;
      overflow: auto;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--theme-color-warning);
      border-radius: var(--theme-default-border-radius);
      color: var(--theme-color-warning);
      background: color-mix(
        in srgb,
        var(--theme-color-warning) 12%,
        transparent
      );
    }
    .center {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: var(--theme-color-soft-text);
      padding: 2rem;
    }

    /* ---- fleet summary ---- */
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: 0.5rem;
    }
    .kpi {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      padding: 0.5rem 0.75rem;
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-component-1);
    }
    .kpi .label {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .kpi .value {
      font-size: 1.25rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .kpi .unit {
      font-size: 0.875rem;
      font-weight: 400;
      color: var(--theme-color-soft-text);
      margin-inline-start: 0.25rem;
    }

    /* ---- plant cards ---- */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
      gap: 0.75rem;
      align-content: start;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-soft-bdr);
      border-inline-start: 4px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-component-1);
      cursor: default;
    }
    .card.linked {
      cursor: pointer;
    }
    .card.linked:hover {
      background: var(--theme-color-component-1--hover);
    }
    .card.linked:focus-visible {
      outline: 2px solid var(--theme-color-focus-bdr);
      outline-offset: 2px;
    }
    .head {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .rank {
      flex: none;
      min-width: 1.5rem;
      font-weight: 700;
      color: var(--theme-color-soft-text);
      font-variant-numeric: tabular-nums;
    }
    .title {
      flex: 1;
      min-width: 0;
    }
    .name {
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .site {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .output {
      display: flex;
      align-items: baseline;
      gap: 0.375rem;
      font-variant-numeric: tabular-nums;
    }
    .output .big {
      font-size: 1.75rem;
      font-weight: 700;
    }
    .output .of {
      color: var(--theme-color-soft-text);
    }
    .bar {
      height: 0.375rem;
      border-radius: 0.1875rem;
      background: var(--theme-color-component-3);
      overflow: hidden;
    }
    .bar > span {
      display: block;
      height: 100%;
      background: var(--theme-color-primary);
      transition: width 0.3s ease;
    }
    .params {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.25rem 0.5rem;
      margin: 0;
    }
    .params div {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .params dt {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .params dd {
      margin: 0;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
  `;
}
