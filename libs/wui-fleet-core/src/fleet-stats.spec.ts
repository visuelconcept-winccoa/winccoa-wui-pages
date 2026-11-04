// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** The atelier's statistics: faults, stops, producing, not connected (#65). */
import { describe, expect, it } from 'vitest';
import { BUILTIN_STATES, fleetStats, isFaultState, type StateDef } from './types.js';

describe('fleet statistics', () => {
  it('count the built-in states: warn is a fault, stop and maintenance are stops', () => {
    const machines = ['ok', 'ok', 'warn', 'stop', 'maint', 'unknown'].map((state) => ({ state }));
    expect(fleetStats(machines, BUILTIN_STATES)).toEqual({ fault: 1, stop: 3, production: 2, offline: 0 });
  });

  it('count a machine not connected apart, whatever its state', () => {
    const machines = [{ state: 'ok', commDp: 'X.comm', connected: false }, { state: 'ok', commDp: 'Y.comm', connected: true }];
    expect(fleetStats(machines, BUILTIN_STATES)).toEqual({ fault: 0, stop: 0, production: 1, offline: 1 });
  });

  it("follow a mapping's own fault flag", () => {
    const states: StateDef[] = [
      { key: 'run', label: 'Run', color: '#0f0', running: true },
      { key: 'err', label: 'Error', color: '#f00', fault: true },
      { key: 'warn', label: 'Warning', color: '#fa0', fault: false }
    ];
    expect(isFaultState(states[2])).toBe(false);
    expect(fleetStats([{ state: 'err' }, { state: 'warn' }, { state: 'run' }], states)).toEqual({ fault: 1, stop: 1, production: 1, offline: 0 });
  });
});
