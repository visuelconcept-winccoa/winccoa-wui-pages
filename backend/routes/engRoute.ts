// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// EngRoute — sub-router for the Engineering Studio API, backed by EngController.
// Mounted at "/api/eng" in CustomerRoutes.
// -----------------------------------------------------------------------------
// Application Security — FAIL-CLOSED, unlike the shared para persistence API.
// The para routes stay open because they ARE the suite-wide DP-JSON persistence
// API (gating them with para's roles would 403 another page saving its store).
// Nothing here is shared: every endpoint is studio-private, so every one of them
// is gated, matching the roles declared in
// libs/wui-eng-studio/src/app-security.roles.json:
//
//   view            reads (health excepted), plan/diff, test-read
//   manage-devices  the device registry and the address-book catalog (ingest,
//                   refresh, role overrides) — the engineering INPUTS
//   edit-model      the workspace (check-out, save) — the engineering OUTPUT
//   checkin         apply a plan to the project (create/update/DELETE types,
//                   datapoints and configs) — the only route that writes OA
//
// A route is gated by the strongest capability it grants, never by its HTTP verb:
// `POST /plan` and `POST /test-read` only READ, so they take `view`; `POST
// /checkout` writes a workspace file, so it takes `edit-model`.
//
// Caveat (documented in INTEGRATION.md): enforcement is only effective when the
// webserver's own HTTP authentication is enabled — without a session identity
// appSecurityGuard fails OPEN with a warning, so these guards are inert on a
// default deployment. The UI gating (hasRole$) still applies, but an API caller
// bypasses it.
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { requireRole } from './appSecurityGuard';
import { EngController } from './engController';

/** Role gate for one studio capability (module id = 'eng-studio'). */
function gate(role: 'view' | 'edit-model' | 'manage-devices' | 'checkin') {
  return requireRole('eng-studio', role);
}

/**
 * Route definitions for the Engineering Studio API (relative to "/api/eng").
 *
 *   GET  /health                                        (open) -> { ok, store }
 *   GET  /roles                                         (open) -> { roles }
 *
 *   GET  /devices                                       (view)           -> { devices }
 *   POST /devices          { devices }                  (manage-devices) -> { devices }
 *
 *   GET  /connections                                   (view)           -> { connections }
 *
 *   GET  /books                                         (view)           -> { books }
 *   GET  /books/:id                                     (view)           -> { book }
 *   POST /books/ingest     { bookId, format, … }        (manage-devices) -> { book }
 *   POST /books/browse     { bookId, connection, … }    (manage-devices) -> { book, delta? }
 *   POST /books/:id/refresh                             (manage-devices) -> { book, delta? }
 *   POST /books/:id/roles  { roles }                    (manage-devices) -> { book }
 *
 *   GET  /workspace?name=                               (view)           -> { workspace }
 *   POST /workspace        { workspace }                (edit-model)     -> { ok }
 *   POST /checkout         { name, types?, dpes? }      (edit-model)     -> { workspace }
 *
 *   GET  /live                                          (view)           -> { snapshot }
 *   POST /live             { types?, dpes? }            (view)           -> { snapshot }
 *   POST /plan             { workspace }                (view)           -> { plan }
 *   POST /test-read        { dpes }                     (view)           -> { results }
 *   POST /checkin          { plan, dryRun }             (checkin)        -> ApplyReport
 *
 * `/health` and `/roles` are deliberately ungated: the page must be able to tell
 * "backend absent" from "not allowed", and `/roles` is what the UI needs to gate
 * itself (it only ever reports the CALLER's own grants, never another user's).
 *
 * `/books/ingest` and `/books/browse` are declared BEFORE `/books/:id/*` —
 * otherwise "ingest"/"browse" would match the `:id` parameter.
 *
 * The body limit is 25mb: a SimaticML ingestion posts a whole TIA export bundle
 * and a check-in plan can carry thousands of config items.
 */
export class EngRoute {
  static routes(): Router {
    const router = Router();
    const controller = new EngController();

    router.use(json({ limit: '25mb' }));

    router.get('/health', controller.health);
    router.get('/roles', controller.roles);

    // --- devices --------------------------------------------------------------
    router.get('/devices', gate('view'), controller.listDevices);
    router.post('/devices', gate('manage-devices'), controller.saveDevices);

    // --- OPC UA connections (browsable sources) --------------------------------
    router.get('/connections', gate('view'), controller.connections);

    // --- address books ---------------------------------------------------------
    router.get('/books', gate('view'), controller.listBooks);
    router.post('/books/ingest', gate('manage-devices'), controller.ingestBook);
    router.post('/books/browse', gate('manage-devices'), controller.browseBook);
    router.get('/books/:id', gate('view'), controller.getBook);
    router.post('/books/:id/refresh', gate('manage-devices'), controller.refreshBook);
    router.post('/books/:id/roles', gate('manage-devices'), controller.saveBookRoles);

    // --- workspace -------------------------------------------------------------
    router.get('/workspace', gate('view'), controller.getWorkspace);
    router.post('/workspace', gate('edit-model'), controller.saveWorkspace);
    router.post('/checkout', gate('edit-model'), controller.checkout);

    // --- live project + check-in -----------------------------------------------
    router.get('/live', gate('view'), controller.live);
    router.post('/live', gate('view'), controller.live);
    router.post('/plan', gate('view'), controller.plan);
    router.post('/test-read', gate('view'), controller.testRead);
    router.post('/checkin', gate('checkin'), controller.checkin);

    return router;
  }
}
