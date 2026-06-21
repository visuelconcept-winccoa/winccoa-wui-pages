/**
 * Persistence layer for production orders.
 *
 * The whole order list is kept in a *single* WinCC OA datapoint — type
 * `ProductionOrders_List`, a Struct with one String element `json` holding the
 * serialized {@link ProductionOrder}[]. Thin adapter over the shared
 * {@link DpSingleJsonStore} (array mode); keeps the page-specific `saveAll` name.
 */
import { DpSingleJsonStore } from '../../_vendor/wui-kit/data/dp-single-json-store.js';
import type { ProductionOrder } from '../types.js';

export class OrderStore extends DpSingleJsonStore<ProductionOrder[]> {
  constructor() {
    super('ProductionOrders_List', 'ProductionOrders_List', () => [], { isArray: true });
  }

  /** Persist the full order list (overwrites the backing datapoint). */
  saveAll(orders: ProductionOrder[]): Promise<void> {
    return this.save(orders);
  }
}
