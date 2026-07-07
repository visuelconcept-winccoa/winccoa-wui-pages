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
import { WuiUserService } from '@wincc-oa/wui-iam-data/user-service.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import {
  Observable,
  catchError,
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  from,
  map,
  of,
  shareReplay,
  startWith,
  switchMap
} from 'rxjs';
import { container } from 'tsyringe';
import { currentAuditUser } from './audit-trail.js';

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

/**
 * Ensure the `AppSecurity_Module` DP type exists (probe, then create via the
 * PARA REST API). False when `/api/para` is unreachable or the caller lacks
 * rights — the para backend module is a PREREQUISITE, like for every
 * DpJsonStore page.
 */
export async function ensureAppSecurityType(): Promise<boolean> {
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
  if (!(await ensureAppSecurityType())) return false;
  const dp = appSecurityDp(decl.module);
  // Probe existence over the datapoint connection first — POSTing dp/create on
  // an existing DP answers 400, which the browser logs as a console error even
  // though it is handled (noisy on every page load).
  if (!(await dpExists(dp))) {
    try {
      const created = await fetch(CREATE_DP_URL, jsonPost({ dpName: dp, dpType: APP_SECURITY_TYPE }));
      // 400 = already exists (raced with another client) — fine.
      if (!created.ok && created.status !== HTTP_BAD_REQUEST) return false;
    } catch {
      return false;
    }
  }
  const okModule = await dpSet(`${dp}.module`, decl.module);
  const okRoles = await dpSet(`${dp}.roles`, JSON.stringify({ title: decl.title, roles: decl.roles }));
  return okModule && okRoles;
}

/**
 * Whether the module's app-security DP already exists. Probed with `dpNames`
 * (returns an empty list for a missing DP) — NEVER with dpGet/dpConnect on the
 * name: the webserver's CTRL handler throws "Invalid argument"
 * (dpConnectUserData) for non-existent DPEs, and that error surfaces as an
 * uncaught exception in the websocket layer, outside any catchError.
 */
async function dpExists(dp: string): Promise<boolean> {
  const api = resolveApi();
  if (!api) return false;
  try {
    const names = (await firstValueFrom(api.dpNames(dp, APP_SECURITY_TYPE))) as string[];
    return Array.isArray(names) && names.length > 0;
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget self-registration for a page module (call once at page
 * load). Best-effort: silently a no-op offline / without write rights.
 */
export function registerModuleRoles(decl: AppModuleRoles): void {
  void upsertModuleRoles(decl).catch(() => false);
}

// --- role resolution ---------------------------------------------------------

async function identityViaMe(): Promise<AppSecurityIdentity | null> {
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
}

/** Unwrap a (possibly `{value}`-wrapped) dpGet result into a plain array. */
function toArr(raw: unknown): unknown[] {
  const v = raw && typeof raw === 'object' && 'value' in (raw as object) ? (raw as { value: unknown }).value : raw;
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}

/**
 * Client-side identity fallback: the session user the SHELL already knows
 * (WuiUserService, via the kit audit helper) + their groups resolved from the
 * `_Users`/`_Groups` system DPs over the page's own datapoint connection.
 * Used when `/me` is unreachable or answers anonymously (the webserver's HTTP
 * layer has no session when server-side auth is disabled). UI-gating quality:
 * server-side enforcement keeps its own resolution.
 */
async function identityViaDp(): Promise<AppSecurityIdentity | null> {
  const api = resolveApi();
  const user = await currentAuditUser();
  // Guard against the helper's `{name:'', id:0}` fallback — id 0 is OA root,
  // never grant that implicitly without a real user name.
  if (!api || user.name === '') return null;
  try {
    const res = toArr(await firstValueFrom(api.dpGet(['_Users.UserName', '_Users.UserId', '_Users.GroupIds', '_Groups.UserName', '_Groups.UserId'])));
    const names = toArr(res[0]).map(String);
    const ids = toArr(res[1]).map(Number);
    const groupIdsPerUser = toArr(res[2]);
    const gNames = toArr(res[3]).map(String);
    const gIds = toArr(res[4]).map(Number);
    const groupById = new Map<number, string>();
    for (const [i, name] of gNames.entries()) groupById.set(Number.isFinite(gIds[i]) ? gIds[i] : i, name);
    const idx = names.indexOf(user.name);
    if (idx === -1) return null;
    const groups = String(groupIdsPerUser[idx] ?? '')
      .split(/[;,]/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n))
      .map((id) => groupById.get(id) ?? String(id));
    const userId = Number.isFinite(ids[idx]) ? ids[idx] : user.id;
    return { username: user.name, userId, admin: userId === 0, groups };
  } catch {
    return null;
  }
}

function resolveUserService(): WuiUserService | null {
  try {
    return container.resolve(WuiUserService);
  } catch {
    return null;
  }
}

/** Cache key tied to the SHELL's session user — a login/logout invalidates it. */
function shellUserKey(): string {
  const svc = resolveUserService();
  return `${svc?.id ?? ''}|${svc?.name ?? ''}`;
}

let identityCache: { key: string; value: Promise<AppSecurityIdentity | null> } | null = null;

/**
 * Session identity: the app-security backend first (`/me`, server-side view),
 * then the client-side `_Users`/`_Groups` fallback when the endpoint is
 * unreachable or sees the request as anonymous. Cached PER SHELL USER — the
 * SPA is not reloaded on logout/login, so a plain module-level cache would
 * keep showing the previous user (prefer {@link identity$} in UIs).
 */
export function identity(): Promise<AppSecurityIdentity | null> {
  const key = shellUserKey();
  if (!identityCache || identityCache.key !== key) {
    identityCache = {
      key,
      value: (async () => {
        const viaMe = await identityViaMe();
        if (viaMe && viaMe.username !== '') return viaMe;
        return (await identityViaDp()) ?? viaMe;
      })()
    };
  }
  return identityCache.value;
}

/**
 * Reactive identity: re-resolves whenever the shell session user changes
 * (login, logout, late user-settings load) — so a banner or a role gate never
 * sticks to the previous user or to the "not loaded yet" state.
 */
export function identity$(): Observable<AppSecurityIdentity | null> {
  const svc = resolveUserService();
  const trigger: Observable<unknown> = svc ? svc.user$.pipe(startWith(null)) : of(null);
  return trigger.pipe(
    switchMap(() => from(identity())),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  );
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

/**
 * Live assignments of one module (empty object when unbound/offline).
 *
 * The DP's existence is probed FIRST (dpNames — errorless): a dpConnect on a
 * not-yet-created `AppSecurity_<module>` DP makes the webserver's CTRL handler
 * throw "Invalid argument in function … dpConnectUserData", which surfaces as
 * an UNCAUGHT websocket-layer exception no catchError can intercept. A module
 * whose DP appears later (first Discover) goes live after a page reload —
 * fine, since an absent DP means every role is open anyway.
 */
export function assignments$(module: string): Observable<AppRoleAssignments> {
  let cached = assignmentCache.get(module);
  if (cached) return cached;
  const api = resolveApi();
  cached = api
    ? from(dpExists(appSecurityDp(module))).pipe(
        switchMap((exists) => {
          if (!exists) return of({});
          try {
            return api.dpConnect(`${appSecurityDp(module)}.assignments`, true).pipe(
              map((e: { value: unknown[] }) => parseAssignments(e.value?.[0])),
              catchError(() => of({}))
            );
          } catch {
            return of({});
          }
        }),
        startWith({}),
        shareReplay({ bufferSize: 1, refCount: false })
      )
    : of({});
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
 * Emits immediately (open) and re-emits when the identity loads, when the
 * SHELL session user changes (login/logout — the SPA is not reloaded), or
 * when an admin changes the assignments.
 */
export function hasRole$(module: string, roleId: string): Observable<boolean> {
  return combineLatest([assignments$(module), identity$().pipe(startWith(null))]).pipe(
    map(([assign, who]) => roleGranted(assign, roleId, who)),
    distinctUntilChanged()
  );
}
