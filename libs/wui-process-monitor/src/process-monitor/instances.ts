// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure helpers of the host instances (issue 39): state, last seen, filter, and whether the
 * "Delete instance" action is offered. No DOM, no i18n import — unit-tested in
 * `instances.spec.ts`. The server enforces the same rules (`managers/processMonitor/
 * instance-state.js` `canDeleteInstance`, role `manage-instances` on the route).
 */
import type { Instance, InstanceState } from './types.js';

/** State of an instance; 'unknown' when the aggregator is older than 0.3.0 (no `status`). */
export type InstanceStateOrUnknown = InstanceState | 'unknown';

/** Not seen for longer than this: the list adds a hint. */
export const STALE_HINT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function instanceState(instance: Pick<Instance, 'status'>): InstanceStateOrUnknown {
  return instance.status?.state ?? 'unknown';
}

/** Connected (or not checked at all): the snapshot is live. Every other state shows it greyed. */
export function isLive(instance: Pick<Instance, 'status'>): boolean {
  const state = instanceState(instance);
  return state === 'connected' || state === 'unknown';
}

/** An instance that needs attention: any checked state other than connected. */
export function isInvalid(instance: Pick<Instance, 'status'>): boolean {
  return !isLive(instance);
}

/** Tone of the state badge (a CSS class mapped to theme variables). */
export function stateTone(state: InstanceStateOrUnknown): 'ok' | 'alarm' | 'warning' | 'neutral' {
  if (state === 'connected') return 'ok';
  if (state === 'agent-unreachable') return 'alarm';
  if (state === 'pmon-unreachable' || state === 'agent-too-old') return 'warning';
  return 'neutral';
}

/** Time since the last published snapshot (`.updated`), in ms; null when unknown. */
export function lastSeenAgeMs(instance: Pick<Instance, 'updated'>, now: number): number | null {
  if (!instance.updated) return null;
  const t = Date.parse(instance.updated);
  return Number.isNaN(t) ? null : Math.max(0, now - t);
}

/** Not seen for more than `STALE_HINT_DAYS`. */
export function isLongUnseen(instance: Pick<Instance, 'updated'>, now: number, days = STALE_HINT_DAYS): boolean {
  const age = lastSeenAgeMs(instance, now);
  return age !== null && age > days * DAY_MS;
}

/**
 * Is "Delete instance" offered? Only with the role, only for an instance whose agent does not
 * answer, never for the aggregator's own node (nor for an aggregator that does not say which
 * one it is).
 */
export function canOfferDelete(instance: Pick<Instance, 'status' | 'local'>, granted: boolean): boolean {
  if (!granted) return false;
  if (instance.local !== false) return false;
  return instanceState(instance) === 'agent-unreachable';
}

/** The instances to list: all, or only the invalid ones. */
export function filterInstances<T extends Pick<Instance, 'status'>>(list: readonly T[], invalidOnly: boolean): T[] {
  return invalidOnly ? list.filter(isInvalid) : [...list];
}

/** Number of instances that need attention, for the list header. */
export function countInvalid(list: readonly Pick<Instance, 'status'>[]): number {
  return list.filter(isInvalid).length;
}
