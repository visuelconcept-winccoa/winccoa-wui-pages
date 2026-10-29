// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure helpers of the managers table (issue 33): uptime, start mode, sorting; and of the edit /
 * delete actions (issue 40): bounds, changes, and whether a delete must stop the manager first.
 * No DOM, no i18n import — unit-tested in `managers.spec.ts`.
 */
import type { ManagerConfig, ManagerInfo, ManagerStartMode } from './types.js';

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

/** Bounds of the restart settings — the same as the backend applies to an add and an edit. */
export const CONFIG_BOUNDS = { secKill: [1, 3600], restartCount: [1, 100], resetMin: [1, 1440] } as const;
export type BoundedKey = keyof typeof CONFIG_BOUNDS;

const START_MODES: readonly ManagerStartMode[] = ['manual', 'once', 'always'];

/** The editable configuration of a manager as the table shows it. */
export function configOf(m: Pick<ManagerInfo, 'startModeCfg' | 'secKill' | 'restartCount' | 'resetMin' | 'options'>): ManagerConfig {
  const mode = m.startModeCfg.toLowerCase() as ManagerStartMode;
  return {
    startMode: START_MODES.includes(mode) ? mode : 'always',
    secKill: m.secKill,
    restartCount: m.restartCount,
    resetMin: m.resetMin,
    options: m.options
  };
}

/** A typed restart setting as an integer within its bounds, or null. */
export function boundedInt(key: BoundedKey, raw: string | number): number | null {
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number.parseInt(text, 10);
  const [min, max] = CONFIG_BOUNDS[key];
  return n >= min && n <= max ? n : null;
}

/** The fields an edit changes, as `field: before → after` (options compared without extra blanks). */
export function configChanges(before: ManagerConfig, after: ManagerConfig): string[] {
  const norm = (v: string): string => v.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  if (before.startMode !== after.startMode) out.push(`startMode: ${before.startMode} → ${after.startMode}`);
  for (const key of ['secKill', 'restartCount', 'resetMin'] as const) {
    if (before[key] !== after[key]) out.push(`${key}: ${before[key]} → ${after[key]}`);
  }
  if (norm(before.options) !== norm(after.options)) out.push(`options: "${before.options}" → "${after.options}"`);
  return out;
}

/** Can a manager entry be edited or deleted at all? Not pmon itself (index 0). */
export function isConfigurable(m: Pick<ManagerInfo, 'index'>): boolean {
  return m.index >= 1;
}

/**
 * How a delete goes for this manager: a stopped one is deleted; a running (or starting) one is
 * stopped first, which also needs the `control` role — without it the delete is refused, with
 * the reason (`needs-control`).
 */
export function deletePlan(
  m: Pick<ManagerInfo, 'index' | 'state'>,
  roles: { editManagers: boolean; control: boolean }
): { allowed: true; stopFirst: boolean } | { allowed: false; reason: 'pmon' | 'needs-edit' | 'needs-control' } {
  if (!isConfigurable(m)) return { allowed: false, reason: 'pmon' };
  if (!roles.editManagers) return { allowed: false, reason: 'needs-edit' };
  const running = m.state !== 0;
  if (running && !roles.control) return { allowed: false, reason: 'needs-control' };
  return { allowed: true, stopFirst: running };
}
