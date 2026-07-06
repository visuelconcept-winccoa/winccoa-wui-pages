// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// AppSecurityRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the Application Security identity endpoints,
// backed by AppSecurityController. Mounted at "/api/app-security".
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { AppSecurityController } from './appSecurityController';

/**
 * Route definitions for the Application Security API.
 *
 * Endpoints (relative to the "/api/app-security" mount point):
 *   GET /health
 *   GET /me      -> { ok, username, userId, admin, groups[] }
 *   GET /groups  -> { ok, groups: [{ id, name }] }
 */
export class AppSecurityRoute {
  static routes(): Router {
    const router = Router();
    const controller = new AppSecurityController();

    router.use(json());

    router.get('/health', controller.health);
    router.get('/me', controller.me);
    router.get('/groups', controller.groups);

    return router;
  }
}
