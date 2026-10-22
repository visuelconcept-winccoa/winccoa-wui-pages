// `wui dev`: the badge backend, mocked. Badge 12345678 is "dev"'s; the station 10.0.0.42 is locked
// (Badges › Liste noire), with two past locks in the history; this browser is the station "127.0.0.1".
import { createHmac } from 'node:crypto';

const users = [
  { userId: 1, username: 'dev', fullName: 'Dev', enabled: true },
  { userId: 2, username: 'operator', fullName: 'Opérateur', enabled: true },
  { userId: 3, username: 'former', fullName: 'Ancien compte', enabled: false }
];
const badges = new Map([[1, '12345678']]);
const settings = { badgeLoginEnabled: true, selfEnrolment: true, hashBadges: false, prefix: '', maxFrameMs: 150, minUidLength: 4, endKey: 'Enter', lockAfterFailures: 3, lockDurationMin: 15 };
// As backend/badgeBlacklist.ts: the locks newest first, the refusals counted per address.
const HOUR = 3_600_000;
const lockRecord = (ip, lockedAt, lockedUntil, failures, item, state, lifted = {}) => ({
  id: `${lockedAt}-${ip}`, ip, lockedAt, lockedUntil, failures, item, state,
  liftedBy: lifted.by ?? null, liftedAt: lifted.at ?? null, reason: lifted.reason ?? null
});
const now0 = Date.now();
const blacklist = {
  records: [
    lockRecord('10.0.0.42', now0 - 5 * 60_000, now0 + 10 * 60_000, 3, 'WC-12', 'active'),
    lockRecord('10.0.0.17', now0 - 26 * HOUR, now0 - 26 * HOUR + 15 * 60_000, 3, 'WC-03', 'lifted', { by: 'dev', at: now0 - 26 * HOUR + 5 * 60_000, reason: 'Badge abîmé, remplacé' }),
    lockRecord('10.0.0.42', now0 - 72 * HOUR, now0 - 72 * HOUR + 15 * 60_000, 3, 'WC-12', 'expired')
  ],
  pending: [{ ip: '10.0.0.7', failures: 1, item: 'WC-07', lastAt: now0 - 2 * 60_000 }]
};
const STATION = '127.0.0.1';
const activeLock = (ip) =>
  blacklist.records.find((record) => record.ip === ip && record.state === 'active' && (record.lockedUntil === null || record.lockedUntil > Date.now()));
/** A refused badge from this browser's station: `locked` at the threshold. */
const refuse = () => {
  if (settings.lockAfterFailures <= 0) return { status: 'unknown' };
  const counter = blacklist.pending.find((pending) => pending.ip === STATION) ?? { ip: STATION, failures: 0, item: '', lastAt: 0 };
  blacklist.pending = blacklist.pending.filter((pending) => pending.ip !== STATION);
  const failures = counter.failures + 1;
  const now = Date.now();
  if (failures < settings.lockAfterFailures) {
    blacklist.pending.unshift({ ...counter, failures, lastAt: now });
    return { status: 'unknown' };
  }
  const lockedUntil = settings.lockDurationMin > 0 ? now + settings.lockDurationMin * 60_000 : null;
  blacklist.records.unshift(lockRecord(STATION, now, lockedUntil, failures, '', 'active'));
  return { status: 'locked', lockedUntil };
};
/** An HTTP error, as the harness answers it. */
const httpError = (status, message) => Object.assign(new Error(message), { status });

// As backend/badgeHash.ts, with a fixed dev key.
const PREFIX = '$hmac-sha256$';
const hash = (uid) => PREFIX + createHmac('sha256', 'wui-dev-key').update(String(uid).trim()).digest('hex');
const matches = (stored, uid, hashOnly) =>
  stored.startsWith(PREFIX) ? stored === hash(uid) : !hashOnly && stored === String(uid).trim();

const ownerOf = (uid, anyForm = false) =>
  [...badges].find(([, stored]) => matches(stored, uid, !anyForm && settings.hashBadges))?.[0];
const associate = (userId, uid) => {
  uid = String(uid ?? '').trim();
  if (uid.length < settings.minUidLength || uid.startsWith(PREFIX)) return { status: 'invalid' };
  const owner = ownerOf(uid, true);
  if (owner !== undefined && owner !== userId) return { status: 'taken' };
  badges.set(userId, settings.hashBadges ? hash(uid) : uid);
  return { status: 'ok' };
};
const view = (userId) => {
  const stored = badges.get(userId);
  if (!stored) return { badge: null, hashed: false };
  return stored.startsWith(PREFIX) ? { badge: null, hashed: true } : { badge: stored.slice(-4), hashed: false };
};
const test = (userId, uid) => {
  uid = String(uid ?? '').trim();
  if (uid.length < settings.minUidLength) return { status: 'invalid' };
  const owner = ownerOf(uid);
  if (owner === userId) return { status: 'match' };
  const other = users.find((user) => user.userId === owner);
  return other ? { status: 'other', username: other.username } : { status: 'none' };
};

export default {
  'GET /api/auth-badge/config': () => {
    const { prefix, maxFrameMs, minUidLength, endKey, badgeLoginEnabled } = settings;
    const lock = activeLock(STATION);
    return { prefix, maxFrameMs, minUidLength, endKey, enabled: badgeLoginEnabled, locked: !!lock, lockedUntil: lock?.lockedUntil ?? null };
  },
  // The session's close: audited by the backend; nothing to keep here.
  'POST /api/auth-badge/logout': ({ body }) => {
    if (!['logout', 'switch-user', 'idle'].includes(body?.reason)) throw httpError(400, 'reason');
    return { status: 'ok' };
  },
  'POST /api/auth-badge/login': ({ body }) => {
    if (!settings.badgeLoginEnabled) return { status: 'disabled' };
    const lock = activeLock(STATION);
    if (lock) return { status: 'locked', lockedUntil: lock.lockedUntil };
    if (ownerOf(body?.uid) !== 1) return refuse();
    blacklist.pending = blacklist.pending.filter((pending) => pending.ip !== STATION);
    return { status: 'ok', username: 'dev', fullName: 'Dev', token: 'mock-token' };
  },
  'GET /api/auth-badge/me': () => ({
    username: 'dev',
    ...view(1),
    selfEnrolment: settings.selfEnrolment,
    // Self-service off on "Badges" locks the page, whatever the user's roles.
    canChange: settings.selfEnrolment
  }),
  'PUT /api/auth-badge/me': ({ body }) => associate(1, body?.uid),
  'DELETE /api/auth-badge/me': () => {
    badges.delete(1);
    return { status: 'ok' };
  },
  'GET /api/auth-badge/settings': () => settings,
  'PUT /api/auth-badge/settings': ({ body }) => {
    let migrated = 0;
    if (body?.hashBadges === true) {
      for (const [userId, stored] of badges) {
        if (stored.startsWith(PREFIX)) continue;
        badges.set(userId, hash(stored));
        migrated += 1;
      }
    }
    // The types only: the bounds are the backend's (badgeSettings.ts).
    for (const key of Object.keys(settings)) if (typeof body?.[key] === typeof settings[key]) settings[key] = body[key];
    return { ...settings, migrated };
  },
  'GET /api/auth-badge/users': () => users.map((user) => ({ ...user, ...view(user.userId) })),
  'GET /api/auth-badge/blacklist': () => {
    for (const record of blacklist.records) {
      if (record.state === 'active' && record.lockedUntil !== null && record.lockedUntil <= Date.now()) record.state = 'expired';
    }
    return blacklist;
  },
  // Exact paths only in `wui dev`: one route per mock address.
  ...Object.fromEntries(
    ['10.0.0.42', '10.0.0.17', STATION].map((ip) => [
      `POST /api/auth-badge/blacklist/${ip}/unlock`,
      ({ body }) => {
        if (typeof body?.reason !== 'string' || body.reason.trim() === '') throw httpError(400, 'reason');
        const lock = activeLock(ip);
        if (!lock) throw httpError(404, 'station not locked');
        Object.assign(lock, { state: 'lifted', liftedBy: 'dev', liftedAt: Date.now(), reason: body.reason.trim().slice(0, 200) });
        blacklist.pending = blacklist.pending.filter((pending) => pending.ip !== ip);
        return { status: 'ok', record: lock };
      }
    ])
  ),
  // Exact paths only in `wui dev`: one route per mock user.
  ...Object.fromEntries(
    users.flatMap(({ userId }) => [
      [`PUT /api/auth-badge/users/${userId}`, ({ body }) => associate(userId, body?.uid)],
      [`POST /api/auth-badge/users/${userId}/test`, ({ body }) => test(userId, body?.uid)],
      [
        `DELETE /api/auth-badge/users/${userId}`,
        () => {
          badges.delete(userId);
          return { status: 'ok' };
        }
      ]
    ])
  )
};
