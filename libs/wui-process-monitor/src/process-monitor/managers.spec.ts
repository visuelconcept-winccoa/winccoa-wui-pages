// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** The managers table helpers (issue 33): uptime, start mode flag, sorting; edit / delete (issue 40). */
import { describe, expect, it } from 'vitest';
import { boundedInt, configChanges, configOf, deletePlan, formatUptime, isConfigurable, liveStartMode, sortManagers, startModeDiffers } from './managers.js';
import type { ManagerInfo } from './types.js';

function mgr(index: number, name: string, over: Partial<ManagerInfo> = {}): ManagerInfo {
  return {
    index,
    name,
    options: '',
    startModeCfg: 'always',
    secKill: 30,
    restartCount: 3,
    resetMin: 1,
    state: 2,
    stateLabel: 'running',
    pid: 1000 + index,
    startMode: 2,
    startTime: '2026-10-29T08:00:00.000Z',
    manNum: index,
    ...over
  };
}

describe('formatUptime', () => {
  it('reads seconds, minutes, hours with padded minutes, then days', () => {
    expect(formatUptime(45_000)).toBe('45 s');
    expect(formatUptime(12 * 60_000 + 30_000)).toBe('12 min');
    expect(formatUptime((3 * 60 + 5) * 60_000)).toBe('3 h 05');
    expect(formatUptime((2 * 24 + 4) * 3_600_000 + 59 * 60_000, 'j')).toBe('2 j 4 h');
  });

  it('a negative span (clock skew) reads as 0 s', () => {
    expect(formatUptime(-5000)).toBe('0 s');
  });
});

describe('start mode', () => {
  it('maps the live code and flags a mode that differs from config/progs', () => {
    expect(liveStartMode({ startMode: 0 })).toBe('manual');
    expect(liveStartMode({ startMode: 9 })).toBe('');
    expect(startModeDiffers({ startMode: 2, startModeCfg: 'always' })).toBe(false);
    expect(startModeDiffers({ startMode: 0, startModeCfg: 'always' })).toBe(true);
    expect(startModeDiffers({ startMode: 9, startModeCfg: 'always' })).toBe(false);
  });
});

describe('sortManagers', () => {
  const list = [
    mgr(0, 'WCCILpmon', { startTime: '2026-10-27T06:00:00.000Z' }),
    mgr(1, 'WCCILdata', { startTime: '2026-10-27T06:00:01.000Z' }),
    mgr(2, 'WCCOAs7plus', { state: 0, stateLabel: 'stopped', pid: -1, startTime: '' }),
    mgr(3, 'WCCOActrl', { startTime: '2026-10-29T10:58:00.000Z' }),
    mgr(4, 'WCCOAui', { state: 0, stateLabel: 'stopped', startTime: '2026-10-28T06:00:00.000Z' })
  ];

  it('the most recent start comes first, managers without one (stopped) last', () => {
    expect(sortManagers(list, 'startTime', 'desc').map((m) => m.index)).toEqual([3, 1, 0, 2, 4]);
    expect(sortManagers(list, 'startTime', 'asc').map((m) => m.index)).toEqual([0, 1, 3, 2, 4]);
  });

  it('sorts by name and by state, ties in pmon order', () => {
    expect(sortManagers(list, 'name', 'asc').map((m) => m.name)).toEqual(['WCCILdata', 'WCCILpmon', 'WCCOActrl', 'WCCOAs7plus', 'WCCOAui']);
    expect(sortManagers(list, 'state', 'asc').map((m) => m.index)).toEqual([2, 4, 0, 1, 3]);
  });

  it('does not reorder the list it is given', () => {
    sortManagers(list, 'name', 'desc');
    expect(list.map((m) => m.index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('edit (issue 40)', () => {
  it('pre-fills the configuration of an entry; an unknown start mode falls back to always', () => {
    expect(configOf(mgr(4, 'WCCOActrl', { startModeCfg: 'Once', options: '-num 1' }))).toEqual({ startMode: 'once', secKill: 30, restartCount: 3, resetMin: 1, options: '-num 1' });
    expect(configOf(mgr(4, 'WCCOActrl', { startModeCfg: '' })).startMode).toBe('always');
  });

  it('bounds the restart settings like the backend', () => {
    expect(boundedInt('secKill', '60')).toBe(60);
    expect(boundedInt('secKill', '0')).toBeNull();
    expect(boundedInt('secKill', '3601')).toBeNull();
    expect(boundedInt('restartCount', '1.5')).toBeNull();
    expect(boundedInt('resetMin', ' 1440 ')).toBe(1440);
    expect(boundedInt('resetMin', '')).toBeNull();
  });

  it('lists the changed fields, before → after (blanks in the options do not count)', () => {
    const before = configOf(mgr(4, 'WCCOActrl', { startModeCfg: 'once', options: '-num 1  -f a.lst' }));
    expect(configChanges(before, { ...before, options: '-num 1 -f a.lst' })).toEqual([]);
    expect(configChanges(before, { ...before, startMode: 'manual', secKill: 60, options: '-num 1 -f b.lst' })).toEqual([
      'startMode: once → manual',
      'secKill: 30 → 60',
      'options: "-num 1  -f a.lst" → "-num 1 -f b.lst"'
    ]);
  });

  it('pmon itself is neither editable nor deletable', () => {
    expect(isConfigurable(mgr(0, 'WCCILpmon'))).toBe(false);
    expect(isConfigurable(mgr(1, 'WCCILdata'))).toBe(true);
  });
});

describe('deletePlan (issue 40)', () => {
  const both = { editManagers: true, control: true };

  it('a stopped manager is deleted, a running one is stopped first', () => {
    expect(deletePlan(mgr(3, 'x', { state: 0 }), both)).toEqual({ allowed: true, stopFirst: false });
    expect(deletePlan(mgr(3, 'x', { state: 2 }), both)).toEqual({ allowed: true, stopFirst: true });
    expect(deletePlan(mgr(3, 'x', { state: 1 }), both)).toEqual({ allowed: true, stopFirst: true });
  });

  it('a missing role refuses with its reason; control is needed only for a running manager', () => {
    expect(deletePlan(mgr(3, 'x', { state: 2 }), { editManagers: true, control: false })).toEqual({ allowed: false, reason: 'needs-control' });
    expect(deletePlan(mgr(3, 'x', { state: 0 }), { editManagers: true, control: false })).toEqual({ allowed: true, stopFirst: false });
    expect(deletePlan(mgr(3, 'x', { state: 0 }), { editManagers: false, control: true })).toEqual({ allowed: false, reason: 'needs-edit' });
    expect(deletePlan(mgr(0, 'WCCILpmon', { state: 0 }), both)).toEqual({ allowed: false, reason: 'pmon' });
  });
});
