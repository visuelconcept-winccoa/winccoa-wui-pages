// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// BadgeAuth against an in-memory WinCC OA: the users, their settings (badges,
// locks) and the audit lines, mocked in place of oaAuth.ts; the settings and
// the Application Security guard, mocked too.

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
  badgeSettings: {} as Record<string, unknown>
}));

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
  clientAddress: () => 'station-1',
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
  roleGranted: (_assignments: unknown, role: string, who: string) => role === 'enrol' && oa.enrol.has(who)
}));

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  handler: (req: Request, res: Response) => Promise<void>,
  { body = {}, params = {}, as }: { body?: unknown; params?: Record<string, string>; as?: string } = {}
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
  const req = { body, params, headers: as ? { authorization: `Bearer jwt-${as}` } : {}, ip: 'station-1' };
  await handler(req as unknown as Request, res as unknown as Response);
  return answer;
}

const lockOf = (userId: number): string | undefined => oa.settings.get('BADGE_LOCK')?.get(userId)?.[0];
const actions = (): string[] => oa.audit.map((line) => line.action);

beforeEach(() => {
  vi.useRealTimers();
  oa.users = [
    { username: 'root', fullName: 'Root', userId: 0, enabled: true },
    { username: 'alice', fullName: 'Alice', userId: 1, enabled: true },
    { username: 'bob', fullName: 'Bob', userId: 2, enabled: false },
    { username: 'carol', fullName: 'Carol', userId: 3, enabled: true },
    { username: 'admin', fullName: 'Admin', userId: 4, enabled: true }
  ];
  oa.settings = new Map([['RFID_UID', new Map([[1, ['11111111']], [2, ['22222222']], [3, ['33333333']]])]]);
  oa.audit = [];
  oa.noPermission = new Set(['carol']);
  oa.enrol = new Set(['admin']);
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

describe('login: the lock', () => {
  it('locks a user after N refusals imputable to them, on every station, past a restart', async () => {
    const badge = new BadgeAuth();
    for (let attempt = 1; attempt < 3; attempt += 1) {
      expect((await call(badge.login, { body: { uid: '33333333', item: 'WC1' } })).body).toEqual({ status: 'unknown' });
    }
    const third = await call(badge.login, { body: { uid: '33333333' } });
    expect(third.body).toMatchObject({ status: 'locked', username: 'carol', fullName: 'Carol' });
    expect(third.body['lockedUntil']).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(JSON.parse(lockOf(3) as string)).toMatchObject({ failures: 3, host: 'station-1' });
    expect(actions()).toEqual(['SESSION_REFUSEE', 'SESSION_REFUSEE', 'SESSION_REFUSEE', 'BADGE_VERROUILLE']);
    expect(oa.audit[0]?.item).toBe('WC1');

    // A new instance: the webserver restarted — the lock is the user's setting.
    oa.audit = [];
    oa.noPermission.clear();
    const restarted = new BadgeAuth();
    expect((await call(restarted.login, { body: { uid: '33333333' } })).body).toMatchObject({ status: 'locked', username: 'carol' });
    expect(actions()).toEqual(['BADGE_REFUSE_VERROU']);
  });

  it('a disabled account counts as a refusal', async () => {
    const badge = new BadgeAuth();
    await call(badge.login, { body: { uid: '22222222' } });
    expect(JSON.parse(lockOf(2) as string)).toMatchObject({ failures: 1, lockedAt: null });
    expect(oa.audit[0]).toMatchObject({ action: 'SESSION_REFUSEE', username: 'bob' });
  });

  it('a login resets the count', async () => {
    const badge = new BadgeAuth();
    oa.noPermission.add('alice');
    await call(badge.login, { body: { uid: '11111111' } });
    await call(badge.login, { body: { uid: '11111111' } });
    expect(JSON.parse(lockOf(1) as string)).toMatchObject({ failures: 2 });
    oa.noPermission.delete('alice');
    expect((await call(badge.login, { body: { uid: '11111111' } })).body).toMatchObject({ status: 'ok', token: 'token-of-alice' });
    expect(lockOf(1)).toBeUndefined();
  });

  it('expires at the deadline, audited when the badge is next presented', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    oa.badgeSettings['lockAfterFailures'] = 1;
    const badge = new BadgeAuth();
    expect((await call(badge.login, { body: { uid: '33333333' } })).body).toMatchObject({ status: 'locked' });
    vi.setSystemTime(1_800_000_000_000 + 15 * 60_000);
    oa.noPermission.clear();
    oa.audit = [];
    expect((await call(badge.login, { body: { uid: '33333333' } })).body).toMatchObject({ status: 'ok' });
    expect(actions()).toEqual(['BADGE_VERROU_EXPIRE', 'OUVERTURE_SESSION']);
  });

  it('duration 0: locked until unlocked', async () => {
    oa.badgeSettings['lockAfterFailures'] = 1;
    oa.badgeSettings['lockDurationMin'] = 0;
    const badge = new BadgeAuth();
    expect((await call(badge.login, { body: { uid: '33333333' } })).body).toMatchObject({ status: 'locked', lockedUntil: null });
  });

  it('threshold 0: never locks', async () => {
    oa.badgeSettings['lockAfterFailures'] = 0;
    const badge = new BadgeAuth();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await call(badge.login, { body: { uid: '33333333' } })).body).toEqual({ status: 'unknown' });
    }
    expect(lockOf(3)).toBeUndefined();
  });
});

describe('login: unknown badges', () => {
  it('never lock anything, and are each audited', async () => {
    const badge = new BadgeAuth();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await call(badge.login, { body: { uid: '99999999', item: 'WC1' } })).body).toEqual({ status: 'unknown' });
    }
    expect(actions()).toEqual(Array(10).fill('BADGE_INCONNU'));
    expect(oa.audit.every((line) => line.item === 'WC1' && !line.reason.includes('99999999'))).toBe(true);
    expect(oa.settings.get('BADGE_LOCK')).toBeUndefined();
    // The station still opens a known badge.
    expect((await call(badge.login, { body: { uid: '11111111' } })).body).toMatchObject({ status: 'ok' });
  });
});

describe('POST /users/:userId/unlock', () => {
  async function lockCarol(badge: InstanceType<typeof BadgeAuth>): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) await call(badge.login, { body: { uid: '33333333' } });
    oa.audit = [];
  }

  it('401 without a token, 403 without the `enrol` role', async () => {
    const badge = new BadgeAuth();
    await lockCarol(badge);
    expect((await call(badge.unlockUser, { params: { userId: '3' }, body: { reason: 'x' } })).status).toBe(401);
    expect((await call(badge.unlockUser, { params: { userId: '3' }, body: { reason: 'x' }, as: 'alice' })).status).toBe(403);
    expect(lockOf(3)).toBeDefined();
  });

  it('400 without a reason', async () => {
    const badge = new BadgeAuth();
    await lockCarol(badge);
    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 42 }]) {
      const answer = await call(badge.unlockUser, { params: { userId: '3' }, body, as: 'admin' });
      expect(answer.status).toBe(400);
      expect(answer.body).toEqual({ status: 'invalid', field: 'reason' });
    }
    expect(lockOf(3)).toBeDefined();
    expect(oa.audit).toEqual([]);
  });

  it('lifts the lock and resets the count, audited with the reason', async () => {
    const badge = new BadgeAuth();
    await lockCarol(badge);
    const answer = await call(badge.unlockUser, { params: { userId: '3' }, body: { reason: ' Badge prêté ' }, as: 'admin' });
    expect(answer).toEqual({ status: 200, body: { status: 'ok' } });
    expect(lockOf(3)).toBeUndefined();
    expect(oa.audit).toHaveLength(1);
    expect(oa.audit[0]).toMatchObject({ action: 'BADGE_DEVERROUILLE', username: 'admin' });
    expect(oa.audit[0]?.reason).toContain('carol');
    expect(oa.audit[0]?.reason).toContain('Badge prêté');
  });

  it('404 for an unknown user', async () => {
    expect((await call(new BadgeAuth().unlockUser, { params: { userId: '77' }, body: { reason: 'x' }, as: 'admin' })).status).toBe(404);
  });
});

describe('GET /users: the lock', () => {
  it('shows locked users and the failures counted', async () => {
    const badge = new BadgeAuth();
    for (let attempt = 0; attempt < 3; attempt += 1) await call(badge.login, { body: { uid: '33333333' } });
    await call(badge.login, { body: { uid: '22222222' } });
    const list = (await call(badge.listUsers, { as: 'admin' })).body as unknown as { username: string; lock: Record<string, unknown> }[];
    const byName = Object.fromEntries(list.map((user) => [user.username, user.lock]));
    expect(byName['carol']).toMatchObject({ locked: true, failures: 3 });
    expect(byName['bob']).toMatchObject({ locked: false, failures: 1 });
    expect(byName['alice']).toEqual({ locked: false, lockedAt: null, lockedUntil: null, failures: 0 });
    expect(byName['root']).toBeUndefined();
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
