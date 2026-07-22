// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stock quantities backed by a DEDICATED WinCC OA datapoint type `WMS_Stock`
 * (one DP per product×location) — so each quantity is a real DPE that can be
 * archived, trended and alarmed on its `minQty`/`maxQty`, rather than an opaque
 * JSON blob. Mirrors the kit `DpJsonStore` idiom: auto-creates the type via the
 * PARA REST API, probes existence with `dpNames` (never `dpGet` on a possibly
 * missing DP), and transparently falls back to the in-memory demo set when the
 * backend is read-only/offline.
 *
 *   WMS_Stock struct = { quantity:Float, product:String, location:String,
 *                        minQty:Float, maxQty:Float }
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import { demoStock, stockId } from '../model.js';
import type { StockCell } from '../types.js';

const TYPE = 'WMS_Stock';
const PREFIX = 'WMS_Stock_';
const CREATE_TYPE_URL = '/api/para/dptype/create';
const CREATE_DP_URL = '/api/para/dp/create';
const DP_SET_URL = '/api/para/dp/set';
const DELETE_DP_BASE = '/api/para/dp';
const HTTP_BAD_REQUEST = 400;

/** Optional min/max written onto the DP so native alarms can be configured. */
export interface StockThresholds {
  min?: number;
  max?: number;
}

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Unwrap a (possibly `{value}`-wrapped) dpGet result into a plain array. */
function toArr(raw: unknown): unknown[] {
  const v = raw && typeof raw === 'object' && 'value' in (raw as object) ? (raw as { value: unknown }).value : raw;
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}

/** Reduce one dpGet slot to its scalar value (unwrap `{value}` / single-element arrays). */
function scalar(raw: unknown): unknown {
  let v = raw;
  if (v && typeof v === 'object' && 'value' in v) v = (v as { value: unknown }).value;
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === 'object' && 'value' in v) v = (v as { value: unknown }).value;
  return v;
}

function idFromDp(dp: string): string {
  const bare = dp.includes(':') ? dp.slice(dp.indexOf(':') + 1) : dp;
  return bare.startsWith(PREFIX) ? bare.slice(PREFIX.length) : bare;
}

export class StockStore {
  /** True when running without a writable backend (in-memory fallback). */
  offline = false;

  private readonly api = this.resolveApi();
  private readonly dpe = this.resolveDpe();
  private memory: StockCell[] | null = null;
  private typeReady = false;

  async list(): Promise<StockCell[]> {
    await this.ensureType();
    const api = this.api;
    const dpe = this.dpe;
    // Offline returns a COPY of the live memory array (Lit change detection).
    if (this.offline || !api || !dpe) return [...this.mem()];
    try {
      const names = await firstValueFrom(dpe.listDatapoints(TYPE));
      const out: StockCell[] = [];
      for (const dp of names) {
        const cell = await this.read(dp);
        if (cell) out.push(cell);
      }
      return out;
    } catch {
      this.offline = true;
      return [...this.mem()];
    }
  }

  /** Create-or-update the quantity (and optional thresholds) of a product at a location. */
  async setQuantity(productId: string, locationId: string, quantity: number, thresholds: StockThresholds = {}): Promise<StockCell> {
    const id = stockId(locationId, productId);
    const dp = PREFIX + id;
    const cell: StockCell = { dp, id, productId, locationId, quantity };
    if (this.offline) {
      this.upsertMem(cell);
      return cell;
    }
    try {
      if (!(await this.exists(dp))) {
        await this.send(CREATE_DP_URL, jsonPost({ dpName: dp, dpType: TYPE }));
      }
      await this.send(DP_SET_URL, jsonPost({ dpeName: `${dp}.quantity`, value: quantity }));
      await this.send(DP_SET_URL, jsonPost({ dpeName: `${dp}.product`, value: productId }));
      await this.send(DP_SET_URL, jsonPost({ dpeName: `${dp}.location`, value: locationId }));
      if (thresholds.min != null) await this.send(DP_SET_URL, jsonPost({ dpeName: `${dp}.minQty`, value: thresholds.min }));
      if (thresholds.max != null) await this.send(DP_SET_URL, jsonPost({ dpeName: `${dp}.maxQty`, value: thresholds.max }));
    } catch {
      this.offline = true;
      this.upsertMem(cell);
    }
    return cell;
  }

  async remove(id: string): Promise<void> {
    if (this.offline) {
      this.memory = this.mem().filter((c) => c.id !== id);
      return;
    }
    try {
      const url = `${DELETE_DP_BASE}/${encodeURIComponent(PREFIX + id)}?dpType=${encodeURIComponent(TYPE)}`;
      await this.send(url, { method: 'DELETE' });
    } catch {
      this.offline = true;
    }
  }

  /** Seed the given cells (first run) — best-effort, no-op offline duplicates merge. */
  async seed(cells: StockCell[]): Promise<void> {
    for (const cell of cells) await this.setQuantity(cell.productId, cell.locationId, cell.quantity);
  }

  // --- internals -------------------------------------------------------------

  private async read(dp: string): Promise<StockCell | undefined> {
    const api = this.api;
    if (!api) return undefined;
    try {
      const res = toArr(await firstValueFrom(api.dpGet([`${dp}.quantity`, `${dp}.product`, `${dp}.location`])));
      const quantity = Number(scalar(res[0]));
      const productId = String(scalar(res[1]) ?? '');
      const locationId = String(scalar(res[2]) ?? '');
      if (!productId || !locationId) return undefined;
      return { dp, id: idFromDp(dp), productId, locationId, quantity: Number.isFinite(quantity) ? quantity : 0 };
    } catch {
      return undefined;
    }
  }

  private async ensureType(): Promise<void> {
    if (this.typeReady || this.offline) return;
    if (!this.api || !this.dpe) {
      this.offline = true;
      return;
    }
    try {
      const res = await fetch(`/api/para/dptype/${encodeURIComponent(TYPE)}`);
      if (res.ok) {
        this.typeReady = true;
        return;
      }
    } catch {
      this.offline = true;
      return;
    }
    try {
      const res = await fetch(
        CREATE_TYPE_URL,
        jsonPost({
          typeName: TYPE,
          structure: {
            name: TYPE,
            type: 'Struct',
            children: [
              { name: 'quantity', type: 'Float', refName: '' },
              { name: 'product', type: 'String', refName: '' },
              { name: 'location', type: 'String', refName: '' },
              { name: 'minQty', type: 'Float', refName: '' },
              { name: 'maxQty', type: 'Float', refName: '' }
            ]
          }
        })
      );
      if (res.ok || res.status === HTTP_BAD_REQUEST) this.typeReady = true;
      else this.offline = true;
    } catch {
      this.offline = true;
    }
  }

  private async exists(dp: string): Promise<boolean> {
    const api = this.api;
    if (!api) return false;
    try {
      const names = (await firstValueFrom(api.dpNames(dp, TYPE))) as string[];
      return Array.isArray(names) && names.length > 0;
    } catch {
      return false;
    }
  }

  private async send(url: string, init: RequestInit): Promise<void> {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status}`);
  }

  private mem(): StockCell[] {
    this.offline = true;
    this.memory ??= demoStock();
    return this.memory;
  }

  private upsertMem(cell: StockCell): void {
    const list = this.mem();
    const i = list.findIndex((c) => c.id === cell.id);
    if (i === -1) list.push(cell);
    else list[i] = cell;
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }

  private resolveDpe(): WuiDpeService | null {
    try {
      return container.resolve<WuiDpeService>(WuiDpeService);
    } catch {
      return null;
    }
  }
}

/** Singleton used by the page. */
export const stockStore = new StockStore();

/** Seed the stock DPs with the demo set on first run (writable backend + empty). */
export async function seedStockIfEmpty(): Promise<void> {
  try {
    const existing = await stockStore.list();
    if (stockStore.offline || existing.length > 0) return;
    await stockStore.seed(demoStock());
  } catch {
    // best-effort
  }
}
