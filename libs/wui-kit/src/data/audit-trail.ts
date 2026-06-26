/**
 * Shared GxP audit-trail writer for the standalone pages.
 *
 * Records edit operations (create / update / delete / import / …) of any page
 * entity into a dedicated WinCC OA datapoint of the fixed system type
 * `_AuditTrail` — the same GxP structure (time · username · uinum · batchid ·
 * item · itemtype · action · oldval → newval · reason · host) that the
 * Audit-trail page (`@visuelconcept/wui-audit-trail`) visualizes. Each module
 * owns one audit DP (e.g. `AuditTrail_CameraStreams`); pass its bare name to the
 * constructor.
 *
 * The DP is auto-provisioned on first use: created of type `_AuditTrail` via the
 * PARA REST API, then — best-effort — NGA value-archiving is enabled on every
 * leaf when an active (non-alert) archive group exists. When none does (or the
 * PARA backend / Audit-trail page isn't installed) the DP is still provisioned,
 * just UNARCHIVED: the live values are written, and archiving can be enabled
 * later from the Audit-trail page (only archived records show up in its history
 * table). Writing is best-effort and NEVER throws — a failed audit write must
 * not break the edit it traces.
 *
 * Writes go through the PARA REST `dp/set` endpoint (like {@link DpJsonStore}),
 * because the dashboard's WSS data connection is read-only; the rx-js API is used
 * only for read-side checks (does the DP exist, which archive group is active).
 * The acting user / id come from `WuiUserService`, the host from `location`. All
 * leaves of one record are written in a single `dp/set` so they share one source
 * timestamp → exactly one row in the Audit-trail viewer.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiUserService } from '@wincc-oa/wui-iam-data/user-service.js';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';
import { container } from 'tsyringe';

const DP_CREATE_URL = '/api/para/dp/create';
const DP_SET_URL = '/api/para/dp/set';
const AUDIT_DP_TYPE = '_AuditTrail';
/** WinCC OA archive-config constants (CTRL DPCONFIG/DPATTR values), as in wui-para. */
const ARCHIVE_INFO = 45; // DPCONFIG_DB_ARCHIVEINFO
const ARCH_PROC_VALARCH = 15; // DPATTR_ARCH_PROC_VALARCH (NGA value archive)
/** Value used to mask a redacted field (e.g. a password) in old/new snapshots. */
const MASK = '••••';

/** Fixed `_AuditTrail` leaves, in GxP display order (also the archived columns). */
const AUDIT_LEAVES = [
  'time',
  'username',
  'uinum',
  'batchid',
  'item',
  'itemtype',
  'action',
  'oldval',
  'newval',
  'reason',
  'host'
] as const;

/** Configuration for one module's audit-trail writer. */
export interface AuditTrailWriterOptions {
  /** Bare audit DP name to write into; auto-created of type `_AuditTrail`. */
  dpName: string;
  /** Default `itemtype` value (the kind of object edited, e.g. 'RtspCamera'). */
  itemType?: string;
  /** Enable NGA archiving on creation when an active group exists (default true). */
  archive?: boolean;
}

/** One audit record; technical fields (time / user / host) are filled by the writer. */
export interface AuditRecord {
  /** Operation performed, e.g. 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT'. */
  action: string;
  /** Human label of the affected item (e.g. the camera name). */
  item: string;
  /** Overrides the writer's default `itemType` for this record. */
  itemType?: string;
  /** Previous value (free text / JSON); empty for a creation. */
  oldval?: string;
  /** New value (free text / JSON); empty for a deletion. */
  newval?: string;
  /** Reason / context of the change. */
  reason?: string;
}

/** Options for the {@link auditSnapshot} / {@link auditDiff} serializers. */
export interface AuditFieldOptions<T> {
  /** Fields whose value must be masked (e.g. passwords) instead of serialized. */
  redact?: readonly (keyof T)[];
}

export class AuditTrailWriter {
  private readonly api = resolveApi();
  private readonly dpName: string;
  private readonly itemType: string;
  private readonly archive: boolean;
  /** Single-flight provisioning promise (idempotent across concurrent writes). */
  private provisioning: Promise<boolean> | null = null;

  constructor(options: AuditTrailWriterOptions) {
    this.dpName = options.dpName;
    this.itemType = options.itemType ?? '';
    this.archive = options.archive ?? true;
  }

  /**
   * Provision the audit DP (idempotent). Resolves to `true` when the DP exists and
   * the PARA backend is writable, `false` when no backend is available. Never throws.
   */
  ensure(): Promise<boolean> {
    this.provisioning ??= this.provision();
    return this.provisioning;
  }

  /**
   * Append one audit record (best-effort). Ensures the DP first and silently
   * no-ops when the backend is unavailable. All leaves are written in a single
   * `dp/set` so they share one timestamp → exactly one row in the viewer.
   */
  async write(record: AuditRecord): Promise<void> {
    if (!(await this.ensure())) return;
    const user = await resolveUserLoaded();
    const values: (string | number)[] = [
      Date.now(), // time (epoch ms; OA stores it as a time value)
      user?.name ?? '', // username
      user?.id ?? 0, // uinum
      0, // batchid (unused)
      record.item, // item
      record.itemType ?? this.itemType, // itemtype
      record.action, // action
      record.oldval ?? '', // oldval
      record.newval ?? '', // newval
      record.reason ?? '', // reason
      globalThis.location?.hostname ?? '' // host
    ];
    const dpeNames = AUDIT_LEAVES.map((leaf) => `${this.dpName}.${leaf}`);
    try {
      await postOk(DP_SET_URL, { dpeNames, values });
    } catch {
      // Best-effort: a failed audit write must never break the traced edit.
    }
  }

  // --- provisioning ----------------------------------------------------------

  private async provision(): Promise<boolean> {
    if (await this.dpExists()) return true;
    const outcome = await this.createDp();
    if (outcome === 'failed') return false;
    if (outcome === 'created' && this.archive) await this.tryEnableArchive();
    return true;
  }

  private async dpExists(): Promise<boolean> {
    if (!this.api) return false;
    try {
      const names = (await firstValueFrom(this.api.dpNames(this.dpName, AUDIT_DP_TYPE))) as string[];
      return Array.isArray(names) && names.length > 0;
    } catch {
      return false;
    }
  }

  /** Create the audit DP — 'created', 'exists' (already there) or 'failed' (no backend). */
  private async createDp(): Promise<'created' | 'exists' | 'failed'> {
    try {
      const res = await fetch(DP_CREATE_URL, jsonPost({ dpName: this.dpName, dpType: AUDIT_DP_TYPE }));
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok === true) return 'created';
      if ((data.error ?? '').toLowerCase().includes('exist')) return 'exists';
      return 'failed';
    } catch {
      return 'failed';
    }
  }

  /** Best-effort NGA value archiving on every leaf, using the first active group. */
  private async tryEnableArchive(): Promise<void> {
    const group = await this.firstActiveGroup();
    if (!group) return; // No usable archive group → leave the DP unarchived (per design).
    for (const leaf of AUDIT_LEAVES) {
      const dpe = `${this.dpName}.${leaf}`;
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential keeps the dp/set load gentle
        await postOk(DP_SET_URL, {
          dpeNames: [
            `${dpe}:_archive.._type`,
            `${dpe}:_archive.1._type`,
            `${dpe}:_archive.1._class`,
            `${dpe}:_archive.._archive`
          ],
          values: [ARCHIVE_INFO, ARCH_PROC_VALARCH, group, true]
        });
      } catch {
        return; // Archiving is optional; stop on the first refusal.
      }
    }
  }

  /** First active, non-alert `_NGA_Group` (bare name), or '' when none exists. */
  private async firstActiveGroup(): Promise<string> {
    if (!this.api) return '';
    try {
      const raw = (await firstValueFrom(this.api.dpNames('*', '_NGA_Group'))) as string[];
      const groups = raw.map((n) => bareName(n)).filter((n) => n !== '' && !n.endsWith('_2'));
      if (groups.length === 0) return '';
      const actives = toArray(await firstValueFrom(this.api.dpGet(groups.map((g) => `${g}.active`))));
      const alerts = toArray(await firstValueFrom(this.api.dpGet(groups.map((g) => `${g}.isAlert`))));
      return groups.find((_g, i) => boolFlag(actives[i]) && !boolFlag(alerts[i])) ?? '';
    } catch {
      return '';
    }
  }
}

/** JSON snapshot of `fields` of `obj`, masking any `redact` field that has a value. */
export function auditSnapshot<T extends object>(
  obj: T,
  fields: readonly (keyof T)[],
  opts: AuditFieldOptions<T> = {}
): string {
  return JSON.stringify(pick(obj, fields, opts.redact));
}

/**
 * The connected user's display name and numeric id, ensuring the settings are
 * loaded first (see {@link AuditTrailWriter}). Returns empty/0 when unavailable.
 * Handy for stamping a non-GxP operations log with the same actor as the audit DP.
 */
export async function currentAuditUser(): Promise<{ name: string; id: number }> {
  const svc = await resolveUserLoaded();
  return { name: svc?.name ?? '', id: svc?.id ?? 0 };
}

/**
 * Field-level diff of two snapshots over `fields`. Returns `{ old, new }` JSON of
 * only the changed fields (redacted as configured), or `null` when nothing changed.
 */
export function auditDiff<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T)[],
  opts: AuditFieldOptions<T> = {}
): { old: string; new: string } | null {
  const redact = new Set<keyof T>(opts.redact ?? []);
  const oldObj: Record<string, unknown> = {};
  const newObj: Record<string, unknown> = {};
  let changed = false;
  for (const field of fields) {
    if (equalValue(before[field], after[field])) continue;
    changed = true;
    oldObj[String(field)] = redact.has(field) ? mask(before[field]) : before[field];
    newObj[String(field)] = redact.has(field) ? mask(after[field]) : after[field];
  }
  return changed ? { old: JSON.stringify(oldObj), new: JSON.stringify(newObj) } : null;
}

/**
 * Deep value equality. Uses identity for primitives and a JSON comparison for
 * objects/arrays — a freshly read entity never shares object identity with the
 * in-memory one, so structural fields (tiles, sections, …) must compare by value.
 */
function equalValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- internals ---------------------------------------------------------------

function pick<T extends object>(
  obj: T,
  fields: readonly (keyof T)[],
  redact: readonly (keyof T)[] = []
): Record<string, unknown> {
  const set = new Set<keyof T>(redact);
  const out: Record<string, unknown> = {};
  for (const field of fields) out[String(field)] = set.has(field) ? mask(obj[field]) : obj[field];
  return out;
}

function mask(value: unknown): string {
  return value ? MASK : '';
}

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** POST that succeeds only when both the HTTP status and the `ok` flag are good. */
async function postOk(url: string, body: object): Promise<void> {
  const res = await fetch(url, jsonPost(body));
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || data.ok !== true) throw new Error(data.error ?? `HTTP ${res.status}`);
}

function resolveApi(): OaRxJsApi | null {
  try {
    return container.resolve<OaRxJsApi>(OaRxJsApi);
  } catch {
    return null;
  }
}

function resolveUser(): WuiUserService | null {
  try {
    return container.resolve(WuiUserService);
  } catch {
    return null;
  }
}

/**
 * Resolve the user service AND make sure the connected user's settings are
 * loaded, so the audit row carries a real `username`/`uinum`. The settings load
 * lazily (via `etm.user.settings.get`); on pages opened before the shell has
 * finished — or embedded ones — `name` would otherwise be empty. When not yet
 * loaded we trigger the fetch and wait briefly (bounded), then fall back to
 * whatever is available. Best-effort: never throws.
 */
async function resolveUserLoaded(): Promise<WuiUserService | null> {
  const svc = resolveUser();
  if (!svc || svc.name) return svc;
  try {
    await firstValueFrom(
      svc.getOaUser().pipe(
        filter(() => svc.name != null),
        timeout({ first: 4000 }),
        catchError(() => of(null))
      )
    );
  } catch {
    // best-effort — write whatever username we have (possibly empty)
  }
  return svc;
}

function bareName(name: string): string {
  return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
}

function toArray<T>(raw: T | T[]): T[] {
  return Array.isArray(raw) ? raw : [raw];
}

/** Coerce a (possibly `{ value }`-wrapped) dpGet result to a boolean flag. */
function boolFlag(raw: unknown): boolean {
  const v = raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : raw;
  const s = String(v ?? '').toLowerCase();
  return s === 'true' || s === '1';
}
