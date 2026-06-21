/**
 * Optional bridge from a production order to the Machine Fleet 3D view.
 *
 * A fleet machine may declare a `workOrderDp` / `operationDp` (the datapoints
 * the 3D bubble reads to show the active OF + operation). When an order starts
 * running we push its number/product onto those DPs; when it ends we clear them.
 * This is **best-effort**: any failure (no DP configured, read-only, offline) is
 * silently ignored — order management never depends on it.
 *
 * Writes go through the PARA REST endpoint (`/api/para/dp/set`), since the
 * WebSocket `dpSet` is read-only in this deployment.
 */
import type { Atelier } from '@visuelconcept/wui-fleet-core/types.js';
import type { ProductionOrder } from '../types.js';

const DP_SET_URL = '/api/para/dp/set';

function findMachine(
  ateliers: Atelier[],
  atelierId: string,
  machineId: string
): { workOrderDp?: string; operationDp?: string } | undefined {
  const atelier = ateliers.find((a) => a.id === atelierId);
  return atelier?.machines.find((m) => m.id === machineId);
}

async function setDp(dpeName: string, value: string): Promise<void> {
  try {
    await fetch(DP_SET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dpeName, value })
    });
  } catch {
    // best-effort
  }
}

/** Push the order's number + product onto the assigned machine's OF datapoints. */
export async function pushOrderToFleet(ateliers: Atelier[], order: ProductionOrder): Promise<void> {
  const machine = findMachine(ateliers, order.atelierId, order.machineId);
  if (!machine) return;
  if (machine.workOrderDp) await setDp(machine.workOrderDp, order.orderNo);
  if (machine.operationDp) await setDp(machine.operationDp, order.product);
}

/** Clear the OF datapoints of the order's assigned machine. */
export async function clearOrderFromFleet(ateliers: Atelier[], order: ProductionOrder): Promise<void> {
  const machine = findMachine(ateliers, order.atelierId, order.machineId);
  if (!machine) return;
  if (machine.workOrderDp) await setDp(machine.workOrderDp, '');
  if (machine.operationDp) await setDp(machine.operationDp, '');
}
