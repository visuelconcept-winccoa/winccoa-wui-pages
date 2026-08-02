// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Naming conventions of the Visuel Concept referential ({Zone}_{Equip}_{Signal}). */
import { describe, expect, it } from 'vitest';
import { dpName, dpSeries, sanitizeSegment, signalName, uniqueName } from './naming.js';

describe('naming', () => {
  it('sanitizes segments (accents, specials, leading digits)', () => {
    expect(sanitizeSegment('Débit pompe n°1')).toBe('Debit_pompe_n_1');
    expect(sanitizeSegment('01-Zone')).toBe('Zone');
    expect(sanitizeSegment('__Four__')).toBe('Four');
  });

  it('builds {Zone}_{Equipement}_{Signal} names', () => {
    expect(signalName('Z01', 'PMP001', 'Run')).toBe('Z01_PMP001_Run');
    expect(dpName('Z01', 'FOUR001')).toBe('Z01_FOUR001');
  });

  it('caps names at 40 characters (referential rule)', () => {
    const name = signalName('Zone_Tres_Longue', 'Equipement_Interminable', 'Signal_Egalement_Long');
    expect(name.length).toBeLessThanOrEqual(40);
  });

  it('generates numbered series', () => {
    expect(dpSeries('Z01', 'FOUR', 3, 3)).toEqual(['Z01_FOUR001', 'Z01_FOUR002', 'Z01_FOUR003']);
  });

  it('derives unique names with numeric suffixes', () => {
    const used = new Set<string>(['Z01_PMP001']);
    expect(uniqueName('Z01_PMP001', used)).toBe('Z01_PMP001_2');
    expect(uniqueName('Z01_PMP001', used)).toBe('Z01_PMP001_3');
  });
});
