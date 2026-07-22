// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * StockStore (dedicated `WMS_Stock` DP type) in the no-backend situation:
 * demo fallback, in-memory upsert/remove, deterministic ids.
 */
import { describe, expect, it } from 'vitest';
import { stockId } from '../model.js';
import { StockStore } from './stock-store.js';

describe('StockStore without a backend (offline fallback)', () => {
  it('lists the demo stock and reports offline', async () => {
    const store = new StockStore();
    const stock = await store.list();
    expect(store.offline).toBe(true);
    expect(stock).toHaveLength(16);
    for (const cell of stock) expect(cell.dp).toBe(`WMS_Stock_${cell.id}`);
  });

  it('setQuantity upserts in memory (update existing, insert new)', async () => {
    const store = new StockStore();
    await store.list();

    // update an existing cell
    const updated = await store.setQuantity('p-1001', 'z-a-1', 999);
    expect(updated.id).toBe(stockId('z-a-1', 'p-1001'));
    let stock = await store.list();
    expect(stock).toHaveLength(16);
    expect(stock.find((c) => c.id === updated.id)?.quantity).toBe(999);

    // insert a brand new product×location pair
    const inserted = await store.setQuantity('p-1004', 'z-d-4', 7);
    stock = await store.list();
    expect(stock).toHaveLength(17);
    expect(stock.find((c) => c.id === inserted.id)?.quantity).toBe(7);
  });

  it('removes a cell in memory', async () => {
    const store = new StockStore();
    const [first] = await store.list();
    await store.remove(first.id);
    const stock = await store.list();
    expect(stock).toHaveLength(15);
    expect(stock.some((c) => c.id === first.id)).toBe(false);
  });

  it('seed merges duplicates instead of stacking them', async () => {
    const store = new StockStore();
    const initial = await store.list();
    await store.seed(initial); // seeding the same cells again
    expect(await store.list()).toHaveLength(initial.length);
  });
});
