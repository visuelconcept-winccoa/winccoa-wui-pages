// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domain model of the AGV Fleet page.
 *
 * One vehicle = one WinCC OA datapoint of type `AGV_Vehicle` (a Struct whose
 * elements map 1:1 onto {@link Agv}). The `state` element is an Int whose value
 * indexes {@link AGV_STATES} — keeping the wire format a plain enum ordinal, the
 * way a PLC / fleet-manager gateway would publish it.
 */

/** Operating state of a vehicle, in the order the OA `state` Int encodes it. */
export const AGV_STATES = [
  'idle',
  'moving',
  'charging',
  'loading',
  'error',
  'offline'
] as const;

export type AgvState = (typeof AGV_STATES)[number];

/** Fallback for a `state` value outside the encoded range. */
export const UNKNOWN_STATE: AgvState = 'offline';

/** One vehicle, flattened from its `AGV_Vehicle` datapoint. */
export interface Agv {
  /** Stable id — the bare datapoint name (`AGV_01`). */
  id: string;
  /** Backing datapoint (bare name, no system prefix). */
  dp: string;
  name: string;
  model: string;
  state: AgvState;
  /** State of charge, percent. */
  battery: number;
  /** Ground speed, m/s. */
  speed: number;
  /** Position on the floor plan, metres. */
  posX: number;
  posY: number;
  /** Travel direction, degrees clockwise from north. */
  heading: number;
  zone: string;
  /** Current transport order, empty when the vehicle is unassigned. */
  mission: string;
  /** Carried load id, empty when running light. */
  payload: string;
  /** Fault / maintenance text, empty when healthy. */
  errorText: string;
  /** Lifetime distance, km. */
  odometer: number;
  missionsToday: number;
}

/** Datapoint elements read for each vehicle — the field order drives the DPE list. */
export const AGV_ELEMENTS = [
  'name',
  'model',
  'state',
  'battery',
  'speed',
  'posX',
  'posY',
  'heading',
  'zone',
  'mission',
  'payload',
  'errorText',
  'odometer',
  'missionsToday'
] as const satisfies readonly (keyof Agv)[];

export type AgvElement = (typeof AGV_ELEMENTS)[number];

/** WinCC OA datapoint type holding one vehicle. */
export const AGV_DP_TYPE = 'AGV_Vehicle';

/** Floor-plan extent in metres — the coordinate space `posX` / `posY` live in. */
export const FLOOR_WIDTH_M = 36;
export const FLOOR_HEIGHT_M = 32;

/** Battery thresholds (percent) driving the low / critical colouring. */
export const BATTERY_LOW_PCT = 35;
export const BATTERY_CRITICAL_PCT = 15;

/**
 * iX theme token used to colour each state, in lists, chips and map markers.
 *
 * Every value must stay legible as a *marker fill* on the floor plan, so none of
 * them may be a component-background token (`--theme-color-component-1` is
 * near-black in the dark theme — an offline vehicle drawn in it disappeared into
 * the racking, which is filled from the same family).
 */
export const STATE_COLORS: Record<AgvState, string> = {
  idle: 'var(--theme-color-neutral)',
  moving: 'var(--theme-color-success)',
  charging: 'var(--theme-color-information)',
  loading: 'var(--theme-color-warning)',
  error: 'var(--theme-color-alarm)',
  offline: 'var(--theme-color-soft-text)'
};

/** iX icon shown next to each state. */
export const STATE_ICONS: Record<AgvState, string> = {
  idle: 'pause',
  moving: 'truck',
  charging: 'battery-charge',
  loading: 'upload',
  error: 'error',
  offline: 'disconnected'
};

/** A vehicle with no order assigned that could take one. */
export function isAvailable(agv: Agv): boolean {
  return agv.state === 'idle' && agv.mission === '';
}

/** True when the vehicle needs attention — faulted, offline or critically low. */
export function needsAttention(agv: Agv): boolean {
  return (
    agv.state === 'error' ||
    agv.state === 'offline' ||
    agv.battery < BATTERY_CRITICAL_PCT
  );
}

/** Clamp a percentage into the 0–100 range a gauge bar can render. */
export function clampPercent(value: number): number {
  const full = 100;
  return Math.max(0, Math.min(value, full));
}

/** Battery bucket used for colouring the charge bar. */
export function batteryLevel(battery: number): 'ok' | 'low' | 'critical' {
  if (battery < BATTERY_CRITICAL_PCT) return 'critical';
  if (battery < BATTERY_LOW_PCT) return 'low';
  return 'ok';
}

/** iX battery icon matching the current charge. */
export function batteryIcon(battery: number): string {
  const level = batteryLevel(battery);
  if (level === 'critical') return 'battery-empty';
  if (level === 'low') return 'battery-quarter';
  return 'battery-full';
}

/** Decode the OA `state` Int into an {@link AgvState}. */
export function decodeState(raw: number): AgvState {
  return AGV_STATES[raw] ?? UNKNOWN_STATE;
}

/** One leg of a mission, as published in the manager's mission book. */
export interface MissionLegRow {
  label: string;
  action: string;
  done: boolean;
  active: boolean;
}

/**
 * One row of the mission book published by the `agvSim` manager on
 * `AGV_MissionBook.json` — one per vehicle, including the vehicles that
 * currently hold no order (`id` empty).
 */
export interface MissionRow {
  vehicle: string;
  vehicleName: string;
  state: AgvState;
  /** Out of service — faulted or offline; not dispatchable. */
  parked: boolean;
  battery: number;
  zone: string;
  /** Order id, empty when the vehicle has no mission. */
  id: string;
  kind: string;
  load: string;
  legIndex: number;
  legCount: number;
  legs: MissionLegRow[];
  /** Distance left on the current leg, metres. */
  remainingM: number;
}

/** An empty vehicle record — the base every DP read is merged onto. */
export function blankAgv(id: string): Agv {
  return {
    id,
    dp: id,
    name: id,
    model: '',
    state: UNKNOWN_STATE,
    battery: 0,
    speed: 0,
    posX: 0,
    posY: 0,
    heading: 0,
    zone: '',
    mission: '',
    payload: '',
    errorText: '',
    odometer: 0,
    missionsToday: 0
  };
}
