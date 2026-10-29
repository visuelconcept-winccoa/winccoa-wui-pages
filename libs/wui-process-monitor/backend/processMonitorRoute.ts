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

import { requireRole } from './appSecurityGuard';
import { ProcessMonitorController, whenBodyFlag } from './processMonitorController';

/**
 * Route definitions for the Process Monitor API.
 *
 * Endpoints (relative to the "/api/process-monitor" mount point):
 *   GET  /health                           -> { ok, vrpc, serviceName, serviceAvailable, serviceStatus, error? }
 *                                             (probes the manager: `serviceAvailable: false`
 *                                              means it is stopped or needs a restart)
 *   GET  /managers                        -> { ok, instances: [{system, hostname, updated, managers, dp, local, status}], managers }
 *                                             status = { state, checkedAt, version, startedAt, error? }, state one of
 *                                             connected | pmon-unreachable | agent-too-old | agent-unreachable | not-checkable
 *                                             (every node pinged over vRPC in this one request — issue 39)
 *   POST /instance/delete { node }         -> { ok, dp, system, hostname, lastSeen, state, code?, error? }
 *                                             (role manage-instances; refused for the local node and for an agent that answers)
 *   POST /manager   { action, index }      -> { ok, action, index }
 *   POST /manager/add    { name, startMode?, options?, index?, node? } -> { ok }
 *   POST /manager/remove { index, node?, name?, stopFirst? } -> { ok, warning? }   (index ≥ 1; role edit-managers,
 *                                             + control with stopFirst: stop the running manager, then delete it)
 *   POST /manager/update { index, node?, name?, startMode, secKill, restartCount, resetMin, options?, restart? }
 *                                          -> { ok, warning?, detail: {before, after, restarted} }
 *                                             (SINGLE_MGR:PROP_PUT — role edit-managers, + control with restart)
 *   POST /restart                          -> { ok }   (restart all)
 *   POST /upload/init     { fileName }     -> { ok, uploadId }
 *   POST /upload/chunk    { uploadId, data(base64) }
 *   POST /upload/finalize { uploadId, clearFolders[], restart } -> deploy result
 *   GET  /logs?node=                       -> { ok, host, files }        (role logs-read)
 *   POST /logs/read   { node, files[], fromOffset?, maxLines?, mergeBak? }
 *                                          -> { ok, host, files: [{name, text, offset, size, truncated, reset, bak?}] }
 *   POST /logs/export { node, files[], mergeBak? } -> the whole files (role logs-read)
 */
export class ProcessMonitorRoute {
  static routes(): Router {
    const router = Router();
    const controller = new ProcessMonitorController();

    router.use(json({ limit: '64mb' }));

    // Application Security: manager control and project deploy are role-gated
    // (open until the admin assigns groups — see appSecurityGuard).
    const MODULE_ID = 'process-monitor';
    router.get('/health', controller.health);
    router.get('/managers', controller.managers);
    router.post('/manager', requireRole(MODULE_ID, 'control'), controller.manager);
    // Editing the pmon configuration (add/remove entries in config/progs) is a
    // separate, more sensitive capability than start/stop → its own role.
    router.post('/manager/add', requireRole(MODULE_ID, 'edit-managers'), controller.managerAdd);
    // Stopping a running manager before deleting it, or restarting it after an edit, is
    // manager control: it also needs the `control` role (issue 40).
    router.post(
      '/manager/remove',
      requireRole(MODULE_ID, 'edit-managers'),
      whenBodyFlag('stopFirst', requireRole(MODULE_ID, 'control')),
      controller.managerRemove
    );
    router.post(
      '/manager/update',
      requireRole(MODULE_ID, 'edit-managers'),
      whenBodyFlag('restart', requireRole(MODULE_ID, 'control')),
      controller.managerUpdate
    );
    router.post('/restart', requireRole(MODULE_ID, 'control'), controller.restartAll);
    // Deleting a host instance (its node DP and history) is its own role, separate from
    // manager control (issue 39).
    router.post('/instance/delete', requireRole(MODULE_ID, 'manage-instances'), controller.instanceDelete);
    router.post('/upload/init', requireRole(MODULE_ID, 'deploy'), controller.uploadInit);
    router.post('/upload/chunk', requireRole(MODULE_ID, 'deploy'), controller.uploadChunk);
    router.post('/upload/finalize', requireRole(MODULE_ID, 'deploy'), controller.uploadFinalize);
    // Logs can hold sensitive data (user names, addresses): their own role, separate
    // from manager control.
    router.get('/logs', requireRole(MODULE_ID, 'logs-read'), controller.logs);
    router.post('/logs/read', requireRole(MODULE_ID, 'logs-read'), controller.logsRead);
    router.post('/logs/export', requireRole(MODULE_ID, 'logs-read'), controller.logsExport);

    return router;
  }
}
