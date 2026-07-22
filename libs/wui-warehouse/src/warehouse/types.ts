// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domain model for the Warehouse Management System page.
 *
 * Persistence granularity (validated design — see the module README):
 *  - {@link Zone}, {@link StorageLocation}, {@link Product} and
 *    {@link InventoryCampaign} are configuration/records — one JSON-in-DP
 *    datapoint per entity via `DpJsonStore` (`WMS_Zone` / `WMS_Location` /
 *    `WMS_Product` / `WMS_Inventory` types).
 *  - {@link StockCell} quantities live in a DEDICATED `WMS_Stock` datapoint
 *    type (one DP per product×location) so a quantity is a real DPE — archivable,
 *    trendable and alarmable on its min/max — not an opaque JSON blob.
 */
import type { DpEntity } from '@visuelconcept/wui-kit/data/dp-json-store.js';

export type LocationType = 'rack' | 'shelf' | 'bin' | 'floor' | 'cold';

/** A warehouse (site) — the top-level container; zones belong to exactly one. */
export interface Warehouse extends DpEntity {
  id: string;
  dp?: string;
  name: string;
  code: string;
  description: string;
  /** Accent colour (hex) used on the overview card. */
  color: string;
}

/** A storage zone — a rectangle on the 2D plan holding locations. */
export interface Zone extends DpEntity {
  id: string;
  dp?: string;
  /** Owning warehouse (backfilled to the default warehouse on legacy data). */
  warehouseId: string;
  name: string;
  code: string;
  description: string;
  /** Accent colour (hex) used on the plan and in tables. */
  color: string;
  /** Layout rectangle on the 2D plan, in grid units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A storage location (rack / shelf / bin …) inside a zone. */
export interface StorageLocation extends DpEntity {
  id: string;
  dp?: string;
  zoneId: string;
  code: string;
  label: string;
  type: LocationType;
  /** Max units the location holds (0 = uncapped). */
  capacity: number;
  /** Layout rectangle RELATIVE to the parent zone, in grid units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A product (SKU) in the catalog. */
export interface Product extends DpEntity {
  id: string;
  dp?: string;
  ref: string;
  name: string;
  category: string;
  unit: string;
  /** Reorder threshold — below it the stock is flagged "under". */
  minQty: number;
  /** Overstock threshold (0 = none) — above it the stock is flagged "over". */
  maxQty: number;
}

/** One quantity of one product at one location, backed by a `WMS_Stock` DP. */
export interface StockCell {
  /** Backing `WMS_Stock` datapoint name. */
  dp: string;
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
}

export type InventoryStatus = 'counting' | 'validated';

/** One count line of an inventory campaign. */
export interface InventoryLine {
  locationId: string;
  productId: string;
  /** Stock at the moment the campaign was opened (the "book" quantity). */
  systemQty: number;
  /** Operator-entered physical count (null = not counted yet). */
  countedQty: number | null;
}

/** A stock-count campaign over a zone (or a whole warehouse). */
export interface InventoryCampaign extends DpEntity {
  id: string;
  dp?: string;
  /** Owning warehouse (backfilled to the default warehouse on legacy data). */
  warehouseId: string;
  name: string;
  status: InventoryStatus;
  createdAt: string;
  validatedAt?: string;
  /** Target zone id; empty string = whole warehouse. */
  zoneId: string;
  lines: InventoryLine[];
}

/** Derived status of a stock quantity vs the product thresholds. */
export type StockStatus = 'ok' | 'under' | 'over' | 'empty';
