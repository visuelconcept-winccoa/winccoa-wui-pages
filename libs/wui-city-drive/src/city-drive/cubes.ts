// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The WinCC OA logo cubes a player throws — on foot or from the car, with the same key. Pure, no
 * three.js. No weapons: a cube is the only thing a player throws.
 *
 * A cube flies forward and drops in an arc; it sticks where it lands (a wall, the ground, a car,
 * a logo), stays there {@link FUSE_S} s, then blows up into its 4 × 4 × 4 small cubes (its size is
 * a setting, in cm; the small cubes are always a quarter of it): the blast
 * takes the logos and hits the cars around it (a hit on the traffic or a security car raises the
 * alert level). It never touches the pedestrians.
 */
import type { Box } from './city.js';
import { THROW_DURATION } from './figure.js';

export interface ThrownCube {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  /** Local player who threw it. */
  owner: number;
  /** Seconds left before it blows up, once stuck (null while flying). */
  fuse: number | null;
  /** Its edge (m): the size setting at the throw. */
  size: number;
}
/** Seconds a stuck cube waits before it blows up. */
export const FUSE_S = 1;
/** Reach of its blast (m): logos and cars within it. */
export const BLAST_M = 4;
/** Speed of a cube thrown by hand (m/s), and its lift. */
export const HAND_SPEED = 20;
const HAND_LIFT = 3.5;
/** From the car: thrown forward from the roof, on top of the car's own speed. */
export const CAR_SPEED = 24;
const CAR_LIFT = 3;
/** Time between two throws from the car (s); on foot, a throw lasts THROW_DURATION. */
export const CAR_COOLDOWN_S = 0.4;
const GRAVITY = 9;

let nextCubeId = 1;

/** A cube of edge `size` (m) thrown by hand from (x, z), facing `heading`: from the shoulder. */
export function throwByHand(x: number, z: number, heading: number, owner: number, size: number): ThrownCube {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const ahead = 0.5 + size / 2;
  return { id: nextCubeId++, x: x + fx * ahead, y: Math.max(1.7, size / 2), z: z + fz * ahead, vx: fx * HAND_SPEED, vy: HAND_LIFT, vz: fz * HAND_SPEED, age: 0, owner, fuse: null, size };
}

/**
 * A cube thrown from a car at (x, z), facing `heading`, moving at (vx, vz): from above the
 * windscreen, `ahead` m in front of the car's centre, forward on top of the car's own speed.
 */
export function throwFromCar(x: number, z: number, heading: number, vx: number, vz: number, ahead: number, owner: number, size: number): ThrownCube {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const out = ahead + size / 2;
  return { id: nextCubeId++, x: x + fx * out, y: Math.max(1.9, size / 2), z: z + fz * out, vx: vx + fx * CAR_SPEED, vy: CAR_LIFT, vz: vz + fz * CAR_SPEED, age: 0, owner, fuse: null, size };
}

/** May a player throw now? On foot once the previous throw is over; from the car after the cooldown. */
export const canThrow = (last: number | null, t: number, onFoot: boolean): boolean => last === null || t - last >= (onFoot ? THROW_DURATION : CAR_COOLDOWN_S);

/** The cube stops where it is and its fuse starts. */
export const stick = (b: ThrownCube): ThrownCube => ({ ...b, vx: 0, vy: 0, vz: 0, fuse: b.fuse ?? FUSE_S });

/**
 * One step of a cube: in flight it moves and drops; against a wall it stops at the wall, on the
 * ground it rests on it — and its fuse starts. A stuck cube burns its fuse; `blows` is true at
 * the step it reaches 0 (the caller makes it explode and drops it).
 */
export function stepCube(b: ThrownCube, dt: number, walls: readonly Box[]): { cube: ThrownCube; blows: boolean } {
  if (b.fuse !== null) {
    const fuse = b.fuse - dt;
    return { cube: { ...b, fuse, age: b.age + dt }, blows: fuse <= 0 };
  }
  const next: ThrownCube = { ...b, x: b.x + b.vx * dt, y: b.y + b.vy * dt, z: b.z + b.vz * dt, vy: b.vy - GRAVITY * dt, age: b.age + dt };
  if (walls.some((w) => next.x > w.x0 && next.x < w.x1 && next.z > w.z0 && next.z < w.z1)) return { cube: stick({ ...b, age: next.age }), blows: false };
  // resting on the ground on its face
  if (next.y <= b.size / 2) return { cube: stick({ ...next, y: b.size / 2 }), blows: false };
  return { cube: next, blows: false };
}
