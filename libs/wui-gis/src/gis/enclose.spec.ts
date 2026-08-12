// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { encloseAssets } from './enclose.js';
import { ringContains, type LatLon } from './types.js';

describe('fitting an outline around assets', () => {
  const p = (lat: number, lon: number): LatLon => ({ lat, lon });

  /** Does the ring cross itself? A crossed ring is filled inside out by MapLibre. */
  function isSimple(ring: readonly (readonly [number, number])[]): boolean {
    const at = (i: number): readonly [number, number] =>
      ring[i % ring.length] as readonly [number, number];
    const side = (
      a: readonly [number, number],
      b: readonly [number, number],
      c: readonly [number, number]
    ): number =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let i = 0; i < ring.length; i++) {
      for (let j = i + 1; j < ring.length; j++) {
        if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
        const [a, b, c, d] = [at(i), at(i + 1), at(j), at(j + 1)];
        const crosses =
          side(a, b, c) > 0 !== side(a, b, d) > 0 &&
          side(c, d, a) > 0 !== side(c, d, b) > 0;
        if (crosses) return false;
      }
    }
    return true;
  }

  it('returns null when there is nothing to enclose', () => {
    expect(encloseAssets([])).toBeNull();
    expect(encloseAssets([p(Number.NaN, 6), p(200, 6)])).toBeNull();
  });

  it('encloses every asset it was given', () => {
    const assets = [
      p(45.9, 6.1),
      p(45.95, 6.2),
      p(45.85, 6.25),
      p(45.88, 6.12)
    ];
    const ring = encloseAssets(assets)!;
    expect(ring.length).toBeGreaterThanOrEqual(3);
    for (const asset of assets) {
      expect(ringContains(ring, asset.lat, asset.lon)).toBe(true);
    }
  });

  it('follows a concave layout instead of bridging across the gap', () => {
    // A genuine C, open to the EAST: two arms and a spine on the west, and nothing at all
    // closing the mouth. Coordinates are jittered as surveyed ones are — exactly collinear
    // assets are a degenerate case, not a realistic one.
    const c = [
      p(45.8603, 6.0012),
      p(45.8598, 6.0301),
      p(45.8611, 6.0602),
      p(45.8812, 6.0018),
      p(45.8808, 6.0304),
      p(45.8801, 6.0593),
      p(45.9397, 6.0008),
      p(45.9402, 6.0298),
      p(45.9389, 6.0605),
      p(45.9188, 6.0022),
      p(45.9193, 6.0309),
      p(45.9199, 6.0596),
      p(45.9002, 6.0015),
      p(45.8998, 6.0211)
    ];
    const ring = encloseAssets(c, { marginM: 120 })!;
    expect(isSimple(ring)).toBe(true);
    for (const asset of c) {
      expect(ringContains(ring, asset.lat, asset.lon)).toBe(true);
    }
    // The bay, dead centre of the mouth: inside the convex hull, so the check is not
    // vacuous, and it must NOT be inside this outline. That is the whole point.
    expect(ringContains(ring, 45.9, 6.05)).toBe(false);
  });

  it('is not a bounding box — a diagonal run stays tight', () => {
    const ring = encloseAssets([p(45.8, 6), p(45.9, 6.1), p(46, 6.2)], {
      marginM: 100
    })!;
    expect(ringContains(ring, 46, 6)).toBe(false);
    expect(ringContains(ring, 45.8, 6.2)).toBe(false);
  });

  it('keeps a lone interior asset inside without cutting in to reach it', () => {
    const corners = [p(45.8, 6), p(46, 6), p(46, 6.3), p(45.8, 6.3)];
    const middle = p(45.9, 6.15);
    const ring = encloseAssets([...corners, middle])!;
    expect(ringContains(ring, middle.lat, middle.lon)).toBe(true);
    for (const corner of corners) {
      expect(ringContains(ring, corner.lat, corner.lon)).toBe(true);
    }
  });

  it('leaves a margin, so a marker sits inside the outline and not on it', () => {
    const assets = [p(45.8, 6), p(46, 6), p(45.9, 6.3)];
    const spread = (ring: readonly (readonly [number, number])[]): number => {
      const lats = ring.map(([, lat]) => lat);
      return Math.max(...lats) - Math.min(...lats);
    };
    const tight = encloseAssets(assets, { marginM: 10 })!;
    const roomy = encloseAssets(assets, { marginM: 900 })!;
    expect(spread(roomy)).toBeGreaterThan(spread(tight));
  });

  it('scales the automatic margin to the group, not to a fixed distance', () => {
    // Same shape, two sizes: the small one must not be swallowed by its own margin, and
    // the large one must not have a margin too thin to see.
    const relative = (points: LatLon[]): number => {
      const ring = encloseAssets(points)!;
      const lats = ring.map(([, lat]) => lat);
      const span = Math.max(...lats) - Math.min(...lats);
      const own =
        Math.max(...points.map((q) => q.lat)) -
        Math.min(...points.map((q) => q.lat));
      return span / own;
    };
    const small = relative([p(45.9, 6.1), p(45.902, 6.1), p(45.901, 6.103)]);
    const large = relative([p(45.7, 6.0), p(46.1, 6.0), p(45.9, 6.4)]);
    // Both grow by a similar *proportion*; a fixed margin would blow the small one up.
    expect(small).toBeLessThan(4);
    expect(large).toBeGreaterThan(1.02);
  });

  it('makes a disc for a single asset rather than refusing', () => {
    const ring = encloseAssets([p(45.9, 6.1)])!;
    expect(ring.length).toBeGreaterThanOrEqual(3);
    expect(ringContains(ring, 45.9, 6.1)).toBe(true);
    expect(isSimple(ring)).toBe(true);
  });

  it('makes a capsule for two assets, enclosing both', () => {
    const ring = encloseAssets([p(45.9, 6.1), p(45.9, 6.13)])!;
    expect(ringContains(ring, 45.9, 6.1)).toBe(true);
    expect(ringContains(ring, 45.9, 6.13)).toBe(true);
    expect(isSimple(ring)).toBe(true);
  });

  it('makes a capsule for a perfectly straight run, enclosing all of it', () => {
    // A line of valves along a main: exactly collinear, so there is no polygon to dig.
    const line = [p(45.9, 6), p(45.9, 6.05), p(45.9, 6.1), p(45.9, 6.2)];
    const ring = encloseAssets(line)!;
    expect(ring.length).toBeGreaterThanOrEqual(3);
    for (const point of line) {
      expect(ringContains(ring, point.lat, point.lon)).toBe(true);
    }
  });

  it('ignores unusable coordinates instead of producing a broken ring', () => {
    const ring = encloseAssets([
      p(45.9, 6.1),
      p(45.95, 6.2),
      p(45.85, 6.25),
      p(Number.NaN, 6.3),
      p(200, 6.3)
    ])!;
    expect(
      ring.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
    ).toBe(true);
    expect(ringContains(ring, 45.9, 6.1)).toBe(true);
  });

  it('does not repeat the first point (this codebase stores open rings)', () => {
    const ring = encloseAssets([
      p(45.8, 6),
      p(46, 6),
      p(46, 6.3),
      p(45.8, 6.3)
    ])!;
    expect(JSON.stringify(ring[0])).not.toBe(JSON.stringify(ring.at(-1)));
  });

  it('tightness 0 stays convex, and raising it digs in', () => {
    // A genuine C, open to the EAST: two arms and a spine on the west, and nothing at all
    // closing the mouth. Coordinates are jittered as surveyed ones are — exactly collinear
    // assets are a degenerate case, not a realistic one.
    const c = [
      p(45.8603, 6.0012),
      p(45.8598, 6.0301),
      p(45.8611, 6.0602),
      p(45.8812, 6.0018),
      p(45.8808, 6.0304),
      p(45.8801, 6.0593),
      p(45.9397, 6.0008),
      p(45.9402, 6.0298),
      p(45.9389, 6.0605),
      p(45.9188, 6.0022),
      p(45.9193, 6.0309),
      p(45.9199, 6.0596),
      p(45.9002, 6.0015),
      p(45.8998, 6.0211)
    ];
    const bay = { lat: 45.9, lon: 6.05 };
    const convex = encloseAssets(c, { tightness: 0, marginM: 120 })!;
    const dug = encloseAssets(c, { tightness: 1, marginM: 120 })!;
    expect(ringContains(convex, bay.lat, bay.lon)).toBe(true);
    expect(ringContains(dug, bay.lat, bay.lon)).toBe(false);
    // And every asset stays enclosed at both extremes.
    for (const asset of c) {
      expect(ringContains(convex, asset.lat, asset.lon)).toBe(true);
      expect(ringContains(dug, asset.lat, asset.lon)).toBe(true);
    }
  });

  it('never exceeds the 64 points the sanitiser keeps', () => {
    // 300 assets scattered over a district: the ring must stay storable, because a
    // truncated ring is a different shape on the next reload.
    const many: LatLon[] = [];
    for (let i = 0; i < 300; i++) {
      const angle = (i / 300) * Math.PI * 2;
      const radius = 0.02 + 0.01 * Math.sin(i);
      many.push(p(45.9 + Math.sin(angle) * radius, 6.1 + Math.cos(angle) * radius));
    }
    const ring = encloseAssets(many)!;
    expect(ring.length).toBeLessThanOrEqual(64);
    expect(isSimple(ring)).toBe(true);
  });

  it('is always a simple polygon, over many random layouts', () => {
    // A deterministic pseudo-random sweep: the offset must never hand back a crossed ring,
    // whatever shape the digging produced.
    let seed = 12_345;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 60; round++) {
      const count = 3 + Math.floor(next() * 25);
      const assets: LatLon[] = [];
      for (let i = 0; i < count; i++) {
        assets.push(p(45.8 + next() * 0.3, 6 + next() * 0.3));
      }
      const ring = encloseAssets(assets)!;
      expect(isSimple(ring)).toBe(true);
      expect(ring.length).toBeLessThanOrEqual(64);
      for (const asset of assets) {
        expect(ringContains(ring, asset.lat, asset.lon)).toBe(true);
      }
    }
  });
});
