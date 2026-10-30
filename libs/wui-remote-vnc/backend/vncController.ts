// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// VncController
// -----------------------------------------------------------------------------
// HTTP side of the Remote VNC bridge, plus the MSA vRPC resolver used by the
// WebSocket relay (vncRelay.ts).
//
// The browser's noVNC client opens a WebSocket to /api/vnc/ws?id=<id>&ticket=…
// The relay must turn that id into a target host:port WITHOUT trusting the
// browser, so it asks the "VncProxy" MSA service (the vncProxy JS manager) to
// resolve the id against the RemoteVnc_<id> datapoint registry. This keeps the
// allow-list server-side (no open proxy).
//
// Since 0.2 this controller also serves the connection list and its writes
// (vncStore.ts; never the password) and the one-shot session tickets the relay
// requires (vncTickets.ts). The routes carry their role (vncRoute.ts).
//
// winccoa-manager (the MSA `Vrpc` namespace) is supplied by the WinCC OA node
// bootstrap at runtime; loaded via a guarded require so only /api/vnc degrades
// if it is ever unavailable.
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

import { requestIdentity } from './vncGuard';
import {
  AuditActor,
  StoreError,
  createConnection,
  deleteConnection,
  getConnection,
  listConnections,
  publicConnection,
  setFavorite,
  updateConnection
} from './vncStore';
import { TICKET_TTL_MS, issueTicket } from './vncTickets';

// The MSA `Vrpc` namespace is supplied untyped at runtime, so the vRPC stub and
// its responses are `any` — the whole controller works against those values.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
let Vrpc: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Vrpc = require('winccoa-manager').Vrpc;
} catch (error) {
  console.warn('VncController: winccoa-manager Vrpc unavailable:', (error as Error)?.message ?? error);
}

const SERVICE_NAME = 'VncProxy';

/** Cached vRPC stub to the VncProxy service (recreated on error). */
let stubPromise: Promise<any> | null = null;

function getStub(): Promise<any> {
  if (!stubPromise) {
    stubPromise = Vrpc.Stub.createAndInitialize(SERVICE_NAME, new Vrpc.StubOptions());
  }
  return stubPromise as Promise<any>;
}

/** A resolved VNC target. */
export interface VncTarget {
  host: string;
  port: number;
  name: string;
}

let relayRegistered = false;

/** Called by registerVncRelay once `/api/vnc/ws` is mounted on the uWS app. */
export function markRelayRegistered(): void {
  relayRegistered = true;
}

/** True when the `/api/vnc/ws` relay is mounted (sessions can open). */
export function relayAvailable(): boolean {
  return relayRegistered;
}

/** True when the MSA vRPC client is available in this process. */
export function vrpcAvailable(): boolean {
  return Vrpc != null;
}

/**
 * Resolve a connection id to its target host:port via the VncProxy MSA service.
 * Throws when MSA is unavailable, the id is unknown, or the target is invalid.
 */
export async function resolveVncTarget(id: string): Promise<VncTarget> {
  if (!Vrpc) throw new Error('MSA vRPC indisponible (winccoa-manager)');
  try {
    const stub = await getStub();
    const ctx = new Vrpc.ClientContext();
    const resp = await stub.callFunction('Resolve', Vrpc.Variant.createString(id), ctx);
    if (resp.status.statusCode !== Vrpc.StatusCode.OK) {
      throw new Error(String(resp.status.text ?? 'resolve failed'));
    }
    const parsed = JSON.parse(resp.response.value) as Partial<VncTarget>;
    return {
      host: String(parsed.host ?? ''),
      port: Number(parsed.port),
      name: String(parsed.name ?? id)
    };
  } catch (error) {
    // A stale stub (service restarted) — drop the cache so the next call reconnects.
    stubPromise = null;
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Fetch the per-connection TCP reachability status from the VncProxy MSA service
 * (which runs the cyclic socket test). Returns `{}` on any error so the page
 * degrades gracefully (all indicators "unknown").
 */
export async function fetchVncStatus(): Promise<Record<string, unknown>> {
  if (!Vrpc) return {};
  try {
    const stub = await getStub();
    const ctx = new Vrpc.ClientContext();
    const resp = await stub.callFunction('Status', Vrpc.Variant.createString(''), ctx);
    if (resp.status.statusCode !== Vrpc.StatusCode.OK) return {};
    return JSON.parse(resp.response.value) as Record<string, unknown>;
  } catch {
    // A stale stub (service restarted) — drop the cache so the next call reconnects.
    stubPromise = null;
    return {};
  }
}

/** The connection id of a `/connection/:id` route (ultimate-express leaves it URL-encoded). */
function paramId(req: Request): string {
  const raw = String((req.params as Record<string, string> | undefined)?.['id'] ?? '');
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return '';
  }
}

function clientAddress(req: Request): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first ?? req.ip ?? '').trim();
}

/** The verified caller, for the audit trail ('' / -1 when not identified). */
async function actorOf(req: Request): Promise<AuditActor> {
  let username = '';
  let userId = -1;
  try {
    const who = await requestIdentity(req);
    username = who.username;
    userId = who.username ? who.userId : -1;
  } catch {
    // Identity unavailable: the row is written without a user, never dropped.
  }
  return { username, userId, host: clientAddress(req) };
}

function fail(res: Response, error: unknown): void {
  if (error instanceof StoreError) {
    res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.warn('[vnc] %s', message);
  res.status(500).json({ ok: false, error: 'failed', message });
}

/**
 * Controller for the Remote VNC HTTP endpoints. The session itself runs over
 * the WebSocket relay (see vncRelay.ts); the role of each route is set in
 * vncRoute.ts.
 */
export class VncController {
  /** GET /api/vnc/health -> liveness, MSA client, relay mounted. */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'vnc', vrpc: Vrpc != null, relay: relayRegistered });
  };

  /** GET /api/vnc/status -> { "<connId>": { reachable, checkedAt, detail }, ... }. */
  public status = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(await fetchVncStatus());
  };

  /** GET /api/vnc/resolve?id=... -> { ok, host, port, name } (diagnostics only). */
  public resolve = async (req: Request, res: Response): Promise<void> => {
    const id = String((req.query?.id as string) ?? '').trim();
    if (!id) {
      res.status(400).json({ ok: false, error: 'id requis' });
      return;
    }
    try {
      const target = await resolveVncTarget(id);
      // Do not leak the port scan surface broadly: this diagnostics route only
      // confirms resolvability + the (already user-owned) host:port.
      res.status(200).json({ ok: true, ...target });
    } catch (error) {
      res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  /** GET /api/vnc/connections -> { ok, connections: PublicConnection[] } (no password). */
  public list = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json({ ok: true, connections: (await listConnections()).map(publicConnection) });
    } catch (error) {
      fail(res, error);
    }
  };

  /** GET /api/vnc/connection/:id -> { ok, connection: PublicConnection } | 404. */
  public get = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = paramId(req);
      const conn = await getConnection(id);
      if (!conn) {
        res.status(404).json({ ok: false, error: 'not-found', message: `unknown connection: ${id}` });
        return;
      }
      res.status(200).json({ ok: true, connection: publicConnection(conn) });
    } catch (error) {
      fail(res, error);
    }
  };

  /** POST /api/vnc/connection { …connection, password? } -> 201 { ok, connection }. */
  public create = async (req: Request, res: Response): Promise<void> => {
    try {
      const created = await createConnection(req.body, await actorOf(req));
      res.status(201).json({ ok: true, connection: publicConnection(created) });
    } catch (error) {
      fail(res, error);
    }
  };

  /** PUT /api/vnc/connection/:id { …fields, password? } -> { ok, connection } (no password = keep it). */
  public update = async (req: Request, res: Response): Promise<void> => {
    try {
      const updated = await updateConnection(paramId(req), req.body, await actorOf(req));
      res.status(200).json({ ok: true, connection: publicConnection(updated) });
    } catch (error) {
      fail(res, error);
    }
  };

  /** DELETE /api/vnc/connection/:id -> { ok }. */
  public remove = async (req: Request, res: Response): Promise<void> => {
    try {
      await deleteConnection(paramId(req), await actorOf(req));
      res.status(200).json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  };

  /** POST /api/vnc/connection/:id/favorite { favorite } -> { ok, connection }. */
  public favorite = async (req: Request, res: Response): Promise<void> => {
    try {
      const favorite = Boolean((req.body as { favorite?: unknown } | undefined)?.favorite);
      const updated = await setFavorite(paramId(req), favorite, await actorOf(req));
      res.status(200).json({ ok: true, connection: publicConnection(updated) });
    } catch (error) {
      fail(res, error);
    }
  };

  /**
   * POST /api/vnc/session { id } -> { ok, ticket, expiresInMs }: a one-shot
   * ticket for `/api/vnc/ws?id=<id>&ticket=<ticket>` (the role was checked by
   * the route). 404 for an unknown connection, 503 when the relay is not mounted.
   */
  public session = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = String((req.body as { id?: unknown } | undefined)?.id ?? '').trim();
      if (!(await getConnection(id))) {
        res.status(404).json({ ok: false, error: 'not-found', message: `unknown connection: ${id}` });
        return;
      }
      if (!relayRegistered) {
        res.status(503).json({ ok: false, error: 'relay-unavailable', message: 'the /api/vnc/ws relay is not mounted' });
        return;
      }
      // The guard already let the caller through; an identity check that fails
      // here (it failed open there too) binds the ticket to nobody.
      const who = await actorOf(req);
      const ticket = issueTicket({ id, username: who.username, userId: who.userId });
      res.status(200).json({ ok: true, ticket, expiresInMs: TICKET_TTL_MS });
    } catch (error) {
      fail(res, error);
    }
  };
}
