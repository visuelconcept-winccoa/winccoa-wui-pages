// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// MiddlewareScriptController
// -----------------------------------------------------------------------------
// HTTP -> MSA (Manager Service API) vRPC bridge for the Middleware-Script
// sandbox DRY-RUN tests, backed by the "MiddlewareScript" JS manager.
//
// Like DplController/AiController, the browser cannot speak vRPC, so this
// webserver acts as the vRPC stub client and forwards the test request to the
// manager, which executes the script in its worker sandbox WITHOUT writing any
// output datapoint and returns { ok, outputs, logs, durationMs, error? }.
//
// winccoa-manager (the MSA `Vrpc` namespace) is supplied by the WinCC OA node
// bootstrap at runtime; it is loaded via a guarded require so that, if absent,
// only /api/middleware-script/* degrades (503) — task editing on the page does
// not depend on this bridge.
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Vrpc: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Vrpc = require('winccoa-manager').Vrpc;
} catch (error) {
  // MSA unavailable — /api/middleware-script/* will report 503.
  console.warn('MiddlewareScriptController: winccoa-manager Vrpc unavailable:', (error as Error)?.message ?? error);
}

const SERVICE_NAME = 'MiddlewareScript';
const HTTP_UNAVAILABLE = 503;
const HTTP_BAD_REQUEST = 400;

/** Cached vRPC stub to the MiddlewareScript service (recreated on error). */
let stubPromise: Promise<any> | null = null;

function getStub(): Promise<any> {
  if (!stubPromise) {
    stubPromise = Vrpc.Stub.createAndInitialize(SERVICE_NAME, new Vrpc.StubOptions());
  }
  return stubPromise as Promise<any>;
}

/**
 * Controller bridging HTTP requests to the MiddlewareScript MSA vRPC service.
 * Handlers are arrow functions so they keep their binding when passed to the router.
 */
export class MiddlewareScriptController {
  /** GET /api/middleware-script/health -> liveness + whether the MSA client is available. */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'middleware-script', vrpc: Vrpc != null });
  };

  /** POST /api/middleware-script/test  body { task, inputValues? } -> sandbox dry-run result. */
  public test = (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { task?: unknown; inputValues?: unknown };
    if (body.task == null || typeof body.task !== 'object') {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: 'task requis' });
      return Promise.resolve();
    }
    return this.call('Test', { task: body.task, inputValues: body.inputValues ?? {} }, res);
  };

  /**
   * Forward a JSON payload to a MiddlewareScript service function and relay its
   * JSON result. A `ok:false` result is still HTTP 200: a failing SCRIPT is a
   * normal dry-run outcome the panel renders (error + logs) — only an
   * unreachable service maps to an HTTP error.
   */
  private async call(fn: string, payload: object, res: Response): Promise<void> {
    if (!Vrpc) {
      res.status(HTTP_UNAVAILABLE).json({ ok: false, error: 'MSA vRPC indisponible (winccoa-manager)' });
      return;
    }
    try {
      const stub = await getStub();
      const ctx = new Vrpc.ClientContext();
      const variant = Vrpc.Variant.createString(JSON.stringify(payload));
      const resp = await stub.callFunction(fn, variant, ctx);
      if (resp.status.statusCode !== Vrpc.StatusCode.OK) {
        res.status(HTTP_UNAVAILABLE).json({ ok: false, error: String(resp.status.text ?? resp.status) });
        return;
      }
      res.status(200).json(JSON.parse(resp.response.value));
    } catch (error) {
      // A stale stub (manager restarted) — drop the cache so the next call reconnects.
      stubPromise = null;
      const status = (error as { status?: { text?: string } })?.status;
      const msg = status?.text ?? (error instanceof Error ? error.message : String(error));
      res.status(HTTP_UNAVAILABLE).json({
        ok: false,
        error: `Service "${SERVICE_NAME}" injoignable — le manager middlewareScript est-il démarré ? (${msg})`
      });
    }
  }
}
