// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// ProcessMonitorRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the Process Monitor bridge, backed by
// ProcessMonitorController. Mounted at "/api/process-monitor" in CustomerRoutes.
// A generous JSON body limit is applied because the ZIP upload is sent as
// base64 chunks in the request body.
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { requireRole } from './appSecurityGuard';
import { ProcessMonitorController } from './processMonitorController';

/**
 * Route definitions for the Process Monitor API.
 *
 * Endpoints (relative to the "/api/process-monitor" mount point):
 *   GET  /health
 *   GET  /managers                        -> { ok, managers }
 *   POST /manager   { action, index }      -> { ok, action, index }
 *   POST /restart                          -> { ok }   (restart all)
 *   POST /upload/init     { fileName }     -> { ok, uploadId }
 *   POST /upload/chunk    { uploadId, data(base64) }
 *   POST /upload/finalize { uploadId, clearFolders[], restart } -> deploy result
 */
export class ProcessMonitorRoute {
  static routes(): Router {
    const router = Router();
    const controller = new ProcessMonitorController();

    router.use(json({ limit: '64mb' }));

    // Application Security: manager control and project deploy are role-gated
    // (open until the admin assigns groups — see appSecurityGuard).
    const MODULE_ID = 'process-monitor';
    router.get('/health', controller.health);
    router.get('/managers', controller.managers);
    router.post('/manager', requireRole(MODULE_ID, 'control'), controller.manager);
    router.post('/restart', requireRole(MODULE_ID, 'control'), controller.restartAll);
    router.post('/upload/init', requireRole(MODULE_ID, 'deploy'), controller.uploadInit);
    router.post('/upload/chunk', requireRole(MODULE_ID, 'deploy'), controller.uploadChunk);
    router.post('/upload/finalize', requireRole(MODULE_ID, 'deploy'), controller.uploadFinalize);

    return router;
  }
}
