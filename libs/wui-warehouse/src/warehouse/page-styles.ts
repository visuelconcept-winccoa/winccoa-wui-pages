// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Styles for the Warehouse page shell (kept out of the component for size). */
import { css, type CSSResult } from 'lit';

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
export function pageStyles(): CSSResult {
  return css`
    :host {
      display: block;
      height: 100%;
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
      padding: 0 1rem 1rem;
      overflow: auto;
    }
    .offline {
      background: color-mix(in srgb, var(--theme-color-warning, #f59e0b) 18%, transparent);
      border: 1px solid var(--theme-color-warning, #f59e0b);
      border-radius: var(--theme-default-border-radius);
      padding: 0.4rem 0.7rem;
      margin: 0.5rem 0;
      font-size: 0.85rem;
    }
    .locked {
      padding: 2rem;
      text-align: center;
      color: var(--theme-color-soft-text);
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      padding: 0.5rem 0;
    }
    .panel {
      flex: 1;
      min-height: 0;
    }
    .plan-wrap {
      display: grid;
      grid-template-columns: 1fr 20rem;
      gap: 0.75rem;
      height: 100%;
      min-height: 0;
    }
    .detail {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      padding: 0.75rem;
      overflow: auto;
    }
    .detail.muted {
      color: var(--theme-color-soft-text);
    }
    .detail-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      border-left: 4px solid var(--accent);
      padding-left: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .detail-head .dot {
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 50%;
      background: var(--accent);
    }
    .detail-meta {
      display: flex;
      justify-content: space-between;
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
      margin-bottom: 0.5rem;
    }
    .subhead {
      font-weight: 600;
      color: var(--theme-color-soft-text);
      font-size: 0.8rem;
      margin: 0.5rem 0 0.25rem;
    }
    .content-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.25rem 0;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      font-size: 0.88rem;
    }
    .content-row:last-child {
      border-bottom: none;
    }
    .strong {
      font-weight: 600;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.8rem;
    }
    .warn {
      color: var(--theme-color-warning, #f59e0b);
    }
    .alarm {
      color: var(--theme-color-alarm, #ef4444);
    }
  `;
}
