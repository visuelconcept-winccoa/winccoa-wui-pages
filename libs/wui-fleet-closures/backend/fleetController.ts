// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// FleetController
// -----------------------------------------------------------------------------
// The writes of the Machine Fleet pages (ateliers, graphics resources, stop
// causes, non-worked periods, archive config of a bound datapoint), each checked
// on the server against the role it needs (fleetRules.ts) before it reaches WinCC
// OA. Same bodies as the PARA datapoint endpoints, which the Fleet used before.
//
// Without a session identity (webserver without HTTP authentication) the check is
// skipped and logged, as the shared requireRole guard does.
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { Request, Response } from 'ultimate-express';

import { identityOf, roleAssignments, roleGranted } from './appSecurityGuard';
import { CLOSURES_DP, closuresRoles, dpOf, rolesForDp, rolesForSet, rolesForType, type FleetRole } from './fleetRules';
import { createTypeFromStructure, type ParaTypeStructure } from './paraTypeNode';

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_ERROR = 500;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** First string found in a dpGet result (raw value, array, or { value }). */
function firstString(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.length ? firstString(raw[0]) : '';
  return '';
}

export class FleetController {
  /** GET /api/fleet/health → the Fleet's guarded writes are deployed. */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'fleet' });
  };

  /**
   * True when the session user holds one of `roles` (any); answers 403 and returns false
   * otherwise. An empty list is refused: the route writes nothing but the Fleet's objects.
   */
  private async allowed(req: Request, res: Response, roles: FleetRole[], what: string): Promise<boolean> {
    if (roles.length === 0) {
      res.status(HTTP_FORBIDDEN).json({ ok: false, error: `forbidden: ${what} is not an object of the Fleet` });
      return false;
    }
    try {
      const who = await identityOf(req);
      if (who.username === '') {
        console.warn(`fleet(${what}): request has no session identity (server-side auth disabled?) — role check skipped.`);
        return true;
      }
      for (const r of roles) {
        if (roleGranted(await roleAssignments(r.module), r.role, who)) return true;
      }
      const list = roles.map((r) => `'${r.role}' of '${r.module}'`).join(' or ');
      res.status(HTTP_FORBIDDEN).json({ ok: false, error: `forbidden: role ${list} required` });
      return false;
    } catch (error) {
      // A failing check must not take the API down: logged, then let through (as requireRole).
      console.warn(`fleet(${what}): ${message(error)}`);
      return true;
    }
  }

  /** POST /api/fleet/dp/set  body { dpeName, value } | { dpeNames, values }. */
  public setValue = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { dpeName?: string; value?: unknown; dpeNames?: string[]; values?: unknown[] };
    const names = body.dpeName !== undefined ? [body.dpeName] : Array.isArray(body.dpeNames) ? body.dpeNames : [];
    const values = body.dpeName !== undefined ? [body.value] : Array.isArray(body.values) ? body.values : [];
    if (names.length === 0 || names.length !== values.length || values.some((v) => v === undefined)) {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: 'provide { dpeName, value } or { dpeNames, values } of the same length' });
      return;
    }
    for (let i = 0; i < names.length; i++) {
      let roles = rolesForSet(names[i]);
      if (dpOf(names[i]) === CLOSURES_DP && roles.length > 0) {
        // The periods of single machines need less than the global schedule: compare with what is stored.
        let before = '';
        try {
          before = firstString(await WsjServerGlobal.winccoa.dpGet(`${CLOSURES_DP}.json`));
        } catch {
          before = '';
        }
        roles = closuresRoles(before, values[i]);
      }
      // eslint-disable-next-line no-await-in-loop -- a handful of elements per call
      if (!(await this.allowed(req, res, roles, names[i]))) return;
    }
    try {
      const ok =
        names.length === 1
          ? await WsjServerGlobal.winccoa.dpSetWait(names[0], values[0])
          : await WsjServerGlobal.winccoa.dpSetWait(names, values);
      res.status(ok ? 200 : HTTP_ERROR).json({ ok: Boolean(ok), dpeNames: names });
    } catch (error) {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: message(error) });
    }
  };

  /** POST /api/fleet/dp/create  body { dpName, dpType }. */
  public createDp = async (req: Request, res: Response): Promise<void> => {
    const { dpName, dpType } = (req.body ?? {}) as { dpName?: string; dpType?: string };
    if (!dpName || !dpType) {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: 'dpName and dpType are required' });
      return;
    }
    if (!(await this.allowed(req, res, rolesForDp(dpName, dpType), dpName))) return;
    try {
      const created = await WsjServerGlobal.winccoa.dpCreate(dpName, dpType);
      res.status(created ? 200 : HTTP_ERROR).json({ ok: Boolean(created), dpName });
    } catch (error) {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: message(error) });
    }
  };

  /** DELETE /api/fleet/dp/:name  (optional ?dpType= guard). */
  public deleteDp = async (req: Request, res: Response): Promise<void> => {
    const name = decodeURIComponent(req.params['name']);
    const expectedType = req.query['dpType'] as string | undefined;
    if (!(await this.allowed(req, res, rolesForDp(dpOf(name)), name))) return;
    try {
      if (!WsjServerGlobal.winccoa.dpExists(name)) {
        res.status(404).json({ ok: false, error: `data point '${name}' does not exist` });
        return;
      }
      if (expectedType && WsjServerGlobal.winccoa.dpTypeName(name) !== expectedType) {
        res.status(409).json({ ok: false, error: `'${name}' is not of type '${expectedType}'` });
        return;
      }
      const deleted = await WsjServerGlobal.winccoa.dpDelete(name);
      res.status(deleted ? 200 : HTTP_ERROR).json({ ok: Boolean(deleted), dpName: name });
    } catch (error) {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: message(error) });
    }
  };

  /** POST /api/fleet/dptype/create  body { typeName, structure } (as PARA's). */
  public createDpType = async (req: Request, res: Response): Promise<void> => {
    const { typeName, structure } = (req.body ?? {}) as { typeName?: string; structure?: ParaTypeStructure };
    if (!typeName || !structure) {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: 'typeName and structure are required' });
      return;
    }
    if (!(await this.allowed(req, res, rolesForType(typeName), typeName))) return;
    try {
      const created = await WsjServerGlobal.winccoa.dpTypeCreate(createTypeFromStructure(typeName, structure));
      res.status(created ? 200 : HTTP_ERROR).json({ ok: Boolean(created), typeName });
    } catch (error) {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: message(error) });
    }
  };

  /**
   * POST /api/fleet/dptype/change  body { typeName, structure } (as PARA's): an existing Fleet type changed
   * in place, its datapoints kept (e.g. `name` added to the stop-cause catalogue type, #74). Same roles as
   * creating the type.
   */
  public changeDpType = async (req: Request, res: Response): Promise<void> => {
    const { typeName, structure } = (req.body ?? {}) as { typeName?: string; structure?: ParaTypeStructure };
    if (!typeName || !structure) {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: 'typeName and structure are required' });
      return;
    }
    if (!(await this.allowed(req, res, rolesForType(typeName), typeName))) return;
    try {
      WsjServerGlobal.winccoa.dpTypeGet(typeName);
    } catch {
      res.status(404).json({ ok: false, error: `data point type '${typeName}' does not exist` });
      return;
    }
    try {
      const changed = await WsjServerGlobal.winccoa.dpTypeChange(createTypeFromStructure(typeName, structure));
      res.status(changed ? 200 : HTTP_ERROR).json({ ok: Boolean(changed), typeName });
    } catch (error) {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: message(error) });
    }
  };
}
