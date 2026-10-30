// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// fleetGuard against a scripted WinCC OA: the CTRL token check (in place of
// winccoa-manager), the directory and the assignments (in place of the
// appSecurityGuard.ts copied at deploy time).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'ultimate-express';

const oa = vi.hoisted(() => ({
  /** token → user name (a token not listed is invalid). */
  tokens: new Map<string, string>(),
  /** The webserver session user ('' = none). */
  session: '',
  /** role → users granted; a role not listed is unassigned (open). */
  assigned: new Map<string, string[]>(),
  failDirectory: false
}));

vi.mock('@winccoa/backend', () => ({ WsjServerGlobal: { winccoa: {} } }));
vi.mock('winccoa-manager', () => ({
  WinccoaCtrlType: { string: 'string' },
  WinccoaCtrlScript: class {
    start = async (_fn: string, [jwt]: string[]) => oa.tokens.get(jwt) ?? '';
  }
}));
vi.mock('./appSecurityGuard', () => {
  const who = (username: string) => ({ username, userId: username ? 1 : -1, admin: false, groups: [] });
  return {
    identityOf: async () => who(oa.session),
    identityOfUsername: async (username: string) => who(username),
    roleAssignments: async () => {
      if (oa.failDirectory) throw new Error('directory unreadable');
      return oa.assigned;
    },
    roleGranted: (assigned: Map<string, string[]>, role: string, identity: { username: string }) =>
      !assigned.has(role) || (assigned.get(role) ?? []).includes(identity.username)
  };
});

const { requireFleetRole } = await import('./fleetGuard');

async function call(headers: Record<string, string> = {}): Promise<{ status: number; passed: boolean; body: unknown }> {
  let status = 200;
  let body: unknown;
  let passed = false;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    }
  } as unknown as Response;
  await requireFleetRole('view')({ headers } as unknown as Request, res, () => (passed = true));
  return { status, passed, body };
}

describe('requireFleetRole', () => {
  beforeEach(() => {
    oa.tokens = new Map([['good', 'alice']]);
    oa.session = '';
    oa.assigned = new Map();
    oa.failDirectory = false;
  });

  it('lets anyone through while the role is unassigned', async () => {
    expect((await call()).passed).toBe(true);
  });

  it('grants the user of a verified WebUI token', async () => {
    oa.assigned.set('view', ['alice']);
    expect((await call({ authorization: 'Bearer good' })).passed).toBe(true);
  });

  it('refuses an assigned role to a caller without identity, and to an invalid token', async () => {
    oa.assigned.set('view', ['alice']);
    const none = await call();
    expect(none).toMatchObject({ status: 403, passed: false, body: { ok: false, error: 'forbidden' } });
    expect((await call({ authorization: 'Bearer forged' })).status).toBe(403);
  });

  it('refuses a verified user without the role', async () => {
    oa.assigned.set('view', ['bob']);
    expect((await call({ authorization: 'Bearer good' })).status).toBe(403);
  });

  it('falls back to the webserver session user', async () => {
    oa.assigned.set('view', ['alice']);
    oa.session = 'alice';
    expect((await call()).passed).toBe(true);
  });

  it('fails open when the check itself fails', async () => {
    oa.assigned.set('view', ['bob']);
    oa.failDirectory = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await call({ authorization: 'Bearer good' })).passed).toBe(true);
  });
});
