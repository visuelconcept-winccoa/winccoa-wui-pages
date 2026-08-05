// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * In-browser demo fleet, used when no `AGV_Vehicle` datapoint exists (or the
 * backend is unreachable). It mirrors the datapoints the page provisions on a
 * demo project, so the layout, KPI bar and floor plan look identical whether the
 * values come from WinCC OA or from here.
 *
 * {@link driftDemoFleet} advances the simulation one tick — enough movement for a
 * live-looking demo without a CTRL/JS simulation manager on the backend.
 */
import { FLOOR_HEIGHT_M, FLOOR_WIDTH_M, type Agv } from '../types.js';

/** Simulation tick, ms — matches the refresh cadence of a real fleet gateway. */
export const DEMO_TICK_MS = 1500;

const FULL_CIRCLE_DEG = 360;
const HALF_CIRCLE_DEG = 180;
const MS_PER_SECOND = 1000;
const BATTERY_FULL_PCT = 100;
/** Floor of the simulated drain, so a demo left running never flatlines. */
const BATTERY_DEMO_FLOOR_PCT = 18;
/** Battery drained per tick while driving / regained while charging, percent. */
const DRAIN_PER_TICK = 0.12;
const CHARGE_PER_TICK = 0.6;
/** Margin kept between a moving vehicle and the hall walls, metres. */
const WALL_MARGIN_M = 1.5;

/** Vehicle models in the demo fleet. */
const MODEL_TUGGER = 'Tugger T200';
const MODEL_FORKLIFT = 'Forklift F450';
const MODEL_TUNNEL = 'Tunnel U150';

export const DEMO_FLEET: Agv[] = [
  {
    id: 'AGV_01',
    dp: 'AGV_01',
    name: 'AGV-01 Atlas',
    model: MODEL_TUGGER,
    state: 'moving',
    battery: 82.4,
    speed: 1.25,
    posX: 14.5,
    posY: 8.2,
    heading: 90,
    zone: 'Aisle A',
    mission: 'MO-4471 → Pick station P3',
    payload: 'Pallet PL-2210',
    errorText: '',
    odometer: 1284.6,
    missionsToday: 37
  },
  {
    id: 'AGV_02',
    dp: 'AGV_02',
    name: 'AGV-02 Boreas',
    model: MODEL_TUGGER,
    state: 'charging',
    battery: 34.1,
    speed: 0,
    posX: 2,
    posY: 22.5,
    heading: 180,
    zone: 'Charging bay C1',
    mission: '',
    payload: '',
    errorText: '',
    odometer: 2044.9,
    missionsToday: 21
  },
  {
    id: 'AGV_03',
    dp: 'AGV_03',
    name: 'AGV-03 Cyclops',
    model: MODEL_FORKLIFT,
    state: 'loading',
    battery: 66.8,
    speed: 0.15,
    posX: 26,
    posY: 15,
    heading: 0,
    zone: 'Rack R12',
    mission: 'MO-4468 → Store LOC-B-14-3',
    payload: 'Pallet PL-2198',
    errorText: '',
    odometer: 3711.2,
    missionsToday: 29
  },
  {
    id: 'AGV_04',
    dp: 'AGV_04',
    name: 'AGV-04 Dorado',
    model: MODEL_FORKLIFT,
    state: 'error',
    battery: 58.3,
    speed: 0,
    posX: 19.5,
    posY: 29,
    heading: 270,
    zone: 'Aisle D',
    mission: 'MO-4470 → Pick station P1',
    payload: 'Pallet PL-2205',
    errorText: 'E-312 Obstacle detected — path blocked',
    odometer: 2890.4,
    missionsToday: 14
  },
  {
    id: 'AGV_05',
    dp: 'AGV_05',
    name: 'AGV-05 Echo',
    model: MODEL_TUGGER,
    state: 'idle',
    battery: 91.7,
    speed: 0,
    posX: 6.5,
    posY: 4,
    heading: 45,
    zone: 'Parking Z0',
    mission: '',
    payload: '',
    errorText: '',
    odometer: 954.3,
    missionsToday: 8
  },
  {
    id: 'AGV_06',
    dp: 'AGV_06',
    name: 'AGV-06 Fenrir',
    model: MODEL_TUNNEL,
    state: 'moving',
    battery: 47.9,
    speed: 1.6,
    posX: 32.5,
    posY: 24,
    heading: 315,
    zone: 'Aisle E',
    mission: 'MO-4473 → Outbound dock D2',
    payload: 'Cart CT-118',
    errorText: '',
    odometer: 1620.8,
    missionsToday: 33
  },
  {
    id: 'AGV_07',
    dp: 'AGV_07',
    name: 'AGV-07 Gale',
    model: MODEL_TUNNEL,
    state: 'offline',
    battery: 12.6,
    speed: 0,
    posX: 3.5,
    posY: 26,
    heading: 180,
    zone: 'Maintenance M1',
    mission: '',
    payload: '',
    errorText: 'Offline — scheduled maintenance (drive wheel)',
    odometer: 4102.5,
    missionsToday: 0
  },
  {
    id: 'AGV_08',
    dp: 'AGV_08',
    name: 'AGV-08 Hyperion',
    model: MODEL_FORKLIFT,
    state: 'moving',
    battery: 73.2,
    speed: 0.95,
    posX: 22,
    posY: 6.5,
    heading: 270,
    zone: 'Aisle B',
    mission: 'MO-4474 → Inbound dock D1',
    payload: '',
    errorText: '',
    odometer: 2260.1,
    missionsToday: 26
  }
];

/**
 * Advance the demo fleet one tick: moving vehicles travel along their heading
 * (bouncing off the hall walls) and drain, charging vehicles refill. Faulted and
 * offline vehicles stay put — the demo keeps a stable "needs attention" set.
 */
export function driftDemoFleet(fleet: Agv[]): Agv[] {
  return fleet.map((agv) => {
    if (agv.state === 'charging') {
      return {
        ...agv,
        battery: Math.min(BATTERY_FULL_PCT, agv.battery + CHARGE_PER_TICK)
      };
    }
    if (agv.state !== 'moving') return agv;
    const tickSeconds = DEMO_TICK_MS / MS_PER_SECOND;
    const radians = (agv.heading * Math.PI) / HALF_CIRCLE_DEG;
    const nextX = agv.posX + Math.sin(radians) * agv.speed * tickSeconds;
    const nextY = agv.posY - Math.cos(radians) * agv.speed * tickSeconds;
    const bounced =
      nextX < WALL_MARGIN_M ||
      nextX > FLOOR_WIDTH_M - WALL_MARGIN_M ||
      nextY < WALL_MARGIN_M ||
      nextY > FLOOR_HEIGHT_M - WALL_MARGIN_M;
    const battery = Math.max(
      BATTERY_DEMO_FLOOR_PCT,
      agv.battery - DRAIN_PER_TICK
    );
    if (bounced) {
      // Turn around rather than drive through a wall.
      return {
        ...agv,
        battery,
        heading: (agv.heading + HALF_CIRCLE_DEG) % FULL_CIRCLE_DEG
      };
    }
    return { ...agv, battery, posX: nextX, posY: nextY };
  });
}
