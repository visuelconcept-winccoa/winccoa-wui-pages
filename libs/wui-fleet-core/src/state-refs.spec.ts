// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** A symbol's bindings through references (winccoa-fra-msp-stma#376): a mobile machine follows its workcenter. */
import { describe, expect, it } from 'vitest';
import { liveTargets, machineLiveState, refTargets, refValue, resolveBinding, resolveMachine } from './state-eval.js';
import type { MachineDef, StateMapping } from './types.js';

const MACHINE: MachineDef = {
  id: 'CN_01', name: 'CN 01', type: 'cabinet', x: 0, z: 0, state: 'ok',
  refDps: { wc: 'CN_01.Base.Assignment.Workcenter' },
  stateDp: 'CN_01.Base.State.Status',
  inputDps: { of: '{wc}.Context.State', aff: 'CN_01.Base.Assignment.Workcenter' },
  stopCauseDp: '{wc}.Cause.Code',
  stopCauseDps: ['CN_01.Data.CAUSE'],
  workOrderDp: '{wc}.Context.OF',
  kpis: [{ key: 'ctx.article', label: 'Article', dp: '{wc}.Context.Article' }, { key: 'p', label: 'P', dp: 'CN_01.Data.P' }]
};

describe('references', () => {
  it('replace {name} by the datapoint the reference names now', () => {
    const values: Record<string, unknown> = { 'CN_01.Base.Assignment.Workcenter': 'System1:WC_A.' };
    const r = resolveMachine(MACHINE, (dpe) => values[dpe]);
    expect(r.inputDps).toEqual({ of: 'WC_A.Context.State', aff: 'CN_01.Base.Assignment.Workcenter' });
    expect([r.stopCauseDp, r.stopCauseDps, r.workOrderDp, r.stateDp]).toEqual(['WC_A.Cause.Code', ['CN_01.Data.CAUSE'], 'WC_A.Context.OF', 'CN_01.Base.State.Status']);
    expect(r.kpis?.map((k) => k.dp)).toEqual(['WC_A.Context.Article', 'CN_01.Data.P']);
    // The symbol itself is not changed.
    expect(MACHINE.workOrderDp).toBe('{wc}.Context.OF');
  });

  it('leave unbound what goes through a reference without a value (machine not assigned)', () => {
    const r = resolveMachine(MACHINE, () => '');
    expect(r.inputDps).toEqual({ aff: 'CN_01.Base.Assignment.Workcenter' });
    expect(r.stopCauseDp).toBeUndefined();
    expect(r.workOrderDp).toBeUndefined();
    expect(r.kpis?.map((k) => k.dp)).toEqual(['', 'CN_01.Data.P']);
    expect(liveTargets(r).map((t) => t.dpe)).toEqual(['CN_01.Base.State.Status', 'CN_01.Base.Assignment.Workcenter', 'CN_01.Data.CAUSE']);
  });

  it('a symbol without reference is itself; an unknown reference unbinds', () => {
    const plain = { ...MACHINE, refDps: undefined };
    expect(resolveMachine(plain, () => 'X')).toBe(plain);
    expect(resolveBinding('{nope}.A', { wc: 'W.x' }, () => 'WC_A')).toBeUndefined();
    expect(resolveBinding('A.B', {}, () => undefined)).toBe('A.B');
    expect(refTargets(MACHINE)).toEqual(['CN_01.Base.Assignment.Workcenter']);
    expect([refValue(['WC_B']), refValue(null), refValue(' WC_C ')]).toEqual(['WC_B', '', 'WC_C']);
  });

  it("give the live state from the workcenter the machine is in now", () => {
    const mapping: StateMapping = {
      id: 'm', name: 'm', fallback: 'stop',
      inputs: [{ key: 'of', label: 'OF' }, { key: 'aff', label: 'Workcenter' }],
      rules: [
        { state: 'non_charge', when: [{ input: 'aff', equals: '' }] },
        { state: 'non_charge', when: [{ input: 'of', equals: 1, not: true }] },
        { state: 'ok', min: 1, max: 1 }
      ]
    };
    const values: Record<string, unknown> = {
      'CN_01.Base.Assignment.Workcenter': 'WC_A', 'CN_01.Base.State.Status': 1, 'WC_A.Context.State': 1, 'WC_B.Context.State': 0
    };
    const read = (dpe: string): unknown => values[dpe];
    expect(machineLiveState(MACHINE, mapping, read, []).state).toBe('ok');
    values['CN_01.Base.Assignment.Workcenter'] = 'WC_B';
    expect(machineLiveState(MACHINE, mapping, read, []).state).toBe('non_charge');
    values['CN_01.Base.Assignment.Workcenter'] = '';
    expect(machineLiveState(MACHINE, mapping, read, []).state).toBe('non_charge');
  });
});
