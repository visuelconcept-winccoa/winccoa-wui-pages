// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** The leader line of a moved bubble meets the edge facing its machine. */
import { describe, expect, it } from 'vitest';
import { leaderEnd } from './leader-end.js';

const box = { x: 100, y: 100, w: 200, h: 50 };

describe('leader end', () => {
  it('is on the bottom edge for a bubble above its machine', () => {
    expect(leaderEnd(box, 180, 220)).toEqual([180, 150]);
  });

  it('is on the top edge for a bubble below its machine', () => {
    expect(leaderEnd(box, 150, 40)).toEqual([150, 100]);
  });

  it('is on the side edge for a bubble beside its machine', () => {
    expect(leaderEnd(box, 40, 120)).toEqual([100, 120]);
    expect(leaderEnd(box, 400, 130)).toEqual([300, 130]);
  });

  it('is the nearest corner for a bubble set diagonally', () => {
    expect(leaderEnd(box, 350, 200)).toEqual([300, 150]);
    expect(leaderEnd(box, 20, 20)).toEqual([100, 100]);
  });

  it('is none when the dot is under the bubble', () => {
    expect(leaderEnd(box, 150, 120)).toBeNull();
  });
});
