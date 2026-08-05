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
      grid-template-columns: minmax(9rem, 12rem) 1fr minmax(16rem, 26rem);
      gap: 0.625rem;
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
    .actors {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      max-height: 11rem;
      overflow: auto;
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
