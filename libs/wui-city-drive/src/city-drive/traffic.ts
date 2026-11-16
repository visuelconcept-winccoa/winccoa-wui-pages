// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Traffic of City Drive (#79): the lights of the crossroads and the cars driven by the game.
 * Pure, no three.js.
 *
 * The road network is the grid of nodes (i, j), i, j = 0..blocks, at (i·CELL, j·CELL). A
 * traffic car runs from a node towards a neighbour in its right-hand lane, stops at a red or
 * yellow light and behind the car ahead (another traffic car or the player), then picks a new
 * direction at the next node (never a U-turn, unless at a dead end).
 */
import { CELL, LANE_OFFSET, rng } from './city.js';

export type Dir = 0 | 1 | 2 | 3; // +Z, +X, -Z, -X
export type Light = 'green' | 'yellow' | 'red';

const DX = [0, 1, 0, -1];
const DZ = [1, 0, -1, 0];
export const CYCLE_S = 18;
const GREEN_S = 7.5;
const YELLOW_S = 1.5;
const CRUISE = 11; // m/s ≈ 40 km/h
const ACCEL = 4;
const DECEL = 9;
const STOP_LINE = CELL - 10; // where a car waits before the crossroads
const GAP = 9;

export interface TrafficCar {
  id: number;
  i: number;
  j: number;
  dir: Dir;
  /** Distance travelled from node (i, j), 0..CELL. */
  s: number;
  speed: number;
  color: number;
}

export interface LightOverrides {
  /** Crossroads `i-j` forced all red (a bound datapoint). */
  allRed: ReadonlySet<string>;
}

export const NO_OVERRIDES: LightOverrides = { allRed: new Set() };

/** Heading of a direction (heading 0 = +Z, forward = (sin h, cos h)). */
export const dirHeading = (d: Dir): number => Math.atan2(DX[d], DZ[d]);

/** Light seen by a car crossing node (i, j) along `axis` (0 = Z, 1 = X) at time t (s). */
export function lightAt(i: number, j: number, axis: 0 | 1, t: number, overrides: LightOverrides = NO_OVERRIDES): Light {
  if (overrides.allRed.has(`${i}-${j}`)) return 'red';
  const phase = (((t + ((i * 7 + j * 3) % CYCLE_S)) % CYCLE_S) + CYCLE_S) % CYCLE_S;
  const half = CYCLE_S / 2;
  const local = axis === 0 ? phase : (phase + half) % CYCLE_S;
  if (local < GREEN_S) return 'green';
  if (local < GREEN_S + YELLOW_S) return 'yellow';
  return 'red';
}

/** World position and heading of a traffic car (in its right-hand lane). */
export function carPose(c: TrafficCar): { x: number; z: number; heading: number } {
  const fx = DX[c.dir];
  const fz = DZ[c.dir];
  // right of the driver = forward × up = (-fz, fx)
  return {
    x: c.i * CELL + fx * c.s - fz * LANE_OFFSET,
    z: c.j * CELL + fz * c.s + fx * LANE_OFFSET,
    heading: dirHeading(c.dir)
  };
}

function inside(i: number, j: number, blocks: number): boolean {
  return i >= 0 && j >= 0 && i <= blocks && j <= blocks;
}

function nextDir(c: TrafficCar, blocks: number, rand: () => number): Dir {
  const back = ((c.dir + 2) % 4) as Dir;
  const options = ([0, 1, 2, 3] as Dir[]).filter((d) => d !== back && inside(c.i + DX[d], c.j + DZ[d], blocks));
  if (options.length === 0) return back;
  // going straight a bit more often than turning
  const straight = options.includes(c.dir) ? [c.dir, c.dir] : [];
  const pool = [...options, ...straight];
  return pool[Math.floor(rand() * pool.length)];
}

export function spawnTraffic(count: number, blocks: number, seed = 11): TrafficCar[] {
  const rand = rng(seed);
  const palette = [0x2f6db5, 0xe2e2e2, 0x1d1d1d, 0xc9a227, 0x3c8d5a, 0x8a8f96, 0x9b2c2c];
  const cars: TrafficCar[] = [];
  for (let id = 0; id < count; id++) {
    const car: TrafficCar = {
      id,
      i: Math.floor(rand() * (blocks + 1)),
      j: Math.floor(rand() * (blocks + 1)),
      dir: 0,
      s: 10 + rand() * (CELL - 30),
      speed: CRUISE * rand(),
      color: palette[id % palette.length]
    };
    car.dir = nextDir({ ...car, dir: Math.floor(rand() * 4) as Dir }, blocks, rand);
    cars.push(car);
  }
  return cars;
}

/** Distance free ahead of `c` before it must stop (light, car ahead, player), or Infinity. */
function freeAhead(c: TrafficCar, all: readonly TrafficCar[], player: { x: number; z: number } | null, t: number, ov: LightOverrides): number {
  let free = Infinity;
  if (c.s < STOP_LINE + 0.5) {
    const ni = c.i + DX[c.dir];
    const nj = c.j + DZ[c.dir];
    const axis: 0 | 1 = c.dir % 2 === 0 ? 0 : 1;
    if (lightAt(ni, nj, axis, t, ov) !== 'green') free = STOP_LINE - c.s;
  }
  for (const o of all) {
    if (o === c || o.i !== c.i || o.j !== c.j || o.dir !== c.dir || o.s <= c.s) continue;
    free = Math.min(free, o.s - c.s - GAP);
  }
  if (player) {
    const p = carPose(c);
    const fx = DX[c.dir];
    const fz = DZ[c.dir];
    const ahead = (player.x - p.x) * fx + (player.z - p.z) * fz;
    const side = Math.abs((player.x - p.x) * fz - (player.z - p.z) * fx);
    if (ahead > 0 && ahead < 18 && side < 3.2) free = Math.min(free, ahead - GAP);
  }
  return free;
}

/** One step of every traffic car (in place, returns the same array). */
export function stepTraffic(
  cars: TrafficCar[],
  blocks: number,
  t: number,
  dt: number,
  player: { x: number; z: number } | null,
  rand: () => number,
  overrides: LightOverrides = NO_OVERRIDES
): TrafficCar[] {
  for (const c of cars) {
    const free = freeAhead(c, cars, player, t, overrides);
    // speed that still lets the car stop within `free`
    const safe = free === Infinity ? CRUISE : Math.sqrt(Math.max(0, 2 * DECEL * Math.max(0, free)));
    const target = Math.min(CRUISE, safe);
    c.speed = c.speed < target ? Math.min(target, c.speed + ACCEL * dt) : Math.max(target, c.speed - DECEL * 1.5 * dt);
    c.s += c.speed * dt;
    if (c.s >= CELL) {
      c.s -= CELL;
      c.i += DX[c.dir];
      c.j += DZ[c.dir];
      c.dir = nextDir(c, blocks, rand);
    }
  }
  return cars;
}
