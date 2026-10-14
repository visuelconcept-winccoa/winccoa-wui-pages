// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layout of the GIS page shell — the overview, the toolbar over the map, and the
 * split that puts the side panel next to it (and under it on a narrow viewport).
 *
 * Split out of `gis.ts` so the page entry reads as behaviour rather than as one
 * long stylesheet.
 *
 * The default area palette used to live here too, and was duplicated in `ai-context.ts`.
 * It now has one home in `types.ts`, which the map, the sanitiser and the importer can all
 * reach without pulling in the UI layer — `nextAreaColor` is re-exported here so the page's
 * existing call site is unchanged.
 */
import { css, type CSSResult } from 'lit';

export { nextAreaColor } from '../types.js';

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
      gap: 0.5rem;
      padding: 0 1rem 1rem;
      box-sizing: border-box;
    }
    gis-site-table {
      flex: 1;
      min-height: 0;
    }
    /* Import / export and the assistant sit at the end of the overview's action row. */
    .overview-tools {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .overview-tools .grow {
      flex: 1;
    }
    .toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .toolbar .grow {
      flex: 1;
    }
    .site-name {
      font-weight: 600;
    }
    .area-filter {
      min-width: 12rem;
    }
    .count {
      color: var(--theme-color-soft-text);
      font-size: 0.875rem;
    }
    /* The site's alarm count — a button, because it filters the map down to them. */
    .alarm-synthesis {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.0625rem 0.5rem;
      border-radius: 999px;
      border: 1px solid var(--theme-color-alarm);
      background: color-mix(in srgb, var(--theme-color-alarm) 16%, transparent);
      color: var(--theme-color-alarm);
      font: inherit;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
    }
    .alarm-synthesis:hover {
      background: color-mix(in srgb, var(--theme-color-alarm) 28%, transparent);
    }
    .hint {
      color: var(--theme-color-soft-text);
      font-size: 0.8125rem;
    }
    .split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 21rem);
      gap: 0.5rem;
      flex: 1;
      min-height: 0;
    }
    gis-map {
      min-height: 18rem;
    }
    gis-map.embedded {
      display: block;
      height: 100%;
      border: 0;
      border-radius: 0;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--theme-color-information);
      border-radius: var(--theme-default-border-radius);
      color: var(--theme-color-information);
      background: color-mix(
        in srgb,
        var(--theme-color-information) 12%,
        transparent
      );
      font-size: 0.8125rem;
    }
    .notice.warn {
      border-color: var(--theme-color-warning);
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
      color: var(--theme-color-soft-text);
    }

    /* The inspector drops under the map on a narrow viewport. */
    @media (max-width: 1100px) {
      .split {
        grid-template-columns: minmax(0, 1fr);
        overflow: auto;
      }
      gis-map {
        min-height: 24rem;
      }
    }
  `;
}
