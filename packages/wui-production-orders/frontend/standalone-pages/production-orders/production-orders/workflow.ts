/**
 * Status workflow for production orders: which transitions are allowed from a
 * given status, and how applying one stamps the actual times / progress.
 */
import type { OrderStatus, ProductionOrder } from './types.js';

const FULL_PROGRESS = 100;

/** A status-change action offered for an order, with its UI affordances. */
export interface StatusAction {
  target: OrderStatus;
  label: string;
  icon: string;
}

const PAD_LEN = 2;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

/** Local-datetime string (`YYYY-MM-DDTHH:mm`) for "now". */
function nowLocalInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The status transitions available from the order's current status. */
export function actionsFor(status: OrderStatus): StatusAction[] {
  switch (status) {
    case 'planned': {
      return [
        { target: 'running', label: 'Démarrer', icon: 'play' },
        { target: 'cancelled', label: 'Annuler', icon: 'cancel' }
      ];
    }
    case 'running': {
      return [
        { target: 'paused', label: 'Pause', icon: 'pause' },
        { target: 'done', label: 'Terminer', icon: 'check' },
        { target: 'cancelled', label: 'Annuler', icon: 'cancel' }
      ];
    }
    case 'paused': {
      return [
        { target: 'running', label: 'Reprendre', icon: 'play' },
        { target: 'done', label: 'Terminer', icon: 'check' },
        { target: 'cancelled', label: 'Annuler', icon: 'cancel' }
      ];
    }
    default: {
      // done / cancelled — terminal.
      return [];
    }
  }
}

/**
 * Return a copy of `order` moved to `target`, stamping actual start/end and
 * progress as appropriate. Unknown/illegal targets just set the status.
 */
export function applyTransition(order: ProductionOrder, target: OrderStatus): ProductionOrder {
  const next: ProductionOrder = { ...order, status: target };
  switch (target) {
    case 'running': {
      if (next.actualStart === '') next.actualStart = nowLocalInput();
      next.actualEnd = '';
      break;
    }
    case 'done': {
      if (next.actualStart === '') next.actualStart = nowLocalInput();
      next.actualEnd = nowLocalInput();
      next.progress = FULL_PROGRESS;
      if (next.qtyProduced === 0) next.qtyProduced = next.qtyOrdered;
      break;
    }
    case 'cancelled': {
      next.actualEnd = nowLocalInput();
      break;
    }
    default: {
      break;
    }
  }
  return next;
}
