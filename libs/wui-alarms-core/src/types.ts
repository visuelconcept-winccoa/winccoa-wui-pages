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
 * Severity vs. priority — read this before tuning anything: WinCC OA carries an
 * alert-class priority (`Alert.prior`, project-configurable) and the class'
 * own colour + abbreviation. The colour and the abbreviation are AUTHORITATIVE
 * and rendered as-is; `severity` (P1…P4) is a derived GROUPING used by the
 * counters, the priority filter and the ordering, computed from `prior` through
 * {@link DEFAULT_PRIORITY_BANDS}. The default bands assume "higher `prior` =
 * more urgent"; a project whose alert classes number priorities differently
 * passes its own bands (`bands` property of the view) — a wrong band table
 * therefore mis-groups alarms, it never mis-colours them.
 */

/** Derived urgency band, 1 = most urgent (P1) … 4 = least (P4). */
export type Severity = 1 | 2 | 3 | 4;

export const SEVERITIES: readonly Severity[] = [1, 2, 3, 4];

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
  /** Derived band — see the file header. */
  severity: Severity;
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

/** `prior >= minPrior` → this severity. Evaluated from the highest band down. */
export interface PriorityBand {
  severity: Severity;
  minPrior: number;
}

/**
 * Default band table for WinCC OA alert-class priorities (0…255).
 *
 * ASSUMPTION, not a WinCC OA guarantee: a higher `_prior` is more urgent, and
 * the standard classes spread over the 0…80 range. Override per project when
 * the alert classes are numbered otherwise.
 */
export const DEFAULT_PRIORITY_BANDS: readonly PriorityBand[] = [
  { severity: 1, minPrior: 60 },
  { severity: 2, minPrior: 40 },
  { severity: 3, minPrior: 20 },
  { severity: 4, minPrior: Number.NEGATIVE_INFINITY }
];

/** Band a raw priority into a {@link Severity}. */
export function severityOf(prior: number, bands: readonly PriorityBand[] = DEFAULT_PRIORITY_BANDS): Severity {
  const ordered = [...bands].sort((a, b) => b.minPrior - a.minPrior);
  for (const band of ordered) {
    if (prior >= band.minPrior) return band.severity;
  }
  return 4;
}

/** Live counters of the view header. */
export interface AlarmCounters {
  /** Standing alarms (not cleared). */
  active: number;
  /** Standing and not taken over — the number a shift must bring to zero. */
  unacknowledged: number;
  /** Standing alarms per severity band. */
  bySeverity: Record<Severity, number>;
  /**
   * Of those, how many are already acknowledged, per band.
   *
   * The parenthesis of `P1 92 (12 ack)` is the whole point: ninety-two alarms of
   * which twelve are taken over is a different shift from ninety-two of which
   * none are — and a single global `unacknowledged` cannot say at which band the
   * backlog sits.
   */
  ackedBySeverity: Record<Severity, number>;
  /** Rows that already went (only ever non-zero on an archived period). */
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
  severity: Severity;
  color: string;
}

/** How the bad-actor top is grouped. */
export type ActorGrouping = 'text' | 'dp';
