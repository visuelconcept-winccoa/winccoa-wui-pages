// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Procedural geometry — the centerline sampler and the swept bore are the
 * numerical core of the 3D twin: PK bookkeeping, gradient/curve integration,
 * frame interpolation and the moving-frame world mapping all get pinned here.
 */
import { describe, expect, it } from 'vitest';
import {
  buildBoreGeometry,
  buildRibbonGeometry,
  crossSection,
  frameAt,
  rightOf,
  sampleCenterline,
  worldAt
} from './tunnel-geometry.js';
import type { SegmentDef, TubeDef } from '../types.js';

function segment(part: Partial<SegmentDef>): SegmentDef {
  return {
    id: 's',
    name: 'S',
    lengthM: 1000,
    gradientPct: 0,
    curveRadiusM: 0,
    clearanceM: 4.5,
    lightingZone: 'interior',
    ...part
  };
}

function tube(segments: SegmentDef[], lanes = 2): TubeDef {
  return { id: 'tube', name: 'Tube', direction: 'unidirectional', lanes, segments };
}

describe('sampleCenterline', () => {
  it('stamps the exact tube length on the last frame', () => {
    const frames = sampleCenterline(tube([segment({ lengthM: 1234 })]));
    expect(frames.at(-1)?.pkM).toBeCloseTo(1234, 6);
  });

  it('integrates a straight segment along +Z', () => {
    const frames = sampleCenterline(tube([segment({ lengthM: 1000 })]));
    const end = frames.at(-1)!.position;
    expect(end.z).toBeCloseTo(1000, 6);
    expect(end.x).toBeCloseTo(0, 6);
    expect(end.y).toBeCloseTo(0, 6);
  });

  it('raises the roadway by the longitudinal gradient', () => {
    const frames = sampleCenterline(tube([segment({ lengthM: 1000, gradientPct: 2 })]));
    expect(frames.at(-1)!.position.y).toBeCloseTo(20, 6);
  });

  it('turns ~90° over a quarter-circle right-hand curve', () => {
    const radius = 200;
    const quarter = (Math.PI * radius) / 2;
    const frames = sampleCenterline(tube([segment({ lengthM: quarter, curveRadiusM: radius })]));
    const tangent = frames.at(-1)!.tangent;
    // Started along +Z; a positive radius bends right → ends along −X.
    expect(tangent.x).toBeCloseTo(-1, 1);
    expect(Math.abs(tangent.z)).toBeLessThan(0.1);
  });

  it('chains segments continuously (no PK jump)', () => {
    const frames = sampleCenterline(
      tube([segment({ lengthM: 500 }), segment({ id: 's2', lengthM: 500, curveRadiusM: 800 })])
    );
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].pkM).toBeGreaterThan(frames[i - 1].pkM);
    }
    expect(frames.at(-1)?.pkM).toBeCloseTo(1000, 6);
  });
});

describe('frameAt', () => {
  it('clamps below and above the tube extent', () => {
    const frames = sampleCenterline(tube([segment({ lengthM: 100 })]));
    expect(frameAt(frames, -50).pkM).toBe(0);
    expect(frameAt(frames, 500).pkM).toBeCloseTo(100, 6);
  });

  it('interpolates between samples', () => {
    const frames = sampleCenterline(tube([segment({ lengthM: 100 })]));
    const mid = frameAt(frames, 55);
    expect(mid.position.z).toBeCloseTo(55, 6);
  });
});

describe('cross-section and world mapping', () => {
  it('derives the bore half-width from the lane count', () => {
    // 2 lanes × 3.5 m / 2 + 1 m walkway = 4.5 m.
    expect(crossSection(tube([segment({})], 2)).halfWidthM).toBeCloseTo(4.5, 6);
    expect(crossSection(tube([segment({})], 3)).halfWidthM).toBeCloseTo(6.25, 6);
  });

  it('maps a positive lateral offset to the right of the direction of travel', () => {
    const frames = sampleCenterline(tube([segment({ lengthM: 100 })]));
    // Heading +Z, "right" is +X in this scene's frame convention.
    expect(rightOf(frames[0]).x).toBeCloseTo(1, 6);
    const world = worldAt(frames, 0, 2, 1.5);
    expect(world.x).toBeCloseTo(2, 6);
    expect(world.y).toBeCloseTo(1.5, 6);
  });
});

describe('swept geometries', () => {
  it('builds an indexed bore whose indices stay in range', () => {
    const t = tube([segment({ lengthM: 200 })]);
    const geometry = buildBoreGeometry(sampleCenterline(t), crossSection(t));
    const vertexCount = geometry.getAttribute('position').count;
    const index = geometry.getIndex()!;
    let max = 0;
    for (let i = 0; i < index.count; i++) max = Math.max(max, index.getX(i));
    expect(max).toBeLessThan(vertexCount);
    expect(index.count % 3).toBe(0);
  });

  it('builds a ribbon with two vertices per frame', () => {
    const frames = sampleCenterline(tube([segment({ lengthM: 200 })]));
    const geometry = buildRibbonGeometry(frames, 3, 0.02);
    expect(geometry.getAttribute('position').count).toBe(frames.length * 2);
  });
});
