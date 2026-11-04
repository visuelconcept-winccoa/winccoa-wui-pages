// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// BadgeAuth against an in-memory WinCC OA: the users, their settings (badges)
// and the audit lines, mocked in place of oaAuth.ts; the DPs (the blacklist's,
// through the real badgeBlacklist.ts) in place of @winccoa/backend; the
// settings and the Application Security guard, mocked too.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'ultimate-express';
import { BadgeAuth } from './badgeAuth';

const oa = vi.hoisted(() => ({
  users: [] as { username: string; fullName: string; userId: number; enabled: boolean }[],
  /** setting → UserId → content */
  settings: new Map<string, Map<number, string[]>>(),
  audit: [] as { action: string; username?: string; item?: string; reason: string; host: string }[],
  /** users without the WebUI login permission */
  noPermission: new Set<string>(),
  /** users with the `enrol` role */
  enrol: new Set<string>(),
  /** users with the `configure` role */
  configure: new Set<string>(),
  badgeSettings: {} as Record<string, unknown>,
  /** DP → value (the blacklist's) */
  dps: new Map<string, unknown>()
}));

vi.mock('@winccoa/backend', () => ({
  WsjServerGlobal: {
    winccoa: {
      dpExists: (dp: string) => oa.dps.has(dp),
      dpTypes: () => [],
      dpTypeCreate: async () => true,
      dpCreate: async (dp: string) => {
        oa.dps.set(dp, '');
        return true;
      },
      dpGet: async (dpe: string) => oa.dps.get(dpe.split('.')[0] as string),
      dpSetWait: async (dpe: string, value: unknown) => {
        oa.dps.set(dpe.split('.')[0] as string, value);
      }
    }
  }
}));
vi.mock('winccoa-manager', () => ({ WinccoaDpTypeNode: class {}, WinccoaElementType: {} }));

vi.mock('./oaAuth', () => ({
  users: async () => oa.users,
  userById: async (userId: number) => oa.users.find((user) => user.userId === userId && userId > 0),
  readUserSettings: async (setting: string) => new Map(oa.settings.get(setting) ?? []),
  writeUserSetting: async (userId: number, setting: string, _name: string, content: string[]) => {
    if (!oa.settings.has(setting)) oa.settings.set(setting, new Map());
    oa.settings.get(setting)?.set(userId, content.filter((value) => value.trim() !== ''));
  },
  signWebUiToken: async (username: string) => (oa.noPermission.has(username) ? '' : `token-of-${username}`),
  // A token is `jwt-<username>`.
  verifyWebUiToken: async (jwt: string) => (jwt.startsWith('jwt-') ? jwt.slice(4) : ''),
  sessionUser: async () => null,
  clientAddress: (req: { ip?: string }) => req.ip ?? '',
  audit: async (line: (typeof oa.audit)[number]) => {
    oa.audit.push(line);
  }
}));

vi.mock('./badgeSettings', () => ({
  DEFAULT_SETTINGS: {},
  readSettings: async () => oa.badgeSettings,
  writeSettings: async () => oa.badgeSettings,
  validSetting: () => undefined
}));

vi.mock('./appSecurityGuard', () => ({
  roleAssignments: async () => ({}),
  identityOfUsername: async (username: string) => username,
  roleGranted: (_assignments: unknown, role: string, who: string) =>
    (role === 'enrol' && oa.enrol.has(who)) || (role === 'configure' && oa.configure.has(who))
}));

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  handler: (req: Request, res: Response) => Promise<void>,
  { body = {}, params = {}, as, ip = 'station-1' }: { body?: unknown; params?: Record<string, string>; as?: string; ip?: string } = {}
): Promise<Answer> {
  const answer: Answer = { status: 200, body: {} };
  const res = {
    status(code: number) {
      answer.status = code;
      return res;
    },
    json(value: Record<string, unknown>) {
      answer.body = value;
      return res;
    }
  };
  const req = { body, params, headers: as ? { authorization: `Bearer jwt-${as}` } : {}, ip };
  await handler(req as unknown as Request, res as unknown as Response);
  return answer;
}

const actions = (): string[] => oa.audit.map((line) => line.action);
/** The stored blacklist, as the DP holds it. */
const stored = (): { counters: { ip: string; failures: number }[]; records: Record<string, unknown>[] } =>
  JSON.parse((oa.dps.get('WuiAuthBadge_Blacklist') as string | undefined) || '{"counters":[],"records":[]}');
/** `count` badges presented from `ip`. */
async function present(badge: BadgeAuth, uid: string, count: number, ip = 'station-1'): Promise<Answer[]> {
  const answers: Answer[] = [];
  for (let attempt = 0; attempt < count; attempt += 1) answers.push(await call(badge.login, { body: { uid, item: 'WC1' }, ip }));
  return answers;
}

beforeEach(() => {
  vi.useRealTimers();
  oa.users = [
    { username: 'root', fullName: 'Root', userId: 0, enabled: true },
    { username: 'alice', fullName: 'Alice', userId: 1, enabled: true },
    { username: 'bob', fullName: 'Bob', userId: 2, enabled: false },
    { username: 'carol', fullName: 'Carol', userId: 3, enabled: true },
    { username: 'admin', fullName: 'Admin', userId: 4, enabled: true },
    { username: 'config', fullName: 'Config', userId: 5, enabled: true }
  ];
  oa.settings = new Map([['RFID_UID', new Map([[1, ['11111111']], [2, ['22222222']], [3, ['33333333']]])]]);
  oa.audit = [];
  oa.noPermission = new Set(['carol']);
  oa.enrol = new Set(['admin']);
  oa.configure = new Set(['config']);
  oa.dps = new Map();
  oa.badgeSettings = {
    badgeLoginEnabled: true,
    selfEnrolment: true,
    hashBadges: false,
    prefix: '',
    maxFrameMs: 150,
    minUidLength: 4,
    endKey: 'Enter',
    lockAfterFailures: 3,
    lockDurationMin: 15
  };
});

describe('login: the lock per station', () => {
  it('N refused badges in a row lock that station only, unknown and refused users alike', async () => {
    const badge = new BadgeAuth();
    // An unknown badge, then a disabled account (bob): two refusals of station-1.
    expect((await present(badge, '99999999', 1))[0]?.body).toEqual({ status: 'unknown' });
    expect((await present(badge, '22222222', 1))[0]?.body).toEqual({ status: 'unknown' });
    expect(stored().counters).toEqual([expect.objectContaining({ ip: 'station-1', failures: 2, item: 'WC1' })]);
    const third = (await present(badge, '33333333', 1))[0];
    expect(third?.body).toMatchObject({ status: 'locked' });
    expect(third?.body['lockedUntil']).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(Object.keys(third?.body ?? {}).sort()).toEqual(['lockedUntil', 'status']);
    expect(actions()).toEqual(['BADGE_INCONNU', 'SESSION_REFUSEE', 'SESSION_REFUSEE', 'MIRE_VERROUILLEE']);
    expect(oa.audit.at(-1)).toMatchObject({ host: 'station-1', item: 'WC1' });
    expect(oa.audit.at(-1)?.reason).toContain('3 badges refusés');
    expect(stored().records).toEqual([expect.objectContaining({ ip: 'station-1', failures: 3, state: 'active', item: 'WC1' })]);

    // Locked: even alice's badge is refused there, before it is looked up…
    oa.audit = [];
    expect((await present(badge, '11111111', 1))[0]?.body).toMatchObject({ status: 'locked' });
    expect(actions()).toEqual(['BADGE_REFUSE_VERROU']);
    expect(oa.audit[0]?.username).toBeUndefined();
    // …and opens her session on another station.
    expect((await present(badge, '11111111', 1, 'station-2'))[0]?.body).toMatchObject({ status: 'ok', token: 'token-of-alice' });
  });

  it('a login resets the station\'s count', async () => {
    const badge = new BadgeAuth();
    await present(badge, '99999999', 2);
    await present(badge, '99999999', 1, 'station-2');
    expect((await present(badge, '11111111', 1))[0]?.body).toMatchObject({ status: 'ok' });
    expect(stored().counters.map((counter) => counter.ip)).toEqual(['station-2']);
    // Two more refusals do not lock: the count started again.
    expect((await present(badge, '99999999', 2)).map((answer) => answer.body['status'])).toEqual(['unknown', 'unknown']);
  });

  it('the lock survives a restart: kept in the DP, not in memory', async () => {
    await present(new BadgeAuth(), '99999999', 3);
    // A webserver restart: the modules loaded again, nothing kept but the DPs.
    vi.resetModules();
    const { BadgeAuth: Restarted } = await import('./badgeAuth');
    const restarted = new Restarted();
    expect((await present(restarted, '11111111', 1))[0]?.body).toMatchObject({ status: 'locked' });
    // GET /config tells the login page so as soon as it loads.
    expect((await call(restarted.getConfig)).body).toMatchObject({ locked: true });
    expect((await call(restarted.getConfig, { ip: 'station-2' })).body).toMatchObject({ locked: false, lockedUntil: null });
  });

  it('expires at the deadline, audited, and kept in the history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    oa.badgeSettings['lockAfterFailures'] = 1;
    const badge = new BadgeAuth();
    expect((await present(badge, '99999999', 1))[0]?.body).toEqual({ status: 'locked', lockedUntil: 1_800_000_000_000 + 15 * 60_000 });
    vi.setSystemTime(1_800_000_000_000 + 15 * 60_000);
    oa.audit = [];
    expect((await present(badge, '11111111', 1))[0]?.body).toMatchObject({ status: 'ok' });
    expect(actions()).toEqual(['VERROU_EXPIRE', 'OUVERTURE_SESSION']);
    expect(oa.audit[0]).toMatchObject({ host: 'station-1' });
    expect(stored().records).toEqual([expect.objectContaining({ ip: 'station-1', state: 'expired' })]);
  });

  it('duration 0: locked until unlocked', async () => {
    oa.badgeSettings['lockAfterFailures'] = 1;
    oa.badgeSettings['lockDurationMin'] = 0;
    expect((await present(new BadgeAuth(), '99999999', 1))[0]?.body).toEqual({ status: 'locked', lockedUntil: null });
  });

  it('threshold 0: never counts nor locks', async () => {
    oa.badgeSettings['lockAfterFailures'] = 0;
    const answers = await present(new BadgeAuth(), '99999999', 5);
    expect(answers.every((answer) => answer.body['status'] === 'unknown')).toBe(true);
    expect(oa.dps.size).toBe(0);
  });

  it('no audit line holds a badge number', async () => {
    await present(new BadgeAuth(), '99999999', 4);
    expect(oa.audit.every((line) => !line.reason.includes('99999999'))).toBe(true);
  });

  it('the user setting BADGE_LOCK of 0.5.0 is ignored', async () => {
    oa.settings.set('BADGE_LOCK', new Map([[1, ['{"failures":3,"lockedAt":1,"lockedUntil":null,"host":"x"}']]]));
    expect((await present(new BadgeAuth(), '11111111', 1))[0]?.body).toMatchObject({ status: 'ok' });
  });
});

describe('GET /blacklist', () => {
  it('401 without a token, 403 without `enrol` or `configure`', async () => {
    const badge = new BadgeAuth();
    expect((await call(badge.getBlacklist)).status).toBe(401);
    expect((await call(badge.getBlacklist, { as: 'alice' })).status).toBe(403);
  });

  it('the locks, newest first, and the refusals counted — for `enrol` and `configure`', async () => {
    const badge = new BadgeAuth();
    await present(badge, '99999999', 3, 'station-1');
    await present(badge, '99999999', 1, 'station-2');
    for (const as of ['admin', 'config']) {
      const { status, body } = await call(badge.getBlacklist, { as });
      expect(status).toBe(200);
      expect(body['records']).toEqual([expect.objectContaining({ ip: 'station-1', state: 'active', failures: 3, item: 'WC1' })]);
      expect(body['pending']).toEqual([expect.objectContaining({ ip: 'station-2', failures: 1 })]);
    }
  });

  it('turns the locks run out expired, audited', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const badge = new BadgeAuth();
    await present(badge, '99999999', 3);
    vi.setSystemTime(1_800_000_000_000 + 16 * 60_000);
    oa.audit = [];
    const { body } = await call(badge.getBlacklist, { as: 'admin' });
    expect(body['records']).toEqual([expect.objectContaining({ state: 'expired' })]);
    expect(actions()).toEqual(['VERROU_EXPIRE']);
  });
});

describe('POST /blacklist/unlock', () => {
  async function lockStation(badge: InstanceType<typeof BadgeAuth>): Promise<void> {
    await present(badge, '99999999', 3);
    oa.audit = [];
  }

  it('401 without a token, 403 without the `enrol` role (`configure` is not enough)', async () => {
    const badge = new BadgeAuth();
    await lockStation(badge);
    const body = { ip: 'station-1', reason: 'x' };
    expect((await call(badge.unlockStation, { body })).status).toBe(401);
    expect((await call(badge.unlockStation, { body, as: 'alice' })).status).toBe(403);
    expect((await call(badge.unlockStation, { body, as: 'config' })).status).toBe(403);
    expect(stored().records[0]).toMatchObject({ state: 'active' });
  });

  it('400 without a reason', async () => {
    const badge = new BadgeAuth();
    await lockStation(badge);
    for (const body of [{ ip: 'station-1' }, { ip: 'station-1', reason: '' }, { ip: 'station-1', reason: '   ' }, { ip: 'station-1', reason: 42 }]) {
      const answer = await call(badge.unlockStation, { body, as: 'admin' });
      expect(answer.status).toBe(400);
      expect(answer.body).toEqual({ status: 'invalid', field: 'reason' });
    }
    expect(stored().records[0]).toMatchObject({ state: 'active' });
    expect(oa.audit).toEqual([]);
  });

  it('400 without an address', async () => {
    const badge = new BadgeAuth();
    await lockStation(badge);
    for (const body of [{ reason: 'x' }, { ip: '', reason: 'x' }, { ip: 42, reason: 'x' }]) {
      const answer = await call(badge.unlockStation, { body, as: 'admin' });
      expect(answer.status).toBe(400);
      expect(answer.body).toEqual({ status: 'invalid', field: 'ip' });
    }
    expect(stored().records[0]).toMatchObject({ state: 'active' });
  });

  it('404 for a station not locked, or no more', async () => {
    const badge = new BadgeAuth();
    await lockStation(badge);
    expect((await call(badge.unlockStation, { body: { ip: 'station-2', reason: 'x' }, as: 'admin' })).status).toBe(404);
    expect((await call(badge.unlockStation, { body: { ip: 'station-1', reason: 'x' }, as: 'admin' })).status).toBe(200);
    expect((await call(badge.unlockStation, { body: { ip: 'station-1', reason: 'x' }, as: 'admin' })).status).toBe(404);
  });

  it('an IPv6 station (`::ffff:10.1.2.3`, `::1`) is unlocked (#24)', async () => {
    const badge = new BadgeAuth();
    for (const ip of ['::ffff:10.1.2.3', '::1']) {
      await present(badge, '99999999', 3, ip);
      const answer = await call(badge.unlockStation, { body: { ip, reason: 'x' }, as: 'admin' });
      expect(answer.status).toBe(200);
      expect(answer.body['record']).toMatchObject({ ip, state: 'lifted' });
    }
  });

  it('lifts the lock, kept in the history with who, when and why, and audited', async () => {
    const badge = new BadgeAuth();
    await lockStation(badge);
    const answer = await call(badge.unlockStation, { body: { ip: 'station-1', reason: ' Badge prêté ' }, as: 'admin', ip: 'office' });
    expect(answer.status).toBe(200);
    expect(answer.body['record']).toMatchObject({ ip: 'station-1', state: 'lifted', liftedBy: 'admin', reason: 'Badge prêté' });
    expect(stored().records).toEqual([expect.objectContaining({ state: 'lifted', liftedBy: 'admin', reason: 'Badge prêté' })]);
    expect(oa.audit).toHaveLength(1);
    expect(oa.audit[0]).toMatchObject({ action: 'VERROU_LEVE', username: 'admin', host: 'office' });
    expect(oa.audit[0]?.reason).toContain('station-1');
    expect(oa.audit[0]?.reason).toContain('Badge prêté');
    // The station opens a badge again.
    expect((await present(badge, '11111111', 1))[0]?.body).toMatchObject({ status: 'ok' });
  });
});

describe('POST /blacklist/:ip/unlock (0.6.0)', () => {
  it('decodes the address: ultimate-express leaves `%3A` in a path parameter (#24)', async () => {
    const badge = new BadgeAuth();
    await present(badge, '99999999', 3, '::ffff:10.1.2.3');
    const params = { ip: encodeURIComponent('::ffff:10.1.2.3') };
    const answer = await call(badge.unlockStationByPath, { params, body: { reason: 'x' }, as: 'admin' });
    expect(answer.status).toBe(200);
    expect(answer.body['record']).toMatchObject({ ip: '::ffff:10.1.2.3', state: 'lifted' });
  });

  it('an address already decoded is unchanged; a bad encoding is 400', async () => {
    const badge = new BadgeAuth();
    await present(badge, '99999999', 3);
    expect((await call(badge.unlockStationByPath, { params: { ip: '%E0%A4%A' }, body: { reason: 'x' }, as: 'admin' })).status).toBe(400);
    expect((await call(badge.unlockStationByPath, { params: { ip: 'station-1' }, body: { reason: 'x' }, as: 'admin' })).status).toBe(200);
  });
});

describe('GET /users', () => {
  it('the users and their badge, no lock any more', async () => {
    const list = (await call(new BadgeAuth().listUsers, { as: 'admin' })).body as unknown as Record<string, unknown>[];
    expect(list.map((user) => user['username'])).toEqual(['admin', 'alice', 'bob', 'carol', 'config']);
    expect(list.find((user) => user['username'] === 'alice')).toEqual({
      username: 'alice',
      fullName: 'Alice',
      userId: 1,
      enabled: true,
      badge: '1111',
      hashed: false
    });
  });
});

describe('POST /logout', () => {
  it('audits the close for the user of the token, never a name sent by the page', async () => {
    const badge = new BadgeAuth();
    const cases = [
      [{ reason: 'logout', item: 'WC1', provider: 'auth-badge' }, 'SESSION_FERMEE'],
      [{ reason: 'switch-user', item: 'WC1', username: 'mallory' }, 'SESSION_CHANGEMENT_UTILISATEUR'],
      [{ reason: 'idle', idleMinutes: 30, provider: 'password' }, 'SESSION_EXPIREE_INACTIVITE']
    ] as const;
    for (const [body, action] of cases) {
      expect(await call(badge.logout, { body, as: 'alice' })).toEqual({ status: 200, body: { status: 'ok' } });
      expect(oa.audit.at(-1)).toMatchObject({ action, username: 'alice', host: 'station-1' });
    }
    expect(oa.audit[0]).toMatchObject({ item: 'WC1', reason: 'Déconnexion (connexion : auth-badge)' });
    expect(oa.audit[2]?.reason).toBe("Déconnexion automatique après 30 min d'inactivité (connexion : password)");
  });

  it('401 without a valid token, 400 on an unknown reason — nothing audited', async () => {
    const badge = new BadgeAuth();
    expect((await call(badge.logout, { body: { reason: 'logout' } })).status).toBe(401);
    expect((await call(badge.logout, { body: { reason: 'logout' }, as: 'nobody' })).status).toBe(401);
    expect((await call(badge.logout, { body: { reason: 'toString' }, as: 'alice' })).status).toBe(400);
    expect((await call(badge.logout, { body: {}, as: 'alice' })).status).toBe(400);
    expect(oa.audit).toEqual([]);
  });

  it('a session opened by root is traced too', async () => {
    await call(new BadgeAuth().logout, { body: { reason: 'logout' }, as: 'root' });
    expect(oa.audit[0]).toMatchObject({ action: 'SESSION_FERMEE', username: 'root' });
  });
});
