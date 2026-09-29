// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// VncRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the Remote VNC bridge (HTTP side), backed by
// VncController. Mounted at "/api/vnc" in CustomerRoutes. The live VNC session
// itself runs over the WebSocket relay registered on the raw uWebSockets app
// (see vncRelay.ts / CustomerDashboardServer.defineRoutes).
// -----------------------------------------------------------------------------

import { Router } from 'ultimate-express';

import { VncController } from './vncController';

/**
 * Route definitions for the Remote VNC bridge API.
 *
 * Endpoints (relative to the "/api/vnc" mount point):
 *   GET /health        -> { ok, service, vrpc }
 *   GET /resolve?id=   -> { ok, host, port, name }  (diagnostics)
 *   (WebSocket /ws?id= -> RFB relay, registered separately on the uWS app)
 */
export class VncRoute {
  static routes(): Router {
    const router = Router();
    const controller = new VncController();

    router.get('/health', controller.health);
    router.get('/resolve', controller.resolve);
    router.get('/status', controller.status);

    return router;
  }
}
