// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persistence layer for managed assets — one WinCC OA datapoint per asset
 * (type `AssetLifecycle_Asset`, a Struct with String elements `name` + `json`).
 *
 * Thin adapter over the shared {@link DpJsonStore}; it only wires the
 * type/prefix and keeps the page-specific method names. The `afterRead` hook
 * migrates legacy phase codes (PM100/PM200) via {@link normalizePhase}.
 */
import { DpJsonStore } from '@visuelconcept/wui-kit/data/dp-json-store.js';
import { DEMO_ASSETS, DEMO_SETS, type DemoDomain } from './demo-assets.js';
import { normalizePhase, type Asset } from '../types.js';

export class AssetStore extends DpJsonStore<Asset> {
  constructor() {
    super(
      'AssetLifecycle_Asset',
      'AssetLifecycle_',
      (asset) => asset.name,
      () => DEMO_ASSETS.map((a) => structuredClone(a)),
      {
        slugFallback: 'asset',
        slugSource: (a) => a.name || a.station,
        afterRead: (a) => {
          a.phase = normalizePhase(a.phase); // migrate legacy PM100/PM200
          return a;
        },
        audit: { dpName: 'AuditTrail_AssetLifecycle', itemType: 'Asset' }
      }
    );
  }

  listAssets(): Promise<Asset[]> {
    return this.list();
  }

  createAsset(asset: Asset): Promise<Asset> {
    return this.create(asset);
  }

  saveAsset(asset: Asset): Promise<void> {
    return this.save(asset);
  }

  deleteAsset(id: string): Promise<void> {
    return this.remove(id);
  }

  /** Seed the backend with a demo fleet for the chosen domain (no-op for ones already present). */
  importDemo(domain: DemoDomain = 'semicon'): Promise<Asset[]> {
    return this.importMany(DEMO_SETS[domain]);
  }

  /** Delete every managed asset. Returns the number removed. */
  async deleteAll(): Promise<number> {
    const all = await this.list();
    for (const asset of all) await this.remove(asset.id);
    return all.length;
  }
}
