// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// BadgeRoute — mounted at /api/auth-badge (badgeAuth.ts):
//
//   GET    /config          the reader's frame (prefix, timing), the login enabled
//   POST   /login           { uid, dbrw? }  the badge login — no session needed
//   GET    /me              the logged-in user's badge   (Authorization: Bearer <WebUI token>)
//   PUT    /me              { uid }  associate a badge    (idem; selfEnrolment only)
//   DELETE /me              remove it                     (idem; selfEnrolment only)
//   GET    /settings        the settings                  (idem)
//   PUT    /settings        change them                   (idem; `configure`)
//   GET    /users           the users and their badge     (idem; `enrol`)
//   PUT    /users/:userId   { uid }  associate a badge    (idem; `enrol`)
//   POST   /users/:userId/test  { uid }  does it open that user's session (idem; `enrol`)
//   DELETE /users/:userId   remove it                     (idem; `enrol`)
// -----------------------------------------------------------------------------

import { Request, Response, Router, json } from 'ultimate-express';

import { BadgeAuth } from './badgeAuth';

/** An async handler whose failure answers 503 instead of leaving the request open. */
const safe =
  (handler: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response): void => {
    Promise.resolve(handler(req, res)).catch((error: unknown) => {
      console.error('[auth-badge]', error);
      if (!res.headersSent) res.status(503).json({ status: 'error', error: 'badge service unavailable' });
    });
  };

export class BadgeRoute {
  static routes(): Router {
    const router = Router();
    const badge = new BadgeAuth();
    router.use(json());
    router.get('/config', safe(badge.getConfig));
    router.post('/login', safe(badge.login));
    router.get('/me', safe(badge.me));
    router.put('/me', safe(badge.enrol));
    router.delete('/me', safe(badge.forget));
    router.get('/settings', safe(badge.getSettings));
    router.put('/settings', safe(badge.putSettings));
    router.get('/users', safe(badge.listUsers));
    router.put('/users/:userId', safe(badge.enrolUser));
    router.post('/users/:userId/test', safe(badge.testUser));
    router.delete('/users/:userId', safe(badge.forgetUser));
    return router;
  }
}
