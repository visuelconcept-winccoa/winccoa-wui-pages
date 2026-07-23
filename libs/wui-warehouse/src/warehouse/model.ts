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

/** Demo warehouse ids (kept as constants so seeds reference them once). */
const WH_NORD = 'wh-nord';
const WH_SUD = 'wh-sud';
const WH_EST = 'wh-est';
const WH_OUEST = 'wh-ouest';
const WH_ATELIER = 'wh-atelier';

/** Warehouse every legacy (pre-multi-warehouse) entity is backfilled into. */
export const DEFAULT_WAREHOUSE_ID = WH_NORD;

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

/** Default 3D structure height per location type (world units). Not used by the 2D plan. */
export const HEIGHT_BY_TYPE: Record<LocationType, number> = { rack: 3.2, shelf: 2.4, bin: 1.6, floor: 0.3, cold: 2.6 };

/** Default 3D structure colour per type (hex), used when a location sets none. */
export const DEFAULT_COLOR_BY_TYPE: Record<LocationType, string> = {
  rack: '#465470',
  shelf: '#8a94a8',
  bin: '#5a6478',
  floor: '#64748b',
  cold: '#9fd8e8'
};

/** Effective 3D height of a location — its override, else the per-type default. */
export function locationHeight(loc: Pick<StorageLocation, 'type' | 'height'>): number {
  return loc.height && loc.height > 0 ? loc.height : HEIGHT_BY_TYPE[loc.type];
}

/** Effective 3D structure colour of a location — its override, else the per-type default. */
export function locationColor(loc: Pick<StorageLocation, 'type' | 'color'>): string {
  return loc.color && loc.color.trim() !== '' ? loc.color : DEFAULT_COLOR_BY_TYPE[loc.type];
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
  /** Optional per-location structure colour override for this zone's racks (3D). */
  locColor?: string;
  /** Optional per-location structure height override for this zone's racks (3D). */
  locHeight?: number;
}

/**
 * Several demonstration sites, each a different configuration:
 *  - Nord   : classic mixed site (racks, cold, floor);
 *  - Sud    : picking shelves + return bins;
 *  - Est    : high-bay pallet racks (tall, coloured — shows the 3D height/colour);
 *  - Ouest  : cold chain (multiple cold rooms + refrigerated dock);
 *  - Atelier: compact maintenance store mixing shelf, bins and a rack.
 */
export function demoWarehouses(): Warehouse[] {
  return [
    { id: WH_NORD, name: 'Entrepôt Nord', code: 'N', description: 'Site principal', color: '#3b82f6' },
    { id: WH_SUD, name: 'Entrepôt Sud', code: 'S', description: 'Picking & retours', color: '#f97316' },
    { id: WH_EST, name: 'Entrepôt Est', code: 'E', description: 'Palettiers grande hauteur', color: '#a855f7' },
    { id: WH_OUEST, name: 'Entrepôt Ouest', code: 'O', description: 'Chaîne du froid', color: '#06b6d4' },
    { id: WH_ATELIER, name: 'Atelier maintenance', code: 'AT', description: 'Petit stock outillage & pièces', color: '#f59e0b' }
  ];
}

const ZONE_SEEDS: ZoneSeed[] = [
  { id: 'z-a', warehouseId: WH_NORD, code: 'A', name: 'Réception', color: '#3b82f6', x: 1, y: 1, w: 13, h: 8 },
  { id: 'z-b', warehouseId: WH_NORD, code: 'B', name: 'Stockage principal', color: '#8b5cf6', x: 15, y: 1, w: 14, h: 8 },
  { id: 'z-c', warehouseId: WH_NORD, code: 'C', name: 'Zone froide', color: '#06b6d4', x: 1, y: 10, w: 13, h: 7 },
  { id: 'z-d', warehouseId: WH_NORD, code: 'D', name: 'Expédition', color: '#f97316', x: 15, y: 10, w: 14, h: 7 },
  { id: 'z-e', warehouseId: WH_SUD, code: 'E', name: 'Picking', color: '#22c55e', x: 1, y: 1, w: 13, h: 8 },
  { id: 'z-f', warehouseId: WH_SUD, code: 'F', name: 'Retours', color: '#eab308', x: 15, y: 1, w: 14, h: 8 },
  // Est — high-bay: tall, coloured pallet racks + a shipping floor.
  { id: 'z-g', warehouseId: WH_EST, code: 'G', name: 'Palettier 1', color: '#a855f7', x: 1, y: 1, w: 14, h: 9, locColor: '#7c3aed', locHeight: 5 },
  { id: 'z-h', warehouseId: WH_EST, code: 'H', name: 'Palettier 2', color: '#8b5cf6', x: 16, y: 1, w: 14, h: 9, locColor: '#6d28d9', locHeight: 6 },
  { id: 'z-i', warehouseId: WH_EST, code: 'I', name: 'Préparation', color: '#f97316', x: 1, y: 11, w: 29, h: 6 },
  // Ouest — cold chain: two cold rooms + a refrigerated dock.
  { id: 'z-j', warehouseId: WH_OUEST, code: 'J', name: 'Chambre +4 °C', color: '#22d3ee', x: 1, y: 1, w: 13, h: 9, locColor: '#67e8f9', locHeight: 3 },
  { id: 'z-k', warehouseId: WH_OUEST, code: 'K', name: 'Chambre −18 °C', color: '#38bdf8', x: 15, y: 1, w: 13, h: 9, locColor: '#7dd3fc', locHeight: 3.4 },
  { id: 'z-l', warehouseId: WH_OUEST, code: 'L', name: 'Quai réfrigéré', color: '#0ea5e9', x: 1, y: 11, w: 27, h: 6 },
  // Atelier — compact mixed store.
  { id: 'z-m', warehouseId: WH_ATELIER, code: 'M', name: 'Établi pièces', color: '#f59e0b', x: 1, y: 1, w: 10, h: 7, locColor: '#fbbf24', locHeight: 2.6 },
  { id: 'z-n', warehouseId: WH_ATELIER, code: 'N', name: 'Bacs visserie', color: '#eab308', x: 12, y: 1, w: 9, h: 7, locColor: '#facc15', locHeight: 1.8 },
  { id: 'z-o', warehouseId: WH_ATELIER, code: 'O', name: 'Rack outillage', color: '#f97316', x: 1, y: 9, w: 20, h: 6, locColor: '#fb923c', locHeight: 3.6 }
];

const TYPE_BY_ZONE: Record<string, LocationType> = {
  'z-c': 'cold',
  'z-d': 'floor',
  'z-e': 'shelf',
  'z-f': 'bin',
  // Est
  'z-i': 'floor',
  // Ouest
  'z-j': 'cold',
  'z-k': 'cold',
  'z-l': 'floor',
  // Atelier
  'z-m': 'shelf',
  'z-n': 'bin'
  // z-g, z-h, z-o default to 'rack'
};

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
  return spots.map((spot, index) => {
    const location: StorageLocation = {
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
    };
    if (zone.locColor) location.color = zone.locColor;
    if (zone.locHeight) location.height = zone.locHeight;
    return location;
  });
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
  { location: 'z-f-2', product: 'p-1002', quantity: 190 }, // 95% → red · under min
  // Entrepôt Est — high-bay pallet racks (cap 1000) + shipping floor
  { location: 'z-g-1', product: 'p-1001', quantity: 720 }, // amber
  { location: 'z-g-2', product: 'p-1003', quantity: 240 },
  { location: 'z-g-3', product: 'p-1004', quantity: 60 },
  { location: 'z-h-1', product: 'p-1001', quantity: 940 }, // 94% → red
  { location: 'z-h-2', product: 'p-2001', quantity: 55 },
  { location: 'z-h-4', product: 'p-2002', quantity: 15 },
  { location: 'z-i-1', product: 'p-2001', quantity: 25 }, // floor, uncapped → blue
  // Entrepôt Ouest — cold rooms (cap 250) + refrigerated dock
  { location: 'z-j-1', product: 'p-3002', quantity: 120 },
  { location: 'z-j-3', product: 'p-2002', quantity: 40 },
  { location: 'z-k-1', product: 'p-3002', quantity: 235 }, // 94% → red · over max (150)
  { location: 'z-k-2', product: 'p-2002', quantity: 90 },
  { location: 'z-l-1', product: 'p-2001', quantity: 40 }, // floor, uncapped → blue
  // Atelier — shelf (cap 400), bins (cap 200), rack (cap 1000)
  { location: 'z-m-1', product: 'p-1002', quantity: 300 }, // 75% → amber
  { location: 'z-m-2', product: 'p-1004', quantity: 90 },
  { location: 'z-n-1', product: 'p-1001', quantity: 180 }, // 90% → red
  { location: 'z-n-2', product: 'p-1002', quantity: 60 },
  { location: 'z-o-1', product: 'p-1003', quantity: 200 },
  { location: 'z-o-2', product: 'p-2002', quantity: 35 }
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
