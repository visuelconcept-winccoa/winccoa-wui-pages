// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure domain helpers + demo-dataset integrity. The demo set doubles as the
 * offline fallback AND the first-run seed, so its cross-references (location →
 * zone, stock → product/location) and its documented under-min / over-max cells
 * must actually hold.
 */
import { describe, expect, it } from 'vitest';
import {
  demoLocations,
  demoProducts,
  demoStock,
  demoWarehouses,
  demoZones,
  locationFillColor,
  locationUnits,
  occupancy,
  occupancyColor,
  occupancyPercent,
  productUnits,
  sanitizeDpId,
  stockId,
  stockStatus,
  variance,
  ZONE_LABEL_BAND
} from './model.js';
import type { InventoryLine } from './types.js';

describe('sanitizeDpId / stockId', () => {
  it('keeps letters, digits and underscores only (DP-name safe)', () => {
    expect(sanitizeDpId('a-b.c d/é#1_Z')).toBe('a_b_c_d___1_Z');
    expect(sanitizeDpId('abc_123')).toBe('abc_123');
  });

  it('builds a deterministic id from location + product', () => {
    expect(stockId('z-a-1', 'p-1001')).toBe('z_a_1__p_1001');
    expect(stockId('z-a-1', 'p-1001')).toBe(stockId('z-a-1', 'p-1001'));
  });
});

describe('locationUnits / productUnits', () => {
  const stock = demoStock();

  it('sums all cells of one location', () => {
    // z-a-1 holds p-1001 (600) + p-1002 (120)
    expect(locationUnits(stock, 'z-a-1')).toBe(720);
    expect(locationUnits(stock, 'nope')).toBe(0);
  });

  it('sums one product across the warehouse', () => {
    // p-3001 is stored at z-c-1 (140) + z-c-3 (220)
    expect(productUnits(stock, 'p-3001')).toBe(360);
    expect(productUnits(stock, 'nope')).toBe(0);
  });
});

describe('occupancy', () => {
  it('is the capped fill ratio when a capacity is set', () => {
    expect(occupancy(50, 100)).toBe(0.5);
    expect(occupancy(150, 100)).toBe(1); // never above 1
    expect(occupancy(0, 100)).toBe(0);
  });

  it('is presence-based (0 or 1) when uncapped', () => {
    expect(occupancy(0, 0)).toBe(0);
    expect(occupancy(3, 0)).toBe(1);
  });
});

describe('occupancyPercent', () => {
  it('is the UNCLAMPED percent for capped locations, null when uncapped', () => {
    expect(occupancyPercent(50, 100)).toBe(50);
    expect(occupancyPercent(1620, 1000)).toBe(162); // over-capacity must stay visible
    expect(occupancyPercent(20, 0)).toBeNull();
  });
});

describe('locationFillColor', () => {
  it('is grey when empty, blue when occupied without capacity (not an alarm)', () => {
    expect(locationFillColor(0, 100)).toBe('#64748b');
    expect(locationFillColor(0, 0)).toBe('#64748b');
    expect(locationFillColor(20, 0)).toBe('#3b82f6');
  });

  it('follows the occupancy scale for capped locations', () => {
    expect(locationFillColor(100, 1000)).toBe('#10b981');
    expect(locationFillColor(750, 1000)).toBe('#f59e0b');
    expect(locationFillColor(950, 1000)).toBe('#ef4444');
  });
});

describe('occupancyColor', () => {
  it('is grey without stock regardless of the ratio', () => {
    expect(occupancyColor(0, false)).toBe('#64748b');
    expect(occupancyColor(1, false)).toBe('#64748b');
  });

  it('steps green → amber → red at 70% and 90%', () => {
    expect(occupancyColor(0.69, true)).toBe('#10b981');
    expect(occupancyColor(0.7, true)).toBe('#f59e0b');
    expect(occupancyColor(0.89, true)).toBe('#f59e0b');
    expect(occupancyColor(0.9, true)).toBe('#ef4444');
  });
});

describe('stockStatus', () => {
  const product = demoProducts().find((p) => p.id === 'p-1003'); // min 20, max 300

  it('flags empty / under / over / ok against the product thresholds', () => {
    expect(stockStatus(0, product)).toBe('empty');
    expect(stockStatus(19, product)).toBe('under');
    expect(stockStatus(20, product)).toBe('ok');
    expect(stockStatus(300, product)).toBe('ok');
    expect(stockStatus(301, product)).toBe('over');
  });

  it('never flags "over" when maxQty is 0 (no overstock threshold)', () => {
    const uncapped = { ...demoProducts()[0], minQty: 0, maxQty: 0 };
    expect(stockStatus(1_000_000, uncapped)).toBe('ok');
  });

  it('is only quantity-based when the product is unknown', () => {
    const unknown = demoProducts().find((p) => p.id === 'nope');
    expect(stockStatus(0, unknown)).toBe('empty');
    expect(stockStatus(5, unknown)).toBe('ok');
  });
});

describe('variance', () => {
  const line = (systemQty: number, countedQty: number | null): InventoryLine => ({
    locationId: 'l',
    productId: 'p',
    systemQty,
    countedQty
  });

  it('is counted − system, and 0 while not yet counted', () => {
    expect(variance(line(10, null))).toBe(0);
    expect(variance(line(10, 10))).toBe(0);
    expect(variance(line(10, 7))).toBe(-3);
    expect(variance(line(10, 12))).toBe(2);
  });
});

describe('demo dataset integrity (offline fallback + first-run seed)', () => {
  const warehouses = demoWarehouses();
  const zones = demoZones();
  const locations = demoLocations();
  const products = demoProducts();
  const stock = demoStock();

  it('has the documented shape: 5 warehouses, 15 zones, 60 locations, 8 products, 34 stock cells', () => {
    expect(warehouses).toHaveLength(5);
    expect(zones).toHaveLength(15);
    expect(locations).toHaveLength(60);
    expect(products).toHaveLength(8);
    expect(stock).toHaveLength(34);
  });

  it('keeps every cross-reference resolvable (ids are stable across calls)', () => {
    const warehouseIds = new Set(warehouses.map((w) => w.id));
    const zoneIds = new Set(zones.map((z) => z.id));
    const locationIds = new Set(locations.map((l) => l.id));
    const productIds = new Set(products.map((p) => p.id));
    for (const z of zones) expect(warehouseIds.has(z.warehouseId), `zone ${z.id} → warehouse ${z.warehouseId}`).toBe(true);
    for (const l of locations) expect(zoneIds.has(l.zoneId), `location ${l.id} → zone ${l.zoneId}`).toBe(true);
    for (const c of stock) {
      expect(locationIds.has(c.locationId), `stock ${c.id} → location ${c.locationId}`).toBe(true);
      expect(productIds.has(c.productId), `stock ${c.id} → product ${c.productId}`).toBe(true);
    }
  });

  it('keeps demo quantities coherent with the location capacities (capped cells never overflow)', () => {
    for (const l of locations) {
      if (l.capacity <= 0) continue;
      const units = locationUnits(stock, l.id);
      expect(units, `location ${l.id}: ${units} > capacity ${l.capacity}`).toBeLessThanOrEqual(l.capacity);
    }
  });

  it('uses DP-safe unique ids everywhere', () => {
    const all = [...warehouses, ...zones, ...locations, ...products].map((e) => e.id);
    expect(new Set(all).size).toBe(all.length);
    for (const c of stock) expect(c.id).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it('seeds the documented under-min and over-max cells (so the UI shows alarms)', () => {
    const byId = new Map(products.map((p) => [p.id, p]));
    const statusOf = (locationId: string, productId: string): string => {
      const cell = stock.find((c) => c.locationId === locationId && c.productId === productId);
      expect(cell, `seed ${locationId}/${productId}`).toBeDefined();
      return stockStatus(cell?.quantity ?? 0, byId.get(productId));
    };
    expect(statusOf('z-a-1', 'p-1002')).toBe('under');
    expect(statusOf('z-b-4', 'p-2002')).toBe('under');
    expect(statusOf('z-c-2', 'p-3002')).toBe('under');
    expect(statusOf('z-c-3', 'p-3001')).toBe('over');
    expect(statusOf('z-a-1', 'p-1001')).toBe('ok');
  });

  it('lays every location inside its zone rectangle, below the label band', () => {
    const byId = new Map(zones.map((z) => [z.id, z]));
    for (const l of locations) {
      const zone = byId.get(l.zoneId);
      expect(zone).toBeDefined();
      if (!zone) continue;
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.y, `location ${l.id} must not cover the zone label band`).toBeGreaterThanOrEqual(ZONE_LABEL_BAND);
      expect(l.x + l.w).toBeLessThanOrEqual(zone.w + 1e-6);
      expect(l.y + l.h).toBeLessThanOrEqual(zone.h + 1e-6);
    }
  });

  it('keeps the zone rectangles disjoint within each warehouse plan', () => {
    for (const a of zones)
      for (const b of zones) {
        if (a.id === b.id || a.warehouseId !== b.warehouseId) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
  });
});
