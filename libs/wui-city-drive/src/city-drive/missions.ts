// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Missions of City Drive (#79). Pure state machine, no three.js.
 *
 * - delivery: drive to the pick-up point, then to the drop point, before the timer ends;
 * - intervention: a machine of the plant is in fault (its bound datapoint, bindings.ts): drive
 *   to its hall. Interventions come first: one is offered as soon as a machine fails.
 */
import { CELL, frontOf, rng, type City } from './city.js';

export type MissionKind = 'delivery' | 'intervention';
export type MissionStage = 'pickup' | 'drop' | 'reach' | 'done' | 'failed';

export interface Point {
  x: number;
  z: number;
}

export interface Mission {
  id: number;
  kind: MissionKind;
  stage: MissionStage;
  /** Current target of the stage. */
  target: Point;
  /** Drop point (delivery). */
  drop?: Point;
  /** Machine building id (intervention). */
  machine?: string;
  /** Seconds left; Infinity for an intervention. */
  timeLeft: number;
  reward: number;
}

export const REACH_RADIUS = 9;
const INTERVENTION_REWARD = 500;

function roadPointOfBuilding(city: City, rand: () => number): Point {
  const ordinary = city.buildings.filter((b) => !b.machine);
  return frontOf(city, ordinary[Math.floor(rand() * ordinary.length)]);
}

export function newDelivery(city: City, from: Point, id: number, seed: number): Mission {
  const rand = rng(seed);
  let pickup = roadPointOfBuilding(city, rand);
  let drop = roadPointOfBuilding(city, rand);
  for (let k = 0; k < 8 && Math.hypot(drop.x - pickup.x, drop.z - pickup.z) < 2 * CELL; k++) drop = roadPointOfBuilding(city, rand);
  for (let k = 0; k < 8 && Math.hypot(pickup.x - from.x, pickup.z - from.z) < CELL; k++) pickup = roadPointOfBuilding(city, rand);
  // Manhattan distance at ~14 m/s, plus a margin
  const dist = Math.abs(pickup.x - from.x) + Math.abs(pickup.z - from.z) + Math.abs(drop.x - pickup.x) + Math.abs(drop.z - pickup.z);
  return {
    id,
    kind: 'delivery',
    stage: 'pickup',
    target: pickup,
    drop,
    timeLeft: Math.round(dist / 14 + 25),
    reward: Math.round(100 + dist / 4)
  };
}

export function newIntervention(city: City, machineId: string, id: number): Mission | null {
  const hall = city.buildings.find((b) => b.id === machineId);
  if (!hall) return null;
  return { id, kind: 'intervention', stage: 'reach', target: frontOf(city, hall), machine: machineId, timeLeft: Infinity, reward: INTERVENTION_REWARD };
}

export interface MissionStep {
  mission: Mission;
  /** Points won at this step (stage reached), 0 otherwise. */
  gained: number;
  /** A stage was reached / the mission ended at this step. */
  event: 'pickup' | 'done' | 'failed' | null;
}

/** Advances a mission by `dt` with the player at `p`. */
export function stepMission(m: Mission, p: Point, dt: number): MissionStep {
  if (m.stage === 'done' || m.stage === 'failed') return { mission: m, gained: 0, event: null };
  const timeLeft = m.timeLeft - dt;
  if (timeLeft <= 0) return { mission: { ...m, timeLeft: 0, stage: 'failed' }, gained: 0, event: 'failed' };
  const reached = Math.hypot(p.x - m.target.x, p.z - m.target.z) <= REACH_RADIUS;
  if (!reached) return { mission: { ...m, timeLeft }, gained: 0, event: null };
  if (m.stage === 'pickup' && m.drop) {
    return { mission: { ...m, timeLeft, stage: 'drop', target: m.drop }, gained: 0, event: 'pickup' };
  }
  const bonus = Number.isFinite(timeLeft) ? Math.round(timeLeft * 2) : 0;
  return { mission: { ...m, timeLeft, stage: 'done' }, gained: m.reward + bonus, event: 'done' };
}

/** An intervention is pointless once its machine is no longer in fault. */
export function cancelIfRepaired(m: Mission, faulted: ReadonlySet<string>): Mission {
  if (m.kind !== 'intervention' || m.stage !== 'reach' || !m.machine) return m;
  return faulted.has(m.machine) ? m : { ...m, stage: 'failed' };
}
