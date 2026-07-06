// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Application Security — shared client primitives.
 *
 * Every page module can declare the ROLES it expects (view/edit/deploy…);
 * an administrator maps each role to WinCC OA user GROUPS in the standalone
 * "Application Security" page. The mapping lives in one datapoint per module
 * (type `AppSecurity_Module`, DP `AppSecurity_<module>`) with two elements
 * owned by two different writers — no write contention:
 *   - `.roles`        declaration JSON, written by the PROVIDING module
 *                     ({@link registerModuleRoles}) and/or the admin page's
 *                     "Discover" seeding;
 *   - `.assignments`  `{roleId: [group names]}` JSON, written ONLY by the
 *                     admin page.
 *
 * Pages gate their affordances with {@link hasRole$}. Resolution rules
 * (validated design — "open by default"):
 *   - role NOT assigned to any group  → granted to every connected user;
 *   - role assigned                   → granted when the session user belongs
 *     to one of the groups (identity from `/api/app-security/me`, resolved
 *     server-side) or is the OA root user;
 *   - identity endpoint unreachable   → granted ONLY for unassigned roles
 *     (an assigned role means the admin opted into security — fail closed).
 *
 * Frontend gating is UX; the same rules are enforced server-side on sensitive
 * API routes (see `backend/routes/appSecurityGuard.ts`).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { Observable, catchError, combineLatest, from, map, of, shareReplay, startWith } from 'rxjs';
import { container } from 'tsyringe';

/** DP type holding one module's roles + assignments. */
export const APP_SECURITY_TYPE = 'AppSecurity_Module';
/** DP name prefix; the instance for a module is `AppSecurity_<module>`. */
export const APP_SECURITY_PREFIX = 'AppSecurity_';
/** Identity endpoint served by the app-security backend module. */
export const APP_SECURITY_ME_URL = '/api/app-security/me';

const CREATE_TYPE_URL = '/api/para/dptype/create';
const CREATE_DP_URL = '/api/para/dp/create';
const DP_SET_URL = '/api/para/dp/set';
const HTTP_BAD_REQUEST = 400;

/** One role a module expects (labels are trilingual, like every UI string). */
export interface AppRoleDeclaration {
  id: string;
  label: MultiLangString;
  description?: MultiLangString;
}

/** A module's full role declaration (what the admin page discovers). */
export interface AppModuleRoles {
  /** Module id — the page id used in specs/menuconfig (e.g. 'para', 'fleet-3d'). */
  module: string;
  /** Human title of the module. */
  title: MultiLangString;
  roles: AppRoleDeclaration[];
}

/** Session identity resolved server-side (username → OA groups). */
export interface AppSecurityIdentity {
  username: string;
  userId: number;
  /** OA root (user id 0) — bypasses every role check. */
  admin: boolean;
  groups: string[];
}

/** Role → assigned group names (absent/empty array = open to all connected). */
export type AppRoleAssignments = Record<string, string[]>;

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Sanitize a module id into the DP-name fragment (defensive — ids are slugs already). */
function dpFragment(module: string): string {
  return module.replaceAll(/[^A-Za-z0-9_-]/g, '_');
}

/** Bare DP name for a module's app-security instance. */
export function appSecurityDp(module: string): string {
  return `${APP_SECURITY_PREFIX}${dpFragment(module)}`;
}

async function ensureType(): Promise<boolean> {
  try {
    const probe = await fetch(`/api/para/dptype/${encodeURIComponent(APP_SECURITY_TYPE)}`);
    if (probe.ok) return true;
    const res = await fetch(
      CREATE_TYPE_URL,
      jsonPost({
        typeName: APP_SECURITY_TYPE,
        structure: {
          name: APP_SECURITY_TYPE,
          type: 'Struct',
          children: [
            { name: 'module', type: 'String', refName: '' },
            { name: 'roles', type: 'String', refName: '' },
            { name: 'assignments', type: 'String', refName: '' }
          ]
        }
      })
    );
    return res.ok || res.status === HTTP_BAD_REQUEST;
  } catch {
    return false;
  }
}

async function dpSet(dpeName: string, value: string): Promise<boolean> {
  try {
    const res = await fetch(DP_SET_URL, jsonPost({ dpeName, value }));
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Upsert a module's role DECLARATION (never touches `.assignments`).
 * Creates the type/DP on first use. Returns false when the backend is
 * unreachable or the caller lacks write rights — callers treat it as
 * best-effort (the admin page's "Discover" seeding covers those cases).
 */
export async function upsertModuleRoles(decl: AppModuleRoles): Promise<boolean> {
  if (!(await ensureType())) return false;
  const dp = appSecurityDp(decl.module);
  try {
    const created = await fetch(CREATE_DP_URL, jsonPost({ dpName: dp, dpType: APP_SECURITY_TYPE }));
    // 400 = already exists — fine.
    if (!created.ok && created.status !== HTTP_BAD_REQUEST) return false;
  } catch {
    return false;
  }
  const okModule = await dpSet(`${dp}.module`, decl.module);
  const okRoles = await dpSet(`${dp}.roles`, JSON.stringify({ title: decl.title, roles: decl.roles }));
  return okModule && okRoles;
}

/**
 * Fire-and-forget self-registration for a page module (call once at page
 * load). Best-effort: silently a no-op offline / without write rights.
 */
export function registerModuleRoles(decl: AppModuleRoles): void {
  void upsertModuleRoles(decl).catch(() => false);
}

// --- role resolution ---------------------------------------------------------

let identityPromise: Promise<AppSecurityIdentity | null> | null = null;

/** Session identity, fetched once (null when the endpoint is unreachable). */
export function identity(): Promise<AppSecurityIdentity | null> {
  identityPromise ??= (async () => {
    try {
      const res = await fetch(APP_SECURITY_ME_URL);
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<AppSecurityIdentity> & { ok?: boolean };
      if (body.ok === false) return null;
      return {
        username: body.username ?? '',
        userId: typeof body.userId === 'number' ? body.userId : -1,
        admin: body.admin === true,
        groups: Array.isArray(body.groups) ? body.groups.map(String) : []
      };
    } catch {
      return null;
    }
  })();
  return identityPromise;
}

function resolveApi(): OaRxJsApi | null {
  try {
    return container.resolve<OaRxJsApi>(OaRxJsApi);
  } catch {
    return null;
  }
}

function parseAssignments(raw: unknown): AppRoleAssignments {
  const v = raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : raw;
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string' || s.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(s);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: AppRoleAssignments = {};
    for (const [role, groups] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(groups)) out[role] = groups.map(String);
    }
    return out;
  } catch {
    return {};
  }
}

const assignmentCache = new Map<string, Observable<AppRoleAssignments>>();

/** Live assignments of one module (empty object when unbound/offline). */
export function assignments$(module: string): Observable<AppRoleAssignments> {
  let cached = assignmentCache.get(module);
  if (cached) return cached;
  const api = resolveApi();
  if (api) {
    try {
      cached = api.dpConnect(`${appSecurityDp(module)}.assignments`, true).pipe(
        map((e: { value: unknown[] }) => parseAssignments(e.value?.[0])),
        catchError(() => of({})),
        startWith({}),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    } catch {
      cached = of({});
    }
  } else {
    cached = of({});
  }
  assignmentCache.set(module, cached);
  return cached;
}

/** Apply the resolution rules for one role. */
export function roleGranted(assign: AppRoleAssignments, roleId: string, who: AppSecurityIdentity | null): boolean {
  const groups = assign[roleId];
  if (!groups || groups.length === 0) return true; // open by default
  if (!who) return false; // assigned + unknown identity → fail closed
  if (who.admin) return true;
  return groups.some((g) => who.groups.includes(g));
}

/**
 * Live grant flag for one role of one module — subscribe and gate the UI.
 * Emits immediately (open) and re-emits when the identity loads or an admin
 * changes the assignments.
 */
export function hasRole$(module: string, roleId: string): Observable<boolean> {
  return combineLatest([assignments$(module), from(identity()).pipe(startWith(null))]).pipe(
    map(([assign, who]) => roleGranted(assign, roleId, who))
  );
}
