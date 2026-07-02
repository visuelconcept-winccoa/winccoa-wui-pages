// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// PoseidonRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the Poseidon supervision API, backed by
// PoseidonController. Mounted at "/api/poseidon" in CustomerRoutes.
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { PoseidonController } from './poseidonController';

/**
 * Route definitions for the Poseidon API.
 *
 * Endpoints (relative to the "/api/poseidon" mount point):
 *   GET  /health                             -> { ok, service }
 *   GET  /kpi                                -> { ok, kpi, values }
 *   GET  /report                             -> { ok, loads, efficiencies, conformity, compliant }
 *   POST /control  { equipment, action }     -> { ok, equipment, action }
 */
export class PoseidonRoute {
  static routes(): Router {
    const router = Router();
    const controller = new PoseidonController();

    router.use(json({ limit: '1mb' }));

    router.get('/health', controller.health);
    router.get('/kpi', controller.kpi);
    router.get('/report', controller.report);
    router.post('/control', controller.control);

    return router;
  }
}
