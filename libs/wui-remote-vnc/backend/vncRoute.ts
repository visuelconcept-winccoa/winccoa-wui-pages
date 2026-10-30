// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// VncRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the Remote VNC bridge (HTTP side), backed by
// VncController. Mounted at "/api/vnc" in CustomerRoutes. The live VNC session
// itself runs over the WebSocket relay registered on the raw uWebSockets app
// (see vncRelay.ts / CustomerDashboardServer.defineRoutes).
//
// Application Security (module `remote-vnc`, src/app-security.roles.json) is
// enforced HERE, not only in the page (vncGuard.ts): open until an admin
// assigns groups to a role.
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { VncController } from './vncController';
import { requireVncRole } from './vncGuard';

/**
 * Route definitions for the Remote VNC bridge API.
 *
 * Endpoints (relative to the "/api/vnc" mount point), with their role:
 *   GET    /health                    -> { ok, service, vrpc, relay }                    (open)
 *   GET    /status                    -> { <id>: { reachable, checkedAt, detail } }      view | connect
 *   GET    /connections               -> { ok, connections: [...] } (never a password)   view | connect
 *   GET    /connection/:id            -> { ok, connection } | 404                          connect
 *   POST   /connection                -> 201 { ok, connection }   (audited)              edit
 *   PUT    /connection/:id            -> { ok, connection }       (audited; no password field = keep it)  edit
 *   DELETE /connection/:id            -> { ok }                   (audited)              edit
 *   POST   /connection/:id/favorite   -> { ok, connection }   { favorite }               view
 *   POST   /session { id }            -> { ok, ticket, expiresInMs } | 404 | 503         connect
 *   GET    /resolve?id=               -> { ok, host, port, name }  (diagnostics)         connect
 *   (WebSocket /ws?id=&ticket=        -> RFB relay, registered separately on the uWS app;
 *                                        consumes the ticket and re-checks `connect`)
 */
export class VncRoute {
  static routes(): Router {
    const router = Router();
    const controller = new VncController();

    router.use(json({ limit: '1mb' }));

    router.get('/health', controller.health);
    router.get('/status', requireVncRole('view', 'connect'), controller.status);
    router.get('/connections', requireVncRole('view', 'connect'), controller.list);
    router.get('/connection/:id', requireVncRole('connect'), controller.get);
    router.post('/connection', requireVncRole('edit'), controller.create);
    router.put('/connection/:id', requireVncRole('edit'), controller.update);
    router.delete('/connection/:id', requireVncRole('edit'), controller.remove);
    // The star is a convenience every viewer may set (as in the page since 0.1).
    router.post('/connection/:id/favorite', requireVncRole('view'), controller.favorite);
    router.post('/session', requireVncRole('connect'), controller.session);
    router.get('/resolve', requireVncRole('connect'), controller.resolve);

    return router;
  }
}
