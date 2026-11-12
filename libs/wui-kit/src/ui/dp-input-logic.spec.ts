// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  childElements,
  existenceName,
  formatValue,
  highlight,
  parentOf,
  parseQuery,
  usefulDescription,
  withoutConfig,
  withoutSystem
} from './dp-input-logic.js';

describe('wui-dp-input logic', () => {
  it('reads what the text asks for', () => {
    expect(parseQuery('  ')).toEqual({ kind: 'types' });
    expect(parseQuery('cn_0')).toEqual({ kind: 'dp', pattern: '*cn_0*', typed: 'cn_0' });
    expect(parseQuery('CN_*')).toEqual({ kind: 'dp', pattern: 'CN_*', typed: 'CN_' });
    expect(parseQuery('System1:CN_01.')).toEqual({ kind: 'element', base: 'System1:CN_01', partial: '' });
    expect(parseQuery('CN_01.Base.Sta')).toEqual({ kind: 'element', base: 'CN_01.Base', partial: 'Sta' });
    expect(parseQuery('CN_01.Base.State:_online.._value')).toEqual({ kind: 'element', base: 'CN_01.Base', partial: 'State' });
  });

  it('drops the system for display and the config part for paths', () => {
    expect(withoutSystem('System1:CN_01.Base')).toBe('CN_01.Base');
    expect(withoutSystem('CN_01.Base')).toBe('CN_01.Base');
    expect(withoutConfig('System1:CN_01.a:_online.._value')).toBe('System1:CN_01.a');
    expect(withoutConfig('_MemoryCheck.FreeKB')).toBe('_MemoryCheck.FreeKB');
  });

  it('lists the elements right under a path, each told whether it has elements under it', () => {
    const children = ['CN_01.Base.Comm', 'CN_01.Base.State', 'CN_01.Base.Label', 'CN_01.'];
    const grand = ['CN_01.Base.Comm.Cause', 'CN_01.Base.Comm.Connected'];
    expect(childElements('CN_01.Base', children, grand)).toEqual([
      { name: 'CN_01.Base.Comm', segment: 'Comm', hasChildren: true },
      { name: 'CN_01.Base.State', segment: 'State', hasChildren: false },
      { name: 'CN_01.Base.Label', segment: 'Label', hasChildren: false }
    ]);
    expect(childElements('CN_01.Base', children, grand, 'st').map((c) => c.segment)).toEqual(['State']);
  });

  it('splits a label around the typed part', () => {
    expect(highlight('CN_01', 'n_0')).toEqual({ before: 'C', match: 'N_0', after: '1' });
    expect(highlight('CN_01', 'zz')).toEqual({ before: 'CN_01', match: '', after: '' });
  });

  it('goes one level up', () => {
    expect(parentOf('CN_01.Base.Comm')).toEqual({ value: 'CN_01.Base.', atDp: false });
    expect(parentOf('CN_01')).toEqual({ value: 'CN_01', atDp: true });
  });

  it('names what must exist for a value', () => {
    expect(existenceName('CN_01.')).toBe('CN_01');
    expect(existenceName('CN_01.Base.State:_original.._value')).toBe('CN_01.Base.State');
  });

  it('formats a current value and keeps only a useful description', () => {
    expect(formatValue(3.14159)).toBe('3,142');
    expect(formatValue(null)).toBe('—');
    expect(formatValue([1, 2])).toBe('[2]');
    expect(formatValue('x'.repeat(40))).toHaveLength(30);
    expect(usefulDescription('System1:CN_01.Base.State', 'CN_01.Base.State')).toBe('');
    expect(usefulDescription('État de la machine', 'CN_01.Base.State')).toBe('État de la machine');
  });
});
