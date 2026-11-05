// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { SYMBOL_SCALE_MAX, SYMBOL_SCALE_MIN, storedScale, symbolScale } from './symbol-scale.js';

describe('symbol scale', () => {
  it('is 1 when absent or invalid', () => {
    expect(symbolScale({})).toBe(1);
    expect(symbolScale({ symbolScale: 0 })).toBe(1);
    expect(symbolScale({ symbolScale: Number.NaN })).toBe(1);
  });

  it('stays within its bounds', () => {
    expect(symbolScale({ symbolScale: 1.5 })).toBe(1.5);
    expect(symbolScale({ symbolScale: 0.01 })).toBe(SYMBOL_SCALE_MIN);
    expect(symbolScale({ symbolScale: 50 })).toBe(SYMBOL_SCALE_MAX);
  });

  it('stores nothing for 1, a rounded bounded factor otherwise', () => {
    expect(storedScale(1)).toBeUndefined();
    expect(storedScale(0)).toBeUndefined();
    expect(storedScale(1.234)).toBe(1.23);
    expect(storedScale(99)).toBe(SYMBOL_SCALE_MAX);
  });
});
