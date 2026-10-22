// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, LIMITS, validSetting } from './badgeSettings';

// The WinCC OA side is not reached by validSetting.
vi.mock('@winccoa/backend', () => ({ WsjServerGlobal: {} }));
vi.mock('winccoa-manager', () => ({ WinccoaDpTypeNode: class {}, WinccoaElementType: {} }));

describe('the lock settings', () => {
  it('default to 3 refusals, 15 minutes', () => {
    expect(DEFAULT_SETTINGS.lockAfterFailures).toBe(3);
    expect(DEFAULT_SETTINGS.lockDurationMin).toBe(15);
    expect(LIMITS.lockAfterFailures).toEqual([0, 20]);
    expect(LIMITS.lockDurationMin).toEqual([0, 1440]);
  });

  it('lockAfterFailures: an integer from 0 (never) to 20', () => {
    for (const value of [0, 1, 3, 20]) expect(validSetting('lockAfterFailures', value)).toBe(value);
    for (const value of [-1, 21, 2.5, '3', null, undefined, Number.NaN]) {
      expect(validSetting('lockAfterFailures', value)).toBeUndefined();
    }
  });

  it('lockDurationMin: an integer from 0 (until unlocked) to 1440', () => {
    for (const value of [0, 1, 15, 1440]) expect(validSetting('lockDurationMin', value)).toBe(value);
    for (const value of [-1, 1441, 0.5, '15', true]) expect(validSetting('lockDurationMin', value)).toBeUndefined();
  });
});
