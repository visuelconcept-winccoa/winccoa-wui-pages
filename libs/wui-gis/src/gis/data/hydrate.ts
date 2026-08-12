// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bringing a stored site up to the current model.
 *
 * Its own module, with no dependency on the store, for two reasons: this is pure data
 * migration and has no business knowing about datapoints, and `gis-store.ts` reaches
 * `OaRxJsApi` through `DpJsonStore`, which cannot even be imported outside a browser — so a
 * migration living there could not be tested at all. (The same layering mistake, and the same
 * fix, as the import errors in `io.ts`.)
 */
import {
  AUTO_GROUP_ZOOM,
  DEFAULT_ZOOM,
  defaultBasemap,
  type Site
} from '../types.js';

/**
 * The area list of an asset stored before multi-area membership existed: its single
 * `areaId`, or nothing. Reads the field off the raw record, which no longer declares it.
 */
function legacyAreaIds(asset: object): string[] {
  const legacy = (asset as { areaId?: unknown }).areaId;
  return typeof legacy === 'string' && legacy !== '' ? [legacy] : [];
}

/**
 * Backfill the fields a record saved by an EARLIER version of this page may lack.
 *
 * The JSON in the datapoint is the one place a `Site` enters the page without the compiler
 * having checked it: every other construction is a typed literal, so `tsc` guarantees it is
 * complete. Here the parsed object is simply cast, which is why each field the model gains
 * has to be added below — and why forgetting one crashes the first consumer that reads its
 * `.length` (it did: `layerIds` on a site stored before information layers existed).
 *
 * Exported and pure so a test can feed it a legacy record, rather than leaving the list to
 * be re-verified by hand on every model change.
 *
 * It deliberately does **not** call `normalizeSite`. That sanitiser is right for untrusted
 * input — an AI proposal, an imported file — because it drops what it cannot use: unknown
 * kinds become generic, an asset without a position disappears, ids are reassigned. Running
 * it on a stored site would quietly rewrite an operator's saved configuration just by
 * opening it. Backfilling adds; it never removes.
 */
export function hydrateSite(site: Site): Site {
  site.areas = site.areas ?? [];
  site.assets = site.assets ?? [];
  // Added after the first release: a site stored before them has none of these.
  site.layers = site.layers ?? [];
  site.routes = site.routes ?? [];
  site.connections = site.connections ?? [];
  site.basemap = site.basemap ?? defaultBasemap();
  site.center = site.center ?? { lat: 0, lon: 0 };
  site.zoom = site.zoom ?? DEFAULT_ZOOM;
  site.groupZoom = site.groupZoom ?? AUTO_GROUP_ZOOM;
  for (const asset of site.assets) {
    asset.readings = asset.readings ?? [];
    // Migration: an asset used to belong to exactly ONE area, stored as `areaId`. A
    // datapoint written by that version must keep its membership, so the old scalar is
    // folded into the list and the empty string means "no area".
    asset.areaIds = asset.areaIds ?? legacyAreaIds(asset);
    asset.layerIds = asset.layerIds ?? [];
  }
  for (const area of site.areas) {
    area.ring = area.ring ?? [];
    area.groupZoom = area.groupZoom ?? AUTO_GROUP_ZOOM;
  }
  for (const connection of site.connections) {
    connection.via = connection.via ?? [];
    connection.areaIds = connection.areaIds ?? [];
    connection.layerIds = connection.layerIds ?? [];
    connection.readings = connection.readings ?? [];
  }
  return site;
}
