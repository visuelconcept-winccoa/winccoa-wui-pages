// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Several people on the same atelier (winccoa-fra-msp-stma#402): the view's edit lock and what it sees of others' saves. */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./fleet-api.js', () => ({ FLEET_API: '/api/ai/fleet', authHeaders: () => ({ Authorization: 'Bearer t' }) }));

const { AtelierEditLock, LOCK_RENEW_MS, remoteChange, stamped } = await import('./atelier-lock.js');

type Reply = { granted?: boolean; holder?: { user: string; since: string } | null } | 'down';

/** A route answering the queued replies in turn, recording what it was asked. */
function route(...replies: Reply[]) {
  const asked: { url: string; action?: string; client?: string }[] = [];
  const doFetch = async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as { action: string; client: string }) : undefined;
    asked.push({ url, action: body?.action, client: body?.client });
    const r = replies.shift() ?? { granted: true, holder: null };
    if (r === 'down') throw new Error('réseau coupé');
    return new Response(JSON.stringify({ ok: true, granted: r.granted ?? false, holder: r.holder ?? null }), { status: 200 });
  };
  return { asked, doFetch };
}

const ALICE = { user: 'alice', since: '2026-11-26T09:00:00.000Z' };

describe('the edit lock of an open view', () => {
  afterEach(() => vi.useRealTimers());

  it('taken when edit mode comes on, refused while someone else holds it, given back when off', async () => {
    const free = route({ granted: true });
    const lock = new AtelierEditLock('atelier-1', 'view-bob-0001', free.doFetch);
    expect(await lock.acquire()).toBe(true);
    expect([lock.held, free.asked[0]]).toEqual([true, { url: '/api/ai/fleet/workshops/atelier-1/lock', action: 'acquire', client: 'view-bob-0001' }]);
    await lock.release();
    expect([lock.held, free.asked[1].action]).toEqual([false, 'release']);

    const busy = route({ granted: false, holder: ALICE });
    const other = new AtelierEditLock('atelier-1', 'view-bob-0002', busy.doFetch);
    expect(await other.acquire()).toBe(false);
    expect([other.held, other.holder]).toEqual([false, ALICE]);
  });

  it('without the route (webserver not updated, demo), editing stays possible: nothing locked', async () => {
    const lock = new AtelierEditLock('atelier-1', 'view-bob-0001', route('down').doFetch);
    expect(await lock.acquire()).toBe(true);
    expect(lock.held).toBe(false);
  });

  it('renewed while on; lost at a renewal refused, the view told who holds it now', async () => {
    vi.useFakeTimers();
    const r = route({ granted: true }, { granted: true }, { granted: false, holder: ALICE });
    const lock = new AtelierEditLock('atelier-1', 'view-alice-old', r.doFetch);
    let lost: unknown = 'not yet';
    lock.onLost = (h) => (lost = h);
    await lock.acquire();
    await vi.advanceTimersByTimeAsync(LOCK_RENEW_MS);
    expect([lock.held, lost]).toEqual([true, 'not yet']);
    await vi.advanceTimersByTimeAsync(LOCK_RENEW_MS);
    expect([lock.held, lost, lock.holder]).toEqual([false, ALICE, ALICE]);
    expect(r.asked.map((a) => a.action)).toEqual(['acquire', 'renew', 'renew']);
    lock.dispose();
  });
});

describe("others' saves", () => {
  const base = { id: 'a', name: 'A', machines: [] } as unknown as Parameters<typeof stamped>[0];

  it('each save carries the next revision, who saved it, when, from which view', () => {
    expect(stamped(base, 4, 'bob', 'view-bob-0001', new Date('2026-11-26T10:00:00Z'))).toMatchObject({
      revision: 5, updatedBy: 'bob', updatedAt: '2026-11-26T10:00:00.000Z', updatedClient: 'view-bob-0001'
    });
  });

  it('a newer revision saved by another view is told; this view’s own save, or an older one, is not', () => {
    const other = JSON.stringify(stamped(base, 4, 'alice', 'view-alice-1', new Date('2026-11-26T10:00:00Z')));
    expect(remoteChange(other, 4, 'view-bob-0001')).toEqual({ revision: 5, by: 'alice', at: '2026-11-26T10:00:00.000Z' });
    expect(remoteChange([other], 4, 'view-bob-0001')?.by).toBe('alice');
    expect(remoteChange(other, 5, 'view-bob-0001')).toBeNull();
    expect(remoteChange(other, 4, 'view-alice-1')).toBeNull();
    expect(remoteChange('pas du json', 0, 'x')).toBeNull();
    // An atelier saved before #402 (no revision) is revision 0: nothing to tell.
    expect(remoteChange(JSON.stringify(base), 0, 'x')).toBeNull();
  });
});
