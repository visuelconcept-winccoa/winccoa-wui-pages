// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Editing a state mapping with several inputs (winccoa-fra-msp-stma#339): conditions shown and read back,
 * empty bounds, inputs kept consistent with the rules, rule order.
 */
import { describe, expect, it } from 'vitest';
import type { StateMapping } from '@visuelconcept-winccoa/wui-fleet-core/types.js';
import { evaluateState } from '@visuelconcept-winccoa/wui-fleet-core/state-eval.js';
import {
  addInput,
  conditionOf,
  conditionView,
  inputKeyError,
  moveRule,
  parseConditionValue,
  removeInput,
  renameInput,
  usesCause,
  withBounds
} from './mapping-edit.js';

const BASE: StateMapping = {
  id: 'mes', name: 'MES', fallback: 'stop',
  inputs: [{ key: 'comm', label: 'Communication' }, { key: 'of', label: 'OF en cours' }],
  rules: [
    { state: 'stop', when: [{ input: 'comm', equals: false }] },
    { state: 'maint', when: [{ input: 'of', equals: 2, not: true }, { input: 'comm', equals: true }] },
    { state: 'ok', min: 1, max: 1 }
  ]
};

describe('conditions in the editor', () => {
  it('a typed value: true / false (also vrai / faux), a number (comma or dot), else the text', () => {
    expect([parseConditionValue('true'), parseConditionValue('Faux'), parseConditionValue(' 2 '), parseConditionValue('2,5'), parseConditionValue('AUTO'), parseConditionValue('')])
      .toEqual([true, false, 2, 2.5, 'AUTO', '']);
  });

  it('shown with an operator, read back the same', () => {
    const cases = [
      { input: 'comm', equals: false },
      { input: 'of', equals: 2, not: true },
      { input: 'niveau', min: 2.5 },
      { input: 'niveau', min: 1, max: 3, not: true },
      { input: 'mode', equals: 'AUTO' }
    ];
    for (const c of cases) expect(conditionOf(conditionView(c))).toEqual(c);
    expect(conditionView({ input: 'of', equals: 2, not: true }).op).toBe('ne');
    expect(conditionView({ input: 'n', min: 1, not: true }).op).toBe('out');
    expect(conditionOf({ input: 'n', op: 'in', value: '', min: '', max: '4' })).toEqual({ input: 'n', max: 4 });
  });

  it('bounds of a rule left empty: no bound (the rule then holds for any value)', () => {
    const r = withBounds({ state: 'ok', min: 0, max: 0 }, '', ' 3 ');
    expect(r).toEqual({ state: 'ok', max: 3 });
    expect(withBounds(r, '1', 'x')).toEqual({ state: 'ok', min: 1 });
  });
});

describe('inputs of a mapping', () => {
  it('a key: a letter then letters, digits, _ ; never the main input ; unique', () => {
    expect([inputKeyError('of', []), inputKeyError('1x', []), inputKeyError('a b', []), inputKeyError('state', []), inputKeyError('declared', []), inputKeyError('comm', ['comm'])])
      .toEqual(['', 'format', 'format', 'reserved', 'reserved', 'taken']);
  });

  it('added with a free key, renamed with the conditions naming it, removed with them', () => {
    const added = addInput(BASE, 'Hors service');
    expect(added.inputs?.at(-1)).toEqual({ key: 'entree3', label: 'Hors service' });
    const renamed = renameInput(BASE, 0, 'com');
    expect(renamed.inputs?.[0].key).toBe('com');
    expect(renamed.rules[0].when).toEqual([{ input: 'com', equals: false }]);
    expect(renamed.rules[1].when?.[1]).toEqual({ input: 'com', equals: true });
    expect(renameInput(BASE, 0, 'of')).toBe(BASE);
    const removed = removeInput(BASE, 0);
    expect(removed.inputs).toEqual([{ key: 'of', label: 'OF en cours' }]);
    expect(removed.rules[0]).toEqual({ state: 'stop' });
    expect(removed.rules[1].when).toEqual([{ input: 'of', equals: 2, not: true }]);
    expect(removeInput(removeInput(BASE, 0), 0).inputs).toBeUndefined();
  });

  it('rules moved: the first one that matches wins', () => {
    const values = { comm: true, of: 0, state: 1 };
    expect(evaluateState(BASE, values)).toBe('maint');
    const moved = moveRule(BASE, 2, -1);
    expect(moved.rules.map((r) => r.state)).toEqual(['stop', 'ok', 'maint']);
    expect(evaluateState(moved, values)).toBe('ok');
    expect(moveRule(BASE, 0, -1)).toBe(BASE);
    expect(usesCause(BASE)).toBe(false);
    expect(usesCause({ ...BASE, rules: [...BASE.rules, { state: '@cause' }] })).toBe(true);
  });
});
