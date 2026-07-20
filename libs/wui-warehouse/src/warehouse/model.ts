// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure domain helpers (derivations, colours, ids) and the demo dataset used both
 * as the offline in-memory fallback and as the first-run seed. All demo entities
 * carry STABLE explicit ids so their cross-references (location→zone,
 * stock→product/location) survive being persisted with `create(item, {id})`.
 */
import type { InventoryLine, Product, StockCell, StockStatus, StorageLocation, Zone } from './types.js';

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

/** Plan fill colour from a fill ratio (grey when empty). */
export function occupancyColor(ratio: number, hasStock: boolean): string {
  if (!hasStock) return '#64748b';
  if (ratio < 0.7) return '#10b981';
  if (ratio < 0.9) return '#f59e0b';
  return '#ef4444';
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
  code: string;
  name: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const ZONE_SEEDS: ZoneSeed[] = [
  { id: 'z-a', code: 'A', name: 'Réception', color: '#3b82f6', x: 1, y: 1, w: 13, h: 8 },
  { id: 'z-b', code: 'B', name: 'Stockage principal', color: '#8b5cf6', x: 15, y: 1, w: 14, h: 8 },
  { id: 'z-c', code: 'C', name: 'Zone froide', color: '#06b6d4', x: 1, y: 10, w: 13, h: 7 },
  { id: 'z-d', code: 'D', name: 'Expédition', color: '#f97316', x: 15, y: 10, w: 14, h: 7 }
];

const TYPE_BY_ZONE: Record<string, StorageLocation['type']> = { 'z-c': 'cold', 'z-d': 'floor' };

/** Four locations laid out as a 2×2 grid inside a zone rectangle. */
function zoneLocations(zone: ZoneSeed): StorageLocation[] {
  const type: StorageLocation['type'] = TYPE_BY_ZONE[zone.id] ?? 'rack';
  const cellW = (zone.w - 1.5) / 2;
  const cellH = (zone.h - 1.5) / 2;
  const spots = [
    { x: 0.5, y: 0.5 },
    { x: 1 + cellW, y: 0.5 },
    { x: 0.5, y: 1 + cellH },
    { x: 1 + cellW, y: 1 + cellH }
  ];
  return spots.map((spot, i) => ({
    id: `${zone.id}-${i + 1}`,
    zoneId: zone.id,
    code: `${zone.code}-${String(i + 1).padStart(2, '0')}`,
    label: `${zone.name} ${i + 1}`,
    type,
    capacity: type === 'floor' ? 0 : 100,
    x: Number(spot.x.toFixed(2)),
    y: Number(spot.y.toFixed(2)),
    w: Number(cellW.toFixed(2)),
    h: Number(cellH.toFixed(2))
  }));
}

export function demoZones(): Zone[] {
  return ZONE_SEEDS.map((z) => ({
    id: z.id,
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

const STOCK_SEEDS: StockSeed[] = [
  { location: 'z-a-1', product: 'p-1001', quantity: 1500 },
  { location: 'z-a-1', product: 'p-1002', quantity: 120 }, // under min
  { location: 'z-a-2', product: 'p-1003', quantity: 180 },
  { location: 'z-a-3', product: 'p-1004', quantity: 45 },
  { location: 'z-b-1', product: 'p-1001', quantity: 900 },
  { location: 'z-b-2', product: 'p-1003', quantity: 260 },
  { location: 'z-b-3', product: 'p-2001', quantity: 52 },
  { location: 'z-b-4', product: 'p-2002', quantity: 8 }, // under min
  { location: 'z-c-1', product: 'p-3001', quantity: 140 },
  { location: 'z-c-2', product: 'p-3002', quantity: 12 }, // under min
  { location: 'z-c-3', product: 'p-3001', quantity: 220 }, // over max
  { location: 'z-d-1', product: 'p-2001', quantity: 20 }
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
