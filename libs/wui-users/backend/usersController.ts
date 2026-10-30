// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// UsersController
// -----------------------------------------------------------------------------
// HTTP -> MSA vRPC bridge of the Users page: forwards every request to the
// "WuiUsers" service of the usersService JS manager, which reads and writes the
// WinCC OA user administration through the vendor's UserManagement classes
// (never a dpSet on _Users here) and runs the Active Directory import.
//
// This file decides nothing about users: the roles are checked by the route
// (requireRole), the payloads are validated by the manager (logic.js). It adds
// the one thing only the webserver knows — WHO asks (the session user, from the
// webserver's own authentication, never from the body) — for the audit trail.
//
// winccoa-manager (the MSA `Vrpc` namespace) is supplied by the WinCC OA node
// bootstrap at runtime; loaded through a guarded require so only /api/users
// degrades (503) when it is unavailable. The stub is dropped on any failure so
// the bridge recovers by itself once the manager is (re)started.
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

import { identityOf } from './appSecurityGuard';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Vrpc: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Vrpc = require('winccoa-manager').Vrpc;
} catch (error) {
  console.warn('UsersController: winccoa-manager Vrpc unavailable:', (error as Error)?.message ?? error);
}

/** Must match the manager's `SERVICE_NAME`. */
const SERVICE_NAME = 'WuiUsers';
/** An AD enumeration can take minutes on a large directory. */
const AD_TIMEOUT_MS = 10 * 60 * 1000;

let stubPromise: Promise<any> | null = null;

function getStub(): Promise<any> {
  stubPromise ??= Vrpc.Stub.createAndInitialize(SERVICE_NAME, new Vrpc.StubOptions());
  return stubPromise as Promise<any>;
}

function errorText(error: unknown): string {
  const status = (error as { status?: { text?: string } })?.status;
  return status?.text ?? (error instanceof Error ? error.message : String(error));
}

type Reply = Record<string, unknown> & { ok?: boolean; error?: string; status?: number };

/** One call of the service; throws on a transport failure (the manager is not there). */
async function callService(method: string, request: object, timeoutMs?: number): Promise<Reply> {
  if (Vrpc == null) throw new Error('MSA vRPC unavailable (winccoa-manager)');
  try {
    const stub = await getStub();
    const ctx = new Vrpc.ClientContext();
    if (timeoutMs && 'timeout' in ctx) ctx.timeout = timeoutMs;
    const response = await stub.callFunction(method, Vrpc.Variant.createString(JSON.stringify(request)), ctx);
    if (response.status.statusCode !== Vrpc.StatusCode.OK) throw new Error(`${SERVICE_NAME}.${method}: ${String(response.status.text ?? response.status)}`);
    return JSON.parse(String(response.response.value ?? '{}')) as Reply;
  } catch (error) {
    stubPromise = null;
    throw new Error(errorText(error));
  }
}

/** Who asks — for the audit trail. */
async function actorOf(req: Request): Promise<{ username: string; userId: number; host: string }> {
  const who = await identityOf(req).catch(() => ({ username: '', userId: -1 }));
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return { username: who.username, userId: who.userId, host: (first ?? req.ip ?? '').trim() };
}

/**
 * Send the service's answer: 200 when ok, its own `status` (400 validation, 404)
 * or 409 when it refused (the user administration said no: name taken, no
 * permission, password policy…), 502 when the manager could not be reached.
 */
async function forward(res: Response, run: () => Promise<Reply>): Promise<void> {
  try {
    const reply = await run();
    if (reply.ok === false) {
      const { status, ...rest } = reply;
      res.status(typeof status === 'number' ? status : 409).json(rest);
      return;
    }
    res.status(200).json(reply);
  } catch (error) {
    res.status(502).json({ ok: false, error: `${SERVICE_NAME} manager unreachable: ${errorText(error)}` });
  }
}

/** Writes routed to `Write { op }`: URL → operation of the manager. */
export const WRITE_OPS: Record<string, string> = {
  '/users/create': 'userCreate',
  '/users/update': 'userUpdate',
  '/users/password': 'userPassword',
  '/users/delete': 'userDelete',
  '/groups/create': 'groupCreate',
  '/groups/update': 'groupUpdate',
  '/groups/delete': 'groupDelete',
  '/permissions/names': 'permissionNames',
  '/areas/create': 'areaCreate',
  '/areas/update': 'areaUpdate',
  '/areas/delete': 'areaDelete',
  '/auth/mode': 'authMode'
};

export class UsersController {
  /** GET /health — always 200: `ok` says whether the manager answers and may write. */
  public health = async (_req: Request, res: Response): Promise<void> => {
    try {
      const reply = await callService('Health', {});
      res.status(200).json({ ...reply, vrpc: true, serviceAvailable: true });
    } catch (error) {
      res.status(200).json({ ok: false, vrpc: Vrpc != null, serviceAvailable: false, service: SERVICE_NAME, error: errorText(error) });
    }
  };

  /** GET /state — users, groups, domains, permission names, authentication method. */
  public state = async (_req: Request, res: Response): Promise<void> => {
    await forward(res, () => callService('Snapshot', {}));
  };

  /** POST /<entity>/<action> — one write, by the operation of its route. */
  public write = (op: string) => async (req: Request, res: Response): Promise<void> => {
    const actor = await actorOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    await forward(res, () => callService('Write', { op, body, actor, reason }));
  };

  /** GET /ad/groups?cached=1 — the AD groups, `imported` when already in WinCC OA. */
  public adGroups = async (req: Request, res: Response): Promise<void> => {
    await forward(res, () => callService('AdGroups', { fresh: req.query?.cached !== '1' }, AD_TIMEOUT_MS));
  };

  /** GET /ad/users?cached=1 — the AD users, `imported` when already in WinCC OA. */
  public adUsers = async (req: Request, res: Response): Promise<void> => {
    await forward(res, () => callService('AdUsers', { fresh: req.query?.cached !== '1' }, AD_TIMEOUT_MS));
  };

  public adImportGroups = async (req: Request, res: Response): Promise<void> => {
    const actor = await actorOf(req);
    await forward(res, () => callService('AdImportGroups', { body: req.body ?? {}, actor }, AD_TIMEOUT_MS));
  };

  public adImportUsers = async (req: Request, res: Response): Promise<void> => {
    const actor = await actorOf(req);
    await forward(res, () => callService('AdImportUsers', { body: req.body ?? {}, actor }, AD_TIMEOUT_MS));
  };

  /** GET /import — the automatic import's settings and last report. */
  public importState = async (_req: Request, res: Response): Promise<void> => {
    await forward(res, () => callService('GetImport', {}));
  };

  public importSettings = async (req: Request, res: Response): Promise<void> => {
    const actor = await actorOf(req);
    await forward(res, () => callService('SetImport', { body: req.body ?? {}, actor }));
  };

  /** POST /import/run — starts a cycle now; the page follows it on GET /import. */
  public importRun = async (req: Request, res: Response): Promise<void> => {
    const actor = await actorOf(req);
    await forward(res, () => callService('RunImport', { actor }));
  };

  /** GET /settings — config/config entries and user settings, read-only. */
  public settings = async (_req: Request, res: Response): Promise<void> => {
    await forward(res, async () => {
      const [project, user] = await Promise.all([callService('ProjectSettings', {}), callService('UserSettings', {})]);
      if (project.ok === false) return project;
      if (user.ok === false) return user;
      return { ok: true, config: project.config, userSettings: user.settings };
    });
  };
}
