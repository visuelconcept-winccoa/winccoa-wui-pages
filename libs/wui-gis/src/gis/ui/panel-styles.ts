// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Styles shared by the two side panels — the asset inspector and the area panel.
 *
 * They are the same piece of furniture in the layout (a bordered card with a
 * coloured badge, a title, and a scrolling body of labelled sections), so the shell
 * lives here once and each panel appends only what is its own.
 */
import { css, type CSSResult } from 'lit';

// eslint-disable-next-line max-lines-per-function -- single shared stylesheet literal
export function panelCore(): CSSResult {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      overflow: hidden;
    }
    .none {
      padding: 1rem;
      color: var(--theme-color-soft-text);
      font-size: 0.875rem;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.5rem 0.5rem 0.75rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-2);
    }
    .badge {
      display: grid;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      flex: none;
      border-radius: 50%;
      background: var(--badge);
      color: var(--theme-color-inv-text, #fff);
    }
    .titles {
      flex: 1;
      min-width: 0;
    }
    .title {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sub {
      color: var(--theme-color-soft-text);
      font-size: 0.75rem;
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 0.625rem;
      padding: 0.75rem;
      overflow: auto;
      min-height: 0;
    }
    .row {
      display: grid;
      gap: 0.5rem;
    }
    .row.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .section {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin-top: 0.25rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
    }
    .section-title {
      color: var(--theme-color-soft-text);
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .mono {
      font-family: var(--theme-font-family-mono, monospace);
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .muted {
      color: var(--theme-color-soft-text);
      font-size: 0.8125rem;
    }
    .hint {
      color: var(--theme-color-soft-text);
      font-size: 0.75rem;
    }
    .error {
      color: var(--theme-color-alarm);
      font-size: 0.75rem;
    }
    .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--theme-color-alarm);
    }

    /* A live-value list: caption on the left, right-aligned figure on the right. Shared
       because the asset inspector and the area panel's asset cards show the same thing. */
    dl.readings {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.25rem 0.75rem;
      margin: 0;
      font-size: 0.875rem;
    }
    dl.readings dt {
      color: var(--theme-color-soft-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    dl.readings dd {
      margin: 0;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    dl.readings .unit {
      margin-left: 0.1875rem;
      font-weight: 400;
      opacity: 0.7;
    }
  `;
}
