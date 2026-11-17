// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Arcade car physics of City Drive (#79): hand-written, no physics library. Pure.
 *
 * The car moves on the XZ plane; `heading` 0 faces +Z, forward = (sin h, cos h). Its velocity
 * is split into a forward and a lateral part: the lateral part is damped by the tyres' grip
 * (low with the handbrake → drift). Collisions: a circle against the buildings' boxes and the
 * city's bounds; an impact returns its strength.
 */
import type { Box } from './city.js';

export interface CarState {
  x: number;
  z: number;
  heading: number;
  /** Velocity (m/s) in world axes. */
  vx: number;
  vz: number;
  /** Fuel, 0..1. */
  fuel: number;
}

export interface CarInput {
  /** -1 (brake / reverse) .. 1 (throttle). */
  throttle: number;
  /** -1 (left) .. 1 (right). */
  steer: number;
  handbrake: boolean;
}

/** Performance of a vehicle (vehicles.ts holds the choice offered to the player). */
export interface CarSpec {
  radius: number;
  wheelBase: number;
  engine: number;
  brake: number;
  reverse: number;
  maxSpeed: number;
  maxReverse: number;
  drag: number;
  rolling: number;
  maxSteer: number;
  grip: number;
  driftGrip: number;
  fuelPerSecond: number;
  idleFuelPerSecond: number;
  emptySpeed: number;
}

export const CAR: CarSpec = {
  radius: 2.2,
  wheelBase: 2.7,
  engine: 14, // m/s²
  brake: 26,
  reverse: 6,
  maxSpeed: 48, // m/s ≈ 173 km/h
  maxReverse: 10,
  drag: 0.0028, // · v²
  rolling: 1.2, // m/s²
  maxSteer: 0.6, // rad
  grip: 9, // lateral damping (1/s)
  driftGrip: 1.6,
  fuelPerSecond: 1 / 300, // full throttle: 5 min
  idleFuelPerSecond: 1 / 3000,
  emptySpeed: 6 // m/s: crawl home on an empty tank
};

export function newCar(x: number, z: number, heading = 0): CarState {
  return { x, z, heading, vx: 0, vz: 0, fuel: 1 };
}

/** Signed speed along the heading (m/s; < 0 when reversing). */
export function forwardSpeed(c: CarState): number {
  return c.vx * Math.sin(c.heading) + c.vz * Math.cos(c.heading);
}

/** Share of the engine left on an empty tank (it was none: the car stayed stuck). */
const EMPTY_PULL = 0.3;

function longitudinal(v: number, input: CarInput, fuel: number, spec: CarSpec): number {
  let a = 0;
  // an empty tank leaves a weak reserve: the car crawls (up to emptySpeed) to the station
  const pull = fuel > 0 ? 1 : EMPTY_PULL;
  if (input.throttle > 0) a = input.throttle * spec.engine * pull;
  else if (input.throttle < 0) a = v > 0.5 ? input.throttle * spec.brake : input.throttle * spec.reverse * pull;
  a -= Math.sign(v) * (spec.rolling + spec.drag * v * v);
  if (input.handbrake) a -= Math.sign(v) * spec.brake * 0.35;
  return a;
}

/** One physics step of `dt` seconds. */
export function stepCar(c: CarState, input: CarInput, dt: number, spec: CarSpec = CAR): CarState {
  const fx = Math.sin(c.heading);
  const fz = Math.cos(c.heading);
  let vf = c.vx * fx + c.vz * fz; // forward
  let vl = c.vx * fz - c.vz * fx; // lateral (to the right)

  const vfNew = vf + longitudinal(vf, input, c.fuel, spec) * dt;
  // friction must stop the car, not reverse it
  vf = Math.sign(vfNew) !== Math.sign(vf) && vf !== 0 && Math.abs(input.throttle) < 0.01 ? 0 : vfNew;
  const top = c.fuel > 0 ? spec.maxSpeed : spec.emptySpeed;
  vf = Math.max(-spec.maxReverse, Math.min(top, vf));

  // steering: bicycle model, less lock at high speed
  const lock = spec.maxSteer * input.steer * (1 / (1 + Math.abs(vf) / 30));
  const yawRate = (vf / spec.wheelBase) * Math.tan(lock);
  // steer > 0 turns right: facing +Z, the right is -X, i.e. a decreasing heading
  const heading = c.heading - yawRate * dt;

  const grip = input.handbrake ? spec.driftGrip : spec.grip;
  vl *= Math.max(0, 1 - grip * dt);

  // velocity back to world axes, around the NEW heading: the car turns, the slide remains
  const nx = Math.sin(heading);
  const nz = Math.cos(heading);
  const vx = vf * nx + vl * nz;
  const vz = vf * nz - vl * nx;
  const burn = Math.max(0, input.throttle) * spec.fuelPerSecond + spec.idleFuelPerSecond;
  return {
    x: c.x + vx * dt,
    z: c.z + vz * dt,
    heading,
    vx,
    vz,
    fuel: Math.max(0, c.fuel - burn * dt)
  };
}

/**
 * Pushes the car out of the boxes it overlaps and out of the bounds, cancelling the velocity
 * into the obstacle. Returns the car and the impact speed (m/s, 0 when nothing was hit).
 */
export function collide(c: CarState, boxes: readonly Box[], bounds: Box, restitution = 0.25, r = CAR.radius): { car: CarState; impact: number } {
  let { x, z, vx, vz } = c;
  let impact = 0;
  for (const b of boxes) {
    if (x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r) continue;
    const px = Math.min(b.x1, Math.max(b.x0, x));
    const pz = Math.min(b.z1, Math.max(b.z0, z));
    let dx = x - px;
    let dz = z - pz;
    let d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d === 0) {
      // centre inside the box: out by the nearest face
      const faces = [x - b.x0, b.x1 - x, z - b.z0, b.z1 - z];
      const k = faces.indexOf(Math.min(...faces));
      dx = k === 0 ? -1 : k === 1 ? 1 : 0;
      dz = k === 2 ? -1 : k === 3 ? 1 : 0;
      d = 0;
      x = k === 0 ? b.x0 - r : k === 1 ? b.x1 + r : x;
      z = k === 2 ? b.z0 - r : k === 3 ? b.z1 + r : z;
    } else {
      dx /= d;
      dz /= d;
      x = px + dx * r;
      z = pz + dz * r;
    }
    const vn = vx * dx + vz * dz;
    if (vn < 0) {
      impact = Math.max(impact, -vn);
      vx -= (1 + restitution) * vn * dx;
      vz -= (1 + restitution) * vn * dz;
    }
  }
  if (x < bounds.x0 || x > bounds.x1) {
    impact = Math.max(impact, Math.abs(vx));
    x = Math.min(bounds.x1, Math.max(bounds.x0, x));
    vx = -vx * restitution;
  }
  if (z < bounds.z0 || z > bounds.z1) {
    impact = Math.max(impact, Math.abs(vz));
    z = Math.min(bounds.z1, Math.max(bounds.z0, z));
    vz = -vz * restitution;
  }
  return { car: { ...c, x, z, vx, vz }, impact };
}

/** Two cars (circles) hitting each other: separated, the player's velocity reflected. */
export function collideCars(c: CarState, ox: number, oz: number, oRadius: number, radius = CAR.radius): { car: CarState; impact: number } {
  const dx = c.x - ox;
  const dz = c.z - oz;
  const d = Math.hypot(dx, dz);
  const min = radius + oRadius;
  if (d >= min || d === 0) return { car: c, impact: 0 };
  const nx = dx / d;
  const nz = dz / d;
  const vn = c.vx * nx + c.vz * nz;
  const car = { ...c, x: ox + nx * min, z: oz + nz * min };
  if (vn >= 0) return { car, impact: 0 };
  return { car: { ...car, vx: c.vx - 1.4 * vn * nx, vz: c.vz - 1.4 * vn * nz }, impact: -vn };
}
