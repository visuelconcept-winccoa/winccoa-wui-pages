// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// TagImporterRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the Tag Importer API, backed by
// TagImporterController. Mounted at "/api/tag-importer" in CustomerRoutes.
//
// A JSON body parser is applied so POST handlers can read req.body; the limit is
// raised because an ImportPlan (many types/instances/addresses) can be large.
//
// Application Security (server-side enforcement, mirrors the UI):
//   - /browse and /connections require the 'browse' role (touch a live server);
//   - /apply requires the 'create' role (writes types/DPs/address configs).
//   Roles are OPEN until an admin assigns groups (see appSecurityGuard).
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { requireRole } from './appSecurityGuard';
import { TagImporterController } from './tagImporterController';

/**
 * Route definitions for the Tag Importer API (relative to "/api/tag-importer"):
 *   GET  /health
 *   GET  /connections                          -> { connections: [{name, connected}] }
 *   POST /connection { name?, endpoint, securityPolicy?, messageMode?, user?, password? } -> { connection, warnings }
 *   POST /browse   { connection, nodeId?, depth? } -> { nodes: [...] }
 *   POST /apply    { plan, dryRun }             -> { ok, dryRun, results: [...] }
 */
export class TagImporterRoute {
  static routes(): Router {
    const router = Router();
    const controller = new TagImporterController();

    router.use(json({ limit: '25mb' }));

    router.get('/health', controller.health);
    router.get('/connections', requireRole('tag-importer', 'browse'), controller.connections);
    router.get('/drivers', requireRole('tag-importer', 'browse'), controller.drivers);
    router.get('/dptypes', requireRole('tag-importer', 'browse'), controller.dpTypes);
    router.post('/connection', requireRole('tag-importer', 'create'), controller.createConnection);
    router.post('/connection/read', requireRole('tag-importer', 'browse'), controller.readConnection);
    router.post('/connection/update', requireRole('tag-importer', 'create'), controller.updateConnection);
    router.post('/browse', requireRole('tag-importer', 'browse'), controller.browse);
    router.post('/apply', requireRole('tag-importer', 'create'), controller.apply);

    return router;
  }
}
