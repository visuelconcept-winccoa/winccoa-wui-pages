// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * State of a machine from a mapping with several inputs (winccoa-fra-msp-stma#339): the shared cases
 * (state-eval.cases.json, played identically by Machine Fleet's state manager), the compatibility with the
 * single-input mappings of before, and the inputs and causes of a symbol.
 */
import { describe, expect, it } from 'vitest';
import cases from './state-eval.cases.json';
import { causeClassOf, causeDpsOf, currentCause, evaluateState, inputDpsOf, liveState, liveTargets, machineLiveState, mappingInputKeys, type CauseClass } from './state-eval.js';
import { resolveState, type StateMapping } from './types.js';

const MAPPINGS = cases.mappings as unknown as Record<string, StateMapping>;

describe('state of a machine — shared cases', () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const mapping = c.mapping ? MAPPINGS[c.mapping] : undefined;
      expect(evaluateState(mapping, c.values, ((c as { cause?: string }).cause ?? '') as CauseClass)).toBe(c.expected);
    });
  }
});

describe('state of a machine — single-input mappings unchanged', () => {
  it('gives what the views gave: resolveState on the value rounded to the nearest code', () => {
    const m = MAPPINGS['simple'];
    const open: StateMapping = { id: 'o', name: 'o', rules: [{ state: 'warn', min: 5 }, { state: 'ok', max: 2 }, { state: 'maint' }], fallback: 'stop' };
    for (const mapping of [m, open]) {
      for (const v of [-1, 0, 0.4, 0.5, 1, 1.999, 2, 3, 4, 5, 10]) expect(evaluateState(mapping, { state: v })).toBe(resolveState(mapping, Math.round(v)));
    }
  });
});

describe('inputs and causes of a symbol', () => {
  it('datapoints by input: the main one, then the named ones bound', () => {
    expect(inputDpsOf({ stateDp: ' M1.State ', inputDps: { comm: 'M1.Comm', of: '', state: 'ignoré' } })).toEqual({ state: 'M1.State', comm: 'M1.Comm' });
    expect(inputDpsOf({})).toEqual({});
  });

  it('cause datapoints by priority, each once; the cause in progress the first not empty', () => {
    expect(causeDpsOf({ stopCauseDp: 'WC.Cause.Code', stopCauseDps: ['M1.Cause', 'WC.Cause.Code', ' '] })).toEqual(['WC.Cause.Code', 'M1.Cause']);
    expect(currentCause(['', null, ' AP01 ', 'ANP02'])).toBe('AP01');
    expect(currentCause([[], ['ANP02']])).toBe('ANP02');
    expect(currentCause([undefined, ''])).toBe('');
  });

  it('class of the cause from the catalogue: planned, else unplanned, none without cause', () => {
    const causes = [{ code: 'AP01', classification: 'planned' }, { code: 'ANP01', classification: 'unplanned' }];
    expect([causeClassOf('AP01', causes), causeClassOf('ANP01', causes), causeClassOf('XX', causes), causeClassOf('', causes)]).toEqual(['planned', 'unplanned', 'unplanned', '']);
  });

  it('input keys of a mapping: the main one first', () => {
    expect(mappingInputKeys(MAPPINGS['mes'])).toEqual(['state', 'comm', 'of', 'hs']);
    expect(mappingInputKeys(undefined)).toEqual(['state']);
  });

  it('live: the datapoints followed, then the state and cause from the values received', () => {
    const m = { stateDp: 'M.State', inputDps: { comm: 'M.Comm', of: 'WC.Ctx', hs: '' }, stopCauseDp: 'WC.Cause', stopCauseDps: ['M.Cause'] };
    expect(liveTargets(m)).toEqual([
      { dpe: 'M.State', input: 'state' }, { dpe: 'M.Comm', input: 'comm' }, { dpe: 'WC.Ctx', input: 'of' },
      { dpe: 'WC.Cause', cause: 0 }, { dpe: 'M.Cause', cause: 1 }
    ]);
    const catalog = [{ code: 'AP01', classification: 'planned' }];
    expect(liveState(MAPPINGS['mes'], {}, ['AP01'], catalog)).toEqual({ state: null, cause: 'AP01' });
    expect(liveState(MAPPINGS['mes'], { comm: true, of: 2, state: 0 }, ['', 'AP01'], catalog)).toEqual({ state: 'arret_planifie', cause: 'AP01' });
    expect(liveState(MAPPINGS['mes'], { comm: true, of: 2, state: 0 }, ['ANP09'], catalog)).toEqual({ state: 'arret_non_planifie', cause: 'ANP09' });
  });

  it('live from a value cache: same as from the values received', () => {
    const m = { stateDp: 'M.State', inputDps: { comm: 'M.Comm', of: 'WC.Ctx' }, stopCauseDp: 'WC.Cause', stopCauseDps: ['M.Cause'] };
    const cache = new Map<string, unknown>([['M.State', 0], ['M.Comm', true], ['WC.Ctx', 2], ['M.Cause', 'AP01']]);
    const catalog = [{ code: 'AP01', classification: 'planned' }];
    expect(machineLiveState(m, MAPPINGS['mes'], (d) => cache.get(d), catalog)).toEqual({ state: 'arret_planifie', cause: 'AP01' });
    expect(machineLiveState(m, MAPPINGS['mes'], () => undefined, catalog)).toEqual({ state: null, cause: '' });
  });
});
