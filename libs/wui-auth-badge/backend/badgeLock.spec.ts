// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { afterFailure, hasExpired, isLocked, lockView, NO_LOCK, parseLock, serializeLock } from './badgeLock';

const NOW = 1_800_000_000_000;
const POLICY = { lockAfterFailures: 3, lockDurationMin: 15 };

describe('afterFailure', () => {
  it('counts, then locks at the threshold for the duration', () => {
    let lock = NO_LOCK;
    for (let failure = 1; failure < 3; failure += 1) {
      const next = afterFailure(lock, POLICY, NOW, 'host-1');
      expect(next.locked).toBe(false);
      expect(next.lock.failures).toBe(failure);
      expect(isLocked(next.lock, NOW)).toBe(false);
      lock = next.lock;
    }
    const third = afterFailure(lock, POLICY, NOW, 'host-2');
    expect(third.locked).toBe(true);
    expect(third.lock).toEqual({ failures: 3, lockedAt: NOW, lockedUntil: NOW + 15 * 60_000, host: 'host-2' });
    expect(isLocked(third.lock, NOW + 15 * 60_000 - 1)).toBe(true);
  });

  it('expires at the deadline', () => {
    const { lock } = afterFailure({ ...NO_LOCK, failures: 2 }, POLICY, NOW, 'h');
    const deadline = NOW + 15 * 60_000;
    expect(hasExpired(lock, deadline - 1)).toBe(false);
    expect(hasExpired(lock, deadline)).toBe(true);
    expect(isLocked(lock, deadline)).toBe(false);
    expect(lockView(lock, deadline)).toEqual({ locked: false, lockedAt: null, lockedUntil: null, failures: 0 });
  });

  it('duration 0: locked until unlocked by hand', () => {
    const { lock, locked } = afterFailure(NO_LOCK, { lockAfterFailures: 1, lockDurationMin: 0 }, NOW, 'h');
    expect(locked).toBe(true);
    expect(lock.lockedUntil).toBeNull();
    expect(isLocked(lock, NOW + 365 * 86_400_000)).toBe(true);
    expect(hasExpired(lock, NOW + 365 * 86_400_000)).toBe(false);
  });

  it('threshold 0: never counts nor locks', () => {
    const next = afterFailure(NO_LOCK, { lockAfterFailures: 0, lockDurationMin: 15 }, NOW, 'h');
    expect(next).toEqual({ lock: NO_LOCK, locked: false });
  });
});

describe('parseLock / serializeLock', () => {
  it('round-trips through the user setting', () => {
    const { lock } = afterFailure({ ...NO_LOCK, failures: 2 }, POLICY, NOW, 'host-1');
    const [stored] = serializeLock(lock);
    expect(parseLock(stored)).toEqual(lock);
  });

  it('no lock is stored as nothing', () => {
    expect(serializeLock(NO_LOCK)).toEqual([]);
  });

  it('an absent or unreadable value is no lock', () => {
    expect(parseLock(undefined)).toBe(NO_LOCK);
    expect(parseLock('')).toBe(NO_LOCK);
    expect(parseLock('{nope')).toBe(NO_LOCK);
    expect(parseLock('{"failures":-2,"lockedUntil":5}')).toEqual(NO_LOCK);
  });
});
