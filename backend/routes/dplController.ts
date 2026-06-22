// -----------------------------------------------------------------------------
// DplController
// -----------------------------------------------------------------------------
// HTTP -> MSA (Manager Service API) vRPC bridge for DPL (WinCC OA ASCII) export
// and import, backed by the "DplAscii" JS manager.
//
// Like AiController, the browser/WebUI cannot speak vRPC, so this webserver acts
// as the vRPC stub client: it forwards the request to the "DplAscii" service,
// which drives WCCOAasciiSQLite in the project context and returns the .dpl
// content (export) or the import result.
//
// winccoa-manager (the MSA `Vrpc` namespace) is supplied by the WinCC OA node
// bootstrap at runtime; it is loaded via a guarded require so that, if absent,
// only the /api/para/dpl/* routes degrade (503).
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Vrpc: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Vrpc = require('winccoa-manager').Vrpc;
} catch (error) {
  // MSA unavailable — /api/para/dpl/* will report 503.
  console.warn('DplController: winccoa-manager Vrpc unavailable:', (error as Error)?.message ?? error);
}

const DPL_SERVICE_NAME = 'DplAscii';

/** Cached vRPC stub to the DplAscii service (recreated on error). */
let dplStubPromise: Promise<any> | null = null;

function getStub(): Promise<any> {
  if (!dplStubPromise) {
    dplStubPromise = Vrpc.Stub.createAndInitialize(DPL_SERVICE_NAME, new Vrpc.StubOptions());
  }
  return dplStubPromise as Promise<any>;
}

/**
 * Controller bridging HTTP requests to the DplAscii MSA vRPC service.
 * Handlers are arrow functions so they keep their binding when passed to the router.
 */
export class DplController {
  /** GET /api/para/dpl/health -> liveness + whether the MSA client is available. */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'dpl', vrpc: Vrpc != null });
  };

  /** POST /api/para/dpl/export  body { dps?: string[], dpts?: string[], filter?: string }. */
  public export = (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { dps?: string[]; dpts?: string[]; filter?: string };
    const dps = Array.isArray(body.dps) ? body.dps : [];
    const dpts = Array.isArray(body.dpts) ? body.dpts : [];
    if (dps.length === 0 && dpts.length === 0) {
      res.status(400).json({ ok: false, error: 'Fournir au moins un dp ou dpt à exporter' });
      return Promise.resolve();
    }
    const filter = typeof body.filter === 'string' ? body.filter : undefined;
    return this.call('Export', { dps, dpts, filter }, res);
  };

  /** POST /api/para/dpl/import  body { fileName, contentBase64 }. */
  public import = (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { fileName?: string; contentBase64?: string };
    if (!body.contentBase64) {
      res.status(400).json({ ok: false, error: 'contentBase64 requis' });
      return Promise.resolve();
    }
    return this.call('Import', { fileName: body.fileName ?? 'import.dpl', contentBase64: body.contentBase64 }, res);
  };

  /** Forward a JSON payload to a DplAscii service function and relay its JSON result. */
  private async call(fn: string, payload: object, res: Response): Promise<void> {
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
      const result = JSON.parse(resp.response.value) as { ok?: boolean };
      res.status(result.ok === false ? 400 : 200).json(result);
    } catch (error) {
      // A stale stub (service restarted) — drop the cache so the next call reconnects.
      dplStubPromise = null;
      const status = (error as { status?: { text?: string } })?.status;
      const msg = status?.text ?? (error instanceof Error ? error.message : String(error));
      res.status(502).json({ ok: false, error: msg });
    }
  }
}
