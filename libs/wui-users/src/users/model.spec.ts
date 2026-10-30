import { describe, expect, it } from 'vitest';
import { bitsSummary, changedFields, emptyBits, groupNames, isAdMode, isValidName, memberIds, normalizeBits, permissionLabel, toggleId } from './model.js';
import type { OaGroup, OaUser } from './types.js';

const user = (id: number, groupIds: number[]): OaUser => ({ id, name: `u${id}`, fullName: '', comment: '', enabled: true, language: '', osId: '', domain: '', groupIds });
const group = (id: number, name: string): OaGroup => ({ id, name, fullName: '', comment: '', osId: '', permissions: emptyBits(), areas: [] });

describe('model', () => {
  it('reads the Active Directory mode from _WinUserAdmin.External', () => {
    expect(isAdMode('Windows')).toBe(true);
    expect(isAdMode('Standard')).toBe(false);
  });

  it('keeps 32 bits and lists the granted levels from 1', () => {
    const bits = normalizeBits([true, false, true]);
    expect(bits).toHaveLength(32);
    expect(bitsSummary(bits)).toBe('1, 3');
    expect(bitsSummary(emptyBits())).toBe('—');
  });

  it('labels a level with its name when it has one', () => {
    expect(permissionLabel(2, ['Visu', ' Operate '])).toBe('2 — Operate');
    expect(permissionLabel(5, ['Visu'])).toBe('5');
  });

  it('resolves group names and members', () => {
    const groups = [group(1, 'Ops'), group(2, 'Maint')];
    expect(groupNames(user(4, [2, 9]), groups)).toEqual(['Maint', '#9']);
    expect(memberIds(groups[0], [user(4, [1]), user(5, [2]), user(6, [1, 2])])).toEqual([4, 6]);
  });

  it('toggles ids and validates names', () => {
    expect(toggleId([1, 2], 2, false)).toEqual([1]);
    expect(toggleId([1], 3, true)).toEqual([1, 3]);
    expect(isValidName('jdoe')).toBe(true);
    expect(isValidName(' jdoe')).toBe(false);
    expect(isValidName('')).toBe(false);
  });

  it('keeps only the changed fields', () => {
    expect(changedFields({ a: 1, b: [1], c: 'x' }, { a: 1, b: [1, 2], c: 'y' })).toEqual({ b: [1, 2], c: 'y' });
  });
});
