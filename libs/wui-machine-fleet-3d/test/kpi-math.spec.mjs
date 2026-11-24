// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * kpiCalc on the history Machine Fleet's state manager records (winccoa-fra-msp-stma#339): state keys of the
 * machine's mapping and the cause in progress. TRS, MTBF and MTTR worked out by hand, and the same stops and
 * the same time out of the opening as the stop and KPI analyses (wui-fleet-core engine.ts) on random histories.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { nonProductionIntervals as stopsTs, offOpeningIntervals as offTs } from '../../wui-fleet-core/src/engine.ts';
import { stateRecordDp as recordDpTs, recordsState as recordsTs } from '../../wui-fleet-core/src/state-eval.ts';
import { DEFAULT_STATE_MAPPINGS } from '../../wui-fleet-core/src/types.ts';

const require = createRequire(import.meta.url);
const K = require('../managers/kpiCalc/kpi-math.js');

const MIN = 60_000;
const t = (m) => m * MIN;
const DEF = DEFAULT_STATE_MAPPINGS[0];
const MES = {
  id: 'mes', name: 'MES', fallback: 'arret_non_planifie', rules: [],
  states: [
    { key: 'production', label: 'Production', color: '#0f0', running: true },
    { key: 'arret_non_planifie', label: 'ANP', color: '#f00' },
    { key: 'arret_planifie', label: 'AP', color: '#00f' },
    { key: 'non_charge', label: 'NC', color: '#888', outsideOpening: true }
  ]
};
const classify = (code) => ({ AP01: 'planned', ANP01: 'unplanned' })[code] ?? 'unplanned';

describe('KPI on a recorded history', () => {
  const states = [{ t: t(0), v: 'ok' }, { t: t(10), v: 'stop' }, { t: t(20), v: 'ok' }, { t: t(40), v: 'stop' }, { t: t(50), v: 'ok' }];
  const causes = [{ t: t(10), v: 'AP01' }, { t: t(20), v: '' }, { t: t(40), v: 'ANP01' }, { t: t(50), v: '' }];

  it('TRS: required = opening − planned stops, minus the unplanned ones', () => {
    // Opening 60 min, planned 10 → required 50; unplanned 10 → 40 / 50 = 80 %.
    expect(K.computeValue('TRS', states, causes, DEF, [], t(0), t(60), 0, '', classify)).toBe(80);
  });

  it('MTBF and MTTR: on the unplanned stops only', () => {
    expect(K.computeValue('MTBF', states, causes, DEF, [], t(0), t(60), 0, '', classify)).toBe(50);
    expect(K.computeValue('MTTR', states, causes, DEF, [], t(0), t(60), 0, '', classify)).toBe(10);
  });

  it('a state outside the opening time (non charge) is neither available nor a stop', () => {
    const s = [{ t: t(0), v: 'production' }, { t: t(20), v: 'non_charge' }, { t: t(40), v: 'arret_non_planifie' }, { t: t(50), v: 'production' }];
    // Opening 60 − 20 = 40; unplanned 10 → 30 / 40 = 75 %.
    expect(K.computeValue('TRS', s, [], MES, [], t(0), t(60), 0, '', classify)).toBe(75);
  });

  it('the recorded datapoint and the symbols recorded, as Machine Fleet', () => {
    for (const id of ['CN_01', 'machine-17', 'x/é y']) expect(K.stateRecordDp(id)).toBe(recordDpTs(id));
    for (const m of [{ stateDp: 'A' }, { inputDps: { c: 'B' } }, { inputDps: { c: ' ' } }, {}]) expect(K.recordsState(m)).toBe(recordsTs(m));
  });
});

describe('same stops as the analyses, on random recorded histories', () => {
  it('non-production and out-of-opening intervals', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const keys = ['production', 'arret_non_planifie', 'arret_planifie', 'non_charge', 'inconnu', ''];
    for (let i = 0; i < 3000; i++) {
      let tm = Math.floor(rnd() * 20) - 10;
      const samples = Array.from({ length: Math.floor(rnd() * 8) }, () => { tm += Math.floor(rnd() * 15); return { t: t(tm), v: keys[Math.floor(rnd() * keys.length)] }; });
      const start = t(Math.floor(rnd() * 10));
      const end = start + t(10 + Math.floor(rnd() * 60));
      const minStop = Math.floor(rnd() * 3) * t(3);
      const ctx = JSON.stringify({ samples, start, end, minStop });
      expect(K.nonProductionIntervals(samples, MES, start, end, minStop), ctx).toEqual(stopsTs(samples, MES, start, end, minStop));
      expect(K.offOpeningIntervals(samples, MES, start, end), ctx).toEqual(offTs(samples, MES, start, end));
    }
  });
});
