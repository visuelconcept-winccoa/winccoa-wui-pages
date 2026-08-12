// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// AlarmsRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the Alarms page, backed by AlarmsController.
// Mounted at "/api/alarms".
//
// Endpoints (relative to the mount point):
//   GET  /health
//   POST /ack     body { dpes: [...] }  -> { ok, ackUser, attributed, count }
//
// `/ack` writes with the WEBSERVER's rights (impersonating the session user), so
// unlike the shared `/api/para/dp/set` persistence endpoint it is role-gated
// server-side: the same `acknowledge` role the page uses to show the affordance
// is enforced here, where a crafted request cannot get around it.
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { AlarmsController } from './alarmsController';
import { requireRole } from './appSecurityGuard';

export class AlarmsRoute {
  static routes(): Router {
    const router = Router();
    const controller = new AlarmsController();

    router.use(json({ limit: '1mb' }));

    router.get('/health', controller.health);
    router.post('/ack', requireRole('alarms', 'acknowledge'), controller.ack);

    return router;
  }
}
