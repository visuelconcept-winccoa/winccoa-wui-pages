// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tension in City Drive (#85): the alert level, red lights, speed cameras, damage and the
 * security cars that give chase. Pure, no three.js.
 *
 * Heat: each offence adds heat; the alert level (0..5) follows the heat. Heat cools down on its
 * own once no offence was made for a while — but not while a security car sees the player.
 * A respray at the station, an acknowledgement of the player's WinCC OA alert, or getting
 * caught clears it.
 */
import { CELL, ROAD_WIDTH, rng, type City } from './city.js';
import { CAR, forwardSpeed, newCar, type CarInput, type CarSpec, type CarState } from './physics.js';
import { lightAt, type LightOverrides } from './traffic.js';

// --- heat and alert level ---------------------------------------------------------------

export type Offence = 'red-light' | 'crash' | 'speed-camera' | 'ram-security';

export const OFFENCE_HEAT: Record<Offence, number> = {
  'red-light': 14,
  crash: 9,
  'speed-camera': 12,
  'ram-security': 22
};

/** Heat needed for levels 1..5. */
export const LEVEL_HEAT = [10, 30, 60, 100, 150] as const;
export const MAX_LEVEL = 5;
/** Seconds without an offence before the heat starts to fall. */
export const COOL_AFTER_S = 10;
/** Heat lost per second once cooling (not seen by a security car). */
export const COOL_RATE = 4;
/** Level from which security cars give chase. */
export const CHASE_FROM_LEVEL = 2;

export const levelOf = (heat: number): number => LEVEL_HEAT.filter((h) => heat >= h).length;

export class Heat {
  heat = 0;
  private lastOffenceAt = -Infinity;

  get level(): number {
    return levelOf(this.heat);
  }

  /** An offence at time t: adds its heat; returns the new level. */
  offence(kind: Offence, t: number): number {
    this.heat = Math.min(LEVEL_HEAT[MAX_LEVEL - 1] + 50, this.heat + OFFENCE_HEAT[kind]);
    this.lastOffenceAt = t;
    return this.level;
  }

  /** Cooling: after COOL_AFTER_S without offence, unless a security car sees the player. */
  step(dt: number, t: number, seen: boolean): void {
    if (seen || t - this.lastOffenceAt < COOL_AFTER_S) return;
    this.heat = Math.max(0, this.heat - COOL_RATE * dt);
  }

  /** One level down (shook the chasers off): heat just under the current level. */
  dropLevel(): void {
    const level = this.level;
    this.heat = level <= 1 ? 0 : LEVEL_HEAT[level - 2];
  }

  clear(): void {
    this.heat = 0;
  }
}

// --- red lights ---------------------------------------------------------------------------

/**
 * The crossroads (i, j) the car just entered at this step while its light was red, or null.
 * Entering = the previous position was outside the crossroads box and the new one is inside;
 * the light seen is the one of the axis the car moves along.
 */
export function ranRedLight(
  prev: { x: number; z: number },
  now: CarState,
  t: number,
  blocks: number,
  overrides?: LightOverrides
): { i: number; j: number } | null {
  const half = ROAD_WIDTH / 2;
  const i = Math.round(now.x / CELL);
  const j = Math.round(now.z / CELL);
  if (i < 0 || j < 0 || i > blocks || j > blocks) return null;
  const inside = (p: { x: number; z: number }): boolean => Math.abs(p.x - i * CELL) < half && Math.abs(p.z - j * CELL) < half;
  if (!inside(now) || inside(prev)) return null;
  const speed = Math.hypot(now.vx, now.vz);
  if (speed < 3) return null; // crawling over the line is no run
  const axis: 0 | 1 = Math.abs(now.vz) >= Math.abs(now.vx) ? 0 : 1;
  return lightAt(i, j, axis, t, overrides) === 'red' ? { i, j } : null;
}

// --- speed cameras -----------------------------------------------------------------------

export interface SpeedCamera {
  id: number;
  x: number;
  z: number;
  /** km/h */
  limit: number;
}

export const CAMERA_RANGE = 7;

/** `count` cameras on the roadside, out of the crossroads, at least 120 m apart. */
export function placeCameras(city: City, count: number, seed = 31): SpeedCamera[] {
  const rand = rng(seed);
  const out: SpeedCamera[] = [];
  const limits = [50, 70, 70, 90];
  for (let tries = 0; out.length < count && tries < count * 80; tries++) {
    const k = Math.floor(rand() * (city.blocks + 1));
    const s = 10 + rand() * (city.size - 20);
    const along = s - Math.round(s / CELL) * CELL;
    if (Math.abs(along) < ROAD_WIDTH / 2 + 10) continue;
    const onX = rand() < 0.5;
    const x = onX ? s : k * CELL;
    const z = onX ? k * CELL : s;
    if (out.some((c) => Math.hypot(c.x - x, c.z - z) < 120)) continue;
    out.push({ id: out.length, x, z, limit: limits[Math.floor(rand() * limits.length)] });
  }
  return out;
}

/** The camera that flashes a car at (x, z) driving at `kmh`, or null; `cooldown` keyed by camera id (s of last flash). */
export function flashedBy(cameras: readonly SpeedCamera[], x: number, z: number, kmh: number, t: number, lastFlash: Map<number, number>): SpeedCamera | null {
  for (const c of cameras) {
    if (Math.hypot(c.x - x, c.z - z) > CAMERA_RANGE || kmh <= c.limit) continue;
    if (t - (lastFlash.get(c.id) ?? -Infinity) < 6) continue;
    lastFlash.set(c.id, t);
    return c;
  }
  return null;
}

/** Fine of a ticket: 50 points, plus 5 per km/h over the limit (rounded to 10). */
export const fineOf = (kmh: number, limit: number): number => Math.round((50 + Math.max(0, kmh - limit) * 5) / 10) * 10;

// --- damage ------------------------------------------------------------------------------

/** Damage 0..1 after a hit at `impact` m/s (light knocks do nothing). */
export function applyImpact(damage: number, impact: number): number {
  if (impact < 4) return damage;
  return Math.min(1, damage + (impact - 3) / 70);
}

/** The car's top speed, reduced by its damage (down to 65 %). */
export function damagedSpec(spec: CarSpec, damage: number): CarSpec {
  const k = 1 - 0.35 * damage;
  return damage === 0 ? spec : { ...spec, maxSpeed: spec.maxSpeed * k, engine: spec.engine * (1 - 0.25 * damage) };
}

// --- security cars ------------------------------------------------------------------------

export interface Chaser {
  car: CarState;
  /** Index of the local player chased. */
  target: number;
  /** Seconds spent nearly still (stuck against a wall): then it backs up. */
  stuck: number;
  reversing: number;
}

export const CHASER_SPEC: CarSpec = { ...CAR, engine: 15, maxSpeed: 46, grip: 11 };
/** Beyond this distance a chaser no longer sees its target. */
export const SIGHT_M = 140;
/** Escape: every chaser farther than this for ESCAPE_S seconds. */
export const ESCAPE_M = 220;
export const ESCAPE_S = 6;
/** Caught: a chaser closer than this while the target crawls, for CAUGHT_S seconds. */
export const CAUGHT_M = 6;
export const CAUGHT_S = 2.5;

/** Chasers for a level: none below CHASE_FROM_LEVEL, then one more per level (max 4). */
export const chasersFor = (level: number): number => (level < CHASE_FROM_LEVEL ? 0 : Math.min(4, level - 1));

/** A chaser spawned behind the target, on the road, ~100 m away. */
export function spawnChaser(target: CarState, index: number, k: number): Chaser {
  const back = 90 + k * 25;
  const h = target.heading;
  const x = Math.round((target.x - Math.sin(h) * back) / CELL) * CELL;
  const z = target.z - Math.cos(h) * back;
  const onZ = Math.abs(Math.cos(h)) >= Math.abs(Math.sin(h));
  const car = onZ ? newCar(x, z, h) : newCar(target.x - Math.sin(h) * back, Math.round(z / CELL) * CELL, h);
  return { car, target: index, stuck: 0, reversing: 0 };
}

/**
 * The chaser's controls: it aims at a point ahead of its target (where the target will be in
 * ~0.8 s, so it cuts it off), brakes into sharp turns, and backs up when stuck.
 */
export function chaserInput(c: Chaser, target: CarState, dt: number): CarInput {
  const lead = 0.8;
  const tx = target.x + target.vx * lead;
  const tz = target.z + target.vz * lead;
  const want = Math.atan2(tx - c.car.x, tz - c.car.z);
  let diff = want - c.car.heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const speed = forwardSpeed(c.car);
  if (c.reversing > 0) {
    c.reversing -= dt;
    return { throttle: -1, steer: diff > 0 ? 1 : -1, handbrake: false };
  }
  c.stuck = Math.abs(speed) < 1.5 ? c.stuck + dt : 0;
  if (c.stuck > 1.5) {
    c.stuck = 0;
    c.reversing = 1.2;
  }
  // heading decreases when turning right: steer = -sign(diff)
  const steer = Math.max(-1, Math.min(1, -diff * 2.2));
  const sharp = Math.abs(diff) > 0.9 && speed > 14;
  const dist = Math.hypot(tx - c.car.x, tz - c.car.z);
  return { throttle: sharp ? -0.6 : dist < 8 ? 0.4 : 1, steer, handbrake: Math.abs(diff) > 1.4 && speed > 10 };
}
