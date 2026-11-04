// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// UsersRoute
// -----------------------------------------------------------------------------
// Sub-router of the Users page, mounted at "/api/users", backed by
// UsersController (→ MSA vRPC → usersService manager). Every route is gated by
// an Application Security role of the module `users` (open until an admin
// assigns groups — see appSecurityGuard).
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { requireRole } from './appSecurityGuard';
import { UsersController, WRITE_OPS } from './usersController';

const MODULE_ID = 'users';

/** The role each write needs. */
const WRITE_ROLE: Record<string, string> = {
  userCreate: 'manage-users',
  userUpdate: 'manage-users',
  userPassword: 'manage-users',
  userDelete: 'manage-users',
  groupCreate: 'manage-groups',
  groupUpdate: 'manage-groups',
  groupDelete: 'manage-groups',
  permissionNames: 'manage-groups',
  areaCreate: 'manage-groups',
  areaUpdate: 'manage-groups',
  areaDelete: 'manage-groups',
  authMode: 'configure'
};

/**
 * Route definitions (relative to "/api/users"):
 *   GET  /health                -> { ok, serviceAvailable, userName, canManage, authName, auths, version, … }
 *   GET  /state                 -> { ok, users, groups, areas, permissionNames[32], authName, auths }   (view)
 *   POST /users/create          { name, fullName?, comment?, language?, password?, enabled?, groupIds? }   (manage-users)
 *   POST /users/update          { id, name?, fullName?, comment?, language?, enabled?, groupIds? }        (manage-users)
 *   POST /users/password        { id, password }                                                          (manage-users)
 *   POST /users/delete          { id }                                                                    (manage-users)
 *   POST /groups/create|update  { id?, name, fullName?, comment?, permissions[32]?, areas?, memberIds? }   (manage-groups)
 *   POST /groups/delete         { id }                                                                    (manage-groups)
 *   POST /permissions/names     { names[32] }                                                             (manage-groups)
 *   POST /areas/create|update   { id?, name, fullName?, comment?, permissions[32]? }                      (manage-groups)
 *   POST /areas/delete          { id }                                                                    (manage-groups)
 *   POST /auth/mode             { mode }  ("Standard" | "Windows" | a user-defined method)                (configure)
 *   GET  /ad/groups[?cached=1]  -> { ok, groups: [{ name, osId, comment, local, imported }] }             (manage-groups)
 *   POST /ad/groups/import      { names[] } -> { ok, created[] }                                          (manage-groups)
 *   GET  /ad/users[?cached=1]   -> { ok, users: [{ name, osId, comment, imported }] }                     (manage-users)
 *   POST /ad/users/import       { names[] } -> { ok, created[], noGroup[], errors[] }                     (manage-users)
 *   GET  /import                -> { ok, settings, status }                                               (view)
 *   POST /import/settings       { enabled, intervalMin, groups[] } -> { ok, settings, status }            (configure)
 *   POST /import/run            -> { ok, started, status }                                                (configure)
 *   GET  /settings              -> { ok, config[], userSettings[] }  (read-only; sensitive contents masked) (view)
 * A refusal of the user administration answers 409 with its reason; 502 when the
 * manager does not answer.
 */
export class UsersRoute {
  static routes(): Router {
    const router = Router();
    const controller = new UsersController();
    const view = requireRole(MODULE_ID, 'view');

    router.use(json({ limit: '1mb' }));

    router.get('/health', controller.health);
    router.get('/state', view, controller.state);
    for (const [path, op] of Object.entries(WRITE_OPS)) {
      router.post(path, requireRole(MODULE_ID, WRITE_ROLE[op]), controller.write(op));
    }
    router.get('/ad/groups', requireRole(MODULE_ID, 'manage-groups'), controller.adGroups);
    router.post('/ad/groups/import', requireRole(MODULE_ID, 'manage-groups'), controller.adImportGroups);
    router.get('/ad/users', requireRole(MODULE_ID, 'manage-users'), controller.adUsers);
    router.post('/ad/users/import', requireRole(MODULE_ID, 'manage-users'), controller.adImportUsers);
    router.get('/import', view, controller.importState);
    router.post('/import/settings', requireRole(MODULE_ID, 'configure'), controller.importSettings);
    router.post('/import/run', requireRole(MODULE_ID, 'configure'), controller.importRun);
    router.get('/settings', view, controller.settings);

    return router;
  }
}
