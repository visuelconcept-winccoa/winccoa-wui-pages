// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// fleetGuard — the Application Security roles of machine-fleet-3d, enforced
// server-side on the fleet routes (/api/ai/fleet/…)
// -----------------------------------------------------------------------------
// Same guard as remote-vnc's backend/vncGuard.ts: keep the two in step. Roles
// of module `machine-fleet-3d` (src/app-security.roles.json), same rules as
// everywhere (appSecurityGuard.ts, copied next to this file at deploy time from
// wui-app-security): a role no admin assigned is OPEN; an assigned role is
// granted to its groups' members and to OA root.
//
// Who calls — `requestIdentity(req)`:
//   1. the user of the WebUI token the page sends (`Authorization: Bearer`),
//      verified by the webserver's own key store (the CTRL decodeToken) — the
//      dashboard authenticates at the WebSocket layer, so the HTTP requests
//      usually carry no passport session;
//   2. else the passport / basic-auth session user (`identityOf`).
// Never a name the client declares.
//
// Difference with `requireRole`: when NO identity can be established and the
// role IS assigned, the request is refused. `requireRole` lets it through (it
// cannot see the token) — here, that would let anyone read the ateliers by
// omitting the header. An unassigned role stays open whatever the identity, so
// nothing changes until an admin assigns groups. A failure of the guard itself
// (directory, assignments or token check unreadable) is logged and fails open.
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { NextFunction, Request, Response } from 'ultimate-express';
import { WinccoaCtrlScript, WinccoaCtrlType } from 'winccoa-manager';

import { AppSecurityIdentity, identityOf, identityOfUsername, roleAssignments, roleGranted } from './appSecurityGuard';

export const MODULE_ID = 'machine-fleet-3d';
export type FleetRole = 'view' | 'edit' | 'ai';

const HTTP_FORBIDDEN = 403;
const ANONYMOUS: AppSecurityIdentity = { username: '', userId: -1, admin: false, groups: [] };

let verifyScript: WinccoaCtrlScript | null = null;

/** The user name a WebUI token was issued for, '' when it is not valid (signature, expiry). */
async function verifyWebUiToken(jwt: string): Promise<string> {
  verifyScript ??= new WinccoaCtrlScript(
    WsjServerGlobal.winccoa,
    `#uses "classes/wssServer/WebUiHttpEndpoints"
     string main(string jwt)
     {
       WssWebUiToken token = WssJwksKeyStore::decodeToken(jwt);
       return token.isValid() ? token.userName() : "";
     }`,
    'wuiMachineFleet3dVerifyToken'
  );
  return String((await verifyScript.start('main', [jwt], [WinccoaCtrlType.string])) ?? '');
}

function bearer(req: Request): string {
  const header = req.headers?.['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  return /^Bearer\s+(\S+)$/i.exec(value ?? '')?.[1] ?? '';
}

const identities = new WeakMap<object, Promise<AppSecurityIdentity>>();

/**
 * The verified identity of the caller (WebUI token, else webserver session),
 * anonymous when there is none. Resolved once per request. Rejects only when
 * the check itself fails (CTRL / directory unavailable).
 */
export function requestIdentity(req: Request): Promise<AppSecurityIdentity> {
  let identity = identities.get(req);
  if (!identity) {
    identity = (async () => {
      const jwt = bearer(req);
      if (jwt) {
        const username = await verifyWebUiToken(jwt);
        if (username) return identityOfUsername(username);
      }
      const session = await identityOf(req);
      return session.username ? session : ANONYMOUS;
    })();
    identities.set(req, identity);
  }
  return identity;
}

/** Whether `who` holds at least one of `roles` (the module's current assignments). */
export async function holdsRole(who: AppSecurityIdentity, roles: readonly FleetRole[]): Promise<boolean> {
  const assignments = await roleAssignments(MODULE_ID);
  return roles.some((role) => roleGranted(assignments, role, who));
}

/**
 * Express middleware: 403 unless the caller holds one of `roles` of machine-fleet-3d.
 *   router.get('/fleet/workshops', requireFleetRole('view'), fleet.list);
 */
export function requireFleetRole(...roles: FleetRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let granted: boolean;
    try {
      granted = await holdsRole(await requestIdentity(req), roles);
    } catch (error) {
      console.warn(`fleetGuard(${roles.join('|')}): check failed, let through:`, (error as Error)?.message ?? error);
      next();
      return;
    }
    if (granted) {
      next();
      return;
    }
    res.status(HTTP_FORBIDDEN).json({
      ok: false,
      error: 'forbidden',
      message: `role ${roles.map((role) => `'${role}'`).join(' or ')} of '${MODULE_ID}' required`
    });
  };
}
