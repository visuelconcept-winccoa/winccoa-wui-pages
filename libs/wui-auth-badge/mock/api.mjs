// `wui dev`: the badge backend, mocked. Badge 12345678 is "dev"'s.
import { createHmac } from 'node:crypto';

const users = [
  { userId: 1, username: 'dev', fullName: 'Dev', enabled: true },
  { userId: 2, username: 'operator', fullName: 'Opérateur', enabled: true },
  { userId: 3, username: 'former', fullName: 'Ancien compte', enabled: false }
];
const badges = new Map([[1, '12345678']]);
const settings = { badgeLoginEnabled: true, selfEnrolment: true, hashBadges: false, prefix: '', maxFrameMs: 150, minUidLength: 4, endKey: 'Enter' };

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
    return { prefix, maxFrameMs, minUidLength, endKey, enabled: badgeLoginEnabled };
  },
  'POST /api/auth-badge/login': ({ body }) => {
    if (!settings.badgeLoginEnabled) return { status: 'disabled' };
    const userId = ownerOf(body?.uid);
    return userId === 1 ? { status: 'ok', username: 'dev', fullName: 'Dev', token: 'mock-token' } : { status: 'unknown' };
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
