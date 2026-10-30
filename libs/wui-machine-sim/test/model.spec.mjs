// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// The machineSim manager's pure part (managers/machineSim/model.js): AUTO_MAP is
// opt-in, and without it no atelier is ever modified. Kept outside the manager
// folder so the spec is not deployed with the manager.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { autoMapEnabled, planAtelier, resolveFamily, simDpName, ALL_PARAMS } = require('../managers/machineSim/model.js');

const atelier = () => ({
  id: 'a1',
  name: 'Atelier 1',
  mappings: [],
  machines: [
    { id: 'four-1', type: 'four', kpis: [] },
    { id: 'tour2', type: 'tour', kpis: [] },
    {
      id: 'bound',
      type: 'robot',
      stateDp: 'System1:Real_Robot.state',
      kpis: [{ key: 'charge', label: 'Charge', unit: '%', dp: 'System1:Real_Robot.load' }]
    },
    { id: 'b1', type: 'basculeur', stateDp: 'System1:Real_Tilt.state', kpis: [{ key: 'vitesse', unit: 'tr/min' }] }
  ]
});

describe('autoMapEnabled', () => {
  it('is off without the option nor the variable', () => {
    expect(autoMapEnabled(['node', 'machineSim/index.js'], {})).toBe(false);
    expect(autoMapEnabled([], { MACHINE_SIM_AUTO_MAP: '' })).toBe(false);
    expect(autoMapEnabled([], { MACHINE_SIM_AUTO_MAP: '0' })).toBe(false);
    expect(autoMapEnabled([], { MACHINE_SIM_AUTO_MAP: 'false' })).toBe(false);
  });

  it('is on with --auto-map among the options, or a true variable', () => {
    expect(autoMapEnabled(['node', 'machineSim/index.js', '--auto-map'], {})).toBe(true);
    for (const word of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
      expect(autoMapEnabled([], { MACHINE_SIM_AUTO_MAP: word })).toBe(true);
    }
  });
});

describe('planAtelier', () => {
  it('without AUTO_MAP, lists the machines to simulate and leaves the atelier untouched', () => {
    const a = atelier();
    const before = JSON.stringify(a);
    const plan = planAtelier(a, false);
    expect(plan.changed).toBe(false);
    expect(JSON.stringify(a)).toBe(before);
    expect(plan.machines).toEqual([
      { dp: 'MachineSim_four_1', isBasculeur: false },
      { dp: 'MachineSim_tour2', isBasculeur: false },
      { dp: 'MachineSim_bound', isBasculeur: false },
      { dp: 'MachineSim_b1', isBasculeur: true }
    ]);
  });

  it('with AUTO_MAP, wires only the unbound machines (and a basculeur tilt), adds the default mapping', () => {
    const a = atelier();
    const plan = planAtelier(a, true);
    expect(plan.changed).toBe(true);
    const [four, tour, bound, tilt] = a.machines;
    expect(four.stateDp).toBe('System1:MachineSim_four_1.state');
    expect(four.stopCauseDp).toBe('System1:MachineSim_four_1.cause');
    expect(four.kpis.map((k) => k.key)).toEqual(['cadence', 'temperature', 'vitesse', 'charge']);
    expect(tour.kpis.map((k) => k.key)).toEqual(['programme', 'outil', 'broche', 'avance']);
    // A machine the user bound keeps its bindings.
    expect(bound.stateDp).toBe('System1:Real_Robot.state');
    expect(bound.kpis).toEqual([{ key: 'charge', label: 'Charge', unit: '%', dp: 'System1:Real_Robot.load' }]);
    // A basculeur's tilt follows the simulated angle; its vitesse is in °/s.
    expect(tilt.stateDp).toBe('System1:Real_Tilt.state');
    expect(tilt.tiltDp).toBe('System1:MachineSim_b1.angle');
    expect(tilt.kpis[0].unit).toBe('°/s');
    expect(a.mappings.map((m) => m.id)).toEqual(['default']);
  });

  it('with AUTO_MAP, reports no change when every machine is already wired', () => {
    const a = atelier();
    planAtelier(a, true);
    const again = JSON.stringify(a);
    expect(planAtelier(a, true).changed).toBe(false);
    expect(JSON.stringify(a)).toBe(again);
  });
});

describe('model', () => {
  it('names a machine DP from its id, sanitized', () => {
    expect(simDpName('four 1/a')).toBe('MachineSim_four_1_a');
  });

  it('resolves the process family: explicit, by type, by KPI keys, else generic', () => {
    expect(resolveFamily({ type: 'four', process: 'soudage' })).toBe('soudage');
    expect(resolveFamily({ type: 'fraiseuse' })).toBe('usinage');
    expect(resolveFamily({ type: 'robot', kpis: [{ key: 'tension' }] })).toBe('soudage');
    expect(resolveFamily({ type: 'robot' })).toBe('generic');
  });

  it('simulates every parameter once (the DP type elements)', () => {
    const names = ALL_PARAMS.map((p) => p.el);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('vitesseSoudage');
  });
});
