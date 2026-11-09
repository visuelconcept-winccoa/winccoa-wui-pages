// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Turns on the Fleet's guarded writes: the FleetStore's writes go through /api/fleet (backend of
 * wui-fleet-closures, each write checked on the server against its role) when it answers, instead of
 * PARA's. Imported only by the pages that declare fleet-closures in their `wuiPage.requires` (or own it),
 * so a page embedding a fleet view without that module (the workcenters' "Vue machine fleet", read only)
 * names no fleet-closures backend (wui-toolkit's check of `wuiPage.requires`). The setting lives in the
 * module, not the page: once such a page has been opened, the store of an embedded view sharing the same
 * copy of this kit routes through /api/fleet too — harmless, the site deploys fleet-closures for that page.
 */
import { routeWritesThrough } from './write-routing.js';

/** Mount of the guarded writes (wui-fleet-closures' backend). */
export const FLEET_API = '/api/fleet';

routeWritesThrough(FLEET_API);
