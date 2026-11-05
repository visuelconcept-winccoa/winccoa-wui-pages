// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// FleetRoute
// -----------------------------------------------------------------------------
// Sub-router of the Machine Fleet pages' writes, mounted at "/api/fleet" by the
// fleet-closures module (the other Fleet pages require it for that): each
// write is checked on the server against the role it needs (FleetController).
// The body limit is the PARA one's: a GLB model is written as a base64 string.
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { FleetController } from './fleetController';

/**
 * Endpoints (relative to "/api/fleet"):
 *   GET    /health
 *   POST   /dptype/create   body { typeName, structure }
 *   POST   /dp/create       body { dpName, dpType }
 *   POST   /dp/set          body { dpeName, value } | { dpeNames, values }
 *   DELETE /dp/:name        optional ?dpType= guard
 */
export class FleetRoute {
  static routes(): Router {
    const router = Router();
    const controller = new FleetController();

    router.use(json({ limit: '25mb' }));

    router.get('/health', controller.health);
    router.post('/dptype/create', controller.createDpType);
    router.post('/dp/create', controller.createDp);
    router.post('/dp/set', controller.setValue);
    router.delete('/dp/:name', controller.deleteDp);

    return router;
  }
}
