// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Alarm statistics: the counters, the EEMUA-191 flood histogram and the bad-actor
 * tops. Pure functions over a snapshot, so they read the same whether the snapshot
 * is the live subscription or an archived period.
 */
import type { ActorGrouping, Alarm, AlarmCounters, AlarmHistogram, BadActor, HistogramBucket } from './types.js';

const MINUTE_MS = 60_000;
export const BUCKET_MS = 10 * MINUTE_MS;
/** EEMUA 191 — ten alarms in ten minutes is the operator-load ceiling. */
export const EEMUA_THRESHOLD = 10;
/** Default histogram window: three hours, the reading of a shift's last stretch. */
export const DEFAULT_WINDOW_MS = 3 * 60 * MINUTE_MS;
const DEFAULT_ACTOR_LIMIT = 10;
/** Bars a histogram aims for, whatever the period's width. */
export const TARGET_BUCKETS = 36;

/**
 * Bucket size for a period: the EEMUA ten minutes for a short window, scaled up
 * (in whole ten-minute steps) for a wide one — a 10-minute bar over seven days
 * would be a thousand bars nobody can read.
 */
export function bucketFor(spanMs: number): number {
  const scaled = Math.ceil(spanMs / TARGET_BUCKETS / BUCKET_MS) * BUCKET_MS;
  return Math.max(BUCKET_MS, scaled);
}

/** The operator-load ceiling of a bucket, scaled from the EEMUA ten minutes. */
export function thresholdFor(bucketMs: number): number {
  return Math.max(1, Math.round(EEMUA_THRESHOLD * (bucketMs / BUCKET_MS)));
}

/** A per-rank tally that answers 0 for a rank nobody raised. */
function emptyRanks(): Record<number, number> {
  return {};
}

function bump(tally: Record<number, number>, rank: number): void {
  tally[rank] = (tally[rank] ?? 0) + 1;
}

/**
 * Counters over the rows it is given — exactly the rows the tab shows.
 *
 * `unacknowledged` counts EVERY row nobody took over, standing or already gone.
 * The "target 0" card is the shift's backlog, and an alarm that came and went
 * unacknowledged is still on that backlog: excluding it would report zero while
 * something is waiting for an answer.
 */
export function countAlarms(all: readonly Alarm[], now: number): AlarmCounters {
  const byRank = emptyRanks();
  const ackedByRank = emptyRanks();
  let active = 0;
  let unacknowledged = 0;
  let cleared = 0;
  let last: Alarm | null = null;

  for (const alarm of all) {
    if (last === null || alarm.raised > last.raised) last = alarm;
    if (alarm.cleared === null) active++;
    else cleared++;
    if (alarm.acked) bump(ackedByRank, alarm.rank);
    else unacknowledged++;
    bump(byRank, alarm.rank);
  }

  return { active, unacknowledged, byRank, ackedByRank, cleared, last, updatedAt: now };
}

/**
 * Alarms raised per bucket over the window ending at `now`.
 *
 * Buckets are aligned on the bucket size so the chart does not shift under the
 * operator between two refreshes.
 */
export function alarmHistogram(
  all: readonly Alarm[],
  now: number,
  windowMs: number = DEFAULT_WINDOW_MS,
  bucketMs: number = BUCKET_MS
): AlarmHistogram {
  const size = Math.max(1, bucketMs);
  // The CURRENT bucket always extends past `now` — aligning `end` on `now` itself
  // would drop the alarm that just came when the clock sits on a boundary.
  const end = (Math.floor(now / size) + 1) * size;
  const count = Math.max(1, Math.round(windowMs / size));
  const start = end - count * size;
  const counts: number[] = Array.from({ length: count }, () => 0);

  for (const alarm of all) {
    if (alarm.raised < start || alarm.raised >= end) continue;
    const index = Math.floor((alarm.raised - start) / size);
    if (index >= 0 && index < count) counts[index] = (counts[index] ?? 0) + 1;
  }

  const threshold = thresholdFor(size);
  const buckets: HistogramBucket[] = counts.map((value, index) => ({
    from: start + index * size,
    count: value,
    overThreshold: value > threshold
  }));
  return { buckets, threshold, bucketMs: size };
}

/** How a bad actor is keyed and labelled, per grouping. */
function actorOf(alarm: Alarm, grouping: ActorGrouping): { key: string; label: string; sublabel: string } {
  if (grouping === 'dp') {
    return { key: alarm.dp, label: alarm.dp, sublabel: alarm.description };
  }
  return { key: `${alarm.text}::${alarm.dpe}`, label: alarm.text || alarm.dpe, sublabel: alarm.dpe };
}

/**
 * The recurring alarms of the snapshot — the EEMUA-191 reading of operator load.
 *
 * Grouped by alarm TEXT (the same message coming back) or by DATAPOINT (the one
 * device that floods), keeping the worst range seen in the group.
 */
export function topActors(
  all: readonly Alarm[],
  grouping: ActorGrouping = 'text',
  limit: number = DEFAULT_ACTOR_LIMIT
): readonly BadActor[] {
  const accumulator = new Map<string, BadActor>();
  for (const alarm of all) {
    const { key, label, sublabel } = actorOf(alarm, grouping);
    const current = accumulator.get(key);
    if (current === undefined) {
      accumulator.set(key, { key, label, sublabel, count: 1, rank: alarm.rank, color: alarm.color });
      continue;
    }
    current.count++;
    if (alarm.rank < current.rank) {
      current.rank = alarm.rank;
      current.color = alarm.color;
    }
  }
  return [...accumulator.values()]
    .sort((first, second) => second.count - first.count || (first.key < second.key ? -1 : 1))
    .slice(0, limit);
}
