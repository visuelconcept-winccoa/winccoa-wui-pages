// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The page must be fully usable WITHOUT a WinCC OA backend: every store
 * transparently falls back to the in-memory demo dataset and flips `offline`.
 * These tests run in exactly that situation (no PARA REST, no OaRxJsApi
 * registered), so they exercise the real production fallback path.
 */
import { describe, expect, it } from 'vitest';
import { DpJsonStore } from '@visuelconcept/wui-kit/data/dp-json-store.js';
import { demoZones } from '../model.js';
import type { Warehouse, Zone } from '../types.js';
import { loadConfig, seedConfigIfEmpty } from './stores.js';

const freshZoneStore = (): DpJsonStore<Zone> => new DpJsonStore<Zone>('WMS_Zone', 'WMS_Zone_', (z) => z.name, demoZones);

describe('DpJsonStore without a backend (offline fallback)', () => {
  it('lists the demo dataset and reports offline', async () => {
    const store = freshZoneStore();
    const zones = await store.list();
    expect(store.offline).toBe(true);
    expect(zones.map((z) => z.id)).toEqual(['z-a', 'z-b', 'z-c', 'z-d', 'z-e', 'z-f']);
  });

  it('returns a fresh array on every list() so Lit change detection works', async () => {
    const store = freshZoneStore();
    const first = await store.list();
    await store.create({ id: '', warehouseId: 'wh-nord', name: 'X', code: 'X', description: '', color: '#000000', x: 0, y: 0, w: 3, h: 3 });
    const second = await store.list();
    expect(second).not.toBe(first);
    expect(second.length).toBe(first.length + 1);
  });

  it('creates in memory with a generated slug id', async () => {
    const store = freshZoneStore();
    await store.list();
    const created = await store.create({ id: '', warehouseId: 'wh-nord', name: 'Zone Tampon', code: 'T', description: '', color: '#123456', x: 1, y: 18, w: 5, h: 4 });
    expect(created.id).toMatch(/^zone-tampon-/);
    expect(created.dp).toBe(`WMS_Zone_${created.id}`);
    const zones = await store.list();
    expect(zones).toHaveLength(7);
    expect(zones.some((z) => z.id === created.id)).toBe(true);
  });

  it('honors an explicit id on create (seed path keeps cross-references)', async () => {
    const store = freshZoneStore();
    await store.list();
    const created = await store.create(
      { id: '', warehouseId: 'wh-nord', name: 'X', code: 'X', description: '', color: '#000000', x: 0, y: 0, w: 1, h: 1 },
      { id: 'z-x' }
    );
    expect(created.id).toBe('z-x');
  });

  it('saves (updates) and removes in memory', async () => {
    const store = freshZoneStore();
    const [first] = await store.list();
    await store.save({ ...first, name: 'Réception 2' });
    const updated = await store.list();
    expect(updated.find((z) => z.id === first.id)?.name).toBe('Réception 2');

    await store.remove(first.id);
    const after = await store.list();
    expect(after).toHaveLength(5);
    expect(after.some((z) => z.id === first.id)).toBe(false);
  });
});

describe('warehouse config stores without a backend', () => {
  it('loadConfig returns the full demo snapshot flagged offline', async () => {
    const config = await loadConfig();
    expect(config.offline).toBe(true);
    expect(config.warehouses).toHaveLength(2);
    expect(config.zones).toHaveLength(6);
    expect(config.locations).toHaveLength(24);
    expect(config.products).toHaveLength(8);
    expect(config.campaigns).toHaveLength(0);
  });

  it('every demo zone belongs to a demo warehouse', async () => {
    const config = await loadConfig();
    const warehouseIds = new Set(config.warehouses.map((w: Warehouse) => w.id));
    for (const zone of config.zones) expect(warehouseIds.has(zone.warehouseId)).toBe(true);
  });

  it('seedConfigIfEmpty never seeds the in-memory fallback (no duplicates)', async () => {
    await seedConfigIfEmpty();
    const config = await loadConfig();
    expect(config.warehouses).toHaveLength(2);
    expect(config.zones).toHaveLength(6);
    expect(config.locations).toHaveLength(24);
    expect(config.products).toHaveLength(8);
  });
});
