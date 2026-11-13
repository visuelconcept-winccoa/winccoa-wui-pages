// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A symbol's representation is shown by its label, not its stored code ("cabinet", "glb"…).
 */
import { describe, expect, it } from 'vitest';
import type { MachineType } from '@visuelconcept-winccoa/wui-fleet-core/types.js';
import { MACHINE_TYPE_LABEL, machineTypeText } from './machine-type-labels.js';

const TYPES: MachineType[] = [
  'four',
  'robot',
  'positionneur',
  'tour',
  'fraiseuse',
  'scie',
  'brocheuse',
  'ressuage',
  'portique',
  'portique-table',
  'basculeur',
  'cabinet',
  'billboard',
  'glb'
];

describe('machine type labels', () => {
  it('has a label in the three languages for every representation', () => {
    expect(Object.keys(MACHINE_TYPE_LABEL).sort()).toEqual([...TYPES].sort());
    for (const t of TYPES) {
      const label = MACHINE_TYPE_LABEL[t] as Record<string, string>;
      for (const lang of ['en_US.utf8', 'fr.utf8', 'de.utf8']) expect(label[lang], `${t} ${lang}`).toBeTruthy();
    }
    expect((MACHINE_TYPE_LABEL.cabinet as Record<string, string>)['fr.utf8']).toBe('Armoire');
    expect((MACHINE_TYPE_LABEL.glb as Record<string, string>)['fr.utf8']).toBe('Modèle 3D (GLB)');
  });

  it('has no label for an unknown representation', () => {
    expect(machineTypeText('pompe')).toBeUndefined();
    expect(machineTypeText('billboard')).toBe(MACHINE_TYPE_LABEL.billboard);
  });
});
