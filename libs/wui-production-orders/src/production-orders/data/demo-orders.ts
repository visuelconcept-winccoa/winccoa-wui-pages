/**
 * Demo production orders, generated against the *real* fleet so the data lines
 * up with the Machine Fleet 3D ateliers/machines already configured in the
 * project. Each demo order is assigned to an actual atelier+machine and its
 * schedule is laid out relative to "now" (past / running / upcoming) so the
 * table, the status mix and the Gantt all show something meaningful.
 */
import type { Atelier } from '@visuelconcept/wui-fleet-core/types.js';
import type { OrderPriority, OrderStatus, ProductionOrder } from '../types.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Product catalogue drawn on for the demo (designation + article prefix). */
const PRODUCTS: { product: string; article: string }[] = [
  { product: 'Bielle forgée Ø40', article: 'BRT-4001' },
  { product: 'Arbre de transmission', article: 'ARB-2207' },
  { product: 'Bride inox 316L', article: 'BRD-3160' },
  { product: 'Pignon 24 dents', article: 'PGN-0024' },
  { product: 'Carter aluminium', article: 'CRT-7700' },
  { product: 'Vilebrequin V6', article: 'VLB-0600' },
  { product: 'Moyeu roue avant', article: 'MYU-1102' },
  { product: 'Collecteur échappement', article: 'CLT-8890' },
  { product: 'Disque de frein ventilé', article: 'DSQ-3300' },
  { product: 'Support moteur', article: 'SPT-4455' }
];

const STATUS_CYCLE: OrderStatus[] = [
  'done',
  'running',
  'planned',
  'paused',
  'planned',
  'running',
  'done',
  'cancelled',
  'planned',
  'running'
];

const PRIORITY_CYCLE: OrderPriority[] = ['normal', 'high', 'normal', 'urgent', 'low', 'high'];

const PAD_LEN = 2;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

/** Local-datetime string (`YYYY-MM-DDTHH:mm`) for an absolute time. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Slot {
  atelier: Atelier;
  machine: { id: string; name: string };
}

/** Flatten the fleet into assignable (atelier, machine) slots. */
function fleetSlots(ateliers: Atelier[]): Slot[] {
  const slots: Slot[] = [];
  for (const atelier of ateliers) {
    for (const machine of atelier.machines) {
      slots.push({ atelier, machine: { id: machine.id, name: machine.name } });
    }
  }
  return slots;
}

/**
 * Build a set of demo orders mapped onto the supplied fleet. Returns an empty
 * list when the fleet has no machines (nothing to assign orders to).
 */
export function buildDemoOrders(ateliers: Atelier[]): ProductionOrder[] {
  const slots = fleetSlots(ateliers);
  if (slots.length === 0) return [];

  const now = Date.now();
  const count = Math.min(PRODUCTS.length, Math.max(6, slots.length));
  const orders: ProductionOrder[] = [];

  for (let i = 0; i < count; i++) {
    const slot = slots[i % slots.length];
    const prod = PRODUCTS[i % PRODUCTS.length];
    const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
    const priority = PRIORITY_CYCLE[i % PRIORITY_CYCLE.length];

    // Spread schedules: index 0 in the past, growing into the future.
    const offsetDays = i - 3;
    const plannedStartMs = now + offsetDays * DAY_MS + (i % 3) * 2 * HOUR_MS;
    const durationMs = (4 + (i % 4) * 3) * HOUR_MS;
    const plannedEndMs = plannedStartMs + durationMs;

    const qtyOrdered = 50 + (i % 6) * 25;
    const { actualStart, actualEnd, progress, qtyProduced } = realize(
      status,
      plannedStartMs,
      plannedEndMs,
      qtyOrdered
    );

    orders.push({
      id: `of-demo-${String(i + 1).padStart(3, '0')}`,
      orderNo: `OF-2026-${String(1001 + i)}`,
      product: prod.product,
      article: `${prod.article}`,
      qtyOrdered,
      qtyProduced,
      atelierId: slot.atelier.id,
      atelierName: slot.atelier.name,
      machineId: slot.machine.id,
      machineName: slot.machine.name,
      plannedStart: toLocalInput(plannedStartMs),
      plannedEnd: toLocalInput(plannedEndMs),
      actualStart,
      actualEnd,
      status,
      priority,
      progress,
      notes: ''
    });
  }
  return orders;
}

/** Derive actual times / progress / produced qty consistent with the status. */
function realize(
  status: OrderStatus,
  plannedStartMs: number,
  plannedEndMs: number,
  qtyOrdered: number
): { actualStart: string; actualEnd: string; progress: number; qtyProduced: number } {
  switch (status) {
    case 'done': {
      return {
        actualStart: toLocalInput(plannedStartMs),
        actualEnd: toLocalInput(plannedEndMs),
        progress: 100,
        qtyProduced: qtyOrdered
      };
    }
    case 'running': {
      return {
        actualStart: toLocalInput(plannedStartMs),
        actualEnd: '',
        progress: 45,
        qtyProduced: Math.round(qtyOrdered * 0.45)
      };
    }
    case 'paused': {
      return {
        actualStart: toLocalInput(plannedStartMs),
        actualEnd: '',
        progress: 30,
        qtyProduced: Math.round(qtyOrdered * 0.3)
      };
    }
    default: {
      // planned / cancelled — not started.
      return { actualStart: '', actualEnd: '', progress: 0, qtyProduced: 0 };
    }
  }
}
