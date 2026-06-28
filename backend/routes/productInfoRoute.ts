// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// ProductInfoRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the Product Information bridge, backed by
// ProductInfoController. Mounted at "/api/product-info" in CustomerRoutes.
// A JSON body parser is applied so the POST handler can read req.body.
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { ProductInfoController } from './productInfoController';

/**
 * Route definitions for the Product Information bridge API.
 *
 * Endpoints (relative to the "/api/product-info" mount point):
 *   GET  /health
 *   POST /lookup   body { productNumber, withDelivery? } -> { obsolescence, delivery, errors }
 */
export class ProductInfoRoute {
  static routes(): Router {
    const router = Router();
    const controller = new ProductInfoController();

    router.use(json({ limit: '1mb' }));

    router.get('/health', controller.health);
    router.post('/lookup', controller.lookup);

    return router;
  }
}
