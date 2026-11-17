// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The weapons of a person on foot (#89). Pure, no three.js.
 *
 * - the **WebUI hammer**: a heavy overhead blow, short reach, wide;
 * - the **sword** (an original star mark on the blade): a fast slash, a wide arc;
 * - the **cube crossbow**: shoots WinCC OA logo cubes that fly ~40 m/s, drop a little and
 *   stop against the walls.
 *
 * They break the logo tokens (they score as if driven through) and the cars — a hit on the
 * traffic or a security car raises the alert level. They never touch the pedestrians.
 */
import type { Box } from './city.js';
import { ATTACK_DURATION, ATTACK_HIT_AT, type AttackKind } from './figure.js';

export type WeaponId = AttackKind;

export interface Weapon {
  id: WeaponId;
  label: string;
  /** Reach of a melee blow, from the body (m); 0 for the crossbow. */
  reach: number;
  /** Half-angle of the arc in front hit by a melee blow (rad). */
  arc: number;
}

export const WEAPONS: readonly Weapon[] = [
  { id: 'hammer', label: 'WebUI hammer', reach: 2.6, arc: 0.9 },
  { id: 'sword', label: 'Star sword', reach: 2.4, arc: 1.3 },
  { id: 'crossbow', label: 'Cube crossbow', reach: 0, arc: 0 }
];

export const weaponById = (id: WeaponId): Weapon => WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];

/** The next weapon in the list (the "next weapon" key / button). */
export const nextWeapon = (id: WeaponId, step = 1): WeaponId => {
  const i = WEAPONS.findIndex((w) => w.id === id);
  return WEAPONS[(i + step + WEAPONS.length) % WEAPONS.length].id;
};

/** A blow under way: its weapon, its start, and whether it already landed. */
export interface Attack {
  weapon: WeaponId;
  t0: number;
  landed: boolean;
}

/** A new blow may start once the previous one is over. */
export const canAttack = (a: Attack | null, t: number): boolean => !a || t - a.t0 >= ATTACK_DURATION[a.weapon];

/** The blow lands at this step (once). */
export function lands(a: Attack, t: number): boolean {
  if (a.landed || t - a.t0 < ATTACK_HIT_AT[a.weapon]) return false;
  a.landed = true;
  return true;
}

/** Is (x, z) within reach of a melee blow from (fx, fz) facing `heading`? */
export function inArc(fx: number, fz: number, heading: number, w: Weapon, x: number, z: number, radius = 0): boolean {
  const dx = x - fx;
  const dz = z - fz;
  const d = Math.hypot(dx, dz);
  if (d > w.reach + radius) return false;
  if (d < 0.5 + radius) return true;
  let diff = Math.atan2(dx, dz) - heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.abs(diff) <= w.arc;
}

// --- the crossbow's cubes -------------------------------------------------------------------

export interface Bolt {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  /** Local player who shot it. */
  owner: number;
}

export const BOLT_SPEED = 40;
export const BOLT_LIFE = 1.4;
const GRAVITY = 5;
/** Height of the shot: the crossbow at the shoulder. */
const BOLT_Y = 1.4;

let nextBoltId = 1;

export function fireBolt(x: number, z: number, heading: number, owner: number): Bolt {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  return { id: nextBoltId++, x: x + fx * 0.9, y: BOLT_Y, z: z + fz * 0.9, vx: fx * BOLT_SPEED, vy: 0.6, vz: fz * BOLT_SPEED, age: 0, owner };
}

/** One step of a cube; null once it hit a wall, the ground, or flew too long. */
export function stepBolt(b: Bolt, dt: number, walls: readonly Box[]): Bolt | null {
  const next = { ...b, x: b.x + b.vx * dt, y: b.y + b.vy * dt, z: b.z + b.vz * dt, vy: b.vy - GRAVITY * dt, age: b.age + dt };
  if (next.age > BOLT_LIFE || next.y < 0.1) return null;
  if (walls.some((w) => next.x > w.x0 && next.x < w.x1 && next.z > w.z0 && next.z < w.z1)) return null;
  return next;
}
