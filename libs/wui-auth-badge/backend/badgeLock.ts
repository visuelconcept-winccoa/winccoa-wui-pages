// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// badgeLock — a user's badge lock, as kept in their user setting BADGE_LOCK
// (`_usr_<UserId>_BADGE_LOCK`, its `.Content[0]` a JSON text): the refused
// badge logins in a row imputable to them, and when their badge was locked
// and until when. Kept with the user, not in the webserver: the lock survives
// a restart and holds on every station.
//
// Pure: the reading and writing are badgeAuth.ts's (oaAuth.ts' user settings).
// -----------------------------------------------------------------------------

export interface BadgeLock {
  /** Refused badge logins in a row, imputable to the user. */
  failures: number;
  /** When the badge was locked (epoch ms), null when it is not. */
  lockedAt: number | null;
  /** Until when (epoch ms); null with `lockedAt`: until unlocked on "Badges". */
  lockedUntil: number | null;
  /** The station of the last refusal. */
  host: string;
}

/** What the "Badges" page sees of a lock (GET /users). */
export interface LockView {
  locked: boolean;
  lockedAt: number | null;
  lockedUntil: number | null;
  failures: number;
}

/** The lock's settings (badgeSettings.ts). */
export interface LockPolicy {
  /** 0: never locked. */
  lockAfterFailures: number;
  /** 0: until unlocked by hand. */
  lockDurationMin: number;
}

export const NO_LOCK: BadgeLock = Object.freeze({ failures: 0, lockedAt: null, lockedUntil: null, host: '' });

export const LOCK_SETTING = 'BADGE_LOCK';
export const LOCK_SETTING_NAME = 'Verrouillage du badge';

/** A stored lock — absent or unreadable: none. */
export function parseLock(raw: string | undefined): BadgeLock {
  if (!raw?.trim()) return NO_LOCK;
  try {
    const stored = JSON.parse(raw) as Partial<Record<keyof BadgeLock, unknown>>;
    const time = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    const failures = typeof stored.failures === 'number' && stored.failures > 0 ? Math.floor(stored.failures) : 0;
    const lockedAt = time(stored.lockedAt);
    return {
      failures,
      lockedAt,
      lockedUntil: lockedAt === null ? null : time(stored.lockedUntil),
      host: typeof stored.host === 'string' ? stored.host : ''
    };
  } catch {
    return NO_LOCK;
  }
}

/** The setting's content: nothing for no lock. */
export function serializeLock(lock: BadgeLock): string[] {
  return lock.failures === 0 && lock.lockedAt === null ? [] : [JSON.stringify(lock)];
}

export function isLocked(lock: BadgeLock, now: number): boolean {
  return lock.lockedAt !== null && (lock.lockedUntil === null || lock.lockedUntil > now);
}

/** The lock has run out (not lifted yet in the setting). */
export function hasExpired(lock: BadgeLock, now: number): boolean {
  return lock.lockedAt !== null && lock.lockedUntil !== null && lock.lockedUntil <= now;
}

/** One more refusal imputable to the user: the new lock, and whether it locks the badge now. */
export function afterFailure(lock: BadgeLock, policy: LockPolicy, now: number, host: string): { lock: BadgeLock; locked: boolean } {
  if (policy.lockAfterFailures <= 0) return { lock, locked: false };
  const failures = lock.failures + 1;
  if (failures < policy.lockAfterFailures) return { lock: { ...lock, failures, host }, locked: false };
  const lockedUntil = policy.lockDurationMin > 0 ? now + policy.lockDurationMin * 60_000 : null;
  return { lock: { failures, lockedAt: now, lockedUntil, host }, locked: true };
}

/** The page's view: an expired lock counts as none. */
export function lockView(lock: BadgeLock, now: number): LockView {
  if (hasExpired(lock, now)) return { locked: false, lockedAt: null, lockedUntil: null, failures: 0 };
  return { locked: isLocked(lock, now), lockedAt: lock.lockedAt, lockedUntil: lock.lockedUntil, failures: lock.failures };
}
