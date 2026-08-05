// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WinCC OA `Alert` events → {@link Alarm} occurrences.
 *
 * Three facts about the runtime's alert stream drive this file, and getting any
 * of them wrong silently inverts the list:
 *
 *  1. `direction === true` means the alarm **CAME** (is standing), `false` means
 *     it **WENT** (cleared). That is the opposite of what one guesses — the
 *     wui-alert-data README calls it out explicitly.
 *  2. `ackState === AckState.DpAttrActTypeNot` (0) means **NOT acknowledged**;
 *     any other value means acknowledged. Same reading as the runtime's own
 *     alert table (`wui-alert-table-wrapper-helper` filters unacknowledged with
 *     `ackState === 0`).
 *  3. `atime` identifies the OCCURRENCE (the time of the CAME event + a count),
 *     so a CAME row and its later WENT row share it. Pairing on `atime` is what
 *     turns two events into one row with `raised` + `cleared`.
 */
import { AckState } from '@wincc-oa/wui-models/enums/wui-alert/ack-state.js';
import type { Alert } from '@wincc-oa/wui-models/interfaces/wui-alert/alert.js';
import { splitDpe } from './scope.js';
import { DEFAULT_PRIORITY_BANDS, severityOf, type Alarm, type AlarmStatus, type PriorityBand } from './types.js';

/** Below this, a timestamp is seconds rather than milliseconds. */
const SECONDS_THRESHOLD = 1e12;

/** Best-effort conversion of an alert timestamp to epoch ms. */
export function toEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < SECONDS_THRESHOLD ? value * 1000 : value;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value !== '') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/** True when the alert carries an acknowledgement. */
export function isAcked(alert: Pick<Alert, 'ackState'>): boolean {
  return alert.ackState !== AckState.DpAttrActTypeNot;
}

/** True when the alert is a CAME event (the alarm is standing). */
export function isCame(alert: Pick<Alert, 'direction'>): boolean {
  return alert.direction === true;
}

/**
 * Occurrence key: the same alarm instance across its CAME and WENT events.
 *
 * `atime` is the occurrence stamp; when a backend answer omits it, the DPE plus
 * the event time is the best available fallback — it keeps the row stable across
 * refreshes, it just cannot pair that event with its counterpart.
 */
export function occurrenceKey(alert: Alert): string {
  const stamp = alert.atime;
  if (stamp && typeof stamp.time === 'number' && stamp.time !== 0) {
    return `${alert.dpeName}#${stamp.time}#${stamp.count ?? 0}`;
  }
  return `${alert.dpeName}#${toEpochMs(alert.time)}`;
}

function statusOf(came: boolean, acked: boolean): AlarmStatus {
  if (came) return acked ? 'ACTIVE_ACK' : 'ACTIVE';
  return acked ? 'CLEARED_ACK' : 'CLEARED';
}

/** The value that triggered the alarm, already formatted when the backend did it. */
function valueOf(alert: Alert): string {
  const formatted = alert.formattedValue;
  if (typeof formatted === 'string' && formatted !== '') return formatted;
  if (alert.value === null || alert.value === undefined) return '';
  return String(alert.value);
}

/** The alert class as the project configured it: abbreviation, colour, priority. */
function classOf(alert: Alert): Pick<Alarm, 'abbr' | 'color' | 'prior'> {
  return { abbr: alert.abbr ?? '', color: alert.color ?? '', prior: alert.prior ?? 0 };
}

/** Who took the alarm over, and when. */
function ackOf(alert: Alert, acked: boolean): Pick<Alarm, 'ackBy' | 'ackAt'> {
  const user = alert.ackUserName ?? '';
  return {
    ackBy: user === '' ? null : user,
    ackAt: acked ? toEpochMs(alert.ackTime) || null : null
  };
}

/** The readable wording of the alarm: its text and the element's description. */
function wordingOf(alert: Alert): Pick<Alarm, 'text' | 'description' | 'value'> {
  return { text: alert.text ?? '', description: alert.dpeDescription ?? '', value: valueOf(alert) };
}

/** One alert event as a standalone {@link Alarm} (no pairing). */
export function toAlarm(alert: Alert, bands: readonly PriorityBand[] = DEFAULT_PRIORITY_BANDS): Alarm {
  const came = isCame(alert);
  const acked = isAcked(alert);
  const time = toEpochMs(alert.time);
  const raised = came ? time : toEpochMs(alert.atime?.time) || time;
  const dpe = alert.dpeName ?? '';
  const { system, dp } = splitDpe(dpe);
  const alertClass = classOf(alert);
  return {
    id: occurrenceKey(alert),
    dpe,
    system,
    dp,
    raised,
    cleared: came ? null : time,
    status: statusOf(came, acked),
    severity: severityOf(alertClass.prior, bands),
    ...alertClass,
    ...wordingOf(alert),
    acked,
    ackable: alert.ackable === true,
    ...ackOf(alert, acked)
  };
}

/** The half of an occurrence that is still standing, when there is one. */
function standingHalf(first: Alarm, second: Alarm): Alarm | null {
  if (first.cleared === null) return first;
  if (second.cleared === null) return second;
  return null;
}

/**
 * Fold two events of the same occurrence into one row.
 *
 * The CAME half carries the identity (text, value, alert class), the WENT half
 * carries `cleared`, and an acknowledgement seen on either half holds — a live
 * ack arrives as a fresh event on the standing alarm, so it must NOT be read as
 * "the alarm went".
 */
function fold(previous: Alarm, incoming: Alarm): Alarm {
  const identity = standingHalf(previous, incoming) ?? incoming;
  const cleared = previous.cleared ?? incoming.cleared;
  const acked = previous.acked || incoming.acked;
  const raised = Math.min(previous.raised || incoming.raised, incoming.raised || previous.raised);
  return {
    ...identity,
    raised,
    cleared,
    status: statusOf(cleared === null, acked),
    acked,
    ackBy: previous.ackBy ?? incoming.ackBy,
    ackAt: previous.ackAt ?? incoming.ackAt
  };
}

/**
 * Alert events → alarm occurrences, CAME paired with WENT.
 *
 * The live subscription and the archive answer both deliver events, and both can
 * deliver the two halves of one occurrence; a row is therefore never duplicated
 * between "it came" and "it went". Newest first.
 */
export function mergeAlerts(alerts: readonly Alert[], bands: readonly PriorityBand[] = DEFAULT_PRIORITY_BANDS): Alarm[] {
  const byOccurrence = new Map<string, Alarm>();
  for (const alert of alerts) {
    if (!alert || typeof alert.dpeName !== 'string' || alert.dpeName === '') continue;
    const alarm = toAlarm(alert, bands);
    const previous = byOccurrence.get(alarm.id);
    byOccurrence.set(alarm.id, previous === undefined ? alarm : fold(previous, alarm));
  }
  return [...byOccurrence.values()].sort((a, b) => b.raised - a.raised || (a.id < b.id ? -1 : 1));
}

/** The datapoint element to write to acknowledge the alarm. */
export function ackDpe(alarm: Pick<Alarm, 'dpe'>): string {
  return `${alarm.dpe}:_alert_hdl.._ack`;
}
