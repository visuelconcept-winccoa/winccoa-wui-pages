// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Fleet-level aggregates derived from the live vehicle list (pure, no I/O). */
import { isAvailable, type Agv, type AgvState } from '../types.js';

const PERCENT = 100;

export interface FleetMetrics {
  /** Vehicles in the fleet. */
  total: number;
  moving: number;
  /** Idle with no order assigned — ready to take one. */
  available: number;
  charging: number;
  /** Faulted or offline — the "needs attention" count. */
  faulted: number;
  /** Mean state of charge over the fleet, percent (0 for an empty fleet). */
  avgBattery: number;
  missionsToday: number;
  /** Share of the fleet actively working (moving or loading), percent. */
  utilization: number;
}

/** Count the vehicles in a given state. */
export function countState(fleet: Agv[], state: AgvState): number {
  return fleet.filter((agv) => agv.state === state).length;
}

/** Aggregate the fleet into the figures shown by the KPI bar. */
export function fleetMetrics(fleet: Agv[]): FleetMetrics {
  const total = fleet.length;
  const working = countState(fleet, 'moving') + countState(fleet, 'loading');
  const batterySum = fleet.reduce((sum, agv) => sum + agv.battery, 0);
  return {
    total,
    moving: countState(fleet, 'moving'),
    available: fleet.filter((agv) => isAvailable(agv)).length,
    charging: countState(fleet, 'charging'),
    faulted: countState(fleet, 'error') + countState(fleet, 'offline'),
    avgBattery: total === 0 ? 0 : batterySum / total,
    missionsToday: fleet.reduce((sum, agv) => sum + agv.missionsToday, 0),
    utilization: total === 0 ? 0 : (working / total) * PERCENT
  };
}
