// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure domain helpers (derivations, colours, ids) and the demo dataset used both
 * as the offline in-memory fallback and as the first-run seed. All demo entities
 * carry STABLE explicit ids so their cross-references (zone→warehouse,
 * location→zone, stock→product/location) survive being persisted with
 * `create(item, {id})`.
 *
 * The demo quantities are deliberately COHERENT with the location capacities
 * (rack 1000 · shelf 400 · cold 250 · bin 200 · floor uncapped) so the plan
 * shows the full colour range instead of saturating red.
 */
import type { InventoryLine, LocationType, Product, StockCell, StockStatus, StorageLocation, Warehouse, Zone } from './types.js';

/** Warehouse every legacy (pre-multi-warehouse) entity is backfilled into. */
export const DEFAULT_WAREHOUSE_ID = 'wh-nord';

/** WinCC-OA-safe id fragment (DP names allow letters, digits, underscore). */
export function sanitizeDpId(raw: string): string {
  return raw.replaceAll(/[^A-Za-z0-9_]/g, '_');
}

/** Deterministic stock id for a product at a location. */
export function stockId(locationId: string, productId: string): string {
  return sanitizeDpId(`${locationId}__${productId}`);
}

/** Total units stored at one location. */
export function locationUnits(stock: StockCell[], locationId: string): number {
  return stock.filter((c) => c.locationId === locationId).reduce((sum, c) => sum + c.quantity, 0);
}

/** Total units of one product across the whole warehouse. */
export function productUnits(stock: StockCell[], productId: string): number {
  return stock.filter((c) => c.productId === productId).reduce((sum, c) => sum + c.quantity, 0);
}

/** Fill ratio 0..1 of a location (presence-based when uncapped). */
export function occupancy(units: number, capacity: number): number {
  if (capacity > 0) return Math.min(1, units / capacity);
  return units > 0 ? 1 : 0;
}

/**
 * UNCAPPED fill percent of a location — may exceed 100 (over-capacity must stay
 * visible, not silently clamp). `null` when the location has no capacity.
 */
export function occupancyPercent(units: number, capacity: number): number | null {
  if (capacity <= 0) return null;
  return Math.round((units / capacity) * 100);
}

const COLOR_EMPTY = '#64748b';
const COLOR_OK = '#10b981';
const COLOR_HIGH = '#f59e0b';
const COLOR_FULL = '#ef4444';
/** Occupied location without a capacity (floor storage) — informative, not an alarm. */
const COLOR_UNCAPPED = '#3b82f6';

/** Plan fill colour from a fill ratio (grey when empty). */
export function occupancyColor(ratio: number, hasStock: boolean): string {
  if (!hasStock) return COLOR_EMPTY;
  if (ratio < 0.7) return COLOR_OK;
  if (ratio < 0.9) return COLOR_HIGH;
  return COLOR_FULL;
}

/**
 * Fill colour of a location on the plan/3D view. Uncapped locations never show
 * the red "full" alarm — any stock on them is neutral information (blue).
 */
export function locationFillColor(units: number, capacity: number): string {
  if (units <= 0) return COLOR_EMPTY;
  if (capacity <= 0) return COLOR_UNCAPPED;
  return occupancyColor(units / capacity, true);
}

/** Stock status of a quantity vs the product's min/max thresholds. */
export function stockStatus(quantity: number, product: Product | undefined): StockStatus {
  if (quantity <= 0) return 'empty';
  if (product && quantity < product.minQty) return 'under';
  if (product && product.maxQty > 0 && quantity > product.maxQty) return 'over';
  return 'ok';
}

/** Inventory variance: counted − system (0 while not yet counted). */
export function variance(line: InventoryLine): number {
  return line.countedQty == null ? 0 : line.countedQty - line.systemQty;
}

// --- demo dataset ------------------------------------------------------------

interface ZoneSeed {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function demoWarehouses(): Warehouse[] {
  return [
    { id: 'wh-nord', name: 'Entrepôt Nord', code: 'N', description: 'Site principal', color: '#3b82f6' },
    { id: 'wh-sud', name: 'Entrepôt Sud', code: 'S', description: 'Picking & retours', color: '#f97316' }
  ];
}

const ZONE_SEEDS: ZoneSeed[] = [
  { id: 'z-a', warehouseId: 'wh-nord', code: 'A', name: 'Réception', color: '#3b82f6', x: 1, y: 1, w: 13, h: 8 },
  { id: 'z-b', warehouseId: 'wh-nord', code: 'B', name: 'Stockage principal', color: '#8b5cf6', x: 15, y: 1, w: 14, h: 8 },
  { id: 'z-c', warehouseId: 'wh-nord', code: 'C', name: 'Zone froide', color: '#06b6d4', x: 1, y: 10, w: 13, h: 7 },
  { id: 'z-d', warehouseId: 'wh-nord', code: 'D', name: 'Expédition', color: '#f97316', x: 15, y: 10, w: 14, h: 7 },
  { id: 'z-e', warehouseId: 'wh-sud', code: 'E', name: 'Picking', color: '#22c55e', x: 1, y: 1, w: 13, h: 8 },
  { id: 'z-f', warehouseId: 'wh-sud', code: 'F', name: 'Retours', color: '#eab308', x: 15, y: 1, w: 14, h: 8 }
];

const TYPE_BY_ZONE: Record<string, LocationType> = { 'z-c': 'cold', 'z-d': 'floor', 'z-e': 'shelf', 'z-f': 'bin' };

/** Realistic per-type capacities (0 = uncapped floor storage). */
export const CAPACITY_BY_TYPE: Record<LocationType, number> = { rack: 1000, shelf: 400, bin: 200, floor: 0, cold: 250 };

/** Top band of a zone rectangle reserved for its label (grid units). */
export const ZONE_LABEL_BAND = 1.4;

/** Four locations laid out as a 2×2 grid inside a zone rectangle, below the label band. */
function zoneLocations(zone: ZoneSeed): StorageLocation[] {
  const type: LocationType = TYPE_BY_ZONE[zone.id] ?? 'rack';
  const cellW = (zone.w - 1.5) / 2;
  const cellH = (zone.h - ZONE_LABEL_BAND - 1) / 2;
  const spots = [
    { x: 0.5, y: ZONE_LABEL_BAND },
    { x: 1 + cellW, y: ZONE_LABEL_BAND },
    { x: 0.5, y: ZONE_LABEL_BAND + 0.5 + cellH },
    { x: 1 + cellW, y: ZONE_LABEL_BAND + 0.5 + cellH }
  ];
  return spots.map((spot, index) => ({
    id: `${zone.id}-${index + 1}`,
    zoneId: zone.id,
    code: `${zone.code}-${String(index + 1).padStart(2, '0')}`,
    label: `${zone.name} ${index + 1}`,
    type,
    capacity: CAPACITY_BY_TYPE[type],
    x: Number(spot.x.toFixed(2)),
    y: Number(spot.y.toFixed(2)),
    w: Number(cellW.toFixed(2)),
    h: Number(cellH.toFixed(2))
  }));
}

export function demoZones(): Zone[] {
  return ZONE_SEEDS.map((z) => ({
    id: z.id,
    warehouseId: z.warehouseId,
    name: z.name,
    code: z.code,
    description: '',
    color: z.color,
    x: z.x,
    y: z.y,
    w: z.w,
    h: z.h
  }));
}

export function demoLocations(): StorageLocation[] {
  return ZONE_SEEDS.flatMap((z) => zoneLocations(z));
}

export function demoProducts(): Product[] {
  return [
    { id: 'p-1001', ref: '1001', name: 'Boulon M8 inox', category: 'Visserie', unit: 'pcs', minQty: 200, maxQty: 2000 },
    { id: 'p-1002', ref: '1002', name: 'Écrou M8 inox', category: 'Visserie', unit: 'pcs', minQty: 200, maxQty: 2000 },
    { id: 'p-1003', ref: '1003', name: 'Roulement 6204', category: 'Mécanique', unit: 'pcs', minQty: 20, maxQty: 300 },
    { id: 'p-1004', ref: '1004', name: 'Courroie A-38', category: 'Mécanique', unit: 'pcs', minQty: 10, maxQty: 120 },
    { id: 'p-2001', ref: '2001', name: 'Huile hydraulique 20L', category: 'Consommable', unit: 'bidon', minQty: 8, maxQty: 60 },
    { id: 'p-2002', ref: '2002', name: 'Graisse EP2 (cart.)', category: 'Consommable', unit: 'pcs', minQty: 12, maxQty: 100 },
    { id: 'p-3001', ref: '3001', name: 'Vaccin lot A (2-8°C)', category: 'Pharma', unit: 'boîte', minQty: 30, maxQty: 200 },
    { id: 'p-3002', ref: '3002', name: 'Réactif lot B (2-8°C)', category: 'Pharma', unit: 'boîte', minQty: 15, maxQty: 150 }
  ];
}

/** Empty by default — campaigns are created by operators. */
export function demoInventories(): [] {
  return [];
}

interface StockSeed {
  location: string;
  product: string;
  quantity: number;
}

/**
 * Quantities chosen against the location capacities to exercise every colour:
 * green (<70%), amber (70–90%), red (≥90%), blue (uncapped floor), grey (empty)
 * — plus the under-min / over-max product statuses used by the tables.
 */
const STOCK_SEEDS: StockSeed[] = [
  // Entrepôt Nord — racks (cap 1000)
  { location: 'z-a-1', product: 'p-1001', quantity: 600 },
  { location: 'z-a-1', product: 'p-1002', quantity: 120 }, // under min · cell total 720 → amber
  { location: 'z-a-2', product: 'p-1003', quantity: 180 },
  { location: 'z-a-3', product: 'p-1004', quantity: 45 },
  { location: 'z-b-1', product: 'p-1001', quantity: 900 }, // 90% → red
  { location: 'z-b-2', product: 'p-1003', quantity: 260 },
  { location: 'z-b-3', product: 'p-2001', quantity: 52 },
  { location: 'z-b-4', product: 'p-2002', quantity: 8 }, // under min
  // Zone froide (cap 250)
  { location: 'z-c-1', product: 'p-3001', quantity: 140 },
  { location: 'z-c-2', product: 'p-3002', quantity: 12 }, // under min
  { location: 'z-c-3', product: 'p-3001', quantity: 220 }, // over max (200) · 88% → amber
  // Expédition (floor, uncapped → blue)
  { location: 'z-d-1', product: 'p-2001', quantity: 20 },
  // Entrepôt Sud — picking shelves (cap 400) & retours bins (cap 200)
  { location: 'z-e-1', product: 'p-1001', quantity: 350 }, // 87% → amber
  { location: 'z-e-2', product: 'p-1004', quantity: 100 },
  { location: 'z-f-1', product: 'p-2002', quantity: 30 },
  { location: 'z-f-2', product: 'p-1002', quantity: 190 } // 95% → red · under min
];

export function demoStock(): StockCell[] {
  return STOCK_SEEDS.map((s) => ({
    dp: `WMS_Stock_${stockId(s.location, s.product)}`,
    id: stockId(s.location, s.product),
    productId: s.product,
    locationId: s.location,
    quantity: s.quantity
  }));
}
