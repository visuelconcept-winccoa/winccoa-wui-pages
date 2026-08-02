// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// EngRoute — sub-router for the Engineering Studio API, backed by EngController.
// Mounted at "/api/eng" in CustomerRoutes.
//
// Application Security — FAIL-CLOSED, unlike the shared para persistence API:
// the studio's check-in is a powerful, studio-scoped operation (create/update/
// DELETE types, datapoints and configs from a plan), so every WRITE route is
// gated with `requireRole('eng-studio', …)`. Reads are gated with 'view'.
// (Enforcement is only effective when the webserver's own HTTP authentication
// is enabled — see appSecurityGuard: without a session identity the guard
// currently fails OPEN with a warning. Enable webserver auth in production.)
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { requireRole } from './appSecurityGuard';
import { EngController } from './engController';

/**
 * Route definitions for the Engineering Studio API (relative to "/api/eng"):
 *   GET  /health
 *   GET  /live                         (view)         -> { snapshot }
 *   POST /test-read  { dpes }          (view)         -> { results }
 *   POST /checkin    { plan, dryRun }  (checkin)      -> ApplyReport
 *   POST /addressbook/ingest           (manage-devices) -> { book }
 *
 * The workspace/device/book read+write endpoints the HttpEngGateway also calls
 * are added here as the backend store is implemented (see engController TODOs).
 */
export class EngRoute {
  static routes(): Router {
    const router = Router();
    const controller = new EngController();

    router.use(json({ limit: '25mb' }));

    router.get('/health', controller.health);
    router.get('/live', requireRole('eng-studio', 'view'), controller.live);
    router.post('/test-read', requireRole('eng-studio', 'view'), controller.testRead);
    router.post('/checkin', requireRole('eng-studio', 'checkin'), controller.checkin);
    router.post('/addressbook/ingest', requireRole('eng-studio', 'manage-devices'), controller.ingestBook);

    return router;
  }
}
