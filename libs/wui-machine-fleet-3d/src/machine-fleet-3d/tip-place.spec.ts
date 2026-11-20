// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Gantt tooltip stays on screen: it flips left of the pointer on the right, above it at the bottom.
 */
import { describe, expect, it } from 'vitest';
import { tipTransform } from './tip-place.js';

describe('tooltip placement', () => {
  it('right of and below the pointer in the top-left of the screen', () => {
    expect(tipTransform(100, 100, 1920, 1080)).toBe('translate(12px, 12px)');
  });

  it('left of the pointer in the right half, above it in the bottom third', () => {
    expect(tipTransform(1900, 100, 1920, 1080)).toBe('translate(calc(-100% - 12px), 12px)');
    expect(tipTransform(100, 1000, 1920, 1080)).toBe('translate(12px, calc(-100% - 12px))');
    expect(tipTransform(1900, 1000, 1920, 1080)).toBe('translate(calc(-100% - 12px), calc(-100% - 12px))');
  });

  it('as before when the viewport size is unknown', () => {
    expect(tipTransform(5000, 5000, 0, 0)).toBe('translate(12px, 12px)');
  });
});
