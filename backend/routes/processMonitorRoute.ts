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

    router.get('/health', controller.health);
    router.get('/managers', controller.managers);
    router.post('/manager', controller.manager);
    router.post('/restart', controller.restartAll);
    router.post('/upload/init', controller.uploadInit);
    router.post('/upload/chunk', controller.uploadChunk);
    router.post('/upload/finalize', controller.uploadFinalize);

    return router;
  }
}
