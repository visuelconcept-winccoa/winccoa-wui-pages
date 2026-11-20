// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { nameKey, nameTaken, uniqueName } from './symbol-names.js';

const MACHINES = [
  { id: 'a', name: 'Presse 1' },
  { id: 'b', name: 'Four Électrique' }
];

describe('symbol names', () => {
  it('ignores case, accents and spaces', () => {
    expect(nameKey('  four   ÉLECTRIQUE ')).toBe('four electrique');
  });

  it('flags a name used by another symbol only', () => {
    expect(nameTaken('presse 1', 'x', MACHINES)).toBe(true);
    expect(nameTaken('Four electrique', 'x', MACHINES)).toBe(true);
    expect(nameTaken('Presse 1', 'a', MACHINES)).toBe(false);
    expect(nameTaken('Presse 2', 'x', MACHINES)).toBe(false);
    expect(nameTaken('  ', 'x', MACHINES)).toBe(false);
  });

  it('suffixes a taken name with the first free number', () => {
    expect(uniqueName('Presse 2', MACHINES)).toBe('Presse 2');
    expect(uniqueName('Presse 1', MACHINES)).toBe('Presse 1 (2)');
    expect(uniqueName('Presse 1', [...MACHINES, { name: 'presse 1 (2)' }])).toBe('Presse 1 (3)');
  });
});
