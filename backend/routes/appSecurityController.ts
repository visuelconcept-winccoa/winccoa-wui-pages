// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// AppSecurityController
// -----------------------------------------------------------------------------
// Identity + group directory for the "Application Security" page and for the
// role guards of other backend modules.
//
//   GET /me      -> { ok, username, userId, admin, groups[] }   (session user)
//   GET /groups  -> { ok, groups: [{ id, name }] }              (OA user groups)
//   GET /health
//
// The session username comes from the webserver's own authentication (passport
// session — basic or OIDC); the user's OA groups are resolved server-side from
// the `_Users` / `_Groups` system datapoints via the webserver's shared
// WinccoaManager (WsjServerGlobal). Nothing here trusts client-sent identity.
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

import { identityOf, listGroups } from './appSecurityGuard';

export class AppSecurityController {
  /** GET /health */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'app-security' });
  };

  /** GET /me — the session user's identity + OA groups. */
  public me = async (req: Request, res: Response): Promise<void> => {
    try {
      const who = await identityOf(req);
      res.status(200).json({ ok: true, ...who });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  };

  /** GET /groups — every OA user group (for the admin page's pickers). */
  public groups = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json({ ok: true, groups: await listGroups() });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  };
}
