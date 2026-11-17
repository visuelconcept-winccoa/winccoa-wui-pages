// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * On foot (#79): the player leaves the car (F), walks or runs (Shift) about the city and gets
 * back in when close to it. Pure, no three.js. Same heading convention as the car: 0 = +Z,
 * forward = (sin h, cos h), a positive turn goes right (decreasing heading).
 */
import type { Box } from './city.js';
import { collide, newCar, type CarState } from './physics.js';

export interface WalkerState {
  x: number;
  z: number;
  heading: number;
  /** m/s, signed (backwards < 0). */
  speed: number;
  /** Stride phase, for the legs' swing. */
  phase: number;
}

export interface WalkInput {
  /** -1 (back) .. 1 (forward). */
  move: number;
  /** -1 (left) .. 1 (right). */
  turn: number;
  run: boolean;
}

export const WALK_SPEED = 1.8;
export const RUN_SPEED = 6;
export const TURN_RATE = 2.6;
export const WALKER_RADIUS = 0.45;
/** How close to the car the player must be to get in (m). */
export const ENTER_DISTANCE = 4.5;

/** Out of the car: standing by the driver's door (left side), facing as the car. */
export function leaveCar(car: CarState, halfWidth: number): WalkerState {
  // the driver's left: facing +Z the left is +X → left = (cos h, -sin h)
  const lx = Math.cos(car.heading);
  const lz = -Math.sin(car.heading);
  const d = halfWidth + 0.9;
  return { x: car.x + lx * d, z: car.z + lz * d, heading: car.heading, speed: 0, phase: 0 };
}

export function canEnter(w: WalkerState, car: CarState): boolean {
  return Math.hypot(w.x - car.x, w.z - car.z) <= ENTER_DISTANCE;
}

/** One step on foot, with the buildings and the city's bounds as walls. */
export function stepWalker(w: WalkerState, input: WalkInput, dt: number, walls: readonly Box[], bounds: Box): WalkerState {
  const heading = w.heading - input.turn * TURN_RATE * dt;
  const target = input.move * (input.run && input.move > 0 ? RUN_SPEED : WALK_SPEED);
  // quick to start and stop: people are not cars
  const speed = w.speed + (target - w.speed) * Math.min(1, dt * 10);
  const moved = newCar(w.x + Math.sin(heading) * speed * dt, w.z + Math.cos(heading) * speed * dt, heading);
  const out = collide(moved, walls, bounds, 0, WALKER_RADIUS).car;
  const phase = w.phase + Math.abs(speed) * dt * 3.2;
  return { x: out.x, z: out.z, heading, speed, phase };
}
