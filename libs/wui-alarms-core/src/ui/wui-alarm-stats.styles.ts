// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { css } from 'lit';

/** Styles of the alarm statistics banner (counters, histogram, bad actors). */
// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
export function alarmStatsStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      color: var(--theme-color-std-text);
      font-size: 0.75rem;
    }
    .banner {
      display: grid;
      /* Four readings on ONE line: the backlog, the ranges, the flood, the repeat
         offenders. They are compared against each other, so they must be seen
         together; below 90rem the grid folds to two columns rather than shrinking
         the histogram into illegibility. */
      grid-template-columns: minmax(8rem, 11rem) minmax(13rem, 1fr) minmax(15rem, 1.3fr) minmax(15rem, 1.3fr);
      gap: 0.625rem;
      align-items: stretch;
    }
    @media (max-width: 90rem) {
      .banner {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 48rem) {
      .banner {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
      padding: 0.5rem 0.6875rem;
      min-width: 0;
    }
    .title {
      font-size: 0.625rem;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--theme-color-soft-text);
    }
    .unack {
      border-color: color-mix(in srgb, var(--wui-alarm-severity-1) 55%, transparent);
      background: color-mix(in srgb, var(--wui-alarm-severity-1) 8%, var(--theme-color-2));
    }
    .unack b {
      display: block;
      font-size: 1.875rem;
      font-weight: 400;
      line-height: 1.1;
      color: var(--wui-alarm-severity-1);
    }
    .hint {
      font-size: 0.6875rem;
      color: var(--theme-color-soft-text);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      min-width: 0;
    }
    .mid {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
    .band {
      display: inline-flex;
      align-items: baseline;
      gap: 0.25rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 0.125rem;
      padding: 0 0.25rem;
      cursor: pointer;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 0.75rem;
    }
    .band[aria-pressed='true'] {
      border-color: var(--theme-color-primary);
      background: color-mix(in srgb, var(--theme-color-primary) 12%, transparent);
    }
    .band .n {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .band .ack {
      font-size: 0.625rem;
      color: var(--theme-color-soft-text);
    }
    .last {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }
    canvas {
      width: 100%;
      height: 4.625rem;
      display: block;
    }
    .actors-card {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .actors {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      flex: 1;
      max-height: 8.5rem;
      overflow: auto;
    }
    .chart {
      position: relative;
    }
    .tip {
      position: absolute;
      transform: translate(-50%, -120%);
      pointer-events: none;
      white-space: nowrap;
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.35);
      padding: 0.25rem 0.5rem;
      font-size: 0.6875rem;
      z-index: 2;
    }
    .tip-when {
      color: var(--theme-color-soft-text);
    }
    .tip-over {
      color: var(--theme-color-warning);
    }
    .actor {
      display: grid;
      grid-template-columns: 1.5rem 1fr auto;
      gap: 0.4375rem;
      align-items: center;
      line-height: 1.5;
      min-width: 0;
    }
    .actor .sub {
      font-size: 0.625rem;
      color: var(--theme-color-soft-text);
    }
    .actor .n {
      font-variant-numeric: tabular-nums;
      color: var(--theme-color-soft-text);
    }
    .tab {
      background: transparent;
      border: 0;
      border-bottom: 0.125rem solid transparent;
      color: var(--theme-color-soft-text);
      font: inherit;
      font-size: 0.75rem;
      padding: 0.125rem 0.375rem;
      cursor: pointer;
    }
    .tab[aria-current='true'] {
      color: var(--theme-color-primary);
      border-bottom-color: var(--theme-color-primary);
    }
    :host([compact]) .banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    :host([compact]) .card {
      border: 0;
      background: transparent;
      padding: 0;
    }
  `;
}
