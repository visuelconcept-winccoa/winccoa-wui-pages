// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { css } from 'lit';

/** Styles of the alarm view shell (toolbar + banner + table). */
// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
export function alarmViewStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
      gap: 0.5rem;
      color: var(--theme-color-std-text);
      font-size: 0.8125rem;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      min-width: 0;
    }
    .tabs {
      display: flex;
      align-items: center;
    }
    .tab {
      background: transparent;
      border: 0;
      border-bottom: 0.125rem solid transparent;
      color: var(--theme-color-soft-text);
      font: inherit;
      padding: 0.1875rem 0.5rem;
      cursor: pointer;
    }
    .tab[aria-current='true'] {
      color: var(--theme-color-primary);
      border-bottom-color: var(--theme-color-primary);
    }
    .ctl {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.75rem;
    }
    .ctl ix-select,
    .ctl ix-date-input {
      min-width: 8.5rem;
    }
    input[type='search'] {
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      color: inherit;
      font: inherit;
      font-size: 0.75rem;
      padding: 0.1875rem 0.4375rem;
      min-width: 12rem;
      flex: 1;
      max-width: 22rem;
    }
    .chk {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
      white-space: nowrap;
    }
    .act {
      background: transparent;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      color: inherit;
      font: inherit;
      font-size: 0.6875rem;
      padding: 0.125rem 0.5rem;
      cursor: pointer;
      white-space: nowrap;
    }
    .act:hover:not(:disabled) {
      border-color: var(--theme-color-primary);
    }
    .act:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .act.primary:not(:disabled) {
      background: var(--theme-color-primary);
      border-color: var(--theme-color-primary);
      color: var(--theme-color-primary--contrast, var(--theme-color-1));
      font-weight: 700;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.6875rem;
      color: var(--theme-color-soft-text);
      white-space: nowrap;
    }
    .dot {
      width: 0.4375rem;
      height: 0.4375rem;
      border-radius: 50%;
      background: var(--theme-color-success);
    }
    .dot.held {
      background: var(--theme-color-warning);
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0.625rem;
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-warning) 18%, transparent);
      border: 1px solid var(--theme-color-warning);
      font-size: 0.75rem;
    }
    .center {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      color: var(--theme-color-soft-text);
    }
    wui-alarm-table {
      flex: 1;
      min-height: 0;
    }
    :host([layout='panel']) {
      font-size: 0.75rem;
      gap: 0.375rem;
    }
    :host([layout='panel']) input[type='search'] {
      min-width: 7rem;
      max-width: none;
    }
  `;
}
