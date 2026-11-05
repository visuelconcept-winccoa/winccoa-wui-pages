// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Non-worked periods: the global schedule applies to every machine, on top of its atelier's
 * and its own periods.
 */
import { describe, expect, it } from 'vitest';
import { closuresForMachine, hasOverlap, mergeClosures, normaliseClosures } from './closures.js';

const DAY = { start: '2026-11-11T00:00', end: '2026-11-11T23:59' };
const SHIFT = { start: '2026-11-12T12:00', end: '2026-11-12T13:00' };

describe('the global schedule', () => {
  it('applies to every machine, with its atelier and its own periods', () => {
    const cfg = normaliseClosures({ global: [DAY], ateliers: {}, machines: { M1: [SHIFT] } });
    expect(closuresForMachine(cfg, 'A', 'M1')).toEqual([DAY, SHIFT]);
    expect(closuresForMachine(cfg, 'A', 'M2')).toEqual([DAY]);
  });

  it('is absent from a config that has none (older data unchanged)', () => {
    expect('global' in normaliseClosures({ ateliers: {}, machines: {} })).toBe(false);
  });

  it('is checked and merged on import like the other scopes', () => {
    const existing = normaliseClosures({ global: [DAY], ateliers: {}, machines: {} });
    const incoming = normaliseClosures({ global: [DAY, SHIFT], ateliers: {}, machines: {} });
    expect(hasOverlap(existing, incoming)).toBe(true);
    expect(mergeClosures(existing, incoming, 'ignore').global).toEqual([DAY, SHIFT]);
  });
});
