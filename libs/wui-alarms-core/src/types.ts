// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The alarm domain shapes — the contract every consumer of the kit shares.
 *
 * One {@link Alarm} is ONE alarm occurrence, not one alert event: WinCC OA
 * reports a CAME event and (later) a WENT event for the same occurrence, and
 * {@link ../mapping.ts mergeAlerts} pairs them into a single row carrying
 * `raised` + `cleared`. That pairing is what lets the same component render the
 * live list and an archived period with one table.
 *
 * Ranges vs. priority — read this before tuning anything. WinCC OA carries an
 * alert-class priority (`Alert.prior`) plus the class' own colour and
 * abbreviation. Those two stay AUTHORITATIVE and are rendered as the project
 * configured them, in the "class" column.
 *
 * On top of that the module groups priorities into {@link AlarmRange}s — the
 * P1…P4 of the alarm list — and THOSE are the project's own: their threshold,
 * their abbreviation and their colour are edited in the page and stored in the
 * module's configuration datapoint. A range is what the counters count, what the
 * chips filter on and what the ordering ranks; `Alarm.rank` is only the position
 * of the matching range (1 = most urgent).
 *
 * {@link DEFAULT_RANGES} is the seed, not a rule: it assumes "higher `prior` =
 * more urgent" over the 0…80 spread of the standard classes, and a project whose
 * classes are numbered otherwise edits it instead of living with it.
 */

/**
 * Alarm lifecycle. `ACTIVE_ACK` is two facts (still standing, taken over), so it
 * stays a distinct state instead of a boolean on ACTIVE.
 */
export type AlarmStatus = 'ACTIVE' | 'ACTIVE_ACK' | 'CLEARED' | 'CLEARED_ACK';

/** One alarm occurrence, as the alarm view displays it. */
export interface Alarm {
  /** Stable id: the same occurrence keeps one row across refreshes. */
  id: string;
  /** Full datapoint element, e.g. `System1:Pump1.value`. */
  dpe: string;
  /** System prefix without the colon, e.g. `System1` (empty when absent). */
  system: string;
  /** Datapoint name without system prefix and element, e.g. `Pump1`. */
  dp: string;
  /** Epoch ms the alarm CAME. */
  raised: number;
  /** Epoch ms it WENT, when it did; `null` = still standing. */
  cleared: number | null;
  status: AlarmStatus;
  /** Position of the matching {@link AlarmRange}, 1 = most urgent. */
  rank: number;
  /** Raw WinCC OA alert-class priority. */
  prior: number;
  /** Alert-class abbreviation, e.g. `A` (alert) / `I` (info). */
  abbr: string;
  /** Alert-class colour as a ready-to-use CSS hex, e.g. `#FF0000`. */
  color: string;
  /** Alarm text (may be empty). */
  text: string;
  /** Datapoint element description. */
  description: string;
  /** Value that triggered the alarm, already formatted with its unit. */
  value: string;
  acked: boolean;
  ackable: boolean;
  ackBy: string | null;
  ackAt: number | null;
}

/**
 * True when acknowledging this alarm is both allowed and useful.
 *
 * Two facts, deliberately kept apart: `ackable` says the alert class ACCEPTS an
 * acknowledgement, `acked` says one already happened. The selection, the button
 * and the write all go through this one predicate, so they can never disagree
 * about what a click would do.
 */
export function canAcknowledge(alarm: Pick<Alarm, 'ackable' | 'acked'>): boolean {
  return alarm.ackable && !alarm.acked;
}

/**
 * One configured priority range — the project's own P1 / P2 / … .
 *
 * `minPrior` is the INCLUSIVE lower bound on the WinCC OA alert-class priority;
 * ranges are read from the highest bound down. There is deliberately no
 * "infinity" bound: the value is stored as JSON in a datapoint, and
 * `JSON.stringify(-Infinity)` is `null`. The LOWEST range simply catches
 * everything below it (see {@link rangeFor}).
 */
export interface AlarmRange {
  /** Stable id — survives a renamed abbreviation. */
  id: string;
  /** Short label on the pill: `P1`, `CRIT`, … */
  abbr: string;
  /** Pill and row colour, a CSS hex (`#E5484D`). */
  color: string;
  /** Inclusive lower bound of `Alert.prior`. */
  minPrior: number;
}

/**
 * The seed ranges: the four levels of the reference product, over the priority
 * spread of the standard WinCC OA alert classes. A project edits them in the
 * page — see {@link ./data/alarm-config-store.ts}.
 */
export const DEFAULT_RANGES: readonly AlarmRange[] = [
  { id: 'p1', abbr: 'P1', color: '#E5484D', minPrior: 60 },
  { id: 'p2', abbr: 'P2', color: '#F5A524', minPrior: 40 },
  { id: 'p3', abbr: 'P3', color: '#00A0D2', minPrior: 20 },
  { id: 'p4', abbr: 'P4', color: '#8B939C', minPrior: 0 }
];

/** Ranges in reading order (most urgent first), invalid entries dropped. */
export function normaliseRanges(ranges: readonly AlarmRange[] | undefined): AlarmRange[] {
  const kept = (ranges ?? [])
    .filter((range) => typeof range?.id === 'string' && range.id !== '')
    .map((range) => ({
      id: range.id,
      abbr: range.abbr === '' ? range.id.toUpperCase() : range.abbr,
      color: range.color,
      minPrior: Number.isFinite(range.minPrior) ? range.minPrior : 0
    }));
  if (kept.length === 0) return structuredClone(DEFAULT_RANGES) as AlarmRange[];
  return kept.sort((first, second) => second.minPrior - first.minPrior);
}

/**
 * The range a priority falls in.
 *
 * Anything below the lowest bound lands in the LOWEST range rather than nowhere:
 * an alarm the configuration did not foresee must still be shown, at the least
 * urgent level, instead of disappearing from every counter.
 */
export function rangeFor(prior: number, ranges: readonly AlarmRange[] = DEFAULT_RANGES): AlarmRange {
  const ordered = ranges.length > 0 ? ranges : DEFAULT_RANGES;
  const match = ordered.find((range) => prior >= range.minPrior);
  return match ?? (ordered.at(-1) as AlarmRange);
}

/** Position of a priority's range, 1 = most urgent. */
export function rankFor(prior: number, ranges: readonly AlarmRange[] = DEFAULT_RANGES): number {
  const ordered = ranges.length > 0 ? ranges : DEFAULT_RANGES;
  const index = ordered.indexOf(rangeFor(prior, ordered));
  return index === -1 ? ordered.length : index + 1;
}

/** The range at a rank, clamped — the pill of a row keeps a colour whatever happens. */
export function rangeAt(rank: number, ranges: readonly AlarmRange[] = DEFAULT_RANGES): AlarmRange {
  const ordered = ranges.length > 0 ? ranges : DEFAULT_RANGES;
  return ordered[Math.min(Math.max(1, rank), ordered.length) - 1] as AlarmRange;
}

/** Live counters of the view header. */
export interface AlarmCounters {
  /** Standing alarms (not cleared). */
  active: number;
  /**
   * Not taken over — the number a shift must bring to zero.
   *
   * Includes the alarms that already WENT without an acknowledgement: they left
   * the field but not the operator's responsibility.
   */
  unacknowledged: number;
  /** Rows of the snapshot per range rank (what the tab shows). */
  byRank: Record<number, number>;
  /**
   * Of those, how many are already acknowledged, per band.
   *
   * The parenthesis of `P1 92 (12 ack)` is the whole point: ninety-two alarms of
   * which twelve are taken over is a different shift from ninety-two of which
   * none are — and a single global `unacknowledged` cannot say at which band the
   * backlog sits.
   */
  ackedByRank: Record<number, number>;
  /** Rows that already went — on the active tab, the gone-but-unacknowledged ones. */
  cleared: number;
  /** Most recent alarm, shown in clear at the top of the view. */
  last: Alarm | null;
  updatedAt: number;
}

/** One bucket of the alarm-flood histogram. */
export interface HistogramBucket {
  /** Epoch ms of the bucket start. */
  from: number;
  count: number;
  /** True when the bucket exceeds the EEMUA-191 operator-load threshold. */
  overThreshold: boolean;
}

export interface AlarmHistogram {
  buckets: readonly HistogramBucket[];
  /** EEMUA 191: beyond ten alarms in ten minutes no operator can keep up. */
  threshold: number;
  bucketMs: number;
}

/** A recurring alarm text or datapoint — the "bad actor" analysis. */
export interface BadActor {
  key: string;
  label: string;
  sublabel: string;
  count: number;
  rank: number;
  color: string;
}

/** How the bad-actor top is grouped. */
export type ActorGrouping = 'text' | 'dp';
