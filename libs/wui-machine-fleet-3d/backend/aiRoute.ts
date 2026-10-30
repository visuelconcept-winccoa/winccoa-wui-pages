// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// AiRoute — the backend of machine-fleet-3d, mounted at "/api/ai"
// -----------------------------------------------------------------------------
// The module's single wui-toolkit mount has been "/api/ai" since 0.1: the AI
// prompt bridge other modules call (para, ampere, gis: `wuiPage.optional`).
// It now also serves the ateliers, read only, to hosts that embed one
// (<wui-fleet-3d-view>) or let their user pick one, under "/fleet".
//
// The AI part is the same as wui-ai-kit's backend/aiRoute.ts (whose controller,
// aiController.ts, is copied next to this file at deploy time): keep the two in
// step. The class keeps its name (`AiRoute`, file `aiRoute`) so a target whose
// descriptor index.ts was written by an earlier deployment — wui-toolkit writes
// it once only — mounts the fleet routes too, with nothing to edit.
//
// Application Security (module `machine-fleet-3d`, src/app-security.roles.json):
// the fleet routes need the `view` role (requireRole, appSecurityGuard.ts copied
// from wui-app-security at deploy time) — open until an admin assigns groups.
// -----------------------------------------------------------------------------

import { Router, json } from 'ultimate-express';

import { AiController } from './aiController';
import { requireRole } from './appSecurityGuard';
import { FleetController } from './fleetAteliers';

export const MODULE_ID = 'machine-fleet-3d';

/**
 * Endpoints (relative to the "/api/ai" mount point), with their role:
 *   GET  /health                -> liveness of the AI bridge                         (open)
 *   POST /chat                  body { prompt, … } -> { text, provider, model }      (open, as in wui-ai-kit)
 *   GET  /fleet/ateliers        -> { ok, ateliers: [{ id, name, machineCount }] }    view
 *   GET  /fleet/ateliers/:id    -> { ok, atelier, stopCauses } | 404                  view
 */
export class AiRoute {
  static routes(): Router {
    const router = Router();
    const ai = new AiController();
    const fleet = new FleetController();

    router.use(json({ limit: '1mb' }));

    router.get('/health', ai.health);
    router.post('/chat', ai.chat);

    router.get('/fleet/ateliers', requireRole(MODULE_ID, 'view'), fleet.list);
    router.get('/fleet/ateliers/:id', requireRole(MODULE_ID, 'view'), fleet.get);

    return router;
  }
}
