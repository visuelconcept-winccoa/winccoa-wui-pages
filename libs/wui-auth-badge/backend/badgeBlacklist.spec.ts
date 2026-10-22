// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeLock,
  Blacklist,
  EMPTY_BLACKLIST,
  expire,
  lift,
  MAX_RECORDS,
  parseBlacklist,
  readBlacklist,
  recordFailure,
  resetFailures,
  serializeBlacklist,
  updateBlacklist
} from './badgeBlacklist';

/** An in-memory WinCC OA: the DPs and their values. */
const oa = vi.hoisted(() => ({ dps: new Map<string, unknown>(), types: new Set<string>(), writes: 0 }));

vi.mock('@winccoa/backend', () => ({
  WsjServerGlobal: {
    winccoa: {
      dpExists: (dp: string) => oa.dps.has(dp),
      dpTypes: (pattern: string) => [...oa.types].filter((type) => type === pattern),
      dpTypeCreate: async (type: { name: string }) => {
        oa.types.add(type.name);
        return true;
      },
      dpCreate: async (dp: string) => {
        oa.dps.set(dp, '');
        return true;
      },
      dpGet: async (dpe: string) => oa.dps.get(dpe.split('.')[0] as string),
      dpSetWait: async (dpe: string, value: unknown) => {
        oa.dps.set(dpe.split('.')[0] as string, value);
        oa.writes += 1;
      }
    }
  }
}));
vi.mock('winccoa-manager', () => ({
  WinccoaDpTypeNode: class {
    constructor(public name: string) {}
  },
  WinccoaElementType: { Struct: 1, String: 2 }
}));

const NOW = 1_800_000_000_000;
const POLICY = { lockAfterFailures: 3, lockDurationMin: 15 };

/** `count` refusals from `ip`. */
function fail(blacklist: Blacklist, ip: string, count: number, policy = POLICY, now = NOW): ReturnType<typeof recordFailure> {
  let result: ReturnType<typeof recordFailure> = { blacklist, failures: 0 };
  for (let index = 0; index < count; index += 1) result = recordFailure(result.blacklist, ip, 'WC1', policy, now);
  return result;
}

beforeEach(() => {
  oa.dps = new Map();
  oa.types = new Set();
  oa.writes = 0;
});

describe('recordFailure: the count per address', () => {
  it('counts, then locks the address at the threshold for the duration', () => {
    const two = fail(EMPTY_BLACKLIST, '10.0.0.1', 2);
    expect(two.locked).toBeUndefined();
    expect(two.blacklist.counters).toEqual([{ ip: '10.0.0.1', failures: 2, item: 'WC1', lastAt: NOW }]);
    expect(activeLock(two.blacklist, '10.0.0.1', NOW)).toBeUndefined();

    const third = recordFailure(two.blacklist, '10.0.0.1', 'WC2', POLICY, NOW);
    expect(third.locked).toEqual({
      id: `${NOW}-10.0.0.1`,
      ip: '10.0.0.1',
      lockedAt: NOW,
      lockedUntil: NOW + 15 * 60_000,
      failures: 3,
      item: 'WC2',
      state: 'active',
      liftedBy: null,
      liftedAt: null,
      reason: null
    });
    // The count starts again; the lock holds until its deadline.
    expect(third.blacklist.counters).toEqual([]);
    expect(activeLock(third.blacklist, '10.0.0.1', NOW + 15 * 60_000 - 1)).toBe(third.locked);
  });

  it('only the address counted: the other stations are not touched', () => {
    let { blacklist } = fail(EMPTY_BLACKLIST, '10.0.0.1', 2);
    blacklist = fail(blacklist, '10.0.0.2', 1).blacklist;
    blacklist = recordFailure(blacklist, '10.0.0.1', '', POLICY, NOW).blacklist;
    expect(activeLock(blacklist, '10.0.0.1', NOW)).toBeDefined();
    expect(activeLock(blacklist, '10.0.0.2', NOW)).toBeUndefined();
    expect(blacklist.counters).toEqual([{ ip: '10.0.0.2', failures: 1, item: 'WC1', lastAt: NOW }]);
  });

  it('a login resets the count of its address only', () => {
    let { blacklist } = fail(EMPTY_BLACKLIST, '10.0.0.1', 2);
    blacklist = fail(blacklist, '10.0.0.2', 2).blacklist;
    blacklist = resetFailures(blacklist, '10.0.0.1');
    expect(blacklist.counters.map((counter) => counter.ip)).toEqual(['10.0.0.2']);
    // Nothing to reset: the same object, nothing written.
    expect(resetFailures(blacklist, '10.0.0.9')).toBe(blacklist);
  });

  it('duration 0: locked until unlocked by hand', () => {
    const { locked, blacklist } = fail(EMPTY_BLACKLIST, 'h', 1, { lockAfterFailures: 1, lockDurationMin: 0 });
    expect(locked?.lockedUntil).toBeNull();
    expect(activeLock(blacklist, 'h', NOW + 365 * 86_400_000)).toBeDefined();
    expect(expire(blacklist, NOW + 365 * 86_400_000).expired).toEqual([]);
  });

  it('threshold 0: never counts nor locks', () => {
    const result = fail(EMPTY_BLACKLIST, 'h', 10, { lockAfterFailures: 0, lockDurationMin: 15 });
    expect(result).toEqual({ blacklist: EMPTY_BLACKLIST, failures: 0 });
  });
});

describe('expire', () => {
  it('turns a lock past its deadline expired, once', () => {
    const { blacklist } = fail(EMPTY_BLACKLIST, 'h', 3);
    const deadline = NOW + 15 * 60_000;
    expect(expire(blacklist, deadline - 1).blacklist).toBe(blacklist);
    const { blacklist: after, expired } = expire(blacklist, deadline);
    expect(expired).toHaveLength(1);
    expect(after.records[0]).toMatchObject({ ip: 'h', state: 'expired' });
    expect(activeLock(after, 'h', deadline)).toBeUndefined();
    expect(expire(after, deadline + 1).expired).toEqual([]);
  });

  it('an address locked again after its expiry: a new record, the old one kept', () => {
    let { blacklist } = fail(EMPTY_BLACKLIST, 'h', 3);
    const later = NOW + 20 * 60_000;
    blacklist = expire(blacklist, later).blacklist;
    blacklist = fail(blacklist, 'h', 3, POLICY, later).blacklist;
    expect(blacklist.records.map((record) => [record.lockedAt, record.state])).toEqual([
      [later, 'active'],
      [NOW, 'expired']
    ]);
  });
});

describe('lift', () => {
  it('lifts the active lock with who, when and why, and resets the count', () => {
    const { blacklist } = fail(fail(EMPTY_BLACKLIST, 'h', 3).blacklist, 'h', 1, { lockAfterFailures: 9, lockDurationMin: 1 });
    expect(blacklist.counters).toHaveLength(1);
    const { blacklist: after, lifted } = lift(blacklist, 'h', 'admin', 'Badge prêté', NOW + 60_000);
    expect(lifted).toMatchObject({ ip: 'h', state: 'lifted', liftedBy: 'admin', liftedAt: NOW + 60_000, reason: 'Badge prêté', failures: 3 });
    expect(activeLock(after, 'h', NOW + 60_000)).toBeUndefined();
    expect(after.records).toHaveLength(1);
    expect(after.counters).toEqual([]);
  });

  it('nothing to lift: no record, nothing changed', () => {
    const { blacklist } = fail(EMPTY_BLACKLIST, 'h', 3);
    expect(lift(blacklist, 'other', 'admin', 'x', NOW)).toEqual({ blacklist });
    const expired = expire(blacklist, NOW + 15 * 60_000).blacklist;
    expect(lift(expired, 'h', 'admin', 'x', NOW + 15 * 60_000).lifted).toBeUndefined();
  });
});

describe('the history', () => {
  it(`is bounded to ${MAX_RECORDS} records: the oldest ended ones purged, never an active lock`, () => {
    const once = { lockAfterFailures: 1, lockDurationMin: 0 };
    // The very first lock stays active, every other one is lifted.
    let { blacklist } = fail(EMPTY_BLACKLIST, 'first', 1, once, 0);
    for (let index = 1; index <= MAX_RECORDS + 10; index += 1) {
      blacklist = recordFailure(blacklist, `10.0.${index}`, '', once, index).blacklist;
      blacklist = lift(blacklist, `10.0.${index}`, 'admin', 'x', index).blacklist;
    }
    expect(blacklist.records).toHaveLength(MAX_RECORDS);
    expect(blacklist.records[0]?.ip).toBe(`10.0.${MAX_RECORDS + 10}`);
    expect(blacklist.records.at(-1)).toMatchObject({ ip: 'first', state: 'active' });
    // 511 locks, 500 kept: the 11 oldest ended records went.
    expect(blacklist.records.some((record) => record.ip === '10.0.11')).toBe(false);
    expect(blacklist.records.some((record) => record.ip === '10.0.12')).toBe(true);
  });
});

describe('parseBlacklist / serializeBlacklist', () => {
  it('round-trips', () => {
    let { blacklist } = fail(EMPTY_BLACKLIST, 'a', 3);
    blacklist = fail(blacklist, 'b', 1).blacklist;
    expect(parseBlacklist(serializeBlacklist(blacklist))).toEqual(blacklist);
    expect(parseBlacklist({ value: serializeBlacklist(blacklist) })).toEqual(blacklist);
  });

  it('an absent or unreadable value is empty, an invalid entry dropped', () => {
    expect(parseBlacklist(undefined)).toBe(EMPTY_BLACKLIST);
    expect(parseBlacklist('')).toBe(EMPTY_BLACKLIST);
    expect(parseBlacklist('{nope')).toBe(EMPTY_BLACKLIST);
    const parsed = parseBlacklist(
      JSON.stringify({
        counters: [{ ip: 'a', failures: 2, lastAt: 1 }, { ip: '', failures: 1, lastAt: 1 }, { ip: 'b', failures: 0, lastAt: 1 }],
        records: [{ ip: 'a', lockedAt: 1, state: 'active' }, { ip: 'b', lockedAt: 1, state: 'gone' }, null]
      })
    );
    expect(parsed.counters).toEqual([{ ip: 'a', failures: 2, item: '', lastAt: 1 }]);
    expect(parsed.records).toEqual([
      { id: '1-a', ip: 'a', lockedAt: 1, lockedUntil: null, failures: 0, item: '', state: 'active', liftedBy: null, liftedAt: null, reason: null }
    ]);
  });
});

describe('the DP WuiAuthBadge_Blacklist', () => {
  it('is empty without its DP, created at the first change, and read again every time', async () => {
    expect(await readBlacklist()).toBe(EMPTY_BLACKLIST);
    await updateBlacklist((blacklist) => ({ blacklist: recordFailure(blacklist, 'h', '', POLICY, NOW).blacklist, result: undefined }));
    expect(oa.types.has('WuiAuthBadge_Blacklist')).toBe(true);
    expect(JSON.parse(oa.dps.get('WuiAuthBadge_Blacklist') as string)).toMatchObject({ counters: [{ ip: 'h', failures: 1 }] });

    // Changed in the DP (another webserver, a restore): what counts is the DP.
    oa.dps.set('WuiAuthBadge_Blacklist', serializeBlacklist(EMPTY_BLACKLIST));
    expect((await readBlacklist()).counters).toEqual([]);
  });

  it('writes nothing when nothing changes', async () => {
    await updateBlacklist((blacklist) => ({ blacklist: resetFailures(blacklist, 'h'), result: undefined }));
    expect(oa.writes).toBe(0);
    expect(oa.dps.size).toBe(0);
  });

  it('serialises the changes: two refusals at once both count', async () => {
    const once = (): Promise<void> =>
      updateBlacklist((blacklist) => ({ blacklist: recordFailure(blacklist, 'h', '', { lockAfterFailures: 9, lockDurationMin: 1 }, NOW).blacklist, result: undefined }));
    await Promise.all([once(), once(), once()]);
    expect((await readBlacklist()).counters[0]?.failures).toBe(3);
  });

  it('a failed change does not stop the next ones', async () => {
    await expect(updateBlacklist(() => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await updateBlacklist((blacklist) => ({ blacklist: recordFailure(blacklist, 'h', '', POLICY, NOW).blacklist, result: undefined }));
    expect((await readBlacklist()).counters).toHaveLength(1);
  });
});
