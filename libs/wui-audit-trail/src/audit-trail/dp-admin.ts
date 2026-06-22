/**
 * Admin data layer for `_AuditTrail` datapoints: list instances, create a new
 * (mandatorily archived) DP, (re)assign its NGA archive group and delete it.
 *
 * Built on the same PARA REST endpoints + OaRxJsApi the rest of the project
 * uses. The archive-config writes mirror the proven `wui-para` archive logic
 * (verified DPCONFIG/DPATTR constants) — see `libs/wui-para/src/para/para-archive.ts`.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { firstValueFrom } from 'rxjs';
import { AUDIT_DP_TYPE, AUDIT_FIELDS } from './types.js';

const DP_CREATE_URL = '/api/para/dp/create';
const DP_SET_URL = '/api/para/dp/set';
const DP_BASE_URL = '/api/para/dp';
/** WinCC OA archive-config constants (CTRL DPCONFIG/DPATTR values). */
const ARCHIVE_INFO = 45; // DPCONFIG_DB_ARCHIVEINFO
const ARCH_PROC_VALARCH = 15; // DPATTR_ARCH_PROC_VALARCH (NGA value archive)

export interface AuditDpStatus {
  /** True when the representative leaf has NGA value archiving enabled. */
  archived: boolean;
  /** Assigned archive group (bare `_NGA_Group` name), or '' when none. */
  group: string;
}

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function scalarText(raw: unknown): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && typeof v === 'object' && 'value' in v) return scalarText((v as { value: unknown }).value);
  return v == null ? '' : String(v);
}

function archiveFlag(raw: unknown): boolean {
  const v = scalarText(raw).toLowerCase();
  return v === 'true' || v === '1';
}

export function bareName(name: string): string {
  return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
}

/** POST that succeeds only when both the HTTP status and the `ok` flag are good. */
async function postOk(url: string, body: object): Promise<void> {
  const res = await fetch(url, jsonPost(body));
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || data.ok !== true) throw new Error(data.error ?? `HTTP ${res.status}`);
}

/** All `_AuditTrail` instances (bare names, sorted). Includes the system DP. */
export async function listAuditDps(api: OaRxJsApi | null): Promise<string[]> {
  if (!api) return [];
  try {
    const names = (await firstValueFrom(api.dpNames('*', AUDIT_DP_TYPE))) as string[];
    return names
      .map((n) => bareName(n))
      .filter((n) => n !== '')
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** Active NGA archive groups (bare `_NGA_Group` names with `.active`, non-alert). */
export async function listArchiveGroups(api: OaRxJsApi | null): Promise<string[]> {
  if (!api) return [];
  try {
    const names = (await firstValueFrom(api.dpNames('*', '_NGA_Group'))) as string[];
    const groups = names
      .map((n) => bareName(n))
      .filter((n) => n !== '' && !n.endsWith('_2'))
      .sort((a, b) => a.localeCompare(b));
    if (groups.length === 0) return [];
    const activeRaw = await firstValueFrom(api.dpGet(groups.map((g) => `${g}.active`)));
    const alertRaw = await firstValueFrom(api.dpGet(groups.map((g) => `${g}.isAlert`)));
    const actives = Array.isArray(activeRaw) ? activeRaw : [activeRaw];
    const alerts = Array.isArray(alertRaw) ? alertRaw : [alertRaw];
    return groups.filter((_g, i) => archiveFlag(actives[i]) && !archiveFlag(alerts[i]));
  } catch {
    return [];
  }
}

/** Archive status of a DP, read from its representative `time` leaf. */
export async function readArchiveStatus(api: OaRxJsApi | null, dp: string): Promise<AuditDpStatus> {
  if (!api) return { archived: false, group: '' };
  const dpe = `${dp}.${AUDIT_FIELDS[0].key}`;
  try {
    const raw = await firstValueFrom(api.dpGet([`${dpe}:_archive.._archive`, `${dpe}:_archive.1._class`]));
    const values = Array.isArray(raw) ? raw : [raw];
    return { archived: archiveFlag(values[0]), group: bareName(scalarText(values[1])) };
  } catch {
    return { archived: false, group: '' };
  }
}

/** Create a `_AuditTrail` datapoint (caller passes the full, prefixed name). */
export async function createAuditDp(dpName: string): Promise<void> {
  await postOk(DP_CREATE_URL, { dpName, dpType: AUDIT_DP_TYPE });
}

/** Enable NGA value archiving with `group` on every `_AuditTrail` leaf of `dp`. */
export async function enableArchive(dp: string, group: string): Promise<void> {
  for (const field of AUDIT_FIELDS) {
    const dpe = `${dp}.${field.key}`;
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
  }
}

/** Delete a `_AuditTrail` datapoint (type-guarded). */
export async function deleteAuditDp(dpName: string): Promise<void> {
  const res = await fetch(
    `${DP_BASE_URL}/${encodeURIComponent(dpName)}?dpType=${encodeURIComponent(AUDIT_DP_TYPE)}`,
    { method: 'DELETE' }
  );
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || data.ok !== true) throw new Error(data.error ?? `HTTP ${res.status}`);
}
