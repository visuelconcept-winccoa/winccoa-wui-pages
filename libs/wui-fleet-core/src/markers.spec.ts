// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Placement markers: a machine is placed from a marker at an offset, and follows the marker
 * when it moves.
 */
import { describe, expect, it } from 'vitest';
import { followMarkers, placeFromMarker, type MachineDef, type PlacementMarker } from './types.js';

const POST: PlacementMarker = { id: 'p7', label: 'C7', x: 20, z: -10 };
const BASE: MachineDef = { id: 'M1', name: 'Four', type: 'cabinet', x: 0, z: 0, state: 'ok' };

describe('placement markers', () => {
  it('places a machine from a marker at an offset', () => {
    const m = placeFromMarker(BASE, POST, 2.5, -1);
    expect([m.markerId, m.x, m.z]).toEqual(['p7', 22.5, -11]);
  });

  it('moves the machines bound to a marker with it, offset kept', () => {
    const m = placeFromMarker(BASE, POST, 2.5, -1);
    const other = { ...BASE, id: 'M2', x: 5, z: 5 };
    const [moved, still] = followMarkers([m, other], [POST], [{ ...POST, x: 30 }]);
    expect([moved.x, moved.z]).toEqual([32.5, -11]);
    expect(still).toBe(other);
  });

  it('unbinds the machines of a removed marker, leaving them in place', () => {
    const m = placeFromMarker(BASE, POST, 1, 1);
    const [after] = followMarkers([m], [POST], []);
    expect('markerId' in after).toBe(false);
    expect([after.x, after.z]).toEqual([21, -9]);
  });
});
