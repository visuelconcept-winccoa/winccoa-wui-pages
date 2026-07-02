// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Hades domain model — an integrated road-tunnel description.
 *
 * A {@link Tunnel} is the single source of truth for one tunnel: an ordered
 * list of PK-referenced {@link SegmentDef} per {@link TubeDef} (the geometry),
 * a flat list of {@link EquipmentDef} placed by PK on a tube (the plant), the
 * {@link OperatingMode}s (reflex sequences of field commands), and the
 * regulatory profile the compliance advisor checks against. Everything —
 * the 3D twin, the linear synoptic, the editor and the compliance advisor —
 * derives from this one structure, persisted as one `Hades_Tunnel` datapoint
 * (JSON) via `HadesStore`.
 *
 * PK ("point kilométrique") positions are stored in metres from the tube
 * portal at PK 0 (`pkM`). Live values (equipment `state` / `measures`) are
 * transient runtime fields excluded from persistence-relevant audits.
 */

/** Regulatory profile driving the compliance advisor (selectable per tunnel). */
export type RegulatoryProfileId = 'eu-2004-54' | 'fr-cetu' | 'ch-astra';

export type TubeDirection = 'unidirectional' | 'bidirectional';

/** CIE 88 lighting zone of a segment (drives the 3D lighting density). */
export type LightingZone = 'entrance' | 'transition' | 'interior' | 'exit';

/** One geometric stretch of a tube, ordered along the PK axis. */
export interface SegmentDef {
  id: string;
  name: string;
  /** Length along the tube axis, in metres. */
  lengthM: number;
  /** Longitudinal gradient in percent (positive = climbing). */
  gradientPct: number;
  /** Horizontal curve radius in metres; 0 = straight. Positive bends right. */
  curveRadiusM: number;
  /** Clear height (gabarit) in metres. */
  clearanceM: number;
  lightingZone: LightingZone;
}

/** One tube (bore) of the tunnel with its ordered segments. */
export interface TubeDef {
  id: string;
  name: string;
  direction: TubeDirection;
  lanes: number;
  segments: SegmentDef[];
}

/** Kinds of tunnel plant Hades knows how to place, render and bind. */
export type EquipmentKind =
  | 'jet-fan'
  | 'lighting'
  | 'sos-niche'
  | 'emergency-exit'
  | 'camera'
  | 'co-sensor'
  | 'no2-sensor'
  | 'opacity-sensor'
  | 'anemometer'
  | 'fire-detection'
  | 'vms'
  | 'lane-signal'
  | 'barrier'
  | 'pump'
  | 'power'
  | 'radio'
  | 'hydrant';

/** Where an equipment sits in the tube cross-section. */
export type EquipmentSide = 'left' | 'right' | 'ceiling' | 'roadway';

/** Role of one bindable point of an equipment type. */
export type PointRole = 'state' | 'measure' | 'command';

/**
 * One bindable point of an equipment kind (catalog level): the page binds a
 * datapoint element to each point of an instance. `state` points drive the
 * 3D/synoptic colour, `measure` points feed live value labels, `command`
 * points are written by operating modes / manual commands (dpSet, confirmed
 * and audited).
 */
export interface PointDef {
  key: string;
  label: string;
  role: PointRole;
  unit?: string;
  /** For command points: allowed values (value → label), rendered as buttons. */
  commandValues?: { value: number; label: string }[];
}

/** Catalog entry describing one equipment kind. */
export interface EquipmentTypeDef {
  kind: EquipmentKind;
  points: PointDef[];
}

/** One equipment instance placed in a tube at a PK. */
export interface EquipmentDef {
  id: string;
  name: string;
  kind: EquipmentKind;
  tubeId: string;
  /** Position in metres from the tube portal (PK 0). */
  pkM: number;
  side: EquipmentSide;
  /** point key → datapoint element name (empty = unbound). */
  bindings: Record<string, string>;
  // --- live runtime fields (driven by dpConnect, never audited) --------------
  /** Resolved state code (see STATE_*), driven by the bound `state` point. */
  state?: number;
  /** Live values of bound measure points, by point key. */
  measures?: Record<string, number>;
}

/** Equipment state codes shared with the simulator (hadesSim manager). */
export const STATE_OFF = 0;
export const STATE_RUN = 1;
export const STATE_WARNING = 2;
export const STATE_FAULT = 3;

/** One field command of an operating mode (reflex sequence step). */
export interface ModeAction {
  /** Target equipment instance. */
  equipmentId: string;
  /** Command point key on that equipment (must exist in its type). */
  pointKey: string;
  value: number;
  label: string;
}

/** Operating mode: a named, ordered reflex sequence of field commands. */
export interface OperatingMode {
  id: string;
  name: string;
  description: string;
  /** Accent used on the mode card ('normal' | 'degraded' | 'closure' | 'fire'). */
  severity: 'normal' | 'degraded' | 'closure' | 'fire';
  actions: ModeAction[];
}

/** The whole tunnel — one `Hades_Tunnel` datapoint (JSON). */
export interface Tunnel {
  id: string;
  /** Backing datapoint name (assigned by the store). */
  dp?: string;
  name: string;
  profile: RegulatoryProfileId;
  /** Average daily traffic per lane (vehicles/day), used by compliance rules. */
  trafficPerLane: number;
  /**
   * Observation (shadow/retrofit) mode: Hades reads the existing plant's
   * datapoints but NEVER writes — commands, mode engagement and archive
   * switches are disabled in the UI. The safe posture when Hades overlays an
   * in-service GTC (see docs/wui-hades/RETROFIT.md).
   */
  shadowMode?: boolean;
  tubes: TubeDef[];
  equipment: EquipmentDef[];
  modes: OperatingMode[];
}

/** Total length of a tube in metres (sum of its segments). */
export function tubeLengthM(tube: TubeDef): number {
  return tube.segments.reduce((sum, s) => sum + s.lengthM, 0);
}

/** Longest tube of the tunnel in metres (the length the regulations look at). */
export function tunnelLengthM(tunnel: Tunnel): number {
  return Math.max(0, ...tunnel.tubes.map((t) => tubeLengthM(t)));
}

/** Equipment of one tube, sorted by PK. */
export function tubeEquipment(tunnel: Tunnel, tubeId: string): EquipmentDef[] {
  return tunnel.equipment.filter((e) => e.tubeId === tubeId).sort((a, b) => a.pkM - b.pkM);
}

/** "PK 1+250" style label for a metre position. */
export function pkLabel(pkM: number): string {
  const km = Math.floor(pkM / 1000);
  const m = Math.round(pkM - km * 1000);
  return `PK ${km}+${String(m).padStart(3, '0')}`;
}

/** Theme-token colour for an equipment state code. */
export function stateColor(state: number | undefined): string {
  switch (state) {
    case STATE_RUN:
      return 'var(--theme-color-success)';
    case STATE_WARNING:
      return 'var(--theme-color-warning)';
    case STATE_FAULT:
      return 'var(--theme-color-alarm)';
    default:
      return 'var(--theme-color-neutral)';
  }
}
