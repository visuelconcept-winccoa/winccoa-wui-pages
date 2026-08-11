// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The single place this page imports MapLibre GL from, and the single place its
 * stylesheet enters the Shadow DOM.
 *
 * Two packaging details are worth the indirection:
 *
 * - **The import shape.** maplibre-gl 5.x publishes ONE bundle,
 *   `dist/maplibre-gl.js`, which is UMD even though the package declares
 *   `"type": "module"`. A default import is what survives both the dev server
 *   (esbuild interop) and `build:pages` (Rollup's commonjs transform, enabled via
 *   `transformMixedEsModules`). Named imports are NOT reliable across both.
 * - **The stylesheet.** MapLibre positions its canvas, controls and popups from
 *   `dist/maplibre-gl.css`. The map lives in a Shadow Root, which document-level
 *   CSS cannot reach, and the pages build would emit a separate `.css` asset that
 *   nothing loads. `?inline` hands us the stylesheet as a string instead, so
 *   {@link MAPLIBRE_STYLES} can be adopted by the component's shadow root and the
 *   page stays one self-contained chunk.
 */
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css?inline';
import { unsafeCSS, type CSSResult } from 'lit';

export { default } from 'maplibre-gl';

/** MapLibre's own stylesheet, ready to be listed in a component's `static styles`. */
export const MAPLIBRE_STYLES: CSSResult = unsafeCSS(maplibreCss);

/**
 * The MapLibre types the page names. Only the *values* have to come through the
 * default import — the published `.d.ts` exports every type by name, so these are
 * safe (and keep the rest of the page free of `maplibre-gl` imports).
 */
export type {
  GeoJSONSource,
  LayerSpecification,
  LngLatBoundsLike,
  MapLibreMap,
  MapMouseEvent,
  Marker,
  StyleSpecification
} from 'maplibre-gl';
