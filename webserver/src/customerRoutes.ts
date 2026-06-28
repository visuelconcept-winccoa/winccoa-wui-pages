// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// CustomerRoutes — @visuelconcept/wui-webserver base
// -----------------------------------------------------------------------------
// Builds the custom HTTP router. Keeps one baseline example (static file
// serving) and then AUTO-MOUNTS every backend module found under
// dist/modules/<name>/ via mountModuleRoutes() — so installing a page module's
// backend is just dropping a folder, no edit here.
// -----------------------------------------------------------------------------

import {
  WsjAccessControlList,
  WsjRoutes,
  WsjStaticLiveDirectoryRoute
} from '@winccoa/backend';
import { Router } from 'ultimate-express';

import { mountModuleRoutes } from './wui-module-routes';

export class CustomerRoutes {
  public static routes() {
    const router = Router();

    // Baseline: serve files from <project>/data/customer/data/ at /customer/data/*.
    router.use(WsjStaticLiveDirectoryRoute.routes('/customer/data'));
    WsjRoutes.acl.set('/customer/*', WsjAccessControlList.fullAccess);

    // Auto-mount every backend module (HTTP routes + ACL).
    mountModuleRoutes(router);

    return router;
  }
}
