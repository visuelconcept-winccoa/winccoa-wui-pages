// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domain model for Production Orders (ordres de fabrication / OF).
 *
 * A production order is a planned manufacturing task: a product/article to make
 * in a given quantity, scheduled on a machine of an atelier (linked to the
 * existing Machine Fleet 3D fleet), with a lifecycle status and a priority.
 *
 * The whole list of orders is persisted as a single WinCC OA datapoint (a JSON
 * array, see {@link OrderStore}) — the orders "come from a list in the
 * datapoints" rather than one DP per order.
 */

/** Lifecycle status of an order. */
export type OrderStatus = 'planned' | 'running' | 'paused' | 'done' | 'cancelled';

/** Scheduling priority. */
export type OrderPriority = 'low' | 'normal' | 'high' | 'urgent';

/** A single production order. */
export interface ProductionOrder {
  /** Stable identifier (slug); unique within the list. */
  id: string;

  // --- identity / product ---
  /** Order number (N° OF), e.g. "OF-2026-0042". */
  orderNo: string;
  /** Product designation, e.g. "Bielle forgée Ø40". */
  product: string;
  /** Article / part reference. */
  article: string;
  /** Ordered quantity. */
  qtyOrdered: number;
  /** Quantity already produced. */
  qtyProduced: number;

  // --- machine / atelier assignment (linked to the Machine Fleet 3D fleet) ---
  /** Target atelier id (= Machine Fleet 3D atelier id), empty if unassigned. */
  atelierId: string;
  /** Cached atelier display name (kept for offline / standalone display). */
  atelierName: string;
  /** Target machine id within the atelier, empty if unassigned. */
  machineId: string;
  /** Cached machine display name. */
  machineName: string;

  // --- schedule (ISO `YYYY-MM-DDTHH:mm` local strings, empty = unset) ---
  plannedStart: string;
  plannedEnd: string;
  actualStart: string;
  actualEnd: string;

  // --- state ---
  status: OrderStatus;
  priority: OrderPriority;
  /** Completion percentage (0–100). */
  progress: number;

  /** Free-text notes. */
  notes: string;
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  planned: 'À venir',
  running: 'En cours',
  paused: 'En pause',
  done: 'Terminé',
  cancelled: 'Annulé'
};

/** Chip / bar colour per status. */
export const STATUS_COLORS: Record<OrderStatus, string> = {
  planned: '#3b82f6',
  running: '#10b981',
  paused: '#f59e0b',
  done: '#94a3b8',
  cancelled: '#ef4444'
};

export const PRIORITY_LABELS: Record<OrderPriority, string> = {
  low: 'Basse',
  normal: 'Normale',
  high: 'Haute',
  urgent: 'Urgente'
};

export const PRIORITY_COLORS: Record<OrderPriority, string> = {
  low: '#94a3b8',
  normal: '#3b82f6',
  high: '#f59e0b',
  urgent: '#ef4444'
};

/** Rank used to sort by priority (higher = more urgent). */
export const PRIORITY_RANK: Record<OrderPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3
};

/** A freshly created order with sensible defaults. */
export function blankOrder(): ProductionOrder {
  return {
    id: '',
    orderNo: '',
    product: '',
    article: '',
    qtyOrdered: 0,
    qtyProduced: 0,
    atelierId: '',
    atelierName: '',
    machineId: '',
    machineName: '',
    plannedStart: '',
    plannedEnd: '',
    actualStart: '',
    actualEnd: '',
    status: 'planned',
    priority: 'normal',
    progress: 0,
    notes: ''
  };
}
