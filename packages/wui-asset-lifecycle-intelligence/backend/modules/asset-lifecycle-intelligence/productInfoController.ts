// -----------------------------------------------------------------------------
// ProductInfoController
// -----------------------------------------------------------------------------
// HTTP -> MSA (Manager Service API) vRPC bridge for the Product Information
// feature (Siemens Product Information Hub: obsolescence + delivery by MLFB).
//
// The browser/WebUI cannot speak vRPC, so this webserver acts as the vRPC stub
// client: it forwards the lookup to the "ProductInfo" service hosted by the
// productInfo JS manager, which calls the Siemens API (the API key stays in the
// manager / its config datapoint — never in the browser).
//
// winccoa-manager (the MSA `Vrpc` namespace) is supplied by the WinCC OA node
// bootstrap at runtime; loaded via a guarded require so only /api/product-info
// degrades (503) if it is ever unavailable.
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Vrpc: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Vrpc = require('winccoa-manager').Vrpc;
} catch (error) {
  console.warn(
    'ProductInfoController: winccoa-manager Vrpc unavailable:',
    (error as Error)?.message ?? error
  );
}

const SERVICE_NAME = 'ProductInfo';

/** Cached vRPC stub to the ProductInfo service (recreated on error). */
let stubPromise: Promise<any> | null = null;

function getStub(): Promise<any> {
  if (!stubPromise) {
    stubPromise = Vrpc.Stub.createAndInitialize(SERVICE_NAME, new Vrpc.StubOptions());
  }
  return stubPromise as Promise<any>;
}

interface LookupBody {
  productNumber?: string;
  withDelivery?: boolean;
}

/**
 * Controller bridging HTTP requests to the ProductInfo MSA vRPC service.
 * Handlers are arrow functions so they keep their binding when passed to the router.
 */
export class ProductInfoController {
  /** GET /api/product-info/health -> liveness + whether the MSA client is available. */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'product-info', vrpc: Vrpc != null });
  };

  /** POST /api/product-info/lookup  body { productNumber, withDelivery? }
   *  -> { ok, obsolescence, delivery, errors }. */
  public lookup = async (req: Request, res: Response): Promise<void> => {
    if (!Vrpc) {
      res.status(503).json({ ok: false, error: 'MSA vRPC indisponible (winccoa-manager)' });
      return;
    }
    const { productNumber, withDelivery } = (req.body ?? {}) as LookupBody;
    if (!productNumber || typeof productNumber !== 'string') {
      res.status(400).json({ ok: false, error: 'productNumber (string, MLFB) requis' });
      return;
    }
    try {
      const stub = await getStub();
      const ctx = new Vrpc.ClientContext();
      const payload = Vrpc.Variant.createString(JSON.stringify({ productNumber, withDelivery }));
      const resp = await stub.callFunction('Lookup', payload, ctx);
      if (resp.status.statusCode !== Vrpc.StatusCode.OK) {
        res.status(502).json({ ok: false, error: String(resp.status.text ?? resp.status) });
        return;
      }
      res.status(200).json({ ok: true, ...JSON.parse(resp.response.value) });
    } catch (error) {
      // A stale stub (service restarted) — drop the cache so the next call reconnects.
      stubPromise = null;
      const status = (error as { status?: { text?: string } })?.status;
      const msg = status?.text ?? (error instanceof Error ? error.message : String(error));
      res.status(502).json({ ok: false, error: msg });
    }
  };
}
