// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Deterministic ordering of alarms.
 *
 * Two workstations must never present the same list in two different orders, so
 * every comparison ends with the id as a tie-breaker. `criticality` is the single
 * definition of "the thing to look at first", shared by the sort and by the
 * banner — one ranking, not two.
 */
import type { Alarm } from './types.js';

export const SORT_FIELDS = ['raised', 'cleared', 'severity', 'dp', 'text', 'status', 'value', 'criticality'] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type SortDir = 'asc' | 'desc';

function cmpNum(a: number, b: number): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function cmpStr(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Criticality rank, ascending = worst first: severity band, then unacknowledged
 * before acknowledged, then still-standing before cleared, then most recent.
 */
export function criticality(alarm: Alarm): readonly number[] {
  return [alarm.severity, alarm.acked ? 1 : 0, alarm.cleared === null ? 0 : 1, -alarm.raised];
}

function cmpCriticality(first: Alarm, second: Alarm): number {
  const left = criticality(first);
  const right = criticality(second);
  for (const [index, value] of left.entries()) {
    const diff = cmpNum(value, right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function cmpField(first: Alarm, second: Alarm, field: SortField): number {
  switch (field) {
    case 'raised': {
      return cmpNum(first.raised, second.raised);
    }
    // A standing alarm has no clearing time; it sorts after every cleared one.
    case 'cleared': {
      return cmpNum(first.cleared ?? Number.MAX_SAFE_INTEGER, second.cleared ?? Number.MAX_SAFE_INTEGER);
    }
    case 'severity': {
      return cmpNum(first.severity, second.severity);
    }
    case 'dp': {
      return cmpStr(first.dpe, second.dpe);
    }
    case 'text': {
      return cmpStr(first.text, second.text);
    }
    case 'status': {
      return cmpStr(first.status, second.status);
    }
    case 'value': {
      return cmpStr(first.value, second.value);
    }
    case 'criticality': {
      return cmpCriticality(first, second);
    }
    default: {
      return 0;
    }
  }
}

/** Compare two alarms on one field, with a stable final tie-break on the id. */
export function compareAlarms(first: Alarm, second: Alarm, field: SortField, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  const diff = cmpField(first, second, field);
  if (diff !== 0) return diff * sign;
  return first.id < second.id ? -1 : 1;
}

/** The most critical alarm of a set — the "look at this first" pick. */
export function mostCritical(alarms: readonly Alarm[]): Alarm | null {
  let best: Alarm | null = null;
  for (const alarm of alarms) {
    if (best === null) {
      best = alarm;
      continue;
    }
    const diff = cmpCriticality(alarm, best);
    if (diff < 0 || (diff === 0 && alarm.id < best.id)) best = alarm;
  }
  return best;
}
