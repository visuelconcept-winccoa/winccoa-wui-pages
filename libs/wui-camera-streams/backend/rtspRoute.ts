// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// RtspRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the RTSP camera bridge (HTTP side), backed by
// RtspController. Mounted at "/api/rtsp" in CustomerRoutes. The live camera
// stream itself runs over the WebSocket relay registered on the raw uWebSockets
// app (see rtspRelay.ts / CustomerDashboardServer.defineRoutes).
// -----------------------------------------------------------------------------

import { Router } from 'ultimate-express';

import { requireRole } from './appSecurityGuard';
import { RtspController } from './rtspController';

/**
 * Route definitions for the RTSP camera bridge API.
 *
 * Endpoints (relative to the "/api/rtsp" mount point):
 *   GET /health   -> { ok, service, manager }
 *   GET /clients  -> { "<cameraId>": <connectedClients>, ... }
 *   GET /status   -> { "<cameraId>": { reachable, checkedAt, detail }, ... }
 *   GET /snapshot/:id -> one JPEG frame of an RTSP camera (role camera-streams/view)
 *   (WebSocket /ws?id= -> MPEG-TS relay, registered separately on the uWS app)
 */
export class RtspRoute {
  static routes(): Router {
    const router = Router();
    const controller = new RtspController();

    router.get('/health', controller.health);
    router.get('/clients', controller.clients);
    router.get('/status', controller.status);
    router.get('/snapshot/:id', requireRole('camera-streams', 'view'), controller.snapshot);

    return router;
  }
}
