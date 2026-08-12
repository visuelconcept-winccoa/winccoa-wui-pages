// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persistence for GIS sites — one WinCC OA datapoint per site (type `GIS_Site`, a
 * Struct with String elements `name` + `json`).
 *
 * Thin adapter over the shared {@link DpJsonStore}; it only wires the type/prefix
 * and keeps the page-specific method names. The `afterRead` hook backfills the
 * fields a record saved by an earlier version may lack, so an old site never
 * reaches the map with an undefined `assets` / `areas` / `basemap`.
 */
import { DpJsonStore } from '@visuelconcept/wui-kit/data/dp-json-store.js';
import { demoSites } from './demo.js';
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

export class GisStore extends DpJsonStore<Site> {
  constructor() {
    super(
      'GIS_Site',
      'GIS_',
      (site) => site.name,
      () => demoSites(),
      {
        slugFallback: 'site',
        afterRead: (site) => {
          site.areas = site.areas ?? [];
          site.assets = site.assets ?? [];
          site.basemap = site.basemap ?? defaultBasemap();
          site.center = site.center ?? { lat: 0, lon: 0 };
          site.zoom = site.zoom ?? DEFAULT_ZOOM;
          for (const asset of site.assets) {
            asset.readings = asset.readings ?? [];
            // Migration: an asset used to belong to exactly ONE area, stored as `areaId`.
            // A datapoint written by that version must keep its membership, so the old
            // scalar is folded into the list and the empty string means "no area".
            asset.areaIds = asset.areaIds ?? legacyAreaIds(asset);
          }
          site.groupZoom = site.groupZoom ?? AUTO_GROUP_ZOOM;
          for (const area of site.areas) {
            area.ring = area.ring ?? [];
            area.groupZoom = area.groupZoom ?? AUTO_GROUP_ZOOM;
          }
          return site;
        },
        audit: {
          dpName: 'AuditTrail_Gis',
          itemType: 'GIS',
          exclude: ['updatedAt']
        }
      }
    );
  }

  listSites(): Promise<Site[]> {
    return this.list();
  }

  createSite(site: Site): Promise<Site> {
    return this.create(site);
  }

  /** Persist a site; see DpJsonStore.save for the per-call audit options. */
  saveSite(
    site: Site,
    opts: { audit?: boolean; auditBaseline?: Site } = {}
  ): Promise<void> {
    return this.save(site, opts);
  }

  deleteSite(id: string): Promise<void> {
    return this.remove(id);
  }

  /** Seed the backend with the supplied demo sites. */
  importDemo(sites: Site[]): Promise<Site[]> {
    return this.importMany(sites);
  }
}
