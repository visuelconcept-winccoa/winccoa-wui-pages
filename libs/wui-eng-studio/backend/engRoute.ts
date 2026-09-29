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
//                   refresh, role overrides, DELETE a catalog) — the engineering
//                   INPUTS
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
 *   GET  /devices/state                                 (view)           -> { states }
 *   POST /devices          { device }                   (manage-devices) -> 201 { device, devices }
 *   POST /devices/:id      { device }                   (manage-devices) -> { device, devices }
 *   PUT  /devices          { devices }                  (manage-devices) -> { devices }
 *   DEL  /devices/:id                                   (manage-devices) -> { devices }
 *
 *   GET  /connections                                   (view)           -> { connections }
 *   GET  /drivers                                       (view)           -> { drivers }
 *   POST /browse/level     { connection, nodeId? }      (view)           -> { nodes }
 *
 *   GET  /books                                         (view)           -> { books }
 *   GET  /books/:id                                     (view)           -> { book }
 *   POST /books            { bookId, name?, interface? } (manage-devices) -> 201 { book, books }
 *   PUT  /books/:id        { book }                      (manage-devices) -> { book, books }
 *   POST /books/ingest     { bookId, format, … }        (manage-devices) -> { book, books }
 *   POST /books/browse     { bookId, connection, … }    (manage-devices) -> { book, delta? }
 *   POST /books/:id/refresh                             (manage-devices) -> { book, delta? }
 *   POST /books/:id/roles  { roles }                    (manage-devices) -> { book }
 *   POST /books/:id/access { access }                   (manage-devices) -> { book }
 *   POST /books/:id/exclude { excluded }                (manage-devices) -> { book }
 *   DEL  /books/:id                                     (manage-devices) -> { books, devices }
 *
 *   GET  /models                                         (view)           -> { models }
 *   POST /models           { model }                     (edit-model)     -> { model }
 *   DEL  /models/:id                                     (edit-model)     -> { ok }
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
    // A creation POSTs to the collection and an update to the item: an "empty id"
    // in the path (`/devices/`) would match the collection route with Express's
    // default non-strict routing, and quietly hit the registry-replace handler.
    router.get('/devices', gate('view'), controller.listDevices);
    // The LIVE part only, for the page's state refresh: a connection state is the one
    // thing about an equipment that changes on its own, and re-sending the registry
    // every few seconds would also let a poll overwrite an operator's in-flight edit.
    router.get('/devices/state', gate('view'), controller.deviceStates);
    router.post('/devices', gate('manage-devices'), controller.createDevice);
    router.post('/devices/:id', gate('manage-devices'), controller.saveDevice);
    router.put('/devices', gate('manage-devices'), controller.saveDevices);
    router.delete('/devices/:id', gate('manage-devices'), controller.deleteDevice);

    // --- OPC UA connections (browsable sources) --------------------------------
    router.get('/connections', gate('view'), controller.connections);

    // --- drivers (the manager numbers the device form offers) ------------------
    router.get('/drivers', gate('view'), controller.drivers);

    // --- one browse LEVEL ------------------------------------------------------
    // `view`, not `manage-devices`: it only READS an address space. It is what the
    // server explorer and the client-driven (progress-reporting) walk are built on.
    router.post('/browse/level', gate('view'), controller.browseLevel);

    // --- address books ---------------------------------------------------------
    router.get('/books', gate('view'), controller.listBooks);
    router.post('/books', gate('manage-devices'), controller.createBook);
    router.post('/books/ingest', gate('manage-devices'), controller.ingestBook);
    router.post('/books/browse', gate('manage-devices'), controller.browseBook);
    router.get('/books/:id', gate('view'), controller.getBook);
    router.put('/books/:id', gate('manage-devices'), controller.putBook);
    router.delete('/books/:id', gate('manage-devices'), controller.deleteBook);
    router.post('/books/:id/refresh', gate('manage-devices'), controller.refreshBook);
    router.post('/books/:id/roles', gate('manage-devices'), controller.saveBookRoles);
    router.post('/books/:id/access', gate('manage-devices'), controller.saveBookAccess);
    router.post('/books/:id/exclude', gate('manage-devices'), controller.saveBookExcluded);

    // --- reusable model templates ----------------------------------------------
    router.get('/models', gate('view'), controller.listModels);
    router.post('/models', gate('edit-model'), controller.saveModel);
    router.delete('/models/:id', gate('edit-model'), controller.deleteModel);

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
