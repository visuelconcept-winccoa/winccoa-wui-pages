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

let directoryCache: { at: number; value: Directory } | null = null;

async function directory(): Promise<Directory> {
  if (directoryCache && Date.now() - directoryCache.at < CACHE_MS) return directoryCache.value;
  const [userNames, userIds, groupIdsPerUser, groupNames, groupIds] = await dpGet([
    '_Users.UserName',
    '_Users.UserId',
    '_Users.GroupIds',
    '_Groups.GroupName',
    '_Groups.GroupId'
  ]);
  const gNames = asArray(groupNames).map(String);
  const gIds = asArray(groupIds).map(Number);
  const groupById = new Map<number, string>();
  for (const [i, id] of gIds.entries()) groupById.set(id, gNames[i] ?? String(id));

  const names = asArray(userNames).map(String);
  const ids = asArray(userIds).map(Number);
  const perUser = asArray(groupIdsPerUser);
  const value: Directory = { userIds: new Map(), userGroups: new Map(), groups: [] };
  for (const [id, name] of groupById) value.groups.push({ id, name });
  value.groups.sort((a, b) => a.name.localeCompare(b.name));
  for (const [i, name] of names.entries()) {
    value.userIds.set(name, ids[i] ?? -1);
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
