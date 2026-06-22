/**
 * Persistence layer for ateliers (workshops).
 *
 * Each atelier is stored as one WinCC OA datapoint of type
 * `MachineFleet3D_Config` (a Struct with two String elements: `name` and
 * `json`, the latter holding the full serialized {@link Atelier}). The DP type
 * is auto-created on first use via the PARA REST API (`/api/para/...`) — the
 * same mechanism the PARA page uses, since `OaRxJsApi` can only read/write
 * values, not create types/DPs. Reads use `OaRxJsApi.dpNames` / `dpGet`.
 *
 * When the backend is unreachable or the user lacks write rights, the store
 * transparently falls back to an in-memory list seeded with the demo atelier
 * and sets `offline = true` so the page can surface a non-blocking notice.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import {
  DEFAULT_BUILDING,
  DEFAULT_DISPLAY,
  DEFAULT_STATE_MAPPINGS,
  type Atelier,
  type GlbResource,
  type GraphicKind,
  type StopCause
} from '../types.js';
import { DEMO_ATELIER } from './demo-layout.js';

const CONFIG_TYPE = 'MachineFleet3D_Config';
const DP_PREFIX = 'MachineFleet3D_';
/** DP type + name prefix for each graphics-resource kind (GLB / billboard). */
const RESOURCE_TYPES: Record<GraphicKind, { type: string; prefix: string }> = {
  glb: { type: 'MachineFleet3D_Glb', prefix: 'MachineFleet3D_Glb_' },
  billboard: { type: 'MachineFleet3D_Billboard', prefix: 'MachineFleet3D_Billboard_' }
};
const STOPCAUSE_TYPE = 'MachineFleet3D_StopCauses';
const STOPCAUSE_DP = 'MachineFleet3D_StopCauses';
const CLOSURES_TYPE = 'MachineFleet3D_Closures';
const CLOSURES_DP = 'MachineFleet3D_Closures';
/** Side-table mapping a resource id → its library name (avoids schema change). */
const RESLIB_TYPE = 'MachineFleet3D_ResLibraries';
const RESLIB_DP = 'MachineFleet3D_ResLibraries';
/** Reference scheme for a DP-backed resource (GLB or billboard). */
const REF_SCHEME = 'dp:';
const DATA_URL_SCHEME = 'data:';
const CREATE_TYPE_URL = '/api/para/dptype/create';
const CREATE_DP_URL = '/api/para/dp/create';
const DP_SET_URL = '/api/para/dp/set';
const DELETE_DP_BASE = '/api/para/dp';
const ID_RADIX = 36;
const HTTP_BAD_REQUEST = 400;

function jsonPost(body: object): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

/** WinCC OA archive-config constants (CTRL DPCONFIG/DPATTR values). */
const ARCHIVE_INFO = 45; // DPCONFIG_DB_ARCHIVEINFO
const ARCH_PROC_VALARCH = 15; // DPATTR_ARCH_PROC_VALARCH (NGA value archive)

/** Coerce a (possibly array/object-wrapped) datapoint value to a scalar string. */
function scalarText(raw: unknown): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && typeof v === 'object' && 'value' in v) return scalarText((v as { value: unknown }).value);
  return v == null ? '' : String(v);
}

/** Interpret an `_archive.._archive` value (bool / 0-1 / "true") as a flag. */
function archiveFlag(raw: unknown): boolean {
  const v = scalarText(raw).toLowerCase();
  return v === 'true' || v === '1';
}

/** Strip the system prefix from a DP name (`System1:_NGA_G_EVENT` → `_NGA_G_EVENT`). */
function bareDpName(name: string): string {
  return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
}

export class FleetStore {
  /** True when running without a writable backend (in-memory fallback). */
  offline = false;

  private readonly api = this.resolveApi();
  private readonly dpe = this.resolveDpe();
  private memory: Atelier[] | null = null;
  private typeReady = false;
  private readonly resourceReady = new Map<GraphicKind, boolean>();

  async ensureConfigType(): Promise<void> {
    if (this.typeReady || this.offline) return;
    if (!this.api || !this.dpe) {
      this.offline = true;
      return;
    }
    const ok = await this.ensureType(CONFIG_TYPE, [
      { name: 'name', type: 'String', refName: '' },
      { name: 'json', type: 'String', refName: '' }
    ]);
    if (ok) this.typeReady = true;
    else this.offline = true;
  }

  async listAteliers(): Promise<Atelier[]> {
    await this.ensureConfigType();
    const api = this.api;
    const dpe = this.dpe;
    if (this.offline || !api || !dpe) return this.mem();
    try {
      // `listDatapoints(type)` → backend command `etm.model.type.listDps`,
      // the reliable way to enumerate DPs of a type (unlike dpNames wildcards).
      const names = await firstValueFrom(dpe.listDatapoints(CONFIG_TYPE));
      const out: Atelier[] = [];
      for (const dp of names) {
        const atelier = await this.readAtelier(dp);
        if (atelier) out.push(atelier);
      }
      return out;
    } catch {
      this.offline = true;
      return this.mem();
    }
  }

  async getAtelier(id: string): Promise<Atelier | undefined> {
    const list = await this.listAteliers();
    return list.find((a) => a.id === id);
  }

  async createAtelier(name: string, seed?: Atelier, id?: string): Promise<Atelier> {
    const chosen = id?.trim() ? this.slug(id) : '';
    const finalId = chosen === '' ? `${this.slug(name)}-${Date.now().toString(ID_RADIX)}` : chosen;
    const base = seed ? structuredClone(seed) : this.blankAtelier();
    const atelier: Atelier = { ...base, id: finalId, name, dp: DP_PREFIX + finalId };
    if (this.offline) {
      this.mem().push(atelier);
      return atelier;
    }
    await this.send(CREATE_DP_URL, jsonPost({ dpName: DP_PREFIX + finalId, dpType: CONFIG_TYPE }));
    await this.saveAtelier(atelier);
    return atelier;
  }

  async saveAtelier(atelier: Atelier): Promise<void> {
    if (this.offline) {
      const list = this.mem();
      const i = list.findIndex((a) => a.id === atelier.id);
      if (i === -1) list.push(atelier);
      else list[i] = atelier;
      return;
    }
    const dp = DP_PREFIX + atelier.id;
    // Configuration is saved through the REST API like the other parameters.
    await this.send(DP_SET_URL, jsonPost({ dpeName: `${dp}.name`, value: atelier.name }));
    await this.send(DP_SET_URL, jsonPost({ dpeName: `${dp}.json`, value: JSON.stringify(atelier) }));
  }

  /**
   * Resolve a resource reference (`dp:<name>`) — or a passthrough data:/http//
   * URL — to a loadable URL. Works for both GLB and billboard resources (both
   * store their payload in the DP's `.data` element). Returns undefined when the
   * resource datapoint no longer exists (deleted) → callers show a fallback.
   */
  async readResourceDataUrl(ref: string): Promise<string | undefined> {
    if (!ref.startsWith(REF_SCHEME)) {
      return ref.startsWith(DATA_URL_SCHEME) || ref.startsWith('http') || ref.startsWith('/')
        ? ref
        : undefined;
    }
    const api = this.api;
    if (!api) return undefined;
    const dpName = ref.slice(REF_SCHEME.length);
    try {
      const raw = await firstValueFrom(api.dpGet(`${dpName}.data`));
      const url = this.extractString(raw);
      return url || undefined;
    } catch {
      return undefined;
    }
  }

  async deleteAtelier(id: string): Promise<void> {
    if (this.offline) {
      this.memory = this.mem().filter((a) => a.id !== id);
      return;
    }
    const url = `${DELETE_DP_BASE}/${encodeURIComponent(DP_PREFIX + id)}?dpType=${encodeURIComponent(CONFIG_TYPE)}`;
    await this.send(url, { method: 'DELETE' });
  }

  // --- graphics resource library (GLB models + billboard icons) --------------

  /** Resolve a GLB reference to a loadable URL (kept for callers/back-compat). */
  async readGlbDataUrl(ref: string): Promise<string | undefined> {
    return this.readResourceDataUrl(ref);
  }

  /** List imported resources of a kind (datapoints of its DP type). */
  async listResources(kind: GraphicKind): Promise<GlbResource[]> {
    await this.ensureResourceType(kind);
    const api = this.api;
    const dpe = this.dpe;
    if (this.offline || !api || !dpe) return [];
    try {
      const names = await firstValueFrom(dpe.listDatapoints(RESOURCE_TYPES[kind].type));
      const libs = await this.readResourceLibraries();
      const out: GlbResource[] = [];
      for (const dp of names) {
        const bare = dp.includes(':') ? dp.slice(dp.indexOf(':') + 1) : dp;
        let label = bare;
        try {
          // eslint-disable-next-line no-await-in-loop -- a handful of resources
          const raw = await firstValueFrom(api.dpGet(`${bare}.name`));
          label = this.extractString(raw) || bare;
        } catch {
          // keep dp name as label
        }
        out.push({ id: bare, name: label, ref: REF_SCHEME + bare, library: libs[bare] ?? '' });
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Import a blob (base64 data URL) as a named resource datapoint of a kind. */
  async importResource(
    kind: GraphicKind,
    name: string,
    dataUrl: string,
    library = ''
  ): Promise<GlbResource | undefined> {
    await this.ensureResourceType(kind);
    if (!this.resourceReady.get(kind)) return undefined;
    const dpName = `${RESOURCE_TYPES[kind].prefix}${this.slug(name)}_${Date.now().toString(ID_RADIX)}`;
    try {
      await this.ensureDp(dpName, RESOURCE_TYPES[kind].type);
      await this.send(DP_SET_URL, jsonPost({ dpeName: `${dpName}.name`, value: name }));
      // The /api/para/dp/set route accepts large bodies (the base64 blob).
      await this.send(DP_SET_URL, jsonPost({ dpeName: `${dpName}.data`, value: dataUrl }));
      if (library) await this.setResourceLibrary(dpName, library);
      return { id: dpName, name, ref: REF_SCHEME + dpName, library };
    } catch {
      return undefined;
    }
  }

  async deleteResource(kind: GraphicKind, ref: string): Promise<void> {
    const dpName = ref.startsWith(REF_SCHEME) ? ref.slice(REF_SCHEME.length) : ref;
    const bare = dpName.includes(':') ? dpName.slice(dpName.indexOf(':') + 1) : dpName;
    const url = `${DELETE_DP_BASE}/${encodeURIComponent(bare)}?dpType=${encodeURIComponent(RESOURCE_TYPES[kind].type)}`;
    await this.send(url, { method: 'DELETE' });
    await this.setResourceLibrary(bare, ''); // drop the orphan library mapping
  }

  /** Assign (or clear, when empty) the library of a resource by its bare id. */
  async setResourceLibrary(id: string, library: string): Promise<void> {
    const libs = await this.readResourceLibraries();
    if (library) libs[id] = library;
    else delete libs[id];
    const ok = await this.ensureType(RESLIB_TYPE, [{ name: 'json', type: 'String', refName: '' }]);
    if (!ok) return;
    try {
      await this.ensureDp(RESLIB_DP, RESLIB_TYPE);
      await this.send(DP_SET_URL, jsonPost({ dpeName: `${RESLIB_DP}.json`, value: JSON.stringify(libs) }));
    } catch {
      // ignore — library is non-critical metadata
    }
  }

  // --- stop-cause catalog (single app-level datapoint) -----------------------

  async listStopCauses(): Promise<StopCause[]> {
    const ok = await this.ensureType(STOPCAUSE_TYPE, [{ name: 'json', type: 'String', refName: '' }]);
    const api = this.api;
    if (!ok || !api) return [];
    try {
      const raw = await firstValueFrom(api.dpGet(`${STOPCAUSE_DP}.json`));
      const json = this.extractString(raw);
      return json ? (JSON.parse(json) as StopCause[]) : [];
    } catch {
      return [];
    }
  }

  async saveStopCauses(causes: StopCause[]): Promise<boolean> {
    const ok = await this.ensureType(STOPCAUSE_TYPE, [{ name: 'json', type: 'String', refName: '' }]);
    if (!ok) return false;
    try {
      await this.ensureDp(STOPCAUSE_DP, STOPCAUSE_TYPE);
      await this.send(DP_SET_URL, jsonPost({ dpeName: `${STOPCAUSE_DP}.json`, value: JSON.stringify(causes) }));
      return true;
    } catch {
      return false;
    }
  }

  // --- non-worked periods (KPI opening-time closures) ------------------------

  /** Read the raw closures JSON blob (shape owned by the KPI page). */
  async listClosures(): Promise<unknown> {
    const ok = await this.ensureType(CLOSURES_TYPE, [{ name: 'json', type: 'String', refName: '' }]);
    const api = this.api;
    if (!ok || !api) return null;
    try {
      const raw = await firstValueFrom(api.dpGet(`${CLOSURES_DP}.json`));
      const json = this.extractString(raw);
      return json ? JSON.parse(json) : null;
    } catch {
      return null;
    }
  }

  async saveClosures(config: unknown): Promise<boolean> {
    const ok = await this.ensureType(CLOSURES_TYPE, [{ name: 'json', type: 'String', refName: '' }]);
    if (!ok) return false;
    try {
      await this.ensureDp(CLOSURES_DP, CLOSURES_TYPE);
      await this.send(DP_SET_URL, jsonPost({ dpeName: `${CLOSURES_DP}.json`, value: JSON.stringify(config) }));
      return true;
    } catch {
      return false;
    }
  }

  // --- archiving (WinCC OA NGA value archive config) -------------------------

  /** Discover the **active** NGA archive groups (type `_NGA_Group`), excluding
   * redundancy peers (`*_2`). A group is usable only when its `.active` flag is
   * set (the backend group is enabled) — inactive groups can't archive. Returns
   * bare group names (system prefix stripped). */
  async listArchiveGroups(): Promise<string[]> {
    const api = this.api;
    if (!api) return [];
    try {
      const names = (await firstValueFrom(api.dpNames('*', '_NGA_Group'))) as string[];
      const groups = names
        .map((n) => bareDpName(n))
        .filter((n) => n !== '' && !n.endsWith('_2'))
        .sort((a, b) => a.localeCompare(b));
      if (groups.length === 0) return [];
      // Keep only ACTIVE groups that are NOT specialized for alerts (`isAlert`):
      // the `_NGA_G_ALERT` group archives alarms, not process values.
      const activeRaw = await firstValueFrom(api.dpGet(groups.map((g) => `${g}.active`)));
      const alertRaw = await firstValueFrom(api.dpGet(groups.map((g) => `${g}.isAlert`)));
      const actives = Array.isArray(activeRaw) ? activeRaw : [activeRaw];
      const alerts = Array.isArray(alertRaw) ? alertRaw : [alertRaw];
      return groups.filter((_, i) => archiveFlag(actives[i]) && !archiveFlag(alerts[i]));
    } catch {
      return [];
    }
  }

  /** Read a DPE's current archive status: enabled flag + assigned group. */
  async readArchiveStatus(dpe: string): Promise<{ enabled: boolean; group: string }> {
    const api = this.api;
    if (!api) return { enabled: false, group: '' };
    try {
      const raw = await firstValueFrom(
        api.dpGet([`${dpe}:_archive.._archive`, `${dpe}:_archive.1._class`])
      );
      const values = Array.isArray(raw) ? raw : [raw];
      // `_class` is a reference to the `_NGA_Group` DP, so the backend returns the
      // system-prefixed name; strip it to match the bare names from listArchiveGroups.
      return { enabled: archiveFlag(values[0]), group: bareDpName(scalarText(values[1])) };
    } catch {
      return { enabled: false, group: '' };
    }
  }

  /**
   * Enable or disable NGA value archiving on a DPE via the dp/set REST API.
   * When enabling, the procedure is set to value-archive and assigned to
   * `group` (a `_NGA_Group` name, e.g. `_NGA_G_EVENT`).
   */
  async setArchive(dpe: string, enabled: boolean, group: string): Promise<boolean> {
    try {
      if (enabled) {
        await this.send(DP_SET_URL, jsonPost({ dpeName: `${dpe}:_archive.._type`, value: ARCHIVE_INFO }));
        await this.send(DP_SET_URL, jsonPost({ dpeName: `${dpe}:_archive.1._type`, value: ARCH_PROC_VALARCH }));
        await this.send(DP_SET_URL, jsonPost({ dpeName: `${dpe}:_archive.1._class`, value: group }));
        await this.send(DP_SET_URL, jsonPost({ dpeName: `${dpe}:_archive.._archive`, value: true }));
      } else {
        await this.send(DP_SET_URL, jsonPost({ dpeName: `${dpe}:_archive.._archive`, value: false }));
      }
      return true;
    } catch {
      return false;
    }
  }

  private async readResourceLibraries(): Promise<Record<string, string>> {
    const ok = await this.ensureType(RESLIB_TYPE, [{ name: 'json', type: 'String', refName: '' }]);
    const api = this.api;
    if (!ok || !api) return {};
    try {
      const raw = await firstValueFrom(api.dpGet(`${RESLIB_DP}.json`));
      const json = this.extractString(raw);
      return json ? (JSON.parse(json) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private async ensureResourceType(kind: GraphicKind): Promise<void> {
    if (this.resourceReady.get(kind) || this.offline || !this.api) return;
    const ok = await this.ensureType(RESOURCE_TYPES[kind].type, [
      { name: 'name', type: 'String', refName: '' },
      { name: 'data', type: 'String', refName: '' }
    ]);
    this.resourceReady.set(kind, ok);
  }

  /**
   * Ensure a DP type exists. Existence is checked via `GET /api/para/dptype/:name`
   * (independent of whether the type currently has datapoints — unlike a
   * listTypes query with excludeEmpty, which hides empty types). A 400 on create
   * is treated as "already exists".
   */
  private async ensureType(
    typeName: string,
    children: { name: string; type: string; refName: string }[]
  ): Promise<boolean> {
    try {
      const res = await fetch(`/api/para/dptype/${encodeURIComponent(typeName)}`);
      if (res.ok) return true;
    } catch {
      return false;
    }
    try {
      const res = await fetch(
        CREATE_TYPE_URL,
        jsonPost({ typeName, structure: { name: typeName, type: 'Struct', children } })
      );
      return res.ok || res.status === HTTP_BAD_REQUEST;
    } catch {
      return false;
    }
  }

  private async ensureDp(name: string, type: string): Promise<void> {
    try {
      await this.send(CREATE_DP_URL, jsonPost({ dpName: name, dpType: type }));
    } catch {
      // Likely already exists — values are written next regardless.
    }
  }

  private extractString(raw: unknown): string | undefined {
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const found = this.extractString(item);
        if (found) return found;
      }
      return undefined;
    }
    if (raw && typeof raw === 'object') return this.extractString((raw as { value?: unknown }).value);
    return undefined;
  }

  // --- internals -------------------------------------------------------------

  private async readAtelier(dp: string): Promise<Atelier | undefined> {
    const api = this.api;
    if (!api) return undefined;
    try {
      // dpGet returns the raw value (or an array of values), NOT { value: [] }.
      const raw = await firstValueFrom(api.dpGet(`${dp}.json`));
      const json = this.extractJsonString(raw);
      if (!json) return undefined;
      const atelier = JSON.parse(json) as Atelier;
      atelier.dp = dp;
      atelier.id = this.idFromDp(dp);
      return atelier;
    } catch {
      return undefined;
    }
  }

  /** dpGet's shape varies (raw string, [string], or {value:[...]}); dig for a JSON object string. */
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

  private mem(): Atelier[] {
    this.offline = true;
    this.memory ??= [structuredClone(DEMO_ATELIER)];
    return this.memory;
  }

  private blankAtelier(): Atelier {
    return {
      id: '',
      name: '',
      building: { ...DEFAULT_BUILDING },
      display: { ...DEFAULT_DISPLAY },
      machines: [],
      mappings: structuredClone(DEFAULT_STATE_MAPPINGS)
    };
  }

  private idFromDp(dp: string): string {
    const bare = dp.includes(':') ? dp.slice(dp.indexOf(':') + 1) : dp;
    return bare.startsWith(DP_PREFIX) ? bare.slice(DP_PREFIX.length) : bare;
  }

  private slug(name: string): string {
    return (
      name
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/(^-|-$)/g, '')
        .slice(0, 24) || 'atelier'
    );
  }
}
