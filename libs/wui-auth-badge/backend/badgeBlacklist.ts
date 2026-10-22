// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// badgeBlacklist — the badge login's lock per station (its IP address, the
// request's `clientAddress`), and the blacklist that keeps every lock:
//
//   - the refused badges in a row per address (`counters`): an unknown badge
//     or a recognised user refused alike; a login from the address resets it;
//   - at `lockAfterFailures` (the settings, badgeSettings.ts; 0: never), the
//     address is locked for `lockDurationMin` minutes (0: until unlocked on
//     "Badges") — a record of the blacklist, `active`;
//   - a record ends `expired` (its deadline passed) or `lifted` (unlocked by
//     hand: who, when, why); kept as the history, MAX_RECORDS at most — the
//     oldest ended records purged first, an active one never.
//
// Kept as JSON in the DP `WuiAuthBadge_Blacklist.state` (its type of the same
// name created at first need, as WuiAuthBadge_Config is), read again for every
// decision — the DP is the source of truth, nothing is kept in memory: a lock
// survives a webserver restart. The changes of one webserver are serialised
// (`updateBlacklist`); an absent DP is an empty blacklist.
//
// The functions over a `Blacklist` are pure (the specs' and badgeAuth.ts');
// they give back the same object when nothing changes, so nothing is written.
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { WinccoaDpTypeNode, WinccoaElementType } from 'winccoa-manager';

export type LockState = 'active' | 'expired' | 'lifted';

/** One lock of an address, current or past. */
export interface BlacklistRecord {
  /** `<lockedAt>-<ip>`: the page's key. */
  id: string;
  ip: string;
  /** Epoch ms. */
  lockedAt: number;
  /** Epoch ms; null: until unlocked on "Badges". */
  lockedUntil: number | null;
  /** The refused badges in a row that locked it. */
  failures: number;
  /** The last item the station sent (its workcenter…), '' when none. */
  item: string;
  state: LockState;
  /** Unlocked by hand: who, when (epoch ms), and the reason given. */
  liftedBy: string | null;
  liftedAt: number | null;
  reason: string | null;
}

/** The refused badges in a row of an address not locked (yet). */
export interface FailureCount {
  ip: string;
  failures: number;
  item: string;
  /** The last refusal (epoch ms). */
  lastAt: number;
}

export interface Blacklist {
  counters: FailureCount[];
  /** Newest first. */
  records: BlacklistRecord[];
}

/** The lock's settings (badgeSettings.ts). */
export interface LockPolicy {
  /** 0: never locked. */
  lockAfterFailures: number;
  /** 0: until unlocked by hand. */
  lockDurationMin: number;
}

/** The history's bound: beyond, the oldest ended records are purged. */
export const MAX_RECORDS = 500;
/** The addresses counted at most: beyond, the oldest counts are dropped. */
export const MAX_COUNTERS = 500;

export const EMPTY_BLACKLIST: Blacklist = Object.freeze({ counters: [], records: [] }) as Blacklist;

// --- pure ---------------------------------------------------------------------------

/** The address's active lock — its deadline not passed —, or undefined. */
export function activeLock(blacklist: Blacklist, ip: string, now: number): BlacklistRecord | undefined {
  return blacklist.records.find((record) => record.ip === ip && isActive(record, now));
}

function isActive(record: BlacklistRecord, now: number): boolean {
  return record.state === 'active' && (record.lockedUntil === null || record.lockedUntil > now);
}

/** The active records whose deadline has passed, turned `expired`. */
export function expire(blacklist: Blacklist, now: number): { blacklist: Blacklist; expired: BlacklistRecord[] } {
  const expired: BlacklistRecord[] = [];
  const records = blacklist.records.map((record) => {
    if (record.state !== 'active' || isActive(record, now)) return record;
    const ended = { ...record, state: 'expired' as const };
    expired.push(ended);
    return ended;
  });
  return expired.length === 0 ? { blacklist, expired } : { blacklist: { ...blacklist, records }, expired };
}

/**
 * One more refused badge from `ip`: its count, and the new lock when it reaches the threshold
 * (the count then starts again from 0). Threshold 0: nothing counted.
 */
export function recordFailure(
  blacklist: Blacklist,
  ip: string,
  item: string,
  policy: LockPolicy,
  now: number
): { blacklist: Blacklist; failures: number; locked?: BlacklistRecord } {
  if (policy.lockAfterFailures <= 0) return { blacklist, failures: 0 };
  const others = blacklist.counters.filter((counter) => counter.ip !== ip);
  const failures = (blacklist.counters.find((counter) => counter.ip === ip)?.failures ?? 0) + 1;
  if (failures < policy.lockAfterFailures) {
    const counters = [...others, { ip, failures, item, lastAt: now }]
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, MAX_COUNTERS);
    return { blacklist: { ...blacklist, counters }, failures };
  }
  const locked: BlacklistRecord = {
    id: `${now}-${ip}`,
    ip,
    lockedAt: now,
    lockedUntil: policy.lockDurationMin > 0 ? now + policy.lockDurationMin * 60_000 : null,
    failures,
    item,
    state: 'active',
    liftedBy: null,
    liftedAt: null,
    reason: null
  };
  return { blacklist: { counters: others, records: bounded([locked, ...blacklist.records]) }, failures, locked };
}

/** A login from `ip`: its count back to 0. */
export function resetFailures(blacklist: Blacklist, ip: string): Blacklist {
  if (!blacklist.counters.some((counter) => counter.ip === ip)) return blacklist;
  return { ...blacklist, counters: blacklist.counters.filter((counter) => counter.ip !== ip) };
}

/** The address's active lock lifted by `by` for `reason` — and its count reset; `lifted` undefined when it had none. */
export function lift(
  blacklist: Blacklist,
  ip: string,
  by: string,
  reason: string,
  now: number
): { blacklist: Blacklist; lifted?: BlacklistRecord } {
  const current = activeLock(blacklist, ip, now);
  if (!current) return { blacklist };
  const lifted: BlacklistRecord = { ...current, state: 'lifted', liftedBy: by, liftedAt: now, reason };
  return {
    blacklist: resetFailures({ ...blacklist, records: blacklist.records.map((record) => (record === current ? lifted : record)) }, ip),
    lifted
  };
}

/** At most MAX_RECORDS: the oldest ended records go first; an active lock is never purged. */
function bounded(records: BlacklistRecord[]): BlacklistRecord[] {
  let excess = records.length - MAX_RECORDS;
  if (excess <= 0) return records;
  const kept = [...records];
  for (let index = kept.length - 1; index >= 0 && excess > 0; index -= 1) {
    if (kept[index]?.state === 'active') continue;
    kept.splice(index, 1);
    excess -= 1;
  }
  return kept;
}

/** The stored blacklist; an absent or unreadable value is empty, an invalid entry dropped. */
export function parseBlacklist(raw: unknown): Blacklist {
  const text = raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : raw;
  if (typeof text !== 'string' || text.trim() === '') return EMPTY_BLACKLIST;
  let stored: { counters?: unknown; records?: unknown };
  try {
    stored = JSON.parse(text) as typeof stored;
  } catch {
    console.warn('[auth-badge] blacklist unreadable, taken as empty');
    return EMPTY_BLACKLIST;
  }
  const list = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object') : [];
  const time = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  const counters = list(stored.counters).flatMap((entry): FailureCount[] => {
    const failures = time(entry['failures']);
    const lastAt = time(entry['lastAt']);
    return str(entry['ip']) && failures && failures > 0 && lastAt !== null
      ? [{ ip: str(entry['ip']), failures: Math.floor(failures), item: str(entry['item']), lastAt }]
      : [];
  });
  const records = list(stored.records).flatMap((entry): BlacklistRecord[] => {
    const ip = str(entry['ip']);
    const lockedAt = time(entry['lockedAt']);
    const state = entry['state'];
    if (!ip || lockedAt === null || (state !== 'active' && state !== 'expired' && state !== 'lifted')) return [];
    return [
      {
        id: str(entry['id']) || `${lockedAt}-${ip}`,
        ip,
        lockedAt,
        lockedUntil: time(entry['lockedUntil']),
        failures: Math.max(0, Math.floor(time(entry['failures']) ?? 0)),
        item: str(entry['item']),
        state,
        liftedBy: typeof entry['liftedBy'] === 'string' ? entry['liftedBy'] : null,
        liftedAt: time(entry['liftedAt']),
        reason: typeof entry['reason'] === 'string' ? entry['reason'] : null
      }
    ];
  });
  return { counters, records };
}

export function serializeBlacklist(blacklist: Blacklist): string {
  return JSON.stringify({ counters: blacklist.counters, records: blacklist.records });
}

// --- the DP ---------------------------------------------------------------------------

const BLACKLIST_DPT = 'WuiAuthBadge_Blacklist';
const BLACKLIST_DP = 'WuiAuthBadge_Blacklist';
const BLACKLIST_DPE = `${BLACKLIST_DP}.state`;

let ready: Promise<void> | null = null;
/** The changes of this webserver, one after the other (each one reads the DP again). */
let queue: Promise<unknown> = Promise.resolve();

/** The stored blacklist (empty without its DP). Throws when the DP cannot be read. */
export async function readBlacklist(): Promise<Blacklist> {
  const winccoa = WsjServerGlobal.winccoa;
  if (!winccoa.dpExists(BLACKLIST_DP)) return EMPTY_BLACKLIST;
  return parseBlacklist(await winccoa.dpGet(BLACKLIST_DPE));
}

/**
 * Reads the blacklist, applies `change` and stores what it gives back — unless it is the same
 * object (nothing changed). Serialised: two badges at once do not lose a count.
 */
export function updateBlacklist<T>(change: (blacklist: Blacklist) => { blacklist: Blacklist; result: T }): Promise<T> {
  const run = queue.then(async () => {
    const before = await readBlacklist();
    const { blacklist, result } = change(before);
    if (blacklist !== before) {
      await ensureBlacklistDp();
      await WsjServerGlobal.winccoa.dpSetWait(BLACKLIST_DPE, serializeBlacklist(blacklist));
    }
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** The type and the DP, created at first need. */
function ensureBlacklistDp(): Promise<void> {
  ready ??= (async () => {
    const winccoa = WsjServerGlobal.winccoa;
    if (winccoa.dpExists(BLACKLIST_DP)) return;
    if (!(winccoa.dpTypes(BLACKLIST_DPT) as string[]).includes(BLACKLIST_DPT)) {
      const type = new WinccoaDpTypeNode(BLACKLIST_DPT, WinccoaElementType.Struct, '', [
        new WinccoaDpTypeNode('state', WinccoaElementType.String)
      ]);
      if (!(await winccoa.dpTypeCreate(type))) throw new Error(`creating the type ${BLACKLIST_DPT} was refused`);
    }
    if (!(await winccoa.dpCreate(BLACKLIST_DP, BLACKLIST_DPT))) throw new Error(`creating ${BLACKLIST_DP} was refused`);
    console.info(`[auth-badge] blacklist DP ${BLACKLIST_DP} created`);
  })().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}
