// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// ParaRoute
// -----------------------------------------------------------------------------
// Express-style sub-router for the PARA engineering endpoints, backed by
// ParaController. Mounted at "/api/para" in CustomerRoutes.
//
// A JSON body parser is applied to this router so POST handlers can read
// req.body. (The standard dashboard routes are GET-based and do not install a
// global JSON parser.) The body limit is raised to 10mb so large payloads --
// e.g. batch dp/set writes or big type structures -- are not rejected with a
// 413 "request entity too large".
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { DplController } from './dplController';
import { ParaController } from './paraController';

/**
 * Route definitions for the PARA API.
 *
 * Endpoints (relative to the "/api/para" mount point):
 *   GET    /health
 *   GET    /dptype/:name    -> { typeName, structure }
 *   POST   /dptype/create   body { typeName, structure }
 *   POST   /dptype/change   body { typeName, structure }  (update in place)
 *   POST   /dp/create       body { dpName, dpType }
 *   POST   /dp/set          body { dpeName, value } | { dpeNames, values }
 *   POST   /dp/rename       body { oldName, newName, expectedType? }
 *   DELETE /dp/:name        optional ?dpType= guard
 *   DELETE /dptype/:name
 *   GET    /dpl/health
 *   POST   /dpl/export      body { dps?: string[], dpts?: string[] } -> { contentBase64, … }
 *   POST   /dpl/import      body { fileName, contentBase64 }
 *
 * The /dpl/* routes bridge to the "DplAscii" MSA manager (WCCOAasciiSQLite).
 */
export class ParaRoute {
  static routes(): Router {
    const router = Router();
    const controller = new ParaController();
    const dpl = new DplController();

    router.use(json({ limit: '25mb' }));

    router.get('/health', controller.health);
    router.get('/dptype/:name', controller.getDpType);
    router.post('/dptype/create', controller.createDpType);
    router.post('/dptype/change', controller.changeDpType);
    router.post('/dp/create', controller.createDp);
    router.post('/dp/set', controller.setValue);
    router.post('/dp/rename', controller.renameDp);
    router.delete('/dp/:name', controller.deleteDp);
    router.delete('/dptype/:name', controller.deleteDpType);

    router.get('/dpl/health', dpl.health);
    router.post('/dpl/export', dpl.export);
    router.post('/dpl/import', dpl.import);

    return router;
  }
}
