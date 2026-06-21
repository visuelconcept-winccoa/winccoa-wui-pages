/**
 * Generic "single datapoint" JSON store: the whole value (an object or an array)
 * lives in ONE fixed WinCC OA datapoint — a Struct type with a single String
 * element `json`. The type + instance are auto-created on first use via the PARA
 * REST API and the store falls back to an in-memory copy (offline) when the
 * backend is unreachable / read-only.
 *
 * Set `isArray` for list-shaped payloads: a missing/garbage value then resolves
 * to the `fallback()` array, and reads/writes a leading `[`. For object payloads
 * (the default) the parsed value is merged over `fallback()` so older records are
 * backfilled with defaults.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';

const CREATE_TYPE_URL = '/api/para/dptype/create';
const CREATE_DP_URL = '/api/para/dp/create';
const DP_SET_URL = '/api/para/dp/set';
const HTTP_BAD_REQUEST = 400;

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export interface DpSingleJsonStoreOptions {
  /** True when the payload is a JSON array (e.g. an order list). */
  isArray?: boolean;
}

export class DpSingleJsonStore<T> {
  /** True when running without a writable backend (in-memory fallback). */
  offline = false;

  private readonly api = this.resolveApi();
  private readonly dpe = this.resolveDpe();
  private memory: T | null = null;
  private ready = false;

  constructor(
    private readonly typeName: string,
    private readonly dpName: string,
    /** Produces a fresh default value (empty array or seeded object defaults). */
    private readonly fallback: () => T,
    private readonly opts: DpSingleJsonStoreOptions = {}
  ) {}

  async load(): Promise<T> {
    await this.ensureDp();
    const api = this.api;
    if (this.offline || !api) return this.mem();
    try {
      const raw = await firstValueFrom(api.dpGet(`${this.dpName}.json`));
      const json = this.extractJsonString(raw);
      if (this.opts.isArray) {
        const parsed: unknown = json ? JSON.parse(json) : [];
        return (Array.isArray(parsed) ? parsed : this.fallback()) as T;
      }
      const parsed = json ? (JSON.parse(json) as Partial<T>) : {};
      return { ...this.fallback(), ...parsed } as T;
    } catch {
      this.offline = true;
      return this.mem();
    }
  }

  async save(value: T): Promise<void> {
    if (this.offline) {
      this.memory = structuredClone(value);
      return;
    }
    try {
      await this.send(DP_SET_URL, jsonPost({ dpeName: `${this.dpName}.json`, value: JSON.stringify(value) }));
    } catch {
      this.offline = true;
      this.memory = structuredClone(value);
    }
  }

  // --- internals -------------------------------------------------------------

  private async ensureDp(): Promise<void> {
    if (this.ready || this.offline) return;
    if (!this.api || !this.dpe) {
      this.offline = true;
      return;
    }
    await this.ensureType();
    if (this.offline) return;
    try {
      const names = await firstValueFrom(this.dpe.listDatapoints(this.typeName));
      if (names.length === 0) {
        await this.send(CREATE_DP_URL, jsonPost({ dpName: this.dpName, dpType: this.typeName }));
      }
      this.ready = true;
    } catch {
      this.offline = true;
    }
  }

  private async ensureType(): Promise<void> {
    try {
      const res = await fetch(`/api/para/dptype/${encodeURIComponent(this.typeName)}`);
      if (res.ok) return;
    } catch {
      this.offline = true;
      return;
    }
    try {
      const res = await fetch(
        CREATE_TYPE_URL,
        jsonPost({
          typeName: this.typeName,
          structure: {
            name: this.typeName,
            type: 'Struct',
            children: [{ name: 'json', type: 'String', refName: '' }]
          }
        })
      );
      if (!res.ok && res.status !== HTTP_BAD_REQUEST) this.offline = true;
    } catch {
      this.offline = true;
    }
  }

  private extractJsonString(raw: unknown): string | undefined {
    const lead = this.opts.isArray ? '[' : '{';
    if (typeof raw === 'string') {
      const s = raw.trim();
      return s.startsWith(lead) ? s : undefined;
    }
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const found = this.extractJsonString(item);
        if (found) return found;
      }
      return undefined;
    }
    if (raw && typeof raw === 'object') {
      return this.extractJsonString((raw as { value?: unknown }).value);
    }
    return undefined;
  }

  private async send(url: string, init: RequestInit): Promise<void> {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status}`);
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

  private mem(): T {
    this.offline = true;
    this.memory ??= this.fallback();
    return this.memory;
  }
}
