// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "À placer" mark (MachineDef.toPlace): a machine laid out by an integration keeps it until the
 * user moves it.
 */
import { describe, expect, it } from 'vitest';
import { placeMachine, type MachineDef } from './types.js';

const BASE: MachineDef = { id: 'M1', name: 'Four', type: 'cabinet', x: 8, z: 8, state: 'ok' };

describe('placeMachine', () => {
  it('moves the machine and clears its "à placer" mark', () => {
    const placed = placeMachine({ ...BASE, toPlace: true }, 12.5, -3);
    expect([placed.x, placed.z]).toEqual([12.5, -3]);
    expect('toPlace' in placed).toBe(false);
  });

  it('keeps every other field, and leaves the given machine untouched', () => {
    const before = { ...BASE, toPlace: true, color: '#123456' };
    const placed = placeMachine(before, 1, 2);
    expect(placed.color).toBe('#123456');
    expect(before.toPlace).toBe(true);
    expect([before.x, before.z]).toEqual([8, 8]);
  });
});
