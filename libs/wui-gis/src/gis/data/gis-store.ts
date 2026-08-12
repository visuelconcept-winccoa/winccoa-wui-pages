// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persistence for GIS sites — one WinCC OA datapoint per site (type `GIS_Site`, a
 * Struct with String elements `name` + `json`).
 *
 * Thin adapter over the shared {@link DpJsonStore}; it only wires the type/prefix
 * and keeps the page-specific method names. Reading goes through {@link hydrateSite}, which
 * backfills the fields a record saved by an earlier version may lack, so an old site never
 * reaches the map with an undefined list.
 */
import { DpJsonStore } from '@visuelconcept/wui-kit/data/dp-json-store.js';
import { demoSites } from './demo.js';
import { hydrateSite } from './hydrate.js';
import type { Site } from '../types.js';

export class GisStore extends DpJsonStore<Site> {
  constructor() {
    super(
      'GIS_Site',
      'GIS_',
      (site) => site.name,
      () => demoSites(),
      {
        slugFallback: 'site',
        afterRead: hydrateSite,
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
