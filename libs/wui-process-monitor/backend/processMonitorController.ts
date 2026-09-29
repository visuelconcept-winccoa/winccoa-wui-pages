// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// ProcessMonitorController
// -----------------------------------------------------------------------------
// HTTP -> MSA (Manager Service API) vRPC bridge for the "Process Monitor" page.
// Forwards to the "ProcessMonitor" service hosted by the processMonitor JS
// manager: list/control pmon managers, add/remove pmon configuration entries,
// restart-all, and deploy an uploaded project ZIP (chunked upload assembled to
// a temp file, then handed to the manager which purges selected folders,
// extracts via 7-Zip, runs config.env and optionally restarts all). DPL import
// is intentionally NOT handled here.
//
// winccoa-manager (the MSA `Vrpc` namespace) is supplied by the WinCC OA node
// bootstrap at runtime; loaded via a guarded require so only /api/process-monitor
// degrades (503) if it is ever unavailable.
//
// The service lives in ANOTHER process, so its availability is a first-class
// concern here: after a deploy that only restarts the webserver, the manager keeps
// running its previous code and every call fails with 502 "Service is not
// available" while pmon still shows it alive. GET /health probes exactly that, and
// the cached stub is invalidated on any failure so the bridge recovers by itself
// once the manager is restarted.
// -----------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Request, Response } from 'ultimate-express';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Vrpc: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Vrpc = require('winccoa-manager').Vrpc;
} catch (error) {
  console.warn('ProcessMonitorController: winccoa-manager Vrpc unavailable:', (error as Error)?.message ?? error);
}

const SERVICE_NAME = 'ProcessMonitor';

/** Cached vRPC stub to the ProcessMonitor service (recreated on error). */
let stubPromise: Promise<any> | null = null;
function getStub(): Promise<any> {
  if (!stubPromise) {
    stubPromise = Vrpc.Stub.createAndInitialize(SERVICE_NAME, new Vrpc.StubOptions());
  }
  return stubPromise as Promise<any>;
}

/**
 * Drop the cached stub so the NEXT call reconnects.
 *
 * A stub is bound to one service instance: once the hosting manager is gone —
 * stopped, or restarted with a different service contract — that stub never
 * recovers, and keeping it would make every later call fail until the webserver
 * itself is restarted. Invalidating on ANY failure lets the bridge heal on its
 * own as soon as the manager is back.
 */
function dropStub(): void {
  stubPromise = null;
}

/** The outcome of one vRPC invocation: the service's parsed reply, or why it failed. */
type Outcome = { ok: true; data: unknown } | { ok: false; error: string };

/** Human-readable reason from an MSA error (its status text) or a plain error. */
function errorText(error: unknown): string {
  const status = (error as { status?: { text?: string } })?.status;
  return status?.text ?? (error instanceof Error ? error.message : String(error));
}

/** In-flight chunked uploads: id -> temp ZIP path. */
const uploads = new Map<string, { tmpPath: string }>();

/**
 * Resolve `<project>/temp` (created on demand) for assembling uploaded ZIPs.
 *
 * We deliberately avoid `os.tmpdir()`: WinCC OA may run under a service account
 * (e.g. a GMSA) that has no user profile, so the OS user-temp path is missing or
 * unwritable — while the service account always has write access to its own
 * project tree. The project root is the nearest ancestor of this deployed module
 * (`<project>/javascript/customer-webserver/…`) that contains `config/config`;
 * `PVSS_II` (the config-file path WinCC OA exports) is used as a fallback.
 */
function projectTempDir(): string {
  let root = '';
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'config', 'config'))) {
      root = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!root) {
    const cfg = process.env.PVSS_II;
    if (cfg && fs.existsSync(cfg)) root = path.dirname(path.dirname(cfg));
  }
  if (!root) throw new Error('impossible de localiser la racine du projet WinCC OA (config/config introuvable)');
  const tmp = path.join(root, 'temp');
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

export class ProcessMonitorController {
  /**
   * GET /health -> liveness AND reachability of the hosting manager.
   *
   * The presence of `winccoa-manager` alone says nothing useful: the module can
   * load fine while the processMonitor manager is stopped — or, after a deploy
   * where only the webserver was restarted, still running the PREVIOUS code under
   * a different service name. Both cases make every other endpoint answer 502
   * while pmon shows the manager alive, so health resolves the vRPC stub and
   * reports what it finds. `serviceAvailable: false` + `error` is the one-request
   * diagnosis for "the manager needs a restart".
   *
   * Always answers 200 (the endpoint answering IS the liveness signal); `ok`
   * carries the verdict on the bridge as a whole.
   */
  public health = async (_req: Request, res: Response): Promise<void> => {
    const probe = await this.probeService();
    res.status(200).json({
      ok: probe.available,
      service: 'process-monitor',
      vrpc: Vrpc != null,
      serviceName: SERVICE_NAME,
      serviceAvailable: probe.available,
      serviceStatus: probe.status,
      ...(probe.error ? { error: probe.error } : {})
    });
  };

  /** GET /managers -> { ok, managers } */
  public managers = async (_req: Request, res: Response): Promise<void> => {
    await this.call('ListManagers', {}, res);
  };

  /** POST /manager { action: start|stop|restart, index, node? } — node = target node DP */
  public manager = async (req: Request, res: Response): Promise<void> => {
    const { action, index, node, systemName } = (req.body ?? {}) as {
      action?: string;
      index?: number;
      node?: string;
      systemName?: string;
    };
    if (!['start', 'stop', 'restart'].includes(String(action)) || typeof index !== 'number') {
      res.status(400).json({ ok: false, error: 'action (start|stop|restart) + index (number) requis' });
      return;
    }
    await this.call('ControlManager', { action, index, node: node ?? systemName ?? '' }, res);
  };

  /** POST /manager/add { name, startMode?, options?, secKill?, restartCount?, resetMin?, index?, node? } */
  public managerAdd = async (req: Request, res: Response): Promise<void> => {
    const { name, startMode, options, secKill, restartCount, resetMin, index, node, systemName } = (req.body ?? {}) as {
      name?: string;
      startMode?: string;
      options?: string;
      secKill?: number;
      restartCount?: number;
      resetMin?: number;
      index?: number;
      node?: string;
      systemName?: string;
    };
    if (typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ ok: false, error: 'name (manager, sans .exe) requis' });
      return;
    }
    await this.call(
      'AddManager',
      {
        node: node ?? systemName ?? '',
        index: typeof index === 'number' ? index : -1,
        manager: { name, startMode, options, secKill, restartCount, resetMin }
      },
      res
    );
  };

  /** POST /manager/remove { index, node? } — index ≥ 1 (0 is pmon itself) */
  public managerRemove = async (req: Request, res: Response): Promise<void> => {
    const { index, node, systemName } = (req.body ?? {}) as { index?: number; node?: string; systemName?: string };
    if (typeof index !== 'number' || index < 1) {
      res.status(400).json({ ok: false, error: 'index (number ≥ 1) requis — 0 est pmon' });
      return;
    }
    await this.call('RemoveManager', { node: node ?? systemName ?? '', index }, res);
  };

  /** POST /restart { node? } -> restart all managers of one node (computer), or local */
  public restartAll = async (req: Request, res: Response): Promise<void> => {
    const { node, systemName } = (req.body ?? {}) as { node?: string; systemName?: string };
    await this.call('RestartAll', { node: node ?? systemName ?? '' }, res);
  };

  /** POST /upload/init { fileName } -> { ok, uploadId } */
  public uploadInit = (req: Request, res: Response): void => {
    const { fileName } = (req.body ?? {}) as { fileName?: string };
    if (!fileName || !/\.zip$/i.test(fileName)) {
      res.status(400).json({ ok: false, error: 'fileName .zip requis' });
      return;
    }
    const uploadId = crypto.randomUUID();
    try {
      const tmpPath = path.join(projectTempDir(), `process-monitor-${uploadId}.zip`);
      fs.writeFileSync(tmpPath, Buffer.alloc(0)); // truncate/create
      uploads.set(uploadId, { tmpPath });
      res.status(200).json({ ok: true, uploadId });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  };

  /** POST /upload/chunk { uploadId, data(base64) } -> appends the chunk */
  public uploadChunk = (req: Request, res: Response): void => {
    const { uploadId, data } = (req.body ?? {}) as { uploadId?: string; data?: string };
    const up = uploadId ? uploads.get(uploadId) : undefined;
    if (!up) {
      res.status(404).json({ ok: false, error: 'uploadId inconnu' });
      return;
    }
    if (typeof data !== 'string') {
      res.status(400).json({ ok: false, error: 'data (base64) requis' });
      return;
    }
    try {
      fs.appendFileSync(up.tmpPath, Buffer.from(data, 'base64'));
      res.status(200).json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  };

  /** POST /upload/finalize { uploadId, clearFolders[], restart, target? } -> deploy result */
  public uploadFinalize = async (req: Request, res: Response): Promise<void> => {
    const { uploadId, clearFolders, restart, target } = (req.body ?? {}) as {
      uploadId?: string;
      clearFolders?: string[];
      restart?: boolean;
      target?: string;
    };
    if (!uploadId) {
      res.status(400).json({ ok: false, error: 'uploadId requis' });
      return;
    }
    const up = uploads.get(uploadId);
    if (!up) {
      res.status(404).json({ ok: false, error: 'uploadId inconnu' });
      return;
    }
    uploads.delete(uploadId);
    const payload = {
      zipPath: up.tmpPath,
      clearFolders: Array.isArray(clearFolders) ? clearFolders : [],
      restart: restart === true,
      target: target || 'all'
    };
    try {
      await this.call('Deploy', payload, res);
    } finally {
      fs.promises.rm(up.tmpPath, { force: true }).catch(() => undefined);
    }
  };

  /**
   * Resolve the vRPC stub and read the hosting service's status — no service
   * method is called, so this stays cheap and side-effect free.
   */
  private probeService = async (): Promise<{ available: boolean; status: string; error?: string }> => {
    if (!Vrpc) return { available: false, status: 'NoVrpc', error: 'MSA vRPC indisponible (winccoa-manager)' };
    try {
      // Rejects when the service cannot be reached at all (manager stopped, or
      // hosting a service under another name) — that is the case we are after.
      const stub = await getStub();
      const status: unknown = stub.serviceStatus;
      const ready: unknown = Vrpc.ServiceStatus?.Ready;
      // The stub's handshake succeeded; `serviceStatus` refines it (a service can
      // go down afterwards). Without that enum, the handshake stays the verdict.
      if (typeof status !== 'number' || typeof ready !== 'number') return { available: true, status: 'Ready' };
      const name = String(Vrpc.ServiceStatus[status] ?? status);
      if (status === ready) return { available: true, status: name };
      return { available: false, status: name, error: `service "${SERVICE_NAME}" ${name}` };
    } catch (error) {
      dropStub();
      return { available: false, status: 'Unavailable', error: errorText(error) };
    }
  };

  /** Invoke one vRPC method with a JSON payload and relay the JSON result. */
  private call = async (fn: string, payload: object, res: Response): Promise<void> => {
    if (!Vrpc) {
      res.status(503).json({ ok: false, error: 'MSA vRPC indisponible (winccoa-manager)' });
      return;
    }
    const outcome = await this.invoke(fn, payload);
    if (!outcome.ok) {
      res.status(502).json({ ok: false, error: outcome.error });
      return;
    }
    res.status(200).json(outcome.data);
  };

  /**
   * One vRPC round-trip. Every failure path invalidates the cached stub (see
   * `dropStub`) — the current MSA client signals a bad call by THROWING an
   * `MsaError`, but it also carries a status on the response, so both are
   * handled: a bridge that stays broken after the manager comes back is worse
   * than one reconnect too many.
   */
  private invoke = async (fn: string, payload: object): Promise<Outcome> => {
    try {
      const stub = await getStub();
      const ctx = new Vrpc.ClientContext();
      const variant = Vrpc.Variant.createString(JSON.stringify(payload));
      const resp = await stub.callFunction(fn, variant, ctx);
      if (resp.status.statusCode !== Vrpc.StatusCode.OK) {
        dropStub();
        return { ok: false, error: String(resp.status.text ?? resp.status) };
      }
      return { ok: true, data: JSON.parse(resp.response.value) };
    } catch (error) {
      dropStub();
      return { ok: false, error: errorText(error) };
    }
  };
}
