// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Configurable machine states. A mapping may declare its own state list (key, label,
 * colour, producing or not); without one, the four built-in states apply exactly as
 * before. What counts as producing drives the Gantt, the stop analysis and the TRS: read
 * the wrong way, a stopped machine would count as available.
 */
import { describe, expect, it } from 'vitest';
import { nonProductionIntervals, offOpeningIntervals } from './engine.js';
import {
  BUILTIN_STATES,
  DEFAULT_STATE_MAPPINGS,
  STATE_COLORS,
  UNKNOWN_STATE_COLOR,
  atelierStates,
  isOutsideOpening,
  isRunningState,
  mappingStates,
  resolveState,
  resolveStateColors,
  stateColor,
  stateLabel,
  type StateMapping
} from './types.js';

/** Five states of a supervision that tells "not producing" apart from "stopped". */
const FIVE: StateMapping = {
  id: 'five',
  name: 'Five states',
  fallback: 'unknown',
  states: [
    { key: 'production', label: 'Production', color: '#2b7a4b', running: true },
    { key: 'stopped', label: 'Arrêt', color: '#b3302a' },
    { key: 'maintenance', label: 'Maintenance', color: '#2f6db5' },
    { key: 'idle', label: 'Hors production', color: '#7a7a7a' },
    { key: 'unknown', label: 'Inconnu', color: '#9ca3af' }
  ],
  rules: [
    { state: 'production', min: 0, max: 0 },
    { state: 'stopped', min: 1, max: 1 },
    { state: 'maintenance', min: 2, max: 2 },
    { state: 'idle', min: 3, max: 3 }
  ]
};

describe('a mapping without a state list keeps the four built-in states', () => {
  const mp = DEFAULT_STATE_MAPPINGS[0];

  it('lists the built-in states, with their labels and colours', () => {
    expect(mappingStates(mp).map((s) => s.key)).toEqual(['ok', 'warn', 'stop', 'maint']);
    expect(stateLabel(mp, 'maint')).toBe('Maintenance');
    expect(stateColor(mp, 'stop')).toBe(STATE_COLORS.stop);
  });

  it('only "ok" is producing', () => {
    expect(isRunningState(mp, 'ok')).toBe(true);
    expect(['warn', 'stop', 'maint'].some((k) => isRunningState(mp, k))).toBe(false);
    expect(isRunningState(undefined, 'ok')).toBe(true);
  });

  it('a colour override still applies', () => {
    const custom: StateMapping = { ...mp, colors: { stop: '#000000' } };
    expect(stateColor(custom, 'stop')).toBe('#000000');
    expect(mappingStates(custom).find((s) => s.key === 'stop')?.color).toBe('#000000');
  });
});

describe('a mapping with its own states', () => {
  it('resolves values to its keys and labels them', () => {
    expect(resolveState(FIVE, 3)).toBe('idle');
    expect(resolveState(FIVE, 9)).toBe('unknown');
    expect(stateLabel(FIVE, 'idle')).toBe('Hors production');
    expect(stateColor(FIVE, 'maintenance')).toBe('#2f6db5');
  });

  it('producing is what the state says, not the key', () => {
    expect(isRunningState(FIVE, 'production')).toBe(true);
    expect(isRunningState(FIVE, 'ok')).toBe(false);
    expect(isRunningState(FIVE, 'idle')).toBe(false);
  });

  it('gives every state a colour, plus the "not connected" overlay', () => {
    const colors = resolveStateColors(FIVE);
    expect(Object.keys(colors)).toEqual(['production', 'stopped', 'maintenance', 'idle', 'unknown', 'disconnected']);
    expect(stateColor(FIVE, 'nope')).toBe(UNKNOWN_STATE_COLOR);
  });
});

describe('atelier-wide states', () => {
  it('merges the mappings in order, first declaration wins', () => {
    const keys = atelierStates([DEFAULT_STATE_MAPPINGS[0], FIVE]).map((s) => s.key);
    expect(keys).toEqual(['ok', 'warn', 'stop', 'maint', 'production', 'stopped', 'maintenance', 'idle', 'unknown']);
    expect(atelierStates(undefined)).toEqual(BUILTIN_STATES);
  });
});

describe('the stop analysis follows the producing flag', () => {
  it('counts every non-producing state as downtime, and only those', () => {
    const t = (min: number): number => min * 60_000;
    const samples = [
      { t: t(0), v: 0 }, // production
      { t: t(10), v: 3 }, // hors production
      { t: t(20), v: 0 }, // production
      { t: t(30), v: 1 } // arrêt
    ];
    expect(nonProductionIntervals(samples, FIVE, t(0), t(40))).toEqual([
      { s: t(10), e: t(20) },
      { s: t(30), e: t(40) }
    ]);
  });
});

describe('a state taken out of the opening time', () => {
  const OFF: StateMapping = {
    ...FIVE,
    states: FIVE.states?.map((st) => (st.key === 'idle' ? { ...st, outsideOpening: true } : st))
  };
  const t = (min: number): number => min * 60_000;
  const samples = [
    { t: t(0), v: 0 }, // production
    { t: t(10), v: 3 }, // hors production, outside the opening time
    { t: t(20), v: 0 }, // production
    { t: t(30), v: 1 } // arrêt
  ];

  it('is neither downtime nor available', () => {
    expect(isOutsideOpening(OFF, 'idle')).toBe(true);
    expect(isOutsideOpening(OFF, 'stopped')).toBe(false);
    expect(isOutsideOpening(FIVE, 'idle')).toBe(false);
    expect(nonProductionIntervals(samples, OFF, t(0), t(40))).toEqual([{ s: t(30), e: t(40) }]);
    expect(offOpeningIntervals(samples, OFF, t(0), t(40))).toEqual([{ s: t(10), e: t(20) }]);
  });

  it('never applies to a producing state', () => {
    const odd: StateMapping = {
      ...FIVE,
      states: FIVE.states?.map((st) => (st.key === 'production' ? { ...st, outsideOpening: true } : st))
    };
    expect(isOutsideOpening(odd, 'production')).toBe(false);
  });
});
