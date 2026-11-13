// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The stop list (analyseStopCauses rawStops): one record per stop and cause, with the cause
 * code read on the machine — also for a machine without a cause datapoint.
 */
import type { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { analyseStopCauses, collectMachines, type AnalysisMachine } from './engine.js';
import { DEFAULT_STATE_MAPPINGS, type Atelier, type StopCause } from './types.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 12, 8, 0, 0);
const t = (min: number): number => T0 + min * MIN;

/** A fake API whose dpGetPeriod answers from a per-DPE history. */
function fakeApi(history: Record<string, { t: number; v: unknown }[]>): OaRxJsApi {
  return {
    dpGetPeriod: (_s: Date, _e: Date, _n: number, dpe: string) => {
      const h = history[dpe.replace(':_original.._value', '')] ?? [];
      return of({ data: h.map((x) => x.v), dataTime: h.map((x) => x.t) });
    }
  } as unknown as OaRxJsApi;
}

const MACHINE: AnalysisMachine = {
  atelierId: 'a',
  atelierName: 'A',
  machineId: 'M1',
  machineName: 'M1',
  stateDp: 'M1.state',
  stopCauseDp: 'M1.cause',
  mapping: DEFAULT_STATE_MAPPINGS[0] // its states: stop, ok (recorded as such by Machine Fleet's state manager, #339)
};

const CATALOG: StopCause[] = [
  { code: '10', description: 'Changement de série', classification: 'planned' },
  { code: '99', description: 'Autre', classification: 'unplanned', isDefault: true }
];

describe('the stop list', () => {
  it('lists every stop with the code read on the machine', async () => {
    const api = fakeApi({
      'M1.state': [{ t: t(0), v: 'ok' }, { t: t(10), v: 'stop' }, { t: t(20), v: 'ok' }, { t: t(30), v: 'stop' }, { t: t(40), v: 'ok' }, { t: t(50), v: 'stop' }, { t: t(55), v: 'ok' }],
      'M1.cause': [{ t: t(10), v: '10' }, { t: t(20), v: '' }, { t: t(30), v: '42' }, { t: t(40), v: '' }]
    });
    const r = await analyseStopCauses(api, [MACHINE], CATALOG, new Date(t(0)), new Date(t(60)));
    const stops = r.rawStops.map((s) => ({ start: (s.startMs - T0) / MIN, code: s.code, key: s.causeKey }));
    expect(stops).toEqual([
      { start: 50, code: '', key: '99' }, // no cause → default entry
      { start: 30, code: '42', key: '99' }, // unknown code → default entry
      { start: 10, code: '10', key: '10' }
    ]);
  });

  it('a machine without a cause datapoint lists its stops too', async () => {
    const api = fakeApi({ 'M1.state': [{ t: t(0), v: 'ok' }, { t: t(10), v: 'stop' }, { t: t(20), v: 'ok' }] });
    const r = await analyseStopCauses(api, [{ ...MACHINE, stopCauseDp: '' }], [], new Date(t(0)), new Date(t(60)));
    expect(r.rawStops.map((s) => [s.durationMs / MIN, s.code, s.classification])).toEqual([[10, '', undefined]]);
  });
});

describe('a machine with its own stop-cause catalogue (#74)', () => {
  it('names and classifies its stops from it, apart from the default catalogue', async () => {
    const api = fakeApi({
      'M1.state': [{ t: t(0), v: 'ok' }, { t: t(10), v: 'stop' }, { t: t(20), v: 'ok' }],
      'M1.cause': [{ t: t(10), v: '10' }]
    });
    const inox = { id: 'inox', name: 'Inox', causes: [{ code: '10', description: 'Décapage', classification: 'unplanned' as const }] };
    const r = await analyseStopCauses(api, [{ ...MACHINE, catalog: inox }], CATALOG, new Date(t(0)), new Date(t(60)));
    expect(r.rawStops.map((s) => [s.causeKey, s.causeLabel, s.classification])).toEqual([['inox:10', '10 — Décapage · Inox', 'unplanned']]);
    expect(r.rows.map((row) => [row.key, row.label])).toEqual([['inox:10', '10 — Décapage · Inox']]);
  });
});

describe('the machines analysed (#339)', () => {
  it('those binding an input and a cause, read on the histories Machine Fleet records', () => {
    const atelier = {
      id: 'a', name: 'A', mappings: [],
      machines: [
        { id: 'M1', name: 'M1', stateDp: 'M1.State', stopCauseDp: 'M1.Cause' },
        { id: 'M2', name: 'M2', inputDps: { comm: 'M2.Comm' }, stopCauseDps: ['WC.Cause'] },
        { id: 'M3', name: 'M3', stateDp: 'M3.State' },
        { id: 'M4', name: 'M4', stopCauseDp: 'M4.Cause' }
      ]
    } as unknown as Atelier;
    const machines = collectMachines([atelier], new Set(), new Set());
    expect(machines.map((m) => [m.machineId, m.stateDp, m.stopCauseDp, m.mapping?.id])).toEqual([
      ['M1', 'MachineFleet3D_State_M1.state', 'MachineFleet3D_State_M1.cause', 'default'],
      ['M2', 'MachineFleet3D_State_M2.state', 'MachineFleet3D_State_M2.cause', 'default']
    ]);
  });
});
