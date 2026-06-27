// -----------------------------------------------------------------------------
// ProcessMonitorController
// -----------------------------------------------------------------------------
// HTTP -> MSA (Manager Service API) vRPC bridge for the "Process Monitor" page.
// Forwards to the "ProcessMonitor" service hosted by the processMonitor JS
// manager: list/control pmon managers, restart-all, and deploy an uploaded
// project ZIP (chunked upload assembled to a temp file, then handed to the
// manager which purges selected folders, extracts via 7-Zip, runs config.env
// and optionally restarts all). DPL import is intentionally NOT handled here.
//
// winccoa-manager (the MSA `Vrpc` namespace) is supplied by the WinCC OA node
// bootstrap at runtime; loaded via a guarded require so only /api/process-monitor
// degrades (503) if it is ever unavailable.
// -----------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as os from 'node:os';
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

/** In-flight chunked uploads: id -> temp ZIP path. */
const uploads = new Map<string, { tmpPath: string }>();

export class ProcessMonitorController {
  /** GET /health */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'process-monitor', vrpc: Vrpc != null });
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
    const tmpPath = path.join(os.tmpdir(), `process-monitor-${uploadId}.zip`);
    try {
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

  /** Invoke one vRPC method with a JSON payload and relay the JSON result. */
  private call = async (fn: string, payload: object, res: Response): Promise<void> => {
    if (!Vrpc) {
      res.status(503).json({ ok: false, error: 'MSA vRPC indisponible (winccoa-manager)' });
      return;
    }
    try {
      const stub = await getStub();
      const ctx = new Vrpc.ClientContext();
      const variant = Vrpc.Variant.createString(JSON.stringify(payload));
      const resp = await stub.callFunction(fn, variant, ctx);
      if (resp.status.statusCode !== Vrpc.StatusCode.OK) {
        res.status(502).json({ ok: false, error: String(resp.status.text ?? resp.status) });
        return;
      }
      res.status(200).json(JSON.parse(resp.response.value));
    } catch (error) {
      stubPromise = null; // stale stub (manager restarted) — reconnect next call
      const status = (error as { status?: { text?: string } })?.status;
      const msg = status?.text ?? (error instanceof Error ? error.message : String(error));
      res.status(502).json({ ok: false, error: msg });
    }
  };
}
