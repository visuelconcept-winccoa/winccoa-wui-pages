// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared types for the Machine Fleet 3D standalone page.
 *
 * Ported from the `atelier-3d-v38.html` prototype (Jumeau Numérique).
 * The prototype's loose `machines[]`/`B`/`zone.userData` shapes are formalised
 * here so the Lit page, the Three.js scene modules, and the integrated config
 * UI share one typed contract.
 */
import type { Group, PointLight } from 'three';

/** The four states every mapping knows when it declares no state list of its own. */
export type BuiltinState = 'ok' | 'warn' | 'stop' | 'maint';

/**
 * Operational state of a machine or zone (drives status colour): one of the built-in
 * states, or the key of a state a mapping declares (`StateMapping.states`).
 */
export type MachineState = BuiltinState | (string & {});

/** Building roof construction (`none` = no roof). */
export type RoofType = 'shed' | 'flat' | 'monoslope' | 'none';

/** Procedural floor pattern keys (see floor-patterns.ts). */
export type FloorType =
  | 'concrete'
  | 'smooth-concrete'
  | 'polished-concrete'
  | 'concrete-white'
  | 'epoxy-blue'
  | 'epoxy-grey'
  | 'epoxy-green'
  | 'epoxy-red'
  | 'epoxy-yellow'
  | 'checkered-floor'
  | 'tiles-white'
  | 'asphalt'
  | 'diamond-plate'
  | 'metal-grating'
  | 'safety-zone'
  | 'graphite-resin'
  | 'light-pu-lanes'
  | 'large-porcelain'
  | 'raised-access'
  | 'hex-tiles'
  | 'micro-terrazzo'
  | 'microcement-dark';

/** Machine geometry kinds the factory can build. */
export type MachineType =
  | 'four'
  | 'robot'
  | 'positionneur'
  | 'tour'
  | 'fraiseuse'
  | 'scie'
  | 'brocheuse'
  | 'ressuage'
  | 'portique'
  | 'portique-table'
  | 'basculeur'
  | 'cabinet'
  | 'billboard'
  | 'glb';

/** Gantry (portique) span presets, in metres — used as `MachineDef.variant`. */
export type PortiqueSize = 'XS' | 'S' | 'M' | 'L' | 'XL';

/**
 * Process family of a machine — drives the domain parameters the simulator
 * emits and binds (usinage = machining; soudage = welding; generic = the
 * default set). When unset, the family is derived from the machine `type`
 * ({@link resolveProcess}).
 */
export type MachineProcess = 'generic' | 'usinage' | 'soudage';

export const MACHINE_PROCESS_LABEL: Record<MachineProcess, string> = {
  generic: 'Générique',
  usinage: 'Usinage',
  soudage: 'Soudage'
};

/** Geometric machine types that default to the `usinage` (machining) family. */
const USINAGE_TYPES = new Set<MachineType>(['tour', 'fraiseuse', 'brocheuse', 'scie']);

/** Resolve a machine's process family: explicit `process`, else derived from type. */
export function resolveProcess(m: { type: MachineType; process?: MachineProcess }): MachineProcess {
  if (m.process) return m.process;
  return USINAGE_TYPES.has(m.type) ? 'usinage' : 'generic';
}

/** TRS sliding-window aggregation period. */
export type TrsWindow = '1h' | '8h' | '12h' | '24h' | '1w' | '1mo';

/** TRS aggregation window → length in milliseconds. */
export const TRS_WINDOW_MS: Record<TrsWindow, number> = {
  '1h': 3_600_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '24h': 86_400_000,
  '1w': 604_800_000,
  '1mo': 2_592_000_000
};

/** Human-readable French labels for the TRS aggregation windows. */
export const TRS_WINDOW_LABELS: Record<TrsWindow, string> = {
  '1h': '1 heure',
  '8h': '8 heures',
  '12h': '12 heures',
  '24h': '24 heures',
  '1w': '1 semaine',
  '1mo': '1 mois'
};

export const DEFAULT_TRS_WINDOW: TrsWindow = '24h';

/** Default TRS recompute period, in minutes (sliding-window refresh frequency). */
export const DEFAULT_TRS_REFRESH_MIN = 5;

/** Computed-KPI type (drives the formula). */
export type KpiType = 'TRS' | 'MTBF' | 'MTTR';

/** Human-readable labels + unit per KPI type. */
export const KPI_TYPE_INFO: Record<KpiType, { label: string; unit: string }> = {
  TRS: { label: 'TRS (disponibilité)', unit: '%' },
  MTBF: { label: 'MTBF (temps moyen entre pannes)', unit: 'min' },
  MTTR: { label: 'MTTR (temps moyen de réparation)', unit: 'min' }
};

/**
 * One configured real-time KPI for a machine. The server-side `kpiCalc` manager
 * computes it over `window` every `refreshMin` minutes and writes the result to
 * a `MachineFleet3D_Kpi` datapoint (whose `value` is NGA-archived for trending).
 */
export interface MachineKpi {
  /** Stable id (used in the DP name) — keep across edits. */
  id: string;
  type: KpiType;
  /** Sliding aggregation window. */
  window: TrsWindow;
  /** Refresh period in minutes (how often the manager recomputes/writes). */
  refreshMin: number;
  /** Optional display name (defaults to the type label). */
  label?: string;
  /** Show this KPI in the 3D bubble. */
  showInBubble?: boolean;
  /** Show this KPI in the detail popup (machine click). Default true. */
  showInPopup?: boolean;
  /** Id of the {@link TrsThresholds} config used to colour the value (TRS). */
  thresholdId?: string;
  /** NGA-archive the computed value (for trending). Default true. */
  archive?: boolean;
  /** NGA archive group (`_NGA_Group`) for the archived value; defaults to the first discovered group. */
  archiveGroup?: string;
}

/** One TRS colour band: values `>= min` (%) up to the next rule use `color`. */
export interface TrsThresholdRule {
  /** Lower bound of the band, in percent [0..100]. */
  min: number;
  /** `#RRGGBB` colour applied to TRS values in this band. */
  color: string;
  /** Optional band label (e.g. "Bon", "Critique"). */
  label?: string;
}

/** A named, shareable TRS threshold config (colour rules by value band). */
export interface TrsThresholds {
  id: string;
  name: string;
  /** Bands; the highest `min` not exceeding the value wins. */
  rules: TrsThresholdRule[];
}

/** Colour used when no band matches / no threshold config is assigned. */
export const DEFAULT_TRS_THRESHOLD_COLOR = '#9aa1ad';

export const DEFAULT_TRS_THRESHOLDS: TrsThresholds[] = [
  {
    id: 'default',
    name: 'Standard (≥ 90 vert, ≥ 75 orange, sinon rouge)',
    rules: [
      { min: 0, color: '#ef4444', label: 'Critique' },
      { min: 75, color: '#f59e0b', label: 'Moyen' },
      { min: 90, color: '#10b981', label: 'Bon' }
    ]
  }
];

/** Resolve a TRS percentage [0..100] to its band colour (highest matching min). */
export function resolveTrsColor(thresholds: TrsThresholds | undefined, pct: number): string {
  if (!thresholds || thresholds.rules.length === 0) return DEFAULT_TRS_THRESHOLD_COLOR;
  let best: TrsThresholdRule | undefined;
  for (const rule of thresholds.rules) {
    if (pct >= rule.min && (best === undefined || rule.min > best.min)) best = rule;
  }
  return best?.color ?? DEFAULT_TRS_THRESHOLD_COLOR;
}

export const PORTIQUE_SPANS: Record<PortiqueSize, number> = {
  XS: 3,
  S: 5,
  M: 8,
  L: 11,
  XL: 15
};

/** State → colour mapping (hex strings, also usable as CSS variables). */
export const STATE_COLORS: Record<BuiltinState, string> = {
  ok: '#10b981',
  warn: '#ef4444',
  stop: '#f59e0b',
  maint: '#3b82f6'
};

/** Human-readable French state labels (for badges, chips, tooltips). */
export const STATE_LABELS: Record<BuiltinState, string> = {
  ok: 'Production',
  warn: 'Défaut',
  stop: 'Arrêt',
  maint: 'Maintenance'
};

/** Badge label / colour for a machine whose communication is down. */
export const DISCONNECTED_LABEL = 'Non connectée';
export const DISCONNECTED_COLOR = '#8B5CF6';

/** Colour key: a machine state, or the "not connected" overlay. */
export type StateColorKey = MachineState | 'disconnected';

/** Default colour per state/overlay (used when a mapping has no override). */
export const DEFAULT_STATE_COLOR_MAP: Record<BuiltinState | 'disconnected', string> = {
  ...STATE_COLORS,
  disconnected: DISCONNECTED_COLOR
};

/** French labels for the colour-config rows in the mapping dialog. */
export const STATE_COLOR_LABELS: Record<BuiltinState | 'disconnected', string> = {
  ok: 'Production',
  warn: 'Défaut',
  stop: 'Arrêt',
  maint: 'Maintenance',
  disconnected: 'Non connectée'
};

export const STATE_COLOR_KEYS: StateColorKey[] = ['ok', 'warn', 'stop', 'maint', 'disconnected'];

/** Colour of a state no mapping describes. */
export const UNKNOWN_STATE_COLOR = '#9ca3af';

/** The four built-in states, in display order ('ok' is the producing one). */
export const BUILTIN_STATES: StateDef[] = [
  { key: 'ok', label: STATE_LABELS.ok, color: STATE_COLORS.ok, running: true },
  { key: 'warn', label: STATE_LABELS.warn, color: STATE_COLORS.warn },
  { key: 'stop', label: STATE_LABELS.stop, color: STATE_COLORS.stop },
  { key: 'maint', label: STATE_LABELS.maint, color: STATE_COLORS.maint }
];

/** States of a mapping, in display order: its own list, else the built-in four (colours resolved). */
export function mappingStates(mapping: StateMapping | undefined): StateDef[] {
  const own = mapping?.states?.length ? mapping.states : BUILTIN_STATES;
  return own.map((s) => ({ ...s, color: mapping?.colors?.[s.key] ?? s.color }));
}

/** The state of that key in a mapping, if the mapping knows it. */
export function stateDef(mapping: StateMapping | undefined, key: string): StateDef | undefined {
  return mappingStates(mapping).find((s) => s.key === key);
}

/** Label of a state: the mapping's, else the built-in label, else the key itself. */
export function stateLabel(mapping: StateMapping | undefined, key: string): string {
  return stateDef(mapping, key)?.label ?? STATE_LABELS[key as BuiltinState] ?? key;
}

/** True when the machine counts as producing in that state ('ok' unless the mapping says otherwise). */
export function isRunningState(mapping: StateMapping | undefined, key: string): boolean {
  // A mapping with its own states: producing is only what it marks so ('ok' means nothing there).
  if (mapping?.states?.length) return Boolean(mapping.states.find((s) => s.key === key)?.running);
  return key === 'ok';
}

/** True when the time spent in that state is taken out of the opening time (see StateDef.outsideOpening). */
export function isOutsideOpening(mapping: StateMapping | undefined, key: string): boolean {
  const def = mapping?.states?.find((s) => s.key === key);
  return Boolean(def?.outsideOpening && !def.running);
}

/** Resolve one state/overlay colour for a mapping (its override, else its state's, else default). */
export function stateColor(mapping: StateMapping | undefined, key: StateColorKey): string {
  return mapping?.colors?.[key] ?? mapping?.states?.find((s) => s.key === key)?.color
    ?? DEFAULT_STATE_COLOR_MAP[key as BuiltinState | 'disconnected'] ?? UNKNOWN_STATE_COLOR;
}

/** Resolve the full colour map for a mapping (every state it knows + the overlay), for the scene/labels. */
export function resolveStateColors(mapping: StateMapping | undefined): Record<StateColorKey, string> {
  const out: Record<string, string> = {};
  for (const s of mappingStates(mapping)) out[s.key] = s.color;
  out['disconnected'] = stateColor(mapping, 'disconnected');
  return out;
}

/**
 * States across all the mappings of an atelier, in order and without duplicates (the first
 * mapping that declares a key wins) — what an atelier-wide legend or count shows.
 */
export function atelierStates(mappings: StateMapping[] | undefined): StateDef[] {
  const out: StateDef[] = [];
  for (const mp of mappings?.length ? mappings : [undefined]) {
    for (const s of mappingStates(mp)) if (!out.some((o) => o.key === s.key)) out.push(s);
  }
  return out;
}

/** Resolve a communication datapoint value (bool or int) to a connected flag. */
export function resolveConnected(raw: unknown): boolean {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v === 'boolean') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n > 0 : Boolean(v);
}

/** True when a comm datapoint is bound and reports the machine as down. */
export function isDisconnected(m: { commDp?: string; connected?: boolean }): boolean {
  return m.commDp != null && m.commDp !== '' && m.connected === false;
}

export const STATE_HEX: Record<BuiltinState, number> = {
  ok: 0x10_B9_81,
  warn: 0xF5_9E_0B,
  stop: 0xEF_44_44,
  maint: 0x3B_82_F6
};

/** A single KPI parameter bound to a machine. `value` is pushed at runtime. */
export interface Kpi {
  key: string;
  label: string;
  /** Bound datapoint element, e.g. "System1:Pump1.value". */
  dp?: string;
  value?: number | string;
  unit?: string;
  /** At most one per machine = true → highlighted in the floating bubble. */
  showInBubble?: boolean;
  /** Shown in the detail card (default true). */
  showInCard?: boolean;
  /** Order within the detail card (ascending). */
  cardOrder?: number;
  /**
   * A production-context value over time (article, contract…): offered as a filter of the
   * machine dashboard, like the work order (needs the datapoint archived).
   */
  filterable?: boolean;
  /**
   * Where the value comes from (e.g. "Automatique", "Manuelle", "Calculée"), shown on its card of
   * the machine dashboard. Usually written by the integration.
   */
  source?: string;
  /** Decimals shown for a numeric value (0..{@link MAX_PARAM_DECIMALS}). When unset,
   * integers print as-is and other numbers with {@link DEFAULT_PARAM_DECIMALS}. */
  decimals?: number;
}

/** Decimals of a non-integer parameter value when the parameter sets none. */
export const DEFAULT_PARAM_DECIMALS = 2;
/** Upper bound of the per-parameter decimals choice. */
export const MAX_PARAM_DECIMALS = 6;

/**
 * Format a parameter's numeric value with its configured decimals — the single
 * rule shared by the 3D bubble, the machine popup and the machine dashboard.
 * Without a configured count, integers stay as-is and the rest gets
 * {@link DEFAULT_PARAM_DECIMALS}. Non-numeric values are printed verbatim.
 */
export function formatParamValue(value: number | string, decimals?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  if (decimals != null) return value.toFixed(Math.min(Math.max(Math.round(decimals), 0), MAX_PARAM_DECIMALS));
  return Number.isInteger(value) ? String(value) : value.toFixed(DEFAULT_PARAM_DECIMALS);
}

/** Maximum number of KPI parameters bound per machine. */
export const MAX_PARAMS = 10;

/** One value→state rule of a state mapping (range bounds optional). */
export interface StateRule {
  state: MachineState;
  min?: number;
  max?: number;
}

/**
 * A state a mapping declares: its key (what the rules produce), label, colour, and whether
 * the machine counts as producing in it — the only states that are not downtime for the
 * Gantt, the stop analysis and the TRS.
 */
export interface StateDef {
  key: string;
  label: string;
  color: string;
  running?: boolean;
  /**
   * Neither available nor a stop (e.g. no work order in progress): the time spent in this
   * state is removed from the opening time, as a non-worked period is. Ignored when `running`.
   */
  outsideOpening?: boolean;
  /** A fault (counted apart from the other stops in the atelier's statistics). Absent: the
   * built-in `warn` ("Défaut") only. Ignored when `running`. */
  fault?: boolean;
}

/** Whether a state is a fault (its own flag, else the built-in `warn`). */
export function isFaultState(s: StateDef): boolean {
  return !s.running && (s.fault ?? s.key === 'warn');
}

/** Machines of an atelier per kind of state: faults, stops, producing, not connected. */
export interface FleetStats {
  fault: number;
  stop: number;
  production: number;
  offline: number;
}

/**
 * Count the machines by kind of state (#65): not connected apart, then producing (`running`),
 * fault ({@link isFaultState}), and any other state — maintenance included — as a stop. A state
 * the atelier does not know counts as a stop.
 */
export function fleetStats(
  machines: readonly Pick<MachineDef, 'state' | 'connected' | 'commDp'>[],
  states: readonly StateDef[]
): FleetStats {
  const out: FleetStats = { fault: 0, stop: 0, production: 0, offline: 0 };
  for (const m of machines) {
    if (isDisconnected(m)) {
      out.offline++;
      continue;
    }
    const def = states.find((x) => x.key === m.state);
    if (def?.running) out.production++;
    else if (def && isFaultState(def)) out.fault++;
    else out.stop++;
  }
  return out;
}

/** A named, ordered value→state mapping (first matching rule wins). */
export interface StateMapping {
  id: string;
  name: string;
  rules: StateRule[];
  /** State used when no rule matches. */
  fallback: MachineState;
  /** Optional per-state / per-overlay colour overrides (else the defaults). */
  colors?: Partial<Record<StateColorKey, string>>;
  /**
   * Optional state list of this mapping, in display order. Absent or empty: the four
   * built-in states (`BUILTIN_STATES`), exactly as before.
   */
  states?: StateDef[];
}

export const DEFAULT_STATE_MAPPINGS: StateMapping[] = [
  {
    id: 'default',
    name: 'Standard (0=arrêt, 1=ok, 2=défaut, 3=maint)',
    fallback: 'stop',
    rules: [
      { state: 'stop', min: 0, max: 0 },
      { state: 'ok', min: 1, max: 1 },
      { state: 'warn', min: 2, max: 2 },
      { state: 'maint', min: 3, max: 3 }
    ]
  }
];

/** Resolve a numeric datapoint value to a machine state via a mapping. */
export function resolveState(mapping: StateMapping | undefined, value: number): MachineState {
  if (!mapping) return 'ok';
  for (const rule of mapping.rules) {
    const okMin = rule.min == null || value >= rule.min;
    const okMax = rule.max == null || value <= rule.max;
    if (okMin && okMax) return rule.state;
  }
  return mapping.fallback;
}

/** Screen corner for the standard navigation controls overlay. */
export type NavCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Human-readable French labels for the navigation-controls corner. */
export const NAV_CORNER_LABELS: Record<NavCorner, string> = {
  'top-left': 'Haut gauche',
  'top-right': 'Haut droite',
  'bottom-left': 'Bas gauche',
  'bottom-right': 'Bas droite'
};

export const DEFAULT_NAV_CORNER: NavCorner = 'bottom-right';

/** Building configuration (formalised `B` from the prototype). */
export interface BuildingConfig {
  length: number;
  width: number;
  height: number;
  bays: number;
  roofType: RoofType;
  /** Column spacing in metres (6..40). */
  colStep: number;
  floorType: FloorType;
  /** Screen corner of the standard navigation controls (default bottom-right). */
  navCorner?: NavCorner;
  /** Draw the columns on the building's outline (inner columns are always drawn). Default true. */
  showPerimeterColumns?: boolean;
  /** Draw the transparent outer walls (long walls and gables). Default true. */
  showWalls?: boolean;
  /** Columns' colour (`#rrggbb`); absent = steel grey {@link DEFAULT_COLUMN_COLOR}. */
  columnColor?: string;
}

/** Default colour of the building's columns (steel grey). */
export const DEFAULT_COLUMN_COLOR = '#5b6578';

export const DEFAULT_BUILDING: BuildingConfig = {
  length: 240,
  width: 160,
  height: 18,
  bays: 4,
  roofType: 'shed',
  colStep: 20,
  // Light by default: the dark industrial concrete made machines and bubbles hard to read.
  floorType: 'concrete-white',
  navCorner: 'bottom-right'
};

/** Scene display toggles. */
export interface DisplayConfig {
  roof: boolean;
  labels: boolean;
  alertOnly: boolean;
  /**
   * A machine's bubble shows only while the pointer is over the machine (or its dot or bubble),
   * not always (#56). Set per atelier, by the role `edit`; never a viewer's own choice.
   */
  bubblesOnHover?: boolean;
}

/** Bounds of a machine's bubble scale (#59). */
export const BUBBLE_SCALE_MIN = 0.6;
export const BUBBLE_SCALE_MAX = 2.5;

export const DEFAULT_DISPLAY: DisplayConfig = {
  roof: true,
  labels: true,
  alertOnly: false
};

/** Serialisable machine definition (config input). */
export interface MachineDef {
  id: string;
  name: string;
  /**
   * Tags by dimension (e.g. { Line: ['L3'], Activity: ['Welding', 'Heat'] }): what the filter
   * bar offers and filters on (see filters.ts). Usually written by an integration.
   */
  tags?: Record<string, string[]>;
  /**
   * Free tags the user puts on the machine's symbol in this atelier, saved with the atelier:
   * filtered on under the CARD_TAGS_DIMENSION dimension (filters.ts), next to {@link tags}.
   */
  cardTags?: string[];
  type: MachineType;
  /** Process family (usinage / soudage / generic). Drives the domain parameters
   * simulated & bound. When unset, derived from `type` ({@link resolveProcess}). */
  process?: MachineProcess;
  x: number;
  z: number;
  /** Vertical position (height) in metres; defaults to 0 (on the floor). */
  y?: number;
  state: MachineState;
  /** Grid location label (e.g. "C7"). */
  loc?: string;
  /** KPI parameters bound to this machine (≤ MAX_PARAMS). */
  kpis?: Kpi[];
  /** Datapoint driving the machine state (resolved via `stateMappingId`). */
  stateDp?: string;
  /** Id of the StateMapping used to resolve `stateDp` → state. */
  stateMappingId?: string;
  /** Datapoint reporting communication status (bool, or int: 0 = down, >0 = up). */
  commDp?: string;
  /** Live communication status; `false` = machine not connected. */
  connected?: boolean;
  /** Ordered bubble/popup visibility for every displayable info item (see
   * {@link DisplayEntry} / {@link resolveDisplaySlots}). The "Affichage" tab. */
  display?: DisplayEntry[];
  /** Datapoint giving the stop-cause code. */
  stopCauseDp?: string;
  /** Datapoint giving the current work order (OF). */
  workOrderDp?: string;
  /** Datapoint giving the current operation. */
  operationDp?: string;
  /** Datapoint giving the machine's alarm code — shown while the machine is not producing. */
  alarmCodeDp?: string;
  /** Live server-computed KPI values (kpiCalc manager), keyed by `MachineKpi.id`. */
  kpiCalcValues?: Record<string, number>;
  /** Resolved threshold-band colour per KPI (TRS only), keyed by `MachineKpi.id`. */
  kpiCalcColors?: Record<string, string>;
  /** Live values pushed at runtime from the bound production DPs. */
  stopCause?: string | number;
  /** Stop cause resolved against the catalog: "code — description". */
  stopCauseLabel?: string;
  workOrder?: string | number;
  operation?: string | number;
  alarmCode?: string | number;
  /** Linked Asset Lifecycle Intelligence (ALI) asset id (`AssetLifecycle_<id>`),
   * used to surface that asset's composite obsolescence/risk score on the machine. */
  aliAssetId?: string;
  /** Live ALI composite risk score [0..100] resolved from the linked asset. */
  aliRiskScore?: number;
  /** Live ALI risk level label (e.g. "Élevé") resolved from the linked asset. */
  aliRiskLabel?: string;
  /** Live colour for the ALI risk band (`#RRGGBB`). */
  aliRiskColor?: string;
  /** Type-specific build hint (e.g. furnace tonnage, lathe size). */
  variant?: string | number;
  /** When true, the machine is not rendered in the 3D scene (still listed/editable). */
  hidden?: boolean;
  /**
   * Placement marker of the atelier the machine is placed from ({@link PlacementMarker}): its
   * position is the marker's plus an offset, kept when the marker moves; moving the machine by
   * hand adjusts the offset.
   */
  markerId?: string;
  /**
   * "À placer": the machine was laid out automatically by an integration (e.g. a machine that
   * joined this atelier), so the user still has to place it. Shown on its bubble, its dot and in
   * the machine list; cleared as soon as the user moves it ({@link placeMachine}).
   */
  toPlace?: boolean;
  /** The machine's bubble size, as a factor of the default one (#59). Absent = 1. */
  bubbleScale?: number;
  /**
   * The machine's bubble placed by hand (#59): screen offset (px) from the machine's dot to the
   * bubble's bottom centre, kept at any zoom. Absent = laid out automatically above the machine.
   */
  bubbleOffset?: [number, number];
  /** Rotation about the scene's vertical axis, in degrees (multiple of 45). */
  rotationY?: number;
  /** Custom paint colour applied to the model's principal parts (`#RRGGBB`). */
  color?: string;
  /** Gantry (portique) clear span in metres. */
  portiqueSpan?: number;
  /** Gantry (portique) height in metres. */
  portiqueHeight?: number;
  /** Gantry (portique) leg/pillar cross-section width in metres. */
  portiqueLegW?: number;
  /** Rotary machining-table diameter in metres (type `portique-table`). */
  tableDiameter?: number;
  /** Industrial tilter (basculeur) width in metres. */
  basculeurW?: number;
  /** Industrial tilter (basculeur) height in metres. */
  basculeurH?: number;
  /** Industrial tilter (basculeur) depth in metres. */
  basculeurD?: number;
  /** Datapoint driving the basculeur tilt angle, in degrees (0 = flat). */
  tiltDp?: string;
  /** Invert the tilt animation: angle → 90 − angle (0↔90). */
  tiltInvert?: boolean;
  /** Live tilt angle (degrees) pushed from `tiltDp`. */
  tiltAngle?: number;
  /** Bound datapoints flagged for historical archiving (WinCC OA archive config). */
  archivedDps?: string[];
  /** Configured real-time KPIs (TRS/MTBF/MTTR), computed server-side and archived. */
  kpiCalcs?: MachineKpi[];
  /** GLB asset URL when type === 'glb'. */
  glbUrl?: string;
  /**
   * Model of the machine's family, shown while the machine has no model of its own (`type`
   * 'glb' with a {@link glbUrl}) — e.g. "dp:MachineFleet3D_Glb_x". Usually written by the
   * integration.
   */
  familyGlbUrl?: string;
  /** Icon URL for a `billboard` (textured plane facing the camera). */
  billboardUrl?: string;
  /** Billboard plane width in metres (default 6). */
  billboardW?: number;
  /** Billboard plane height in metres (default 6). */
  billboardH?: number;
  /** Linked custom dashboard id (→ /data/dashboard-wc/index.html#/dashboard/<id>). */
  dashboardId?: number;
  /** Which dashboard to open from the detail card: the built-in contextualised
   * machine dashboard (`default`) or a specific WinCC OA dashboard (`oa`).
   * When unset, derived ({@link resolveDashboardMode}): `oa` if a `dashboardId`
   * is set, else `default`. */
  dashboardMode?: DashboardMode;
  /** Extra custom links (URL) shown as buttons in the machine popup; each opens
   * in a new browser tab. Up to {@link MAX_DASHBOARD_LINKS}. */
  dashboardLinks?: DashboardLink[];
  /**
   * The links stay within the application: only an address of the application is accepted
   * ({@link appLinkHref}), and each opens in the same tab. Usually written by the integration.
   */
  appLinksOnly?: boolean;
  /**
   * The page of what the machine belongs to (another page of the application), reached from a button of
   * its dashboard in the same tab. Usually written by the integration that places the machine.
   */
  ownerLink?: { label: string; url: string };
  /**
   * More datapoints whose alarms are the machine's, in its dashboard (e.g. the machine's own
   * datapoint when its state is read elsewhere). Usually written by the integration.
   */
  alarmDps?: string[];
  /**
   * Shortest stop that counts, in seconds: a non-producing period shorter than this (a stop,
   * maintenance, no connection…) is taken as production — it appears neither in the Gantt nor
   * in the stops, and does not lower the TRS. 0 or absent: every stop counts.
   */
  minStopSec?: number;
}

/** Source of a machine's dashboard: built-in contextualised vs. specific WinCC OA. */
export type DashboardMode = 'default' | 'oa';

export const DASHBOARD_MODE_LABEL: Record<DashboardMode, string> = {
  default: 'Tableau de bord machine par défaut (contextualisé)',
  oa: 'Dashboard WinCC OA spécifique'
};

/** Resolve which dashboard a machine opens (explicit `dashboardMode`, else derived). */
export function resolveDashboardMode(m: { dashboardMode?: DashboardMode; dashboardId?: number }): DashboardMode {
  if (m.dashboardMode) return m.dashboardMode;
  return m.dashboardId == null ? 'default' : 'oa';
}

/** A selectable dashboard option (id + display name). */
export interface DashboardOption {
  id: number;
  name: string;
}

/** A custom link shown as a button in the machine popup (opens a URL in a new tab). */
export interface DashboardLink {
  /** Button label. */
  label: string;
  /** iX icon name (from {@link DASHBOARD_LINK_ICONS}). */
  icon: string;
  /** External URL — opened in a new browser tab. */
  url: string;
}

/** Maximum custom dashboard links per machine. */
export const MAX_DASHBOARD_LINKS = 3;

/**
 * The address of a link within the application, or undefined when it would lead out of it: a
 * route of the application ("#/…") or a path of this server ("/…", not "//host"); anything with
 * a scheme ("https:", "javascript:"…) or a host is refused ({@link MachineDef.appLinksOnly}).
 */
export function appLinkHref(raw: string): string | undefined {
  const url = raw.trim();
  if (url.startsWith('#')) return url.length > 1 ? url : undefined;
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')) return url;
  return undefined;
}

/** Default icon for a freshly added dashboard link. */
export const DEFAULT_DASHBOARD_LINK_ICON = 'ontology';

/**
 * Curated icon choices for a dashboard-link button. Limited to names known to
 * exist in the deployed (older) `@siemens/ix-icons` bundle, so the picker never
 * shows the "crossed rectangle" fallback.
 */
export const DASHBOARD_LINK_ICONS: { value: string; label: string }[] = [
  { value: 'ontology', label: 'Tableau de bord' },
  { value: 'barchart', label: 'Graphique' },
  { value: 'analysis', label: 'Analyse' },
  { value: 'eye', label: 'Visualisation' },
  { value: 'calendar', label: 'Planning' },
  { value: 'bell', label: 'Alarmes' },
  { value: 'info', label: 'Information' },
  { value: 'image', label: 'Synoptique' },
  { value: 'folder', label: 'Documents' },
  { value: 'cogwheel', label: 'Paramètres' }
];

/** Accent PointLight configuration assigned to certain machines. */
export interface AccentConfig {
  color: number;
  intensity: number;
  distance: number;
  yOffset: number;
}

/** Camera focus pose for "fly to machine". */
export interface FocusPose {
  pos: [number, number, number];
  target: [number, number, number];
}

/** Runtime machine instance (definition + built mesh + derived bounds). */
export interface Machine extends MachineDef {
  mesh: Group;
  /** Footprint width / depth in metres. */
  w: number;
  d: number;
  /** World Y of the label anchor (top of bounding box + margin). */
  topY: number;
  bbox: { x1: number; x2: number; z1: number; z2: number };
  focus: FocusPose;
  suppressLabel: boolean;
  accentConfig?: AccentConfig;
  /** Borrowed PointLight from the pool (assigned per frame by proximity). */
  _light?: PointLight;
}

/** Kind of a displayable info item (drives label/styling in bubble & popup). */
export type DisplayKind =
  | 'state'
  | 'stopCause'
  | 'workOrder'
  | 'operation'
  | 'alarmCode'
  | 'obsolescence'
  | 'param'
  | 'kpi';

/** The machine moved by the user to (x, z): placed, so no longer "à placer". */
export function placeMachine<T extends MachineDef>(m: T, x: number, z: number): T {
  const placed: T = { ...m, x, z };
  delete placed.toPlace;
  return placed;
}

export const DISPLAY_KIND_LABEL: Record<DisplayKind, string> = {
  state: 'État',
  stopCause: 'Production',
  workOrder: 'Production',
  operation: 'Production',
  alarmCode: 'Production',
  obsolescence: 'ALI',
  param: 'Paramètre',
  kpi: 'KPI'
};

/**
 * One row of the unified "Affichage" tab: a displayable info item with its
 * bubble/popup visibility. The ITEM is identified by `ref`
 * (`state` | `stopCause` | `workOrder` | `operation` | `alarmCode` | `param:<key>` | `kpi:<id>`);
 * the display ORDER is the position of the entry within `MachineDef.display`.
 */
export interface DisplayEntry {
  ref: string;
  inBubble?: boolean;
  inPopup?: boolean;
}

/** A resolved display item (catalog metadata + effective visibility), in order. */
export interface DisplaySlot {
  ref: string;
  kind: DisplayKind;
  label: string;
  inBubble: boolean;
  inPopup: boolean;
  /** Set when kind === 'param'. */
  param?: Kpi;
  /** Set when kind === 'kpi'. */
  kpi?: MachineKpi;
}

const FIXED_DISPLAY: { ref: string; kind: DisplayKind; label: string }[] = [
  { ref: 'state', kind: 'state', label: 'État machine' },
  { ref: 'stopCause', kind: 'stopCause', label: "Cause d'arrêt" },
  { ref: 'workOrder', kind: 'workOrder', label: 'OF en cours' },
  { ref: 'operation', kind: 'operation', label: 'Opération' },
  { ref: 'alarmCode', kind: 'alarmCode', label: 'Code alarme' }
];

/**
 * Resolve the ordered list of displayable items for a machine: the fixed items
 * (state + production DPs), then its parameters, then its server KPIs. Default
 * visibility is taken from each item's legacy flags; `MachineDef.display` (if
 * present) overrides both ORDER and visibility. Items missing from `display`
 * are appended in catalog order so newly added params/KPIs appear automatically.
 */
export function resolveDisplaySlots(m: MachineDef): DisplaySlot[] {
  const catalog = new Map<string, DisplaySlot>();
  for (const f of FIXED_DISPLAY) catalog.set(f.ref, { ...f, inBubble: true, inPopup: true });
  // Obsolescence (ALI) is only displayable once the machine is linked to an asset.
  if (m.aliAssetId != null && m.aliAssetId !== '') {
    catalog.set('obsolescence', {
      ref: 'obsolescence',
      kind: 'obsolescence',
      label: 'Obsolescence (ALI)',
      inBubble: false,
      inPopup: true
    });
  }
  for (const p of m.kpis ?? []) {
    catalog.set(`param:${p.key}`, {
      ref: `param:${p.key}`,
      kind: 'param',
      label: p.label || p.key,
      inBubble: p.showInBubble === true,
      inPopup: p.showInCard !== false,
      param: p
    });
  }
  for (const k of m.kpiCalcs ?? []) {
    catalog.set(`kpi:${k.id}`, {
      ref: `kpi:${k.id}`,
      kind: 'kpi',
      label: k.label && k.label !== '' ? k.label : KPI_TYPE_INFO[k.type].label,
      inBubble: k.showInBubble === true,
      inPopup: k.showInPopup !== false,
      kpi: k
    });
  }
  const out: DisplaySlot[] = [];
  const seen = new Set<string>();
  for (const e of m.display ?? []) {
    const slot = catalog.get(e.ref);
    if (!slot || seen.has(e.ref)) continue;
    seen.add(e.ref);
    out.push({ ...slot, inBubble: e.inBubble ?? slot.inBubble, inPopup: e.inPopup ?? slot.inPopup });
  }
  for (const [ref, slot] of catalog) if (!seen.has(ref)) out.push(slot);
  return out;
}

/** Time classification of a stop cause. */
export type StopClassification = 'unplanned' | 'planned' | 'production';

export const STOP_CLASSIFICATION_LABELS: Record<StopClassification, string> = {
  unplanned: 'Arrêt non planifié',
  planned: 'Arrêt planifié',
  production: 'Production'
};

/** A stop-cause catalog entry (single-level catalog). */
export interface StopCause {
  code: string;
  description: string;
  classification: StopClassification;
  /** When true, this entry is shown for any code not found in the catalog. */
  isDefault?: boolean;
}

/**
 * Resolve a stop-cause code against the catalog → "code — description".
 * When the code is unknown, falls back to the catalog's default entry (the one
 * flagged `isDefault`) if any, otherwise to the bare code. Returns an empty
 * string when no code is provided.
 */
export function formatStopCause(catalog: StopCause[], code: string | number | undefined): string {
  if (code == null || code === '') return '';
  const key = String(code);
  const entry = catalog.find((c) => c.code === key);
  if (entry) return `${entry.code} — ${entry.description}`;
  const fallback = catalog.find((c) => c.isDefault);
  return fallback ? `${fallback.code} — ${fallback.description}` : key;
}

/** Kind of imported graphics resource: 3D model (GLB) or 2D icon (billboard). */
export type GraphicKind = 'glb' | 'billboard';

/** An imported graphics resource (one datapoint with `name` + base64 `data`). */
export interface GlbResource {
  /** Resource id (= DP name suffix). */
  id: string;
  /** Display name. */
  name: string;
  /** Reference usable as `MachineDef.glbUrl`/`billboardUrl` (e.g. "dp:MachineFleet3D_Glb_x"). */
  ref: string;
  /** Optional library/category used to group resources (empty = unclassified). */
  library?: string;
}

/** Alias — graphics resources (GLB or billboard) share the same shape. */
export type GraphicResource = GlbResource;

/** A saved camera viewpoint (orbit pose). */
export interface Viewpoint {
  id: string;
  name: string;
  pos: [number, number, number];
  target: [number, number, number];
}

/** A workshop ("atelier") — one persisted unit (one DP). */
export interface Atelier {
  /** Logical id (= DP name suffix). */
  id: string;
  /** Full DP name (e.g. "System1:MachineFleet3D_x"); absent until persisted. */
  dp?: string;
  name: string;
  building: BuildingConfig;
  display: DisplayConfig;
  machines: MachineDef[];
  mappings: StateMapping[];
  /** Shareable TRS threshold (colour-band) configs referenced by machines. */
  trsThresholds?: TrsThresholds[];
  /** Saved camera viewpoints. */
  viewpoints?: Viewpoint[];
  /** Id of the viewpoint applied automatically when the 3D view loads. */
  defaultViewpointId?: string;
  /** Placement markers of this atelier (posts or other landmarks), machines placed from them. */
  markers?: PlacementMarker[];
}

/**
 * A placement marker of an atelier: a named point of the floor (a post, a landmark) from which
 * machines are placed. A machine bound to it keeps its offset when the marker moves.
 */
export interface PlacementMarker {
  id: string;
  label: string;
  x: number;
  z: number;
}

/** The machine placed from a marker at an offset (dx, dz): its position follows from it. */
export function placeFromMarker<T extends MachineDef>(m: T, marker: PlacementMarker, dx: number, dz: number): T {
  return { ...m, markerId: marker.id, x: marker.x + dx, z: marker.z + dz };
}

/**
 * Machines after the markers changed from `before` to `after`: a machine bound to a moved
 * marker moves with it (same offset); one bound to a removed marker keeps its place, unbound.
 */
export function followMarkers<T extends MachineDef>(
  machines: T[],
  before: readonly PlacementMarker[],
  after: readonly PlacementMarker[]
): T[] {
  return machines.map((m) => {
    if (!m.markerId) return m;
    const old = before.find((k) => k.id === m.markerId);
    const now = after.find((k) => k.id === m.markerId);
    if (!now) {
      const unbound = { ...m };
      delete unbound.markerId;
      return unbound;
    }
    if (!old || (old.x === now.x && old.z === now.z)) return m;
    return { ...m, x: m.x + now.x - old.x, z: m.z + now.z - old.z };
  });
}

/** Number of a new marker's default name ("Repère N"): one above the highest N already used. */
export function nextMarkerNumber(markers: readonly PlacementMarker[]): number {
  let max = markers.length;
  for (const k of markers) {
    const n = /(\d+)\s*$/.exec(k.label);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return max + 1;
}
