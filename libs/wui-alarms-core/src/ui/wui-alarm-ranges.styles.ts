// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { css } from 'lit';

/** Styles of the priority-range editor dialog. */
// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
export function rangeStyles(): ReturnType<typeof css> {
  return css`
    .panel {
      width: 44rem;
    }
    .ranges {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
      margin: 0.5rem 0;
    }
    .ranges th {
      text-align: left;
      font-size: 0.6875rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--_text-soft);
      padding: 0.25rem 0.375rem;
      border-bottom: 1px solid var(--_border);
    }
    .ranges td {
      padding: 0.25rem 0.375rem;
      border-bottom: 1px solid var(--_border);
      vertical-align: middle;
    }
    .ranges input {
      background: var(--_surface-sunken);
      border: 1px solid var(--_border);
      border-radius: var(--_radius);
      color: inherit;
      font: inherit;
      font-size: 0.8125rem;
      padding: 0.125rem 0.375rem;
    }
    .ranges input.abbr {
      width: 7rem;
    }
    .ranges input.prior {
      width: 5rem;
      text-align: right;
    }
    .ranges input.label {
      width: 9rem;
    }
    .ranges td.color {
      white-space: nowrap;
    }
    .ranges label.theme {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      margin-left: 0.375rem;
      font-size: 0.75rem;
      color: var(--_text-soft);
    }
    .ranges input[type='color'] {
      width: 2.5rem;
      height: 1.5rem;
      padding: 0;
    }
    .add {
      margin-top: 0.25rem;
    }
    .notice {
      margin: 0.375rem 0;
      padding: 0.375rem 0.625rem;
      border-radius: var(--_radius);
      background: color-mix(in srgb, var(--_to-ack) 18%, transparent);
      border: 1px solid var(--_to-ack);
      font-size: 0.75rem;
    }
  `;
}
