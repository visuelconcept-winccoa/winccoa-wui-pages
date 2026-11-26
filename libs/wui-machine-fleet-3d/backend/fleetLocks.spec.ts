// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The edit lock of an atelier (winccoa-fra-msp-stma#402): one editor at a time, a newer view of the same user takes it
 * over, a lock no longer renewed is free again, the holder is the user of the request's token.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'ultimate-express';

let caller = 'alice';
vi.mock('@winccoa/backend', () => ({ WsjServerGlobal: { winccoa: {} } }));
vi.mock('./fleetGuard', () => ({
  requestIdentity: async () => ({ username: caller, userId: 1, admin: false, groups: [] })
}));

const { FleetLocksController, LOCK_STALE_MS, decideLock, holderOf } = await import('./fleetLocks');

const A1 = { user: 'alice', client: 'view-alice-1' };
const A2 = { user: 'alice', client: 'view-alice-2' };
const B = { user: 'bob', client: 'view-bob-01' };

describe('decideLock', () => {
  it('a free atelier is granted; another user is then refused, the holder is told', () => {
    const first = decideLock(null, 'acquire', A1, 1000);
    expect(first).toEqual({ granted: true, lock: { ...A1, since: 1000, beat: 1000 } });
    const other = decideLock(first.lock, 'acquire', B, 2000);
    expect(other.granted).toBe(false);
    expect(other.lock).toEqual(first.lock);
    expect(holderOf(other.lock, 2000)).toEqual({ user: 'alice', since: new Date(1000).toISOString() });
  });

  it('renewing keeps it; a lock no longer renewed is free again', () => {
    const { lock } = decideLock(null, 'acquire', A1, 0);
    const renewed = decideLock(lock, 'renew', A1, LOCK_STALE_MS - 1);
    expect(renewed).toEqual({ granted: true, lock: { ...A1, since: 0, beat: LOCK_STALE_MS - 1 } });
    expect(decideLock(lock, 'acquire', B, LOCK_STALE_MS - 1).granted).toBe(false);
    expect(decideLock(lock, 'acquire', B, LOCK_STALE_MS).granted).toBe(true);
    expect(holderOf(lock, LOCK_STALE_MS)).toBeNull();
  });

  it('a newer view of the same user takes it over; the older one loses it at its next renewal', () => {
    const { lock } = decideLock(null, 'acquire', A1, 0);
    const taken = decideLock(lock, 'acquire', A2, 10);
    expect(taken).toEqual({ granted: true, lock: { ...A2, since: 0, beat: 10 } });
    expect(decideLock(taken.lock, 'renew', A1, 20)).toEqual({ granted: false, lock: taken.lock });
  });

  it('after a webserver restart (no lock), a renewal takes it back; released, it is free', () => {
    expect(decideLock(null, 'renew', B, 5)).toEqual({ granted: true, lock: { ...B, since: 5, beat: 5 } });
    const { lock } = decideLock(null, 'acquire', B, 0);
    expect(decideLock(lock, 'release', A1, 1)).toEqual({ granted: true, lock });
    expect(decideLock(lock, 'release', B, 1)).toEqual({ granted: true, lock: null });
  });
});

function call(handler: (req: Request, res: Response) => Promise<void>, params: Record<string, string>, body?: unknown) {
  let status = 200;
  let json: unknown = null;
  const res = { status(n: number) { status = n; return this; }, json(v: unknown) { json = v; return this; } } as unknown as Response;
  return handler({ params, body } as unknown as Request, res).then(() => ({ status, json }));
}

describe('FleetLocksController', () => {
  it('grants the user of the token, refuses another, and tells who holds it', async () => {
    let now = 1_000;
    const c = new FleetLocksController(() => now);
    caller = 'alice';
    expect((await call(c.post, { id: 'atelier-1' }, { action: 'acquire', client: 'view-alice-1' })).json).toEqual({
      ok: true, granted: true, holder: { user: 'alice', since: new Date(1000).toISOString() }
    });
    caller = 'bob';
    now = 2_000;
    expect((await call(c.post, { id: 'atelier-1' }, { action: 'acquire', client: 'view-bob-01' })).json).toMatchObject({ granted: false, holder: { user: 'alice' } });
    expect((await call(c.get, { id: 'atelier-1' })).json).toMatchObject({ ok: true, holder: { user: 'alice' } });
    expect((await call(c.get, { id: 'atelier-2' })).json).toEqual({ ok: true, holder: null });
    caller = 'alice';
    await call(c.post, { id: 'atelier-1' }, { action: 'release', client: 'view-alice-1' });
    expect((await call(c.get, { id: 'atelier-1' })).json).toEqual({ ok: true, holder: null });
  });

  it('refuses an invalid atelier, action or client', async () => {
    const c = new FleetLocksController();
    expect((await call(c.post, { id: '*' }, { action: 'acquire', client: 'view-alice-1' })).status).toBe(400);
    expect((await call(c.post, { id: 'a' }, { action: 'steal', client: 'view-alice-1' })).status).toBe(400);
    expect((await call(c.post, { id: 'a' }, { action: 'acquire', client: 'x' })).status).toBe(400);
    expect((await call(c.get, { id: 'a b' })).status).toBe(400);
  });
});
