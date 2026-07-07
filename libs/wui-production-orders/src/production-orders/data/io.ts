// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Import / export helpers for the production-order list.
 *
 * - JSON export/import round-trips the full {@link ProductionOrder} list (the
 *   canonical format — re-importing an export merges by `id`/`orderNo`).
 * - CSV export is a flat, spreadsheet-friendly dump (labels resolved, UTF-8 BOM
 *   so Excel renders accents). CSV is export-only.
 */
import {
  blankOrder,
  type ProductionOrder
} from '../types.js';
import { MSG, localize, priorityLabel, statusLabel } from '../i18n.js';
import { CSV_BOM, JSON_INDENT, csvCell, download, timestampSlug } from '@visuelconcept/wui-kit/data/io.js';

const CSV_COLUMNS: { key: keyof ProductionOrder | 'statusLabel' | 'priorityLabel'; label: () => string }[] = [
  { key: 'orderNo', label: () => localize(MSG.csv.orderNo) },
  { key: 'product', label: () => localize(MSG.csv.product) },
  { key: 'article', label: () => localize(MSG.csv.article) },
  { key: 'qtyOrdered', label: () => localize(MSG.csv.qtyOrdered) },
  { key: 'qtyProduced', label: () => localize(MSG.csv.qtyProduced) },
  { key: 'atelierName', label: () => localize(MSG.csv.atelier) },
  { key: 'machineName', label: () => localize(MSG.csv.machine) },
  { key: 'plannedStart', label: () => localize(MSG.csv.plannedStart) },
  { key: 'plannedEnd', label: () => localize(MSG.csv.plannedEnd) },
  { key: 'actualStart', label: () => localize(MSG.csv.actualStart) },
  { key: 'actualEnd', label: () => localize(MSG.csv.actualEnd) },
  { key: 'statusLabel', label: () => localize(MSG.csv.status) },
  { key: 'priorityLabel', label: () => localize(MSG.csv.priority) },
  { key: 'progress', label: () => localize(MSG.csv.progress) },
  { key: 'notes', label: () => localize(MSG.csv.notes) }
];

/** Download the full order list as a JSON file. */
export function exportJson(orders: ProductionOrder[]): void {
  const payload = { kind: 'production-orders', version: 1, orders };
  download(
    `production-orders-${timestampSlug()}.json`,
    JSON.stringify(payload, null, JSON_INDENT),
    'application/json'
  );
}

/** Download the order list as a CSV file (labels resolved). */
export function exportCsv(orders: ProductionOrder[]): void {
  const rows = [CSV_COLUMNS.map((c) => c.label()).join(',')];
  for (const order of orders) {
    const enriched: Record<string, unknown> = {
      ...order,
      statusLabel: localize(statusLabel(order.status)),
      priorityLabel: localize(priorityLabel(order.priority))
    };
    rows.push(CSV_COLUMNS.map((c) => csvCell(enriched[c.key])).join(','));
  }
  download(
    `production-orders-${timestampSlug()}.csv`,
    CSV_BOM + rows.join('\r\n'),
    'text/csv;charset=utf-8'
  );
}

/**
 * Parse imported JSON into a normalized order list. Accepts either a bare array
 * or an export envelope (`{ orders: [...] }`). Each field is coerced against
 * {@link blankOrder} defaults so partial/foreign records stay valid. Throws when
 * the payload is not parseable JSON or holds no order array.
 */
export function parseOrders(text: string): ProductionOrder[] {
  const raw: unknown = JSON.parse(text);
  const list = Array.isArray(raw) ? raw : (raw as { orders?: unknown }).orders;
  if (!Array.isArray(list)) {
    throw new TypeError(localize(MSG.io.invalidFormat));
  }
  return list.map((item) => normalize(item as Partial<ProductionOrder>));
}

function normalize(item: Partial<ProductionOrder>): ProductionOrder {
  const base = blankOrder();
  const out: ProductionOrder = { ...base };
  for (const key of Object.keys(base) as (keyof ProductionOrder)[]) {
    if (item[key] !== undefined && item[key] !== null) {
      (out as unknown as Record<string, unknown>)[key] = item[key];
    }
  }
  out.qtyOrdered = Number(out.qtyOrdered) || 0;
  out.qtyProduced = Number(out.qtyProduced) || 0;
  out.progress = Number(out.progress) || 0;
  return out;
}
