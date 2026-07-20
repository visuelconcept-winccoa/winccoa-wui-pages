// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Configuration persistence for the Warehouse page: one JSON-in-DP datapoint per
 * entity via the shared {@link DpJsonStore} (auto-creates its Struct type + DP,
 * falls back to the in-memory demo dataset when the backend is read-only/offline).
 *
 *   WMS_Zone_*      zones            WMS_Product_*   product catalog
 *   WMS_Location_*  locations        WMS_Inventory_* inventory campaigns
 *
 * Stock QUANTITIES are NOT here — they live in the dedicated `WMS_Stock` type
 * (see `stock-store.ts`).
 */
import { DpJsonStore, type DpEntity } from '@visuelconcept/wui-kit/data/dp-json-store.js';
import { demoInventories, demoLocations, demoProducts, demoZones } from '../model.js';
import type { InventoryCampaign, Product, StorageLocation, Zone } from '../types.js';

export const zoneStore = new DpJsonStore<Zone>('WMS_Zone', 'WMS_Zone_', (z) => z.name, demoZones);
export const locationStore = new DpJsonStore<StorageLocation>('WMS_Location', 'WMS_Location_', (l) => l.code, demoLocations);
export const productStore = new DpJsonStore<Product>('WMS_Product', 'WMS_Product_', (p) => p.ref, demoProducts, {
  slugSource: (p) => p.ref
});
export const inventoryStore = new DpJsonStore<InventoryCampaign>('WMS_Inventory', 'WMS_Inventory_', (c) => c.name, demoInventories);

/** Snapshot of everything the page needs, plus whether we are on demo data. */
export interface WarehouseConfig {
  zones: Zone[];
  locations: StorageLocation[];
  products: Product[];
  campaigns: InventoryCampaign[];
  offline: boolean;
}

/** Persist demo entities keeping their explicit ids (preserves cross-references). */
async function seedWithIds<T extends DpEntity>(store: DpJsonStore<T>, items: T[]): Promise<void> {
  for (const item of items) await store.create(item, { id: item.id });
}

/**
 * Seed the config stores with the demo dataset on first run — only when the
 * backend is writable AND the store is empty. Never seeds the in-memory fallback
 * (which is already the demo data). Best-effort: a failure just leaves the store
 * empty and the UI usable.
 */
export async function seedConfigIfEmpty(): Promise<void> {
  try {
    const [zones, locations, products] = await Promise.all([zoneStore.list(), locationStore.list(), productStore.list()]);
    if (zoneStore.offline || locationStore.offline || productStore.offline) return;
    if (zones.length === 0) await seedWithIds(zoneStore, demoZones());
    if (locations.length === 0) await seedWithIds(locationStore, demoLocations());
    if (products.length === 0) await seedWithIds(productStore, demoProducts());
  } catch {
    // best-effort — the offline fallback still renders demo data
  }
}

/** Load zones, locations, products and campaigns in one shot. */
export async function loadConfig(): Promise<WarehouseConfig> {
  const [zones, locations, products, campaigns] = await Promise.all([
    zoneStore.list(),
    locationStore.list(),
    productStore.list(),
    inventoryStore.list()
  ]);
  const offline = zoneStore.offline || locationStore.offline || productStore.offline || inventoryStore.offline;
  return { zones, locations, products, campaigns, offline };
}
