// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'vitest';
import { allowed, groupByModule } from './catalog.js';
import type { Tutorial } from './guide/tutorial.js';

const tutorial = (id: string, module: string, roles?: string[]): Tutorial => ({ id, module, title: id, roles, steps: [{ say: id }] });

describe('groupByModule', () => {
  test('by module, in the order the modules first appear, each one\'s in its own order', () => {
    const groups = groupByModule([tutorial('a1', 'msp'), tutorial('b1', 'alarms'), tutorial('a2', 'msp'), tutorial('c1', 'workcenters')]);
    expect(groups.map((group) => [group.module, group.tutorials.map((t) => t.id)])).toEqual([
      ['msp', ['a1', 'a2']],
      ['alarms', ['b1']],
      ['workcenters', ['c1']]
    ]);
    expect(groupByModule([])).toEqual([]);
  });
});

describe('allowed', () => {
  test('no role: everyone', () => {
    expect(allowed(tutorial('a', 'msp'), new Map())).toBe(true);
    expect(allowed(tutorial('a', 'msp', []), new Map([['msp/view', false]]))).toBe(true);
  });
  test('one of its roles held suffices', () => {
    const t = tutorial('a', 'msp', ['msp/alarm-ack', 'alarms/acknowledge']);
    expect(allowed(t, new Map([['msp/alarm-ack', false], ['alarms/acknowledge', true]]))).toBe(true);
    expect(allowed(t, new Map([['msp/alarm-ack', false], ['alarms/acknowledge', false]]))).toBe(false);
  });
  test('a role not known yet does not forbid (hasRole$ has not answered)', () => {
    expect(allowed(tutorial('a', 'msp', ['msp/view']), new Map())).toBe(true);
  });
});
