// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// MiddlewareScriptRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the Middleware-Script sandbox-test bridge,
// backed by MiddlewareScriptController. Mounted at "/api/middleware-script" in
// CustomerRoutes.
//
// Task persistence does NOT go through here — the page stores its
// MiddlewareScript_Task DPs through the shared /api/para DP-JSON API (kit
// DpJsonStore), like every other page store. This module only bridges the
// dry-run tests to the middlewareScript manager.
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { requireRole } from './appSecurityGuard';
import { MiddlewareScriptController } from './middlewareScriptController';

/**
 * Route definitions for the Middleware-Script API.
 *
 * Endpoints (relative to the "/api/middleware-script" mount point):
 *   GET  /health
 *   POST /test    body { task, inputValues? } -> { ok, outputs, logs, durationMs, error? }
 *
 * /test is Application-Security gated (middleware-script.test): a dry-run
 * executes user-authored code on the manager, so it is a capability worth
 * restricting server-side, not just in the UI.
 */
export class MiddlewareScriptRoute {
  static routes(): Router {
    const router = Router();
    const controller = new MiddlewareScriptController();

    router.use(json({ limit: '2mb' }));

    router.get('/health', controller.health);
    router.post('/test', requireRole('middleware-script', 'test'), controller.test);

    return router;
  }
}
