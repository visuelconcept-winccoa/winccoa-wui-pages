/**
 * Generic "one datapoint per entity" JSON store shared by the standalone pages.
 *
 * Each entity persists as one WinCC OA datapoint of a Struct type with two String
 * elements (`name` + `json`), auto-created on first use via the PARA REST API
 * (`OaRxJsApi` can read/write values but not create types/DPs). Reads use
 * `WuiDpeService.listDatapoints` + `OaRxJsApi.dpGet`. When the backend is
 * unreachable (or the user lacks write rights) it transparently falls back to an
 * in-memory list seeded with demo data and flips `offline = true`.
 *
 * Per-page variations are expressed through {@link DpJsonStoreOptions}:
 * - `slugFallback` — the word used when an entity label has no slug-able chars.
 * - `slugSource`   — derive the id slug from a field other than the `.name` label.
 * - `afterRead`    — post-parse migration hook (e.g. backfill a defaulted field).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';

const CREATE_TYPE_URL = '/api/para/dptype/create';
const CREATE_DP_URL = '/api/para/dp/create';
const DP_SET_URL = '/api/para/dp/set';
const DELETE_DP_BASE = '/api/para/dp';
const ID_RADIX = 36;
const HTTP_BAD_REQUEST = 400;
const SLUG_MAX = 28;

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/**
 * Minimal shape every stored entity must expose so the store can manage it.
 * `dp` is optional: the store always (re)assigns it on create/read, and page
 * entity types commonly declare it optional (`dp?: string`).
 */
export interface DpEntity {
  id: string;
  dp?: string;
}

/** Optional per-page behaviour hooks (see class docs). */
export interface DpJsonStoreOptions<T> {
  slugFallback?: string;
  slugSource?: (item: T) => string;
  afterRead?: (item: T) => T;
}

export class DpJsonStore<T extends DpEntity> {
  /** True when running without a writable backend (in-memory fallback). */
  offline = false;

  private readonly api = this.resolveApi();
  private readonly dpe = this.resolveDpe();
  private memory: T[] | null = null;
  private typeReady = false;

  constructor(
    private readonly typeName: string,
    private readonly prefix: string,
    /** `.name` element value for a given entity. */
    private readonly labelOf: (item: T) => string,
    /** Demo seed used for the offline fallback. */
    private readonly demo: () => T[],
    private readonly opts: DpJsonStoreOptions<T> = {}
  ) {}

  async list(): Promise<T[]> {
    await this.ensureType();
    const api = this.api;
    const dpe = this.dpe;
    if (this.offline || !api || !dpe) return this.mem();
    try {
      const names = await firstValueFrom(dpe.listDatapoints(this.typeName));
      const out: T[] = [];
      for (const dp of names) {
        const item = await this.read(dp);
        if (item) out.push(item);
      }
      return out;
    } catch {
      this.offline = true;
      return this.mem();
    }
  }

  async create(item: T, opts: { id?: string } = {}): Promise<T> {
    const id = opts.id ?? `${this.slug(this.slugLabel(item))}-${Date.now().toString(ID_RADIX)}`;
    const created: T = { ...item, id, dp: this.prefix + id };
    if (this.offline) {
      this.mem().push(created);
      return created;
    }
    await this.send(CREATE_DP_URL, jsonPost({ dpName: created.dp, dpType: this.typeName }));
    await this.save(created);
    return created;
  }

  async save(item: T): Promise<void> {
    if (this.offline) {
      const list = this.mem();
      const i = list.findIndex((x) => x.id === item.id);
      if (i === -1) list.push(item);
      else list[i] = item;
      return;
    }
    const dp = this.prefix + item.id;
    await this.send(DP_SET_URL, jsonPost({ dpeName: `${dp}.name`, value: this.labelOf(item) }));
    await this.send(DP_SET_URL, jsonPost({ dpeName: `${dp}.json`, value: JSON.stringify(item) }));
  }

  async remove(id: string): Promise<void> {
    if (this.offline) {
      this.memory = this.mem().filter((x) => x.id !== id);
      return;
    }
    const url = `${DELETE_DP_BASE}/${encodeURIComponent(this.prefix + id)}?dpType=${encodeURIComponent(this.typeName)}`;
    await this.send(url, { method: 'DELETE' });
  }

  /** Persist many entities (used for demo seeding / import). */
  async importMany(items: T[]): Promise<T[]> {
    const out: T[] = [];
    for (const seed of items) out.push(await this.create(seed));
    return out;
  }

  // --- internals -------------------------------------------------------------

  private async ensureType(): Promise<void> {
    if (this.typeReady || this.offline) return;
    if (!this.api || !this.dpe) {
      this.offline = true;
      return;
    }
    try {
      const res = await fetch(`/api/para/dptype/${encodeURIComponent(this.typeName)}`);
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
          typeName: this.typeName,
          structure: {
            name: this.typeName,
            type: 'Struct',
            children: [
              { name: 'name', type: 'String', refName: '' },
              { name: 'json', type: 'String', refName: '' }
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

  private async read(dp: string): Promise<T | undefined> {
    const api = this.api;
    if (!api) return undefined;
    try {
      const raw = await firstValueFrom(api.dpGet(`${dp}.json`));
      const json = this.extractJsonString(raw);
      if (!json) return undefined;
      const item = JSON.parse(json) as T;
      item.dp = dp;
      item.id = this.idFromDp(dp);
      return this.opts.afterRead ? this.opts.afterRead(item) : item;
    } catch {
      return undefined;
    }
  }

  private extractJsonString(raw: unknown): string | undefined {
    if (typeof raw === 'string') {
      const s = raw.trim();
      return s.startsWith('{') ? s : undefined;
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

  private mem(): T[] {
    this.offline = true;
    this.memory ??= this.demo();
    return this.memory;
  }

  private idFromDp(dp: string): string {
    const bare = dp.includes(':') ? dp.slice(dp.indexOf(':') + 1) : dp;
    return bare.startsWith(this.prefix) ? bare.slice(this.prefix.length) : bare;
  }

  private slugLabel(item: T): string {
    return this.opts.slugSource ? this.opts.slugSource(item) : this.labelOf(item);
  }

  private slug(name: string): string {
    return (
      name
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/(^-|-$)/g, '')
        .slice(0, SLUG_MAX) || (this.opts.slugFallback ?? 'item')
    );
  }
}
