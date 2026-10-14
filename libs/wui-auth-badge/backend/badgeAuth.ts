// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// BadgeAuth — the server side of the badge login (taken from the fra-stma
// site, spec 2.1 §5.8):
//
//   - badge → user through the user setting RFID_UID (`_usr_<UserId>_RFID_UID`),
//     resolved here so the badge numbers never reach the browser;
//   - the login page locked for 15 minutes after three unknown badges in a
//     row, the lock re-armed by any badge presented meanwhile — per client
//     station: a page reload does not lift it;
//   - an audit line per event, never the badge number — its item, what the
//     page passes on (the station's, from the site's modules: `item`);
//   - the reader's frame: WUI_BADGE_PREFIX (MSP_BADGE_PREFIX, the site's
//     former name, still read);
//   - the session: the WebUI token of the recognised user, signed as
//     /WebUI_Token signs it after a password (oaAuth.ts).
//
// And for the logged-in user (their token, never a name sent by the page):
// their badge, associated or removed.
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

import {
  audit,
  clientAddress,
  readUserSettings,
  sessionUser,
  signWebUiToken,
  userById,
  writeUserSetting
} from './oaAuth';

const MAX_CONSECUTIVE_FAILURES = 3;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const MIN_UID_LENGTH = 4;
const MAX_ITEM_LENGTH = 64;

const BADGE_FRAME = {
  prefix: process.env['WUI_BADGE_PREFIX'] ?? process.env['MSP_BADGE_PREFIX'] ?? '',
  maxFrameMs: 150,
  minUidLength: MIN_UID_LENGTH
};

const SETTING = 'RFID_UID';
const SETTING_NAME = 'Numéro de badge RFID';

interface ClientLock {
  failures: number;
  lockedUntil: number;
}

export class BadgeAuth {
  private readonly locks = new Map<string, ClientLock>();

  /** GET /config — the reader's frame. */
  getConfig = (_req: Request, res: Response): void => {
    res.json(BADGE_FRAME);
  };

  /**
   * POST /login  { uid, dbrw?, item? }
   *   → { status: 'ok', username, fullName, token } | { status: 'unknown' } | { status: 'locked', lockedUntil }
   * A recognised user without the WebUI login permission gets `unknown`.
   * 400 without a number, 503 when the badges cannot be read.
   */
  login = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { uid?: unknown; dbrw?: unknown; item?: unknown };
    const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
    // What the login is about, as the station says (its workcenter…): the audit line's item.
    const item = typeof body.item === 'string' ? body.item.trim().slice(0, MAX_ITEM_LENGTH) : '';
    if (uid === '') {
      res.status(400).json({ status: 'error', error: 'uid missing' });
      return;
    }
    const host = clientAddress(req);
    const now = Date.now();
    const lock = this.lockOf(host, now);

    if (lock.lockedUntil > now) {
      lock.lockedUntil = now + LOCK_DURATION_MS;
      void audit({ action: 'BADGE_REFUSE_VERROU', item, host, reason: 'Badge présenté pendant le verrouillage de la mire' });
      res.json({ status: 'locked', lockedUntil: lock.lockedUntil });
      return;
    }

    let userId: number | undefined;
    try {
      userId = await this.userIdOf(uid);
    } catch (error) {
      console.error('[auth-badge] badges unreadable', error);
      res.status(503).json({ status: 'error', error: 'badge login unavailable' });
      return;
    }
    const user = userId === undefined ? undefined : await userById(userId);

    if (!user?.enabled) {
      lock.failures += 1;
      void audit({ action: 'BADGE_INCONNU', item, host, reason: 'Badge non reconnu' });
      if (lock.failures >= MAX_CONSECUTIVE_FAILURES) {
        lock.failures = 0;
        lock.lockedUntil = now + LOCK_DURATION_MS;
        void audit({ action: 'MIRE_VERROUILLEE', item, host, reason: `${MAX_CONSECUTIVE_FAILURES} badges non reconnus consécutifs` });
        res.json({ status: 'locked', lockedUntil: lock.lockedUntil });
        return;
      }
      res.json({ status: 'unknown' });
      return;
    }

    let token = '';
    try {
      token = await signWebUiToken(user.username, body.dbrw === true);
    } catch (error) {
      console.error('[auth-badge] WebUI token not signed', error);
      res.status(503).json({ status: 'error', error: 'badge login unavailable' });
      return;
    }
    if (!token) {
      void audit({ action: 'SESSION_REFUSEE', username: user.username, userId: user.userId, item, host, reason: 'Mode badge : permission de connexion absente' });
      res.json({ status: 'unknown' });
      return;
    }

    this.locks.delete(host);
    void audit({ action: 'OUVERTURE_SESSION', username: user.username, userId: user.userId, item, host, reason: 'Mode badge' });
    res.json({ status: 'ok', username: user.username, fullName: user.fullName, token });
  };

  /** GET /me — the logged-in user's badge: { username, badge: last digits | null }. */
  me = async (req: Request, res: Response): Promise<void> => {
    const user = await sessionUser(req).catch(() => null);
    if (!user) {
      res.status(401).json({ status: 'error', error: 'not logged in' });
      return;
    }
    const uid = (await readUserSettings(SETTING, SETTING_NAME)).get(user.userId)?.[0];
    res.json({ username: user.username, badge: uid ? uid.slice(-4) : null });
  };

  /** PUT /me  { uid } — associates a badge with the logged-in user: { status: 'ok' | 'taken' | 'invalid' }. */
  enrol = async (req: Request, res: Response): Promise<void> => {
    const user = await sessionUser(req).catch(() => null);
    if (!user) {
      res.status(401).json({ status: 'error', error: 'not logged in' });
      return;
    }
    const body = (req.body ?? {}) as { uid?: unknown };
    const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
    if (uid.length < MIN_UID_LENGTH) {
      res.json({ status: 'invalid' });
      return;
    }
    const owner = await this.userIdOf(uid);
    if (owner !== undefined && owner !== user.userId) {
      void audit({ action: 'BADGE_DEJA_ASSOCIE', username: user.username, userId: user.userId, host: clientAddress(req), reason: 'Badge associé à un autre compte' });
      res.json({ status: 'taken' });
      return;
    }
    await writeUserSetting(user.userId, SETTING, SETTING_NAME, [uid]);
    void audit({ action: 'BADGE_ASSOCIE', username: user.username, userId: user.userId, host: clientAddress(req), reason: 'Badge associé au compte' });
    res.json({ status: 'ok' });
  };

  /** DELETE /me — removes the logged-in user's badge. */
  forget = async (req: Request, res: Response): Promise<void> => {
    const user = await sessionUser(req).catch(() => null);
    if (!user) {
      res.status(401).json({ status: 'error', error: 'not logged in' });
      return;
    }
    await writeUserSetting(user.userId, SETTING, SETTING_NAME, []);
    void audit({ action: 'BADGE_RETIRE', username: user.username, userId: user.userId, host: clientAddress(req), reason: 'Badge retiré du compte' });
    res.json({ status: 'ok' });
  };

  /** The user a badge number is associated with. */
  private async userIdOf(uid: string): Promise<number | undefined> {
    for (const [userId, content] of await readUserSettings(SETTING, SETTING_NAME)) {
      if (content[0]?.trim() === uid) return userId;
    }
    return undefined;
  }

  /** The station's counter; an expired lock lifted (and audited). */
  private lockOf(host: string, now: number): ClientLock {
    let lock = this.locks.get(host);
    if (!lock) {
      lock = { failures: 0, lockedUntil: 0 };
      this.locks.set(host, lock);
    } else if (lock.lockedUntil !== 0 && lock.lockedUntil <= now) {
      lock.lockedUntil = 0;
      void audit({ action: 'MIRE_DEVERROUILLEE', host, reason: 'Fin du délai de verrouillage' });
    }
    return lock;
  }
}
