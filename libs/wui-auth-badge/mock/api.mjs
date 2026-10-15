// `wui dev`: the badge backend, mocked. Badge 12345678 is "dev"'s.
const users = [
  { userId: 1, username: 'dev', fullName: 'Dev', enabled: true },
  { userId: 2, username: 'operator', fullName: 'Opérateur', enabled: true },
  { userId: 3, username: 'former', fullName: 'Ancien compte', enabled: false }
];
const badges = new Map([[1, '12345678']]);
const settings = { badgeLoginEnabled: true, selfEnrolment: true };

const ownerOf = (uid) => [...badges].find(([, badge]) => badge === uid)?.[0];
const associate = (userId, uid) => {
  uid = String(uid ?? '').trim();
  if (uid.length < 4) return { status: 'invalid' };
  const owner = ownerOf(uid);
  if (owner !== undefined && owner !== userId) return { status: 'taken' };
  badges.set(userId, uid);
  return { status: 'ok' };
};
const last = (userId) => badges.get(userId)?.slice(-4) ?? null;

export default {
  'GET /api/auth-badge/config': () => ({ prefix: '', maxFrameMs: 150, minUidLength: 4, enabled: settings.badgeLoginEnabled }),
  'POST /api/auth-badge/login': ({ body }) => {
    if (!settings.badgeLoginEnabled) return { status: 'disabled' };
    const userId = ownerOf(body?.uid);
    return userId === 1 ? { status: 'ok', username: 'dev', fullName: 'Dev', token: 'mock-token' } : { status: 'unknown' };
  },
  'GET /api/auth-badge/me': () => ({
    username: 'dev',
    badge: last(1),
    selfEnrolment: settings.selfEnrolment,
    // As a user without the `enrol` role: turning self-service off on "Badges" shows the locked page.
    canChange: settings.selfEnrolment
  }),
  'PUT /api/auth-badge/me': ({ body }) => associate(1, body?.uid),
  'DELETE /api/auth-badge/me': () => {
    badges.delete(1);
    return { status: 'ok' };
  },
  'GET /api/auth-badge/settings': () => settings,
  'PUT /api/auth-badge/settings': ({ body }) => {
    for (const key of Object.keys(settings)) if (typeof body?.[key] === 'boolean') settings[key] = body[key];
    return settings;
  },
  'GET /api/auth-badge/users': () => users.map((user) => ({ ...user, badge: last(user.userId) })),
  // Exact paths only in `wui dev`: one route per mock user.
  ...Object.fromEntries(
    users.flatMap(({ userId }) => [
      [`PUT /api/auth-badge/users/${userId}`, ({ body }) => associate(userId, body?.uid)],
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
