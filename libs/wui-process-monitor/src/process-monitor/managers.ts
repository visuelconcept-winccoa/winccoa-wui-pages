// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure helpers of the managers table (issue 33): uptime, start mode, sorting.
 * No DOM, no i18n import — unit-tested in `managers.spec.ts`.
 */
import type { ManagerInfo } from './types.js';

/** Live start-mode codes of `MGRLIST:STATI` → the words of `config/progs`. */
const LIVE_START_MODES: Record<number, string> = { 0: 'manual', 1: 'once', 2: 'always' };

/** The live start mode of a manager as a `config/progs` word ('' for an unknown code). */
export function liveStartMode(m: Pick<ManagerInfo, 'startMode'>): string {
  return LIVE_START_MODES[m.startMode] ?? '';
}

/** True when pmon runs the manager with another start mode than `config/progs` says. */
export function startModeDiffers(m: Pick<ManagerInfo, 'startMode' | 'startModeCfg'>): boolean {
  const live = liveStartMode(m);
  return Boolean(live && m.startModeCfg && live !== m.startModeCfg.toLowerCase());
}

/** Start time in epoch ms, or null when the manager has none that can be read. */
export function startTimeMs(m: Pick<ManagerInfo, 'startTime'>): number | null {
  if (!m.startTime) return null;
  const t = Date.parse(m.startTime);
  return Number.isNaN(t) ? null : t;
}

/** A running (or starting) manager has a start time worth showing; a stopped one has none. */
export function hasStartTime(m: Pick<ManagerInfo, 'state' | 'startTime'>): boolean {
  return m.state !== 0 && Boolean(m.startTime);
}

/**
 * Uptime as a compact text: `45 s`, `12 min`, `3 h 05`, `2 d 4 h`. `dayUnit` is the
 * localized day abbreviation (`d`, `j`, `T`). A negative span (clock skew between the
 * browser and the server) reads as `0 s`.
 */
export function formatUptime(ms: number, dayUnit = 'd'): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} ${dayUnit} ${h % 24} h`;
}

export type ManagerSortKey = 'index' | 'name' | 'state' | 'startTime';
export type SortDir = 'asc' | 'desc';

/**
 * The managers sorted by one column; ties keep the pmon order. For the start time,
 * managers without one (stopped, unreadable) always go last, so a descending sort shows
 * the most recent starts first — a manager restarting in a loop comes up top.
 */
export function sortManagers(list: readonly ManagerInfo[], key: ManagerSortKey, dir: SortDir): ManagerInfo[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byIndex = (a: ManagerInfo, b: ManagerInfo): number => a.index - b.index;
  const compare = (a: ManagerInfo, b: ManagerInfo): number => {
    if (key === 'name') return sign * a.name.localeCompare(b.name) || byIndex(a, b);
    if (key === 'state') return sign * (a.state - b.state) || byIndex(a, b);
    if (key === 'startTime') {
      const ta = hasStartTime(a) ? startTimeMs(a) : null;
      const tb = hasStartTime(b) ? startTimeMs(b) : null;
      if (ta === null || tb === null) return (ta === null ? 1 : 0) - (tb === null ? 1 : 0) || byIndex(a, b);
      return sign * (ta - tb) || byIndex(a, b);
    }
    return sign * byIndex(a, b);
  };
  return [...list].sort(compare);
}
