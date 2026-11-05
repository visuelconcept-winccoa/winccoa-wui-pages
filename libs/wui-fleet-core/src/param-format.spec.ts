// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A parameter's value shown with its own decimals, the same in the bubble, the card and the dashboard.
 */
import { describe, expect, it } from 'vitest';
import { formatParamValue } from './types.js';

describe('formatParamValue', () => {
  it('uses the decimals the parameter sets', () => {
    expect(formatParamValue(58.4401, 1)).toBe('58.4');
    expect(formatParamValue(181.2986, 0)).toBe('181');
    expect(formatParamValue(2, 2)).toBe('2.00');
  });

  it('without decimals: integers as-is, other numbers with two', () => {
    expect(formatParamValue(42)).toBe('42');
    expect(formatParamValue(0.91512)).toBe('0.92');
  });

  it('prints a text verbatim and bounds the decimals', () => {
    expect(formatParamValue('Cuisson')).toBe('Cuisson');
    expect(formatParamValue(1.5, 12)).toBe('1.500000');
    expect(formatParamValue(1.5, -1)).toBe('2');
  });
});
