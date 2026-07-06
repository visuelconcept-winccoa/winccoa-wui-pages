// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Application Security — server-side role guard (self-contained).
// -----------------------------------------------------------------------------
// Shared by the app-security module AND copied into every backend module that
// protects routes (each page module stays self-contained — no cross-module
// import). Provides:
//
//   identityOf(req)              session user → { username, userId, admin, groups }
//   listGroups()                 OA group directory ({ id, name }[])
//   requireRole(module, role)    express middleware → 403 when the session user
//                                lacks the role (mirrors the client rules:
//                                unassigned role = open; assigned = group match
//                                or OA root; unknown identity = fail closed)
//
// Identity comes from the webserver's OWN authentication (passport session /
// basic auth) — never from client-sent data. Groups and role assignments are
// read from the `_Users` / `_Groups` system DPs and the `AppSecurity_<module>`
// DPs through the webserver's shared WinccoaManager (WsjServerGlobal), with a
// short cache. When `@winccoa/backend` is unavailable (isolated dev) the guard
// degrades OPEN for unassigned roles only.
// -----------------------------------------------------------------------------

import { NextFunction, Request, Response } from 'ultimate-express';

/* eslint-disable @typescript-eslint/no-explicit-any */
let winccoa: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  winccoa = require('@winccoa/backend').WsjServerGlobal?.winccoa ?? null;
} catch (error) {
  console.warn('appSecurityGuard: @winccoa/backend unavailable:', (error as Error)?.message ?? error);
}

const CACHE_MS = 5000;
const HTTP_FORBIDDEN = 403;

export interface AppSecurityIdentity {
  username: string;
  userId: number;
  admin: boolean;
  groups: string[];
}

/** Coerce a (possibly `{value}`-wrapped) dpGet result into a plain array. */
function asArray(raw: unknown): unknown[] {
  const v = raw && typeof raw === 'object' && 'value' in (raw as object) ? (raw as { value: unknown }).value : raw;
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}

async function dpGet(dpes: string[]): Promise<unknown[]> {
  if (!winccoa) return dpes.map(() => []);
  return (await winccoa.dpGet(dpes)) as unknown[];
}

// --- OA user / group directory (cached) --------------------------------------

interface Directory {
  /** username → OA user id. */
  userIds: Map<string, number>;
  /** username → group NAMES. */
  userGroups: Map<string, string[]>;
  /** every group, id → name. */
  groups: { id: number; name: string }[];
}

/**
 * Element names of the user directory, resolved ONCE by introspecting the
 * `_Users` DP TYPE (dpTypeGet) instead of hardcoding them.
 *
 * OA stores users AND groups as two DP INSTANCES of the same `_Users` type:
 * the `_Users` DP holds the users, the `_Groups` DP holds the groups — where
 * `UserName`/`UserId` then carry the GROUP names/ids. So one schema drives
 * both reads (there is no `_Groups` DP type).
 */
interface DirectorySchema {
  userName: string | null;
  userId: string | null;
  userGroupIds: string | null;
}

let schemaCache: DirectorySchema | null = null;

function pickElement(children: { name: string }[], candidates: string[]): string | null {
  for (const cand of candidates) {
    const hit = children.find((c) => c.name.toLowerCase() === cand);
    if (hit) return hit.name;
  }
  return null;
}

function directorySchema(): DirectorySchema {
  if (schemaCache) return schemaCache;
  let users: { name: string }[] = [];
  try {
    users = (winccoa?.dpTypeGet('_Users')?.children ?? []) as { name: string }[];
  } catch (error) {
    console.warn('appSecurityGuard: dpTypeGet(_Users) failed:', (error as Error)?.message ?? error);
  }
  // When introspection yields nothing (type unreadable), fall back to the
  // classic names and let the isolated per-element reads report what fails.
  const noUsers = users.length === 0;
  schemaCache = {
    userName: pickElement(users, ['username', 'name']) ?? (noUsers ? 'UserName' : null),
    userId: pickElement(users, ['userid', 'id']) ?? (noUsers ? 'UserId' : null),
    userGroupIds: pickElement(users, ['groupids', 'groups', 'groupid']) ?? (noUsers ? 'GroupIds' : null)
  };
  console.info(
    `appSecurityGuard: directory schema — _Users type(${users.map((c) => c.name).join(',') || '?'}) → ${JSON.stringify(schemaCache)}`
  );
  return schemaCache;
}

/** dpGet ONE element, isolated (a bad/unreadable element must not sink the rest). */
async function dpGetOne(dpe: string | null, base: string): Promise<unknown[]> {
  if (!dpe || !winccoa) return [];
  try {
    const [value] = (await winccoa.dpGet([`${base}.${dpe}`])) as unknown[];
    return asArray(value);
  } catch (error) {
    console.warn(`appSecurityGuard: dpGet(${base}.${dpe}) failed:`, (error as Error)?.message ?? error);
    return [];
  }
}

let directoryCache: { at: number; value: Directory } | null = null;

async function directory(): Promise<Directory> {
  if (directoryCache && Date.now() - directoryCache.at < CACHE_MS) return directoryCache.value;
  const schema = directorySchema();
  // `_Groups` is a DP INSTANCE of the `_Users` type: its UserName/UserId
  // elements carry the GROUP names/ids (confirmed on 3.21).
  const [userNames, userIds, groupIdsPerUser, groupNames, groupIds] = await Promise.all([
    dpGetOne(schema.userName, '_Users'),
    dpGetOne(schema.userId, '_Users'),
    dpGetOne(schema.userGroupIds, '_Users'),
    dpGetOne(schema.userName, '_Groups'),
    dpGetOne(schema.userId, '_Groups')
  ]);
  const gNames = userDirStrings(groupNames);
  const gIds = groupIds.map(Number);
  const groupById = new Map<number, string>();
  for (const [i, name] of gNames.entries()) {
    // Prefer the real GroupId; fall back to the array index (still lets the
    // picker list the groups even when the id element is absent/unreadable).
    const id = Number.isFinite(gIds[i]) ? gIds[i] : i;
    groupById.set(id, name);
  }

  const names = userDirStrings(userNames);
  const ids = userIds.map(Number);
  const perUser = groupIdsPerUser;
  const value: Directory = { userIds: new Map(), userGroups: new Map(), groups: [] };
  for (const [id, name] of groupById) value.groups.push({ id, name });
  value.groups.sort((a, b) => a.name.localeCompare(b.name));
  for (const [i, name] of names.entries()) {
    value.userIds.set(name, Number.isFinite(ids[i]) ? ids[i] : -1);
    // Each entry lists the user's group ids, semicolon- or comma-separated.
    const rawIds = String(perUser[i] ?? '')
      .split(/[;,]/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    value.userGroups.set(
      name,
      rawIds.map((id) => groupById.get(id) ?? String(id))
    );
  }
  directoryCache = { at: Date.now(), value };
  return value;
}

/** Non-empty strings of a raw element read. */
function userDirStrings(raw: unknown[]): string[] {
  return raw.map(String).filter((s) => s.trim() !== '');
}

/** Every OA user group (admin UI picker). */
export async function listGroups(): Promise<{ id: number; name: string }[]> {
  const dir = await directory();
  return dir.groups;
}

// --- session identity ---------------------------------------------------------

/** Username from the webserver's own authentication (passport/basic session). */
function sessionUsername(req: Request): string {
  const r = req as any;
  return String(
    r.user?.preferred_username ??
      r.user?.username ??
      r.user?.name ??
      r.session?.passport?.user?.preferred_username ??
      r.session?.passport?.user?.username ??
      r.session?.passport?.user?.name ??
      ''
  );
}

/** Resolve the session user's identity + OA groups (server-side only). */
export async function identityOf(req: Request): Promise<AppSecurityIdentity> {
  const username = sessionUsername(req);
  if (!username) return { username: '', userId: -1, admin: false, groups: [] };
  const dir = await directory();
  const userId = dir.userIds.get(username) ?? -1;
  return {
    username,
    userId,
    admin: userId === 0, // OA root
    groups: dir.userGroups.get(username) ?? []
  };
}

// --- role assignments + guard --------------------------------------------------

const assignmentsCache = new Map<string, { at: number; value: Record<string, string[]> }>();

function dpFragment(module: string): string {
  return module.replaceAll(/[^A-Za-z0-9_-]/g, '_');
}

/** Role → group names of one module (empty when the DP/element is absent). */
export async function roleAssignments(module: string): Promise<Record<string, string[]>> {
  const cached = assignmentsCache.get(module);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value: Record<string, string[]> = {};
  try {
    const [raw] = await dpGet([`AppSecurity_${dpFragment(module)}.assignments`]);
    const s = asArray(raw)[0];
    if (typeof s === 'string' && s.trim() !== '') {
      const parsed = JSON.parse(s) as Record<string, unknown>;
      for (const [role, groups] of Object.entries(parsed)) {
        if (Array.isArray(groups)) value[role] = groups.map(String);
      }
    }
  } catch {
    value = {};
  }
  assignmentsCache.set(module, { at: Date.now(), value });
  return value;
}

/** The client-side rules, applied server-side. */
export function roleGranted(assign: Record<string, string[]>, roleId: string, who: AppSecurityIdentity): boolean {
  const groups = assign[roleId];
  if (!groups || groups.length === 0) return true; // open by default
  if (who.admin) return true;
  if (!who.username) return false; // assigned + unknown identity → fail closed
  return groups.some((g) => who.groups.includes(g));
}

/**
 * Express middleware: reject the request (403) when the session user lacks
 * `role` of `module`. Usage:
 *   router.post('/upload/init', requireRole('process-monitor', 'deploy'), controller.uploadInit);
 */
export function requireRole(module: string, roleId: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [assign, who] = await Promise.all([roleAssignments(module), identityOf(req)]);
      if (roleGranted(assign, roleId, who)) {
        next();
        return;
      }
      res.status(HTTP_FORBIDDEN).json({ ok: false, error: `forbidden: role '${roleId}' of '${module}' required` });
    } catch (error) {
      // Guard failure must not take the API down — log and fail open.
      console.warn(`appSecurityGuard(${module}/${roleId}):`, (error as Error)?.message ?? error);
      next();
    }
  };
}
