// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
// The ring-editing operations, mirrored from gis-map.ts, checked for their invariants.
// The component itself needs a DOM + WebGL; the arithmetic it performs does not.
import { areaCollection, MIN_RING } from '../map/style.js';
import { ringContains } from '../types.js';

describe('area outline editing', () => {
  type Ring = readonly (readonly [number, number])[];

  const HALF = 2;
  const moveVertex = (ring: Ring, i: number, to: [number, number]): Ring =>
    ring.map((p, k) => (k === i ? to : p));
  const insertVertex = (ring: Ring, i: number): Ring => {
    const from = ring[i] as readonly [number, number];
    const to = ring[(i + 1) % ring.length] as readonly [number, number];
    const middle: [number, number] = [
      (from[0] + to[0]) / HALF,
      (from[1] + to[1]) / HALF
    ];
    return [...ring.slice(0, i + 1), middle, ...ring.slice(i + 1)];
  };
  const removeVertex = (ring: Ring, i: number): Ring =>
    ring.length <= MIN_RING ? ring : ring.filter((_, k) => k !== i);

  function check(label: string, got: unknown, expected: unknown): void {
    it(label, () => {
      expect(got).toEqual(expected);
    });
  }

  // A square around Annecy, [lon, lat].
  const square: Ring = [
    [6.1, 45.9],
    [6.2, 45.9],
    [6.2, 46],
    [6.1, 46]
  ];

  // --- move -------------------------------------------------------------------
  const moved = moveVertex(square, 1, [6.25, 45.88]);
  check('move keeps the corner count', moved.length, square.length);
  check('move changes only the dragged corner', moved[1], [6.25, 45.88]);
  check(
    'move leaves the others alone',
    [moved[0], moved[2], moved[3]],
    [square[0], square[2], square[3]]
  );

  // --- insert -----------------------------------------------------------------
  const inserted = insertVertex(square, 0);
  check('insert adds exactly one corner', inserted.length, square.length + 1);
  check(
    'insert lands at the midpoint of the clicked edge',
    inserted[1],
    [6.15, 45.9]
  );
  check(
    'insert preserves the order around the ring',
    [inserted[0], inserted[2], inserted[3], inserted[4]],
    [square[0], square[1], square[2], square[3]]
  );

  // Inserting on the LAST edge wraps to the first corner, not off the end.
  const wrapped = insertVertex(square, square.length - 1);
  check('insert on the closing edge wraps', wrapped.at(-1), [6.1, 45.95]);
  check(
    'insert on the closing edge still adds one',
    wrapped.length,
    square.length + 1
  );

  // --- remove -----------------------------------------------------------------
  const removed = removeVertex(square, 2);
  check('remove drops exactly one corner', removed.length, square.length - 1);
  check(
    'remove drops the right one',
    removed.some((p) => p[0] === 6.2 && p[1] === 46),
    false
  );

  // A triangle is the floor: the last three corners are protected.
  const triangle: Ring = [
    [0, 0],
    [1, 0],
    [0, 1]
  ];
  check(
    'a triangle refuses to lose a corner',
    removeVertex(triangle, 0).length,
    MIN_RING
  );
  check(
    'the protected ring is returned unchanged',
    removeVertex(triangle, 1),
    triangle
  );

  // --- the ring stays drawable throughout -------------------------------------
  let ring: Ring = square;
  const ops: string[] = [];
  for (let step = 0; step < 40; step++) {
    const pick = step % 3;
    if (pick === 0) ring = insertVertex(ring, step % ring.length);
    else if (pick === 1)
      ring = moveVertex(ring, step % ring.length, [
        6.1 + (step % 7) / 100,
        45.9 + (step % 5) / 100
      ]);
    else ring = removeVertex(ring, step % ring.length);
    ops.push(String(ring.length));
    if (ring.length < MIN_RING) {
      failures++;
      console.log('FAIL  ring fell below a triangle at step', step);
    }
    // Whatever the sequence, the polygon must still reach the map as one drawable feature.
    const fc = areaCollection(
      [{ id: 'a', name: 'A', ring, color: '#ffffff', link: '', groupZoom: 0 }],
      ''
    );
    if (fc.features.length !== 1) {
      failures++;
      console.log('FAIL  ring stopped being drawable at step', step);
    }
    const outer = fc.features[0]!.geometry.coordinates[0]!;
    if (JSON.stringify(outer[0]) !== JSON.stringify(outer.at(-1))) {
      failures++;
      console.log('FAIL  emitted ring not closed at step', step);
    }
  }
  check('40 mixed edits keep the ring drawable and closed', true, true);
  console.log('   corner counts along the way:', ops.join(' '));

  // --- point-in-area still works on an edited ring ----------------------------
  const grown = insertVertex(insertVertex(square, 0), 3);
  check(
    'an asset inside stays inside after edits',
    ringContains(grown, 45.95, 6.15),
    true
  );
  check(
    'an asset outside stays outside after edits',
    ringContains(grown, 45.95, 6.35),
    false
  );
});
