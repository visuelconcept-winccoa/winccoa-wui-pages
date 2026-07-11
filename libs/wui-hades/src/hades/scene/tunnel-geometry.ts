// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Procedural tunnel geometry — everything derives from the segment list.
 *
 * The tube centerline is walked segment by segment (straight or constant-radius
 * horizontal arc, plus the longitudinal gradient) and sampled every
 * {@link STEP_M} metres into PK-stamped frames (position + tangent). The bore
 * itself is a horseshoe cross-section (vertical side walls + semicircular
 * vault) swept along those frames and rendered from the inside (BackSide), and
 * the roadway is a flat ribbon with painted lane separators. Equipment
 * placement reuses {@link frameAt} + {@link crossSection} so a PK + side pair
 * lands exactly on the wall / vault / roadway of the generated bore.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import type { TubeDef } from '../types.js';

/** Centerline sampling step (metres). */
export const STEP_M = 10;
/** Lane width (m) used to derive the bore width from the lane count. */
const LANE_WIDTH_M = 3.5;
/** Emergency walkway width on each side of the roadway (m). */
const WALKWAY_M = 1;
/** Height of the vertical side walls before the vault starts (m). */
const WALL_HEIGHT_M = 2.2;
/** Points used to tessellate the vault semicircle. */
const VAULT_POINTS = 14;

/** One sampled point of the tube centerline. */
export interface Frame {
  position: Vector3;
  tangent: Vector3;
  pkM: number;
}

/** Cross-section dimensions of a tube (derived from its lane count). */
export interface CrossSection {
  /** Half-width of the bore at road level (m). */
  halfWidthM: number;
  /** Height of the vertical walls (m). */
  wallHeightM: number;
  /** Total interior height at the crown (m). */
  crownHeightM: number;
}

export function crossSection(tube: TubeDef): CrossSection {
  const halfWidthM = (tube.lanes * LANE_WIDTH_M) / 2 + WALKWAY_M;
  return {
    halfWidthM,
    wallHeightM: WALL_HEIGHT_M,
    crownHeightM: WALL_HEIGHT_M + halfWidthM
  };
}

/**
 * Sample the tube centerline into frames every {@link STEP_M} metres.
 * The tube starts at the origin heading +Z; a positive `curveRadiusM` bends
 * right, the gradient raises/lowers the roadway along the way.
 */
export function sampleCenterline(tube: TubeDef): Frame[] {
  const frames: Frame[] = [];
  const position = new Vector3(0, 0, 0);
  let heading = 0; // radians around +Y, 0 = +Z
  let pkM = 0;

  const push = (): void => {
    const tangent = new Vector3(Math.sin(heading), 0, Math.cos(heading)).normalize();
    frames.push({ position: position.clone(), tangent, pkM });
  };
  push();

  for (const segment of tube.segments) {
    const steps = Math.max(1, Math.round(segment.lengthM / STEP_M));
    const stepM = segment.lengthM / steps;
    const rise = (segment.gradientPct / 100) * stepM;
    for (let i = 0; i < steps; i++) {
      if (segment.curveRadiusM !== 0) {
        heading -= stepM / segment.curveRadiusM;
      }
      position.x += Math.sin(heading) * stepM;
      position.z += Math.cos(heading) * stepM;
      position.y += rise;
      pkM += stepM;
      push();
    }
  }
  return frames;
}

/** Interpolated frame at an arbitrary PK (clamped to the tube extent). */
export function frameAt(frames: Frame[], pkM: number): Frame {
  const last = frames.at(-1);
  const first = frames[0];
  if (!first || !last) return { position: new Vector3(), tangent: new Vector3(0, 0, 1), pkM: 0 };
  if (pkM <= first.pkM) return first;
  if (pkM >= last.pkM) return last;
  let low = 0;
  let high = frames.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (frames[mid].pkM <= pkM) low = mid;
    else high = mid;
  }
  const a = frames[low];
  const b = frames[high];
  const t = (pkM - a.pkM) / (b.pkM - a.pkM || 1);
  return {
    pkM,
    position: a.position.clone().lerp(b.position, t),
    tangent: a.tangent.clone().lerp(b.tangent, t).normalize()
  };
}

const UP = new Vector3(0, 1, 0);

/** Rightward horizontal unit vector of a frame (cross-section +X axis). */
export function rightOf(frame: Frame): Vector3 {
  return new Vector3().crossVectors(frame.tangent, UP).normalize().negate();
}

/** World position at (pk, lateral offset, height) in the tube's moving frame. */
export function worldAt(frames: Frame[], pkM: number, lateralM: number, heightM: number): Vector3 {
  const frame = frameAt(frames, pkM);
  return frame.position
    .clone()
    .addScaledVector(rightOf(frame), lateralM)
    .add(new Vector3(0, heightM, 0));
}

/** Local 2D profile of the horseshoe bore, left wall base → right wall base. */
function boreProfile(section: CrossSection): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [
    { x: -section.halfWidthM, y: 0 },
    { x: -section.halfWidthM, y: section.wallHeightM }
  ];
  for (let i = 1; i < VAULT_POINTS; i++) {
    const angle = Math.PI - (Math.PI * i) / VAULT_POINTS;
    points.push({
      x: Math.cos(angle) * section.halfWidthM,
      y: section.wallHeightM + Math.sin(angle) * section.halfWidthM
    });
  }
  points.push({ x: section.halfWidthM, y: section.wallHeightM }, { x: section.halfWidthM, y: 0 });
  return points;
}

/**
 * Fraction of the vault quarter kept on each side in the cutaway (dollhouse)
 * profile — the rest of the crown is left open so an orbiting camera looks
 * straight down onto the roadway and the equipment.
 */
const CUTAWAY_VAULT_KEEP = 0.45;

/**
 * The two half-profiles of the open-top (cutaway) bore: each keeps its wall and
 * the lower {@link CUTAWAY_VAULT_KEEP} of its vault quarter, leaving a
 * longitudinal skylight along the crown. Returned left half then right half,
 * each ordered base → opening edge.
 */
function cutawayProfiles(section: CrossSection): { x: number; y: number }[][] {
  const keep = Math.max(1, Math.round(VAULT_POINTS * 0.5 * CUTAWAY_VAULT_KEEP));
  const left: { x: number; y: number }[] = [
    { x: -section.halfWidthM, y: 0 },
    { x: -section.halfWidthM, y: section.wallHeightM }
  ];
  for (let i = 1; i <= keep; i++) {
    const angle = Math.PI - (Math.PI * i) / VAULT_POINTS;
    left.push({
      x: Math.cos(angle) * section.halfWidthM,
      y: section.wallHeightM + Math.sin(angle) * section.halfWidthM
    });
  }
  // Mirrored right half (base → opening edge; DoubleSide material absorbs the winding flip).
  const right = left.map((p) => ({ x: -p.x, y: p.y }));
  return [left, right];
}

/**
 * Clip a sampled centerline at a PK: every frame up to `pkM` plus one exact
 * interpolated end frame. The full array comes back when the PK is at (or
 * beyond) the tube end; at least the first frame is always kept.
 */
export function clipFrames(frames: Frame[], pkM: number): Frame[] {
  const last = frames.at(-1);
  if (!last || pkM >= last.pkM) return frames;
  const kept = frames.filter((f) => f.pkM < pkM);
  if (kept.length === 0) kept.push(frames[0]);
  const end = frameAt(frames, Math.max(frames[0].pkM, pkM));
  if (end.pkM > (kept.at(-1)?.pkM ?? 0)) kept.push(end);
  return kept;
}

/** Sweep an arbitrary local (x, y) profile along the frames (shared core). */
function sweepProfile(frames: Frame[], profile: { x: number; y: number }[]): BufferGeometry {
  const ringSize = profile.length;
  const positions = new Float32Array(frames.length * ringSize * 3);
  const uvs = new Float32Array(frames.length * ringSize * 2);

  for (const [f, frame] of frames.entries()) {
    const right = rightOf(frame);
    for (const [p, point] of profile.entries()) {
      const world = frame.position
        .clone()
        .addScaledVector(right, point.x)
        .add(new Vector3(0, point.y, 0));
      const base = (f * ringSize + p) * 3;
      positions[base] = world.x;
      positions[base + 1] = world.y;
      positions[base + 2] = world.z;
      const uvBase = (f * ringSize + p) * 2;
      uvs[uvBase] = frame.pkM / 50;
      uvs[uvBase + 1] = p / (ringSize - 1);
    }
  }

  const indices: number[] = [];
  for (let f = 0; f < frames.length - 1; f++) {
    for (let p = 0; p < ringSize - 1; p++) {
      const a = f * ringSize + p;
      const b = a + 1;
      const c = a + ringSize;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Swept interior surface of the bore (indexed, with normals), meant to be
 * rendered with `side: BackSide` so the camera inside the tube sees the walls.
 */
export function buildBoreGeometry(frames: Frame[], section: CrossSection): BufferGeometry {
  return sweepProfile(frames, boreProfile(section));
}

/**
 * Open-top (cutaway) bore: the two wall/lower-vault shells with a longitudinal
 * skylight along the crown — the dollhouse view. Rendered DoubleSide so the
 * shells read from outside as well as inside.
 */
export function buildCutawayGeometries(frames: Frame[], section: CrossSection): BufferGeometry[] {
  return cutawayProfiles(section).map((profile) => sweepProfile(frames, profile));
}

/**
 * Flat cross-section face (the "slice" cap) of the bore at one frame — shown at
 * the moving PK cut so the scrubbed tunnel reads as a solid sliced model. A
 * triangle fan from the profile centroid (the horseshoe profile is convex).
 */
export function buildSectionCapGeometry(frame: Frame, section: CrossSection): BufferGeometry {
  const profile = boreProfile(section);
  const right = rightOf(frame);
  const centroid = { x: 0, y: (section.wallHeightM + section.crownHeightM) / 3 };
  const points = [centroid, ...profile];
  const positions = new Float32Array(points.length * 3);
  for (const [i, p] of points.entries()) {
    const world = frame.position.clone().addScaledVector(right, p.x).add(new Vector3(0, p.y, 0));
    positions.set([world.x, world.y, world.z], i * 3);
  }
  const indices: number[] = [];
  for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Flat ribbon following the centerline at a fixed height (roadway, walkways,
 * lane separators). `halfWidthM` on each side of `centerOffsetM`.
 */
export function buildRibbonGeometry(
  frames: Frame[],
  halfWidthM: number,
  heightM: number,
  centerOffsetM = 0
): BufferGeometry {
  const positions = new Float32Array(frames.length * 2 * 3);
  for (const [f, frame] of frames.entries()) {
    const right = rightOf(frame);
    const left = frame.position
      .clone()
      .addScaledVector(right, centerOffsetM - halfWidthM)
      .add(new Vector3(0, heightM, 0));
    const rightPoint = frame.position
      .clone()
      .addScaledVector(right, centerOffsetM + halfWidthM)
      .add(new Vector3(0, heightM, 0));
    positions.set([left.x, left.y, left.z, rightPoint.x, rightPoint.y, rightPoint.z], f * 6);
  }
  const indices: number[] = [];
  for (let f = 0; f < frames.length - 1; f++) {
    const a = f * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
