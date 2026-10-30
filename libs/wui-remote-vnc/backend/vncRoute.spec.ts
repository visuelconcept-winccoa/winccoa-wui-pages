// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// The /api/vnc routes against an in-memory WinCC OA: the DPs (in place of
// @winccoa/backend), the WebUI token check (in place of winccoa-manager's CTRL
// script: a token is `jwt-<user>`), the Application Security directory and
// assignments (in place of the guard copied at deploy time; its real
// `roleGranted` rule is used). Each route is called through the middleware
// chain vncRoute.ts builds, as ultimate-express would.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'ultimate-express';

const oa = vi.hoisted(() => ({
  dps: new Map<string, unknown>(),
  types: new Set<string>(),
  /** role → groups (Application Security assignments of remote-vnc). */
  assignments: {} as Record<string, string[]>,
  /** user → groups. */
  users: new Map<string, string[]>()
}));

vi.mock('@winccoa/backend', () => ({
  WsjServerGlobal: {
    winccoa: {
      dpTypes: (name: string) => (oa.types.has(name) ? [name] : []),
      dpTypeCreate: async (node: { name: string }) => {
        oa.types.add(node.name);
        return true;
      },
      dpExists: (dpe: string) => oa.dps.has(dpe.split('.')[0]),
      dpNames: (pattern: string) => {
        const prefix = pattern.replace('*', '');
        return [...oa.dps.keys()].filter((dp) => dp.startsWith(prefix)).map((dp) => `System1:${dp}`);
      },
      dpCreate: async (dp: string) => {
        oa.dps.set(dp, { name: '', json: '' });
        return true;
      },
      dpDelete: async (dp: string) => oa.dps.delete(dp),
      dpGet: async (dpes: string | string[]) => {
        const read = (dpe: string): unknown => {
          const [dp, leaf] = dpe.split('.');
          return (oa.dps.get(dp) as Record<string, unknown> | undefined)?.[leaf];
        };
        return Array.isArray(dpes) ? dpes.map(read) : read(dpes);
      },
      dpSetWait: async (dpes: string[], values: unknown[]) => {
        dpes.forEach((dpe, i) => {
          const [dp, leaf] = dpe.split('.');
          const record = (oa.dps.get(dp) as Record<string, unknown> | undefined) ?? {};
          record[leaf.split(':')[0]] = values[i];
          oa.dps.set(dp, record);
        });
      }
    }
  }
}));

vi.mock('winccoa-manager', () => ({
  WinccoaDpTypeNode: class {
    constructor(readonly name: string) {}
  },
  WinccoaElementType: { Struct: 1, String: 25 },
  WinccoaCtrlType: { string: 'string' },
  WinccoaCtrlScript: class {
    async start(_fn: string, [jwt]: string[]): Promise<string> {
      return jwt.startsWith('jwt-') ? jwt.slice(4) : '';
    }
  }
}));

vi.mock('./appSecurityGuard', async () => {
  const real = await import('../../wui-app-security/backend/appSecurityGuard');
  const identity = (username: string) => ({
    username,
    userId: username ? 7 : -1,
    admin: false,
    groups: oa.users.get(username) ?? []
  });
  return {
    roleGranted: real.roleGranted,
    roleAssignments: async () => oa.assignments,
    identityOfUsername: async (username: string) => identity(username),
    // A passport session, when the test request carries one.
    identityOf: async (req: { user?: { username?: string } }) => identity(req.user?.username ?? '')
  };
});

type Handler = (req: Request, res: Response, next: () => void) => unknown;
const routes = vi.hoisted(() => new Map<string, Handler[]>());

vi.mock('ultimate-express', () => {
  const Router = () => {
    const add =
      (method: string) =>
      (path: string, ...handlers: Handler[]) =>
        routes.set(`${method} ${path}`, handlers);
    return { use: () => undefined, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
  };
  return { Router, json: () => () => undefined };
});

const { VncRoute } = await import('./vncRoute');
const { markRelayRegistered } = await import('./vncController');
const { consumeTicket } = await import('./vncTickets');
VncRoute.routes();
markRelayRegistered();

interface Answer {
  status: number;
  body: Record<string, unknown>;
  reached: boolean;
}

/** Call `route` through its middleware chain, as `user` (a WebUI token), or anonymously. */
async function call(
  route: string,
  { as, session, params = {}, body, query = {} }: { as?: string; session?: string; params?: Record<string, string>; body?: unknown; query?: Record<string, string> } = {}
): Promise<Answer> {
  const handlers = routes.get(route);
  if (!handlers) throw new Error(`no route ${route}`);
  const answer: Answer = { status: 200, body: {}, reached: false };
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
  const req = {
    params,
    query,
    body,
    ip: '10.1.2.3',
    headers: as ? { authorization: `Bearer jwt-${as}` } : {},
    user: session ? { username: session } : undefined
  };
  for (const [i, handler] of handlers.entries()) {
    let next = false;
    if (i === handlers.length - 1) answer.reached = true;
    await handler(req as unknown as Request, res as unknown as Response, () => (next = true));
    if (i < handlers.length - 1 && !next) break;
  }
  return answer;
}

function seed(id: string, record: Record<string, unknown>): void {
  oa.types.add('RemoteVnc_Connection');
  oa.dps.set(`RemoteVnc_${id}`, { name: record['name'], json: JSON.stringify({ id, ...record }) });
}

/** The audit write is not awaited by the route (best-effort): let it land. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

const stored = (id: string): Record<string, unknown> =>
  JSON.parse(String((oa.dps.get(`RemoteVnc_${id}`) as { json: string }).json)) as Record<string, unknown>;

/** Each route, a request it accepts, and the role(s) that open it. */
const ROUTES: { route: string; roles: string[]; request: Parameters<typeof call>[1] }[] = [
  { route: 'GET /status', roles: ['view', 'connect'], request: {} },
  { route: 'GET /connections', roles: ['view', 'connect'], request: {} },
  { route: 'GET /connection/:id', roles: ['connect'], request: { params: { id: 'hmi' } } },
  { route: 'POST /connection', roles: ['edit'], request: { body: { name: 'New', host: '10.0.0.9', port: 5900 } } },
  { route: 'PUT /connection/:id', roles: ['edit'], request: { params: { id: 'hmi' }, body: { name: 'HMI 1', host: '10.0.3.21' } } },
  { route: 'DELETE /connection/:id', roles: ['edit'], request: { params: { id: 'hmi' } } },
  { route: 'POST /connection/:id/favorite', roles: ['view'], request: { params: { id: 'hmi' }, body: { favorite: true } } },
  { route: 'POST /session', roles: ['connect'], request: { body: { id: 'hmi' } } },
  { route: 'GET /resolve', roles: ['connect'], request: { query: { id: 'hmi' } } }
];

beforeEach(() => {
  oa.dps.clear();
  oa.types.clear();
  oa.users.clear();
  // Every role assigned to its own group: a role is held only through it.
  oa.assignments = { view: ['Viewers'], connect: ['Operators'], edit: ['Engineers'] };
  oa.users.set('nobody', []);
  oa.users.set('viewer', ['Viewers']);
  oa.users.set('operator', ['Operators']);
  oa.users.set('engineer', ['Engineers']);
  seed('hmi', { name: 'HMI', host: '10.0.3.21', port: 5900, password: 'top-secret', shared: true });
});

describe('the /api/vnc routes enforce the remote-vnc roles', () => {
  it.each(ROUTES)('$route is refused (403) without its role, before the controller', async ({ route, request }) => {
    const answer = await call(route, { ...request, as: 'nobody' });
    expect(answer.status).toBe(403);
    expect(answer.reached).toBe(false);
    expect(answer.body).toMatchObject({ ok: false, error: 'forbidden' });
  });

  it.each(ROUTES)('$route is refused to an unidentified caller once its role is assigned', async ({ route, request }) => {
    const answer = await call(route, request);
    expect(answer.status).toBe(403);
    expect(answer.reached).toBe(false);
  });

  it.each(ROUTES)('$route lets a holder of its role through', async ({ route, roles, request }) => {
    const user = { view: 'viewer', connect: 'operator', edit: 'engineer' }[roles[0]] as string;
    const answer = await call(route, { ...request, as: user });
    expect(answer.reached).toBe(true);
    expect(answer.status).not.toBe(403);
  });

  it.each(ROUTES)('$route is open to everyone while no admin assigned its role', async ({ route, request }) => {
    oa.assignments = {};
    const answer = await call(route, request);
    expect(answer.reached).toBe(true);
  });

  it('the passport session identifies a caller too', async () => {
    expect((await call('GET /connections', { session: 'viewer' })).status).toBe(200);
    expect((await call('GET /connections', { session: 'nobody' })).status).toBe(403);
  });

  it('a forged token identifies nobody', async () => {
    const handlers = routes.get('GET /connections') as Handler[];
    const answer = { status: 200 };
    const res = { status: (code: number) => ((answer.status = code), res), json: () => res };
    await handlers[0]({ headers: { authorization: 'Bearer forged' } } as unknown as Request, res as unknown as Response, () => undefined);
    expect(answer.status).toBe(403);
  });
});

describe('the connection routes never answer a password', () => {
  it('the listing has id, name and endpoint, and hasPassword instead of the password', async () => {
    seed('panel', { name: 'Panel', host: '10.0.4.42', port: 5901, password: '' });
    const { status, body } = await call('GET /connections', { as: 'viewer' });
    expect(status).toBe(200);
    const list = body['connections'] as Record<string, unknown>[];
    expect(list.map((c) => [c['id'], c['name'], c['host'], c['port'], c['hasPassword']])).toEqual([
      ['hmi', 'HMI', '10.0.3.21', 5900, true],
      ['panel', 'Panel', '10.0.4.42', 5901, false]
    ]);
    for (const conn of list) expect(conn).not.toHaveProperty('password');
    expect(JSON.stringify(body)).not.toContain('top-secret');
  });

  it('nor does one connection, a creation, an update or the favourite', async () => {
    const answers = [
      await call('GET /connection/:id', { as: 'operator', params: { id: 'hmi' } }),
      await call('POST /connection', { as: 'engineer', body: { name: 'B', host: 'h', port: 5900, password: 'pw-new' } }),
      await call('PUT /connection/:id', { as: 'engineer', params: { id: 'hmi' }, body: { description: 'x' } }),
      await call('POST /connection/:id/favorite', { as: 'viewer', params: { id: 'hmi' }, body: { favorite: true } })
    ];
    for (const answer of answers) {
      expect(answer.status).toBeLessThan(300);
      expect(JSON.stringify(answer.body)).not.toMatch(/top-secret|pw-new|"password"/);
    }
  });

  it('an update without a password keeps it; a string replaces it; the format stays', async () => {
    await call('PUT /connection/:id', { as: 'engineer', params: { id: 'hmi' }, body: { name: 'HMI 1' } });
    expect(stored('hmi')).toMatchObject({ id: 'hmi', dp: 'RemoteVnc_hmi', name: 'HMI 1', password: 'top-secret' });
    expect((oa.dps.get('RemoteVnc_hmi') as { name: string }).name).toBe('HMI 1');
    await call('PUT /connection/:id', { as: 'engineer', params: { id: 'hmi' }, body: { password: '' } });
    expect(stored('hmi')['password']).toBe('');
  });

  it('a creation validates its input and creates the DP of the unchanged type', async () => {
    expect((await call('POST /connection', { as: 'engineer', body: { name: 'x', host: 'h', port: 70000 } })).status).toBe(400);
    const created = await call('POST /connection', { as: 'engineer', body: { name: 'Robot cell', host: '10.0.3.55', port: 5900 } });
    expect(created.status).toBe(201);
    const id = (created.body['connection'] as { id: string }).id;
    expect(id).toMatch(/^robot-cell-[0-9a-z]+$/);
    expect(stored(id)).toMatchObject({ name: 'Robot cell', host: '10.0.3.55', port: 5900, password: '', lastConnectedAt: '' });
  });

  it('an unknown connection is a 404', async () => {
    expect((await call('GET /connection/:id', { as: 'operator', params: { id: 'nope' } })).status).toBe(404);
    expect((await call('DELETE /connection/:id', { as: 'engineer', params: { id: 'nope' } })).status).toBe(404);
    expect((await call('POST /session', { as: 'operator', body: { id: 'nope' } })).status).toBe(404);
  });
});

describe('the audit trail (AuditTrail_RemoteVnc)', () => {
  it('gets one row per change, with the verified user and the password masked', async () => {
    await call('PUT /connection/:id', { as: 'engineer', params: { id: 'hmi' }, body: { password: 'changed' } });
    await settle();
    const row = oa.dps.get('AuditTrail_RemoteVnc') as Record<string, unknown>;
    expect(row).toMatchObject({ username: 'engineer', uinum: 7, item: 'RemoteVnc_hmi', itemtype: 'VncConnection', action: 'UPDATE', host: '10.1.2.3' });
    expect(JSON.parse(String(row['oldval']))).toEqual({ password: '••••' });
    expect(JSON.parse(String(row['newval']))).toEqual({ password: '••••' });
    await call('DELETE /connection/:id', { as: 'engineer', params: { id: 'hmi' } });
    await settle();
    const deleted = oa.dps.get('AuditTrail_RemoteVnc') as Record<string, unknown>;
    expect(deleted['action']).toBe('DELETE');
    expect(String(deleted['oldval'])).not.toContain('changed');
    expect(oa.dps.has('RemoteVnc_hmi')).toBe(false);
  });
});

describe('POST /session', () => {
  it('hands out a one-shot ticket bound to the connection and the caller', async () => {
    const { status, body } = await call('POST /session', { as: 'operator', body: { id: 'hmi' } });
    expect(status).toBe(200);
    const ticket = String(body['ticket']);
    expect(consumeTicket(ticket, 'other')).toBeNull(); // wrong id: consumed and refused
    const again = await call('POST /session', { as: 'operator', body: { id: 'hmi' } });
    const second = String(again.body['ticket']);
    expect(consumeTicket(second, 'hmi')).toMatchObject({ id: 'hmi', username: 'operator' });
    expect(consumeTicket(second, 'hmi')).toBeNull(); // used once
  });
});
