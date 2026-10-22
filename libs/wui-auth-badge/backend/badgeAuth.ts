// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// BadgeAuth — the server side of the badge login (taken from the fra-stma
// site, spec 2.1 §5.8):
//
//   - badge → user through the user setting RFID_UID (`_usr_<UserId>_RFID_UID`),
//     resolved here so the badge numbers never reach the browser;
//   - a user's badge locked after `lockAfterFailures` refused logins in a row
//     imputable to them (disabled account, no WebUI login permission), for
//     `lockDurationMin` minutes or until unlocked on "Badges" (the settings,
//     badgeSettings.ts) — kept in their user setting BADGE_LOCK (badgeLock.ts):
//     the lock survives a webserver restart and holds on every station; a
//     login reset the count. An unknown badge locks nothing: it is only
//     audited. The lock's expiry is audited when the badge is next presented;
//   - the session's close (logout, switch user, idle expiry), audited for the
//     user of the request's WebUI token (POST /logout), whatever the login
//     provider that opened it;
//   - an audit line per event, never the badge number — its item, what the
//     page passes on (the station's, from the site's modules: `item`);
//   - the reader's frame: WUI_BADGE_PREFIX (MSP_BADGE_PREFIX, the site's
//     former name, still read);
//   - the session: the WebUI token of the recognised user, signed as
//     /WebUI_Token signs it after a password (oaAuth.ts).
//
// And for the logged-in user (their token, never a name sent by the page):
// their badge, associated or removed — only when the settings let every user
// do it (`selfEnrolment`); else on the "Badges" page, by the `enrol` role.
//
// The "Badges" page: the settings (badgeSettings.ts; the `configure` role) and
// any user's badge and lock (the `enrol` role; an unlock needs a reason). The roles are Application Security's,
// module `auth-badge` (src/app-security.roles.json), checked here against the
// user of the request's WebUI token: a badge session has no webserver session,
// so the guard's own `requireRole` could not tell who calls.
//
// The numbers may be stored as one-way fingerprints (the `hashBadges` setting,
// badgeHash.ts): turned on, every number in clear is rewritten as one; turned
// off, they stay — a badge then matches in clear or as a fingerprint.
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

import { identityOfUsername, roleAssignments, roleGranted } from './appSecurityGuard';
import { hashKey, hashUid, isHashed, matches } from './badgeHash';
import {
  afterFailure,
  BadgeLock,
  hasExpired,
  isLocked,
  LOCK_SETTING,
  LOCK_SETTING_NAME,
  lockView,
  NO_LOCK,
  parseLock,
  serializeLock
} from './badgeLock';
import { BadgeSettings, DEFAULT_SETTINGS, readSettings, validSetting, writeSettings } from './badgeSettings';
import {
  audit,
  clientAddress,
  readUserSettings,
  sessionUser,
  signWebUiToken,
  userById,
  users,
  OaUser,
  verifyWebUiToken,
  writeUserSetting
} from './oaAuth';

const MAX_ITEM_LENGTH = 64;
const MAX_REASON_LENGTH = 200;

const SETTING = 'RFID_UID';
const SETTING_NAME = 'Numéro de badge RFID';

/** The Application Security module of the roles (src/app-security.roles.json). */
const MODULE = 'auth-badge';
type Role = 'configure' | 'enrol';

type EnrolStatus = 'ok' | 'taken' | 'invalid';
type TestStatus = 'match' | 'other' | 'none' | 'invalid';

/** Who calls a role-guarded route: the user of their WebUI token. */
interface Actor {
  username: string;
  userId: number;
}

/** Why a session closes (POST /logout), and its audit action. */
const CLOSE_ACTIONS = {
  logout: 'SESSION_FERMEE',
  'switch-user': 'SESSION_CHANGEMENT_UTILISATEUR',
  idle: 'SESSION_EXPIREE_INACTIVITE'
} as const;
type CloseReason = keyof typeof CLOSE_ACTIONS;

export class BadgeAuth {
  /** GET /config — the reader's frame, and whether the badge login is enabled. */
  getConfig = async (_req: Request, res: Response): Promise<void> => {
    const { prefix, maxFrameMs, minUidLength, endKey, badgeLoginEnabled } = await readSettings();
    res.json({ prefix, maxFrameMs, minUidLength, endKey, enabled: badgeLoginEnabled });
  };

  /**
   * POST /login  { uid, dbrw?, item? }
   *   → { status: 'ok', username, fullName, token } | { status: 'unknown' }
   *     | { status: 'locked', lockedUntil, username, fullName } (lockedUntil null: until unlocked on "Badges")
   *     | { status: 'disabled' } (the settings' badgeLoginEnabled off)
   * An unknown badge: `unknown`, audited, nothing locked. A recognised user refused (disabled,
   * no WebUI login permission): `unknown`, one more failure of theirs — `locked` at the threshold.
   * 400 without a number, 503 when the badges cannot be read.
   */
  login = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { uid?: unknown; dbrw?: unknown; item?: unknown };
    const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
    // What the login is about, as the station says (its workcenter…): the audit line's item.
    const item = textOf(body.item, MAX_ITEM_LENGTH);
    if (uid === '') {
      res.status(400).json({ status: 'error', error: 'uid missing' });
      return;
    }
    const host = clientAddress(req);
    const settings = await readSettings();
    if (!settings.badgeLoginEnabled) {
      void audit({ action: 'BADGE_REFUSE_DESACTIVE', item, host, reason: 'Connexion par badge désactivée' });
      res.json({ status: 'disabled' });
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
    if (!user) {
      // Nobody to lock: audited only, every time.
      void audit({ action: 'BADGE_INCONNU', item, host, reason: 'Badge non reconnu' });
      res.json({ status: 'unknown' });
      return;
    }

    const now = Date.now();
    const lock = await this.currentLock(user, now, item, host);
    if (isLocked(lock, now)) {
      void audit({ action: 'BADGE_REFUSE_VERROU', username: user.username, userId: user.userId, item, host, reason: 'Badge présenté pendant le verrouillage du compte' });
      res.json(lockedAnswer(user, lock));
      return;
    }

    if (!user.enabled) {
      await this.refuse(res, user, lock, { now, item, host, reason: 'Mode badge : compte désactivé' });
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
      await this.refuse(res, user, lock, { now, item, host, reason: 'Mode badge : permission de connexion absente' });
      return;
    }

    // A login resets the count; failing to store it must not refuse the login.
    if (lock !== NO_LOCK) await this.storeLock(user.userId, NO_LOCK).catch((error: unknown) => console.error('[auth-badge] badge lock not reset', error));
    void audit({ action: 'OUVERTURE_SESSION', username: user.username, userId: user.userId, item, host, reason: 'Mode badge' });
    res.json({ status: 'ok', username: user.username, fullName: user.fullName, token });
  };

  /**
   * POST /logout  { reason: 'logout' | 'switch-user' | 'idle', item?, provider?, idleMinutes? }
   * — the session of the request's WebUI token closes: an audit line (SESSION_FERMEE,
   * SESSION_CHANGEMENT_UTILISATEUR, SESSION_EXPIREE_INACTIVITE) for that user — never a name
   * sent by the page —, whatever the login provider that opened it (`provider`, named in the
   * line). 401 without a valid token, 400 on an unknown reason. The page does not wait for it.
   */
  logout = async (req: Request, res: Response): Promise<void> => {
    const actor = await this.actorOf(req);
    if (!actor) {
      res.status(401).json({ status: 'error', error: 'not logged in' });
      return;
    }
    const body = (req.body ?? {}) as { reason?: unknown; item?: unknown; provider?: unknown; idleMinutes?: unknown };
    const reason = body.reason;
    if (typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(CLOSE_ACTIONS, reason)) {
      res.status(400).json({ status: 'invalid', field: 'reason' });
      return;
    }
    const provider = textOf(body.provider, MAX_ITEM_LENGTH);
    const idle = typeof body.idleMinutes === 'number' && Number.isFinite(body.idleMinutes) && body.idleMinutes > 0 ? body.idleMinutes : 0;
    const why = {
      logout: 'Déconnexion',
      'switch-user': "Changement d'utilisateur",
      idle: idle > 0 ? `Déconnexion automatique après ${idle} min d'inactivité` : 'Déconnexion automatique (inactivité)'
    }[reason as CloseReason];
    await audit({
      action: CLOSE_ACTIONS[reason as CloseReason],
      username: actor.username,
      userId: actor.userId,
      item: textOf(body.item, MAX_ITEM_LENGTH),
      host: clientAddress(req),
      reason: provider ? `${why} (connexion : ${provider})` : why
    });
    res.json({ status: 'ok' });
  };

  /**
   * GET /me — the logged-in user's badge:
   * { username, badge: last digits | null, hashed, selfEnrolment, canChange }
   * (`hashed`: a badge is associated, stored as a fingerprint — no digits)
   * (`canChange`: the settings' selfEnrolment — the `enrol` role does not open it).
   */
  me = async (req: Request, res: Response): Promise<void> => {
    const user = await sessionUser(req).catch(() => null);
    if (!user) {
      res.status(401).json({ status: 'error', error: 'not logged in' });
      return;
    }
    const { selfEnrolment } = await readSettings();
    const uid = (await readUserSettings(SETTING, SETTING_NAME)).get(user.userId)?.[0];
    res.json({
      username: user.username,
      ...badgeView(uid),
      selfEnrolment,
      canChange: selfEnrolment
    });
  };

  /** PUT /me  { uid } — associates a badge with the logged-in user: { status: 'ok' | 'taken' | 'invalid' }; 403 when not allowed. */
  enrol = async (req: Request, res: Response): Promise<void> => {
    const user = await sessionUser(req).catch(() => null);
    if (!user) {
      res.status(401).json({ status: 'error', error: 'not logged in' });
      return;
    }
    if (!(await this.canChangeOwn())) {
      void audit({ action: 'BADGE_REFUSE_ENROLEMENT', username: user.username, userId: user.userId, host: clientAddress(req), reason: "Association par l'utilisateur non autorisée" });
      res.status(403).json({ status: 'forbidden' });
      return;
    }
    const body = (req.body ?? {}) as { uid?: unknown };
    const status = await this.associate(user.userId, body.uid);
    if (status === 'taken') {
      void audit({ action: 'BADGE_DEJA_ASSOCIE', username: user.username, userId: user.userId, host: clientAddress(req), reason: 'Badge associé à un autre compte' });
    } else if (status === 'ok') {
      void audit({ action: 'BADGE_ASSOCIE', username: user.username, userId: user.userId, host: clientAddress(req), reason: 'Badge associé au compte' });
    }
    res.json({ status });
  };

  /** DELETE /me — removes the logged-in user's badge; 403 when not allowed. */
  forget = async (req: Request, res: Response): Promise<void> => {
    const user = await sessionUser(req).catch(() => null);
    if (!user) {
      res.status(401).json({ status: 'error', error: 'not logged in' });
      return;
    }
    if (!(await this.canChangeOwn())) {
      res.status(403).json({ status: 'forbidden' });
      return;
    }
    await writeUserSetting(user.userId, SETTING, SETTING_NAME, []);
    void audit({ action: 'BADGE_RETIRE', username: user.username, userId: user.userId, host: clientAddress(req), reason: 'Badge retiré du compte' });
    res.json({ status: 'ok' });
  };

  // --- the "Badges" page --------------------------------------------------------

  /** GET /settings — the settings, for any logged-in user (the page shows them read-only without `configure`). */
  getSettings = async (req: Request, res: Response): Promise<void> => {
    if (!(await this.actorOf(req))) {
      res.status(401).json({ status: 'error', error: 'not logged in' });
      return;
    }
    res.json(await readSettings());
  };

  /**
   * PUT /settings  { badgeLoginEnabled?, selfEnrolment?, hashBadges?, prefix?, maxFrameMs?, minUidLength?, endKey?,
   *                  lockAfterFailures?, lockDurationMin? }
   * — the `configure` role: the stored settings, and `migrated`: the numbers in clear rewritten as
   * fingerprints (`hashBadges: true` — done before the setting is stored: a failure leaves it off);
   * 400 on a value out of bounds (badgeSettings.ts).
   */
  putSettings = async (req: Request, res: Response): Promise<void> => {
    const actor = await this.authorize(req, res, 'configure');
    if (!actor) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof BadgeSettings)[]) {
      if (!(key in body)) continue;
      const value = validSetting(key, body[key]);
      if (value === undefined) {
        res.status(400).json({ status: 'invalid', field: key });
        return;
      }
      patch[key] = value;
    }
    const before = await readSettings();
    // Idempotent: asked again, it rewrites what was left in clear.
    const migrated = patch['hashBadges'] === true ? await this.hashClearBadges() : 0;
    if (migrated > 0) {
      void audit({ action: 'BADGES_CHIFFRES', username: actor.username, userId: actor.userId, host: clientAddress(req), reason: `${migrated} code(s) badge chiffré(s)` });
    }
    const after = await writeSettings(patch as Partial<BadgeSettings>);
    const changes = (Object.keys(patch) as (keyof BadgeSettings)[])
      .filter((key) => before[key] !== after[key])
      .map((key) => `${key}=${String(after[key])}`);
    if (changes.length > 0) {
      void audit({ action: 'CONFIG_BADGE_MODIFIEE', username: actor.username, userId: actor.userId, host: clientAddress(req), reason: changes.join(', ') });
    }
    res.json({ ...after, migrated });
  };

  /**
   * GET /users — the `enrol` role: every user a badge can open (root excepted), with their badge
   * (`badge`, `hashed`: as for /me) and their lock (`lock`: { locked, lockedAt, lockedUntil, failures },
   * an expired lock shown as none).
   */
  listUsers = async (req: Request, res: Response): Promise<void> => {
    if (!(await this.authorize(req, res, 'enrol'))) return;
    const [badges, locks] = await Promise.all([
      readUserSettings(SETTING, SETTING_NAME),
      readUserSettings(LOCK_SETTING, LOCK_SETTING_NAME)
    ]);
    const now = Date.now();
    const list = (await users())
      .filter((user) => user.userId > 0 && user.username)
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((user) => {
        const uid = badges.get(user.userId)?.[0];
        return { ...user, ...badgeView(uid), lock: lockView(parseLock(locks.get(user.userId)?.[0]), now) };
      });
    res.json(list);
  };

  /**
   * POST /users/:userId/unlock  { reason } — the `enrol` role: lifts that user's badge lock and
   * resets their failures; 400 without a reason (audited with it: BADGE_DEVERROUILLE).
   */
  unlockUser = async (req: Request, res: Response): Promise<void> => {
    const actor = await this.authorize(req, res, 'enrol');
    if (!actor) return;
    const target = await userById(Number(req.params['userId']));
    if (!target) {
      res.status(404).json({ status: 'error', error: 'unknown user' });
      return;
    }
    const reason = textOf(((req.body ?? {}) as { reason?: unknown }).reason, MAX_REASON_LENGTH);
    if (reason === '') {
      res.status(400).json({ status: 'invalid', field: 'reason' });
      return;
    }
    const before = await this.readLock(target.userId);
    await this.storeLock(target.userId, NO_LOCK);
    const was = isLocked(before, Date.now()) ? 'verrouillé' : `${before.failures} échec(s) en cours`;
    void audit({
      action: 'BADGE_DEVERROUILLE',
      username: actor.username,
      userId: actor.userId,
      host: clientAddress(req),
      reason: `Compte ${target.username} déverrouillé par ${actor.username} (${was}) : ${reason}`
    });
    res.json({ status: 'ok' });
  };

  /** PUT /users/:userId  { uid } — the `enrol` role: associates a badge with that user: { status: 'ok' | 'taken' | 'invalid' }. */
  enrolUser = async (req: Request, res: Response): Promise<void> => {
    const actor = await this.authorize(req, res, 'enrol');
    if (!actor) return;
    const target = await userById(Number(req.params['userId']));
    if (!target) {
      res.status(404).json({ status: 'error', error: 'unknown user' });
      return;
    }
    const body = (req.body ?? {}) as { uid?: unknown };
    const status = await this.associate(target.userId, body.uid);
    if (status === 'taken') {
      void audit({ action: 'BADGE_DEJA_ASSOCIE', username: actor.username, userId: actor.userId, host: clientAddress(req), reason: `Badge associé à un autre compte (enrôlement de ${target.username})` });
    } else if (status === 'ok') {
      void audit({ action: 'BADGE_ASSOCIE', username: actor.username, userId: actor.userId, host: clientAddress(req), reason: `Badge associé au compte ${target.username} par ${actor.username}` });
    }
    res.json({ status });
  };

  /**
   * POST /users/:userId/test  { uid } — the `enrol` role: does the presented badge open that user's session?
   *   → { status: 'match' } | { status: 'other', username } (another user's) | { status: 'none' } | { status: 'invalid' }
   * The login's own rules (the `hashBadges` setting); nothing is written. A disabled user's match is still a match.
   */
  testUser = async (req: Request, res: Response): Promise<void> => {
    const actor = await this.authorize(req, res, 'enrol');
    if (!actor) return;
    const target = await userById(Number(req.params['userId']));
    if (!target) {
      res.status(404).json({ status: 'error', error: 'unknown user' });
      return;
    }
    const body = (req.body ?? {}) as { uid?: unknown };
    const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
    if (uid.length < (await readSettings()).minUidLength) {
      res.json({ status: 'invalid' satisfies TestStatus });
      return;
    }
    const owner = await this.userIdOf(uid);
    if (owner === target.userId) {
      res.json({ status: 'match' satisfies TestStatus });
      return;
    }
    const other = owner === undefined ? undefined : await userById(owner);
    res.json(other ? { status: 'other' satisfies TestStatus, username: other.username } : { status: 'none' satisfies TestStatus });
  };

  /** DELETE /users/:userId — the `enrol` role: removes that user's badge. */
  forgetUser = async (req: Request, res: Response): Promise<void> => {
    const actor = await this.authorize(req, res, 'enrol');
    if (!actor) return;
    const target = await userById(Number(req.params['userId']));
    if (!target) {
      res.status(404).json({ status: 'error', error: 'unknown user' });
      return;
    }
    await writeUserSetting(target.userId, SETTING, SETTING_NAME, []);
    void audit({ action: 'BADGE_RETIRE', username: actor.username, userId: actor.userId, host: clientAddress(req), reason: `Badge retiré du compte ${target.username} par ${actor.username}` });
    res.json({ status: 'ok' });
  };

  // --- helpers ------------------------------------------------------------------

  /** Associates `uid` with a user, refused when it is another user's. */
  private async associate(userId: number, rawUid: unknown): Promise<EnrolStatus> {
    const uid = typeof rawUid === 'string' ? rawUid.trim() : '';
    const { minUidLength, hashBadges } = await readSettings();
    // A number shaped as a fingerprint would never match again.
    if (uid.length < minUidLength || isHashed(uid)) return 'invalid';
    // Refused in either form: a number in clear left over must not be given twice.
    const owner = await this.userIdOf(uid, { anyForm: true });
    if (owner !== undefined && owner !== userId) return 'taken';
    const stored = hashBadges ? hashUid(uid, hashKey(true) as Buffer) : uid;
    await writeUserSetting(userId, SETTING, SETTING_NAME, [stored]);
    return 'ok';
  }

  /** Rewrites every number stored in clear as its fingerprint; how many were. */
  private async hashClearBadges(): Promise<number> {
    const key = hashKey(true) as Buffer;
    let count = 0;
    for (const [userId, content] of await readUserSettings(SETTING, SETTING_NAME)) {
      const stored = content[0]?.trim();
      if (!stored || isHashed(stored)) continue;
      await writeUserSetting(userId, SETTING, SETTING_NAME, [hashUid(stored, key)]);
      count += 1;
    }
    return count;
  }

  /** A user changes their own badge on "Mon badge" with selfEnrolment only; else on "Badges", by the `enrol` role. */
  private async canChangeOwn(): Promise<boolean> {
    return (await readSettings()).selfEnrolment;
  }

  private async hasRole(username: string, role: Role): Promise<boolean> {
    const [assignments, who] = await Promise.all([roleAssignments(MODULE), identityOfUsername(username)]);
    return roleGranted(assignments, role, who);
  }

  /** The user of the request's WebUI token — root included, unlike `sessionUser` — or null. */
  private async actorOf(req: Request): Promise<Actor | null> {
    const header = req.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    const jwt = /^Bearer\s+(\S+)$/i.exec(value ?? '')?.[1];
    if (!jwt) return null;
    const username = await verifyWebUiToken(jwt).catch(() => '');
    if (!username) return null;
    const user = (await users()).find((candidate) => candidate.username === username);
    return user?.enabled ? { username: user.username, userId: user.userId } : null;
  }

  /** The caller when they have `role`; else answers 401 / 403 and gives null. */
  private async authorize(req: Request, res: Response, role: Role): Promise<Actor | null> {
    const actor = await this.actorOf(req);
    if (!actor) {
      res.status(401).json({ status: 'error', error: 'not logged in' });
      return null;
    }
    if (!(await this.hasRole(actor.username, role))) {
      res.status(403).json({ status: 'forbidden', error: `role '${role}' of '${MODULE}' required` });
      return null;
    }
    return actor;
  }

  /**
   * The user a badge number is associated with — by the login's rules: with
   * `hashBadges`, fingerprints only; without, in clear or as a fingerprint.
   * `anyForm`: either form whatever the setting (duplicates).
   */
  private async userIdOf(uid: string, { anyForm = false } = {}): Promise<number | undefined> {
    const hashOnly = !anyForm && (await readSettings()).hashBadges;
    const key = hashKey(false);
    for (const [userId, content] of await readUserSettings(SETTING, SETTING_NAME)) {
      if (content[0] !== undefined && matches(content[0], uid, key, hashOnly)) return userId;
    }
    return undefined;
  }

  private async readLock(userId: number): Promise<BadgeLock> {
    return parseLock((await readUserSettings(LOCK_SETTING, LOCK_SETTING_NAME)).get(userId)?.[0]);
  }

  private async storeLock(userId: number, lock: BadgeLock): Promise<void> {
    await writeUserSetting(userId, LOCK_SETTING, LOCK_SETTING_NAME, serializeLock(lock));
  }

  /** The user's lock; an expired one lifted (and audited). */
  private async currentLock(user: OaUser, now: number, item: string, host: string): Promise<BadgeLock> {
    const lock = await this.readLock(user.userId);
    if (!hasExpired(lock, now)) return lock;
    await this.storeLock(user.userId, NO_LOCK);
    void audit({ action: 'BADGE_VERROU_EXPIRE', username: user.username, userId: user.userId, item, host, reason: 'Fin du délai de verrouillage du compte' });
    return NO_LOCK;
  }

  /** A login refused to a recognised user: audited, one more failure of theirs — locked at the threshold. */
  private async refuse(
    res: Response,
    user: OaUser,
    lock: BadgeLock,
    { now, item, host, reason }: { now: number; item: string; host: string; reason: string }
  ): Promise<void> {
    void audit({ action: 'SESSION_REFUSEE', username: user.username, userId: user.userId, item, host, reason });
    const settings = await readSettings();
    const next = afterFailure(lock, settings, now, host);
    if (next.lock !== lock) {
      try {
        await this.storeLock(user.userId, next.lock);
      } catch (error) {
        // The refusal stands; only the count is lost.
        console.error('[auth-badge] badge lock not stored', error);
      }
    }
    if (!next.locked) {
      res.json({ status: 'unknown' });
      return;
    }
    const until = next.lock.lockedUntil === null ? "jusqu'au déverrouillage manuel" : `${settings.lockDurationMin} min`;
    void audit({
      action: 'BADGE_VERROUILLE',
      username: user.username,
      userId: user.userId,
      item,
      host,
      reason: `${next.lock.failures} refus consécutifs : badge verrouillé (${until})`
    });
    res.json(lockedAnswer(user, next.lock));
  }
}

/** The login's answer to a locked user's badge. */
function lockedAnswer(user: OaUser, lock: BadgeLock): { status: 'locked'; lockedUntil: number | null; username: string; fullName: string } {
  return { status: 'locked', lockedUntil: lock.lockedUntil, username: user.username, fullName: user.fullName };
}

/** A trimmed text of at most `max` characters; '' when not a string. */
function textOf(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

/**
 * What the browser may see of a stored badge: the last digits of a number in
 * clear (`badge`), nothing of a fingerprint (`hashed`).
 */
function badgeView(stored: string | undefined): { badge: string | null; hashed: boolean } {
  if (!stored) return { badge: null, hashed: false };
  return isHashed(stored) ? { badge: null, hashed: true } : { badge: stored.slice(-4), hashed: false };
}
