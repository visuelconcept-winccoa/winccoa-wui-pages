// -----------------------------------------------------------------------------
// VncController
// -----------------------------------------------------------------------------
// HTTP/health side of the Remote VNC bridge, plus the MSA vRPC resolver used by
// the WebSocket relay (vncRelay.ts).
//
// The browser's noVNC client opens a WebSocket to /api/vnc/ws?id=<id>. The relay
// must turn that id into a target host:port WITHOUT trusting the browser, so it
// asks the "VncProxy" MSA service (the vncProxy JS manager) to resolve the id
// against the RemoteVnc_<id> datapoint registry. This keeps the allow-list
// server-side (no open proxy).
//
// winccoa-manager (the MSA `Vrpc` namespace) is supplied by the WinCC OA node
// bootstrap at runtime; loaded via a guarded require so only /api/vnc degrades
// if it is ever unavailable.
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

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

/**
 * Controller for the Remote VNC HTTP endpoints. Only `/health` is HTTP; the
 * actual session runs over the WebSocket relay (see vncRelay.ts).
 */
export class VncController {
  /** GET /api/vnc/health -> liveness + whether the MSA client is available. */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'vnc', vrpc: Vrpc != null });
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
}
