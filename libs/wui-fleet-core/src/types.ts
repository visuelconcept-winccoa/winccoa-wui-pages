/**
 * Shared types for the Machine Fleet 3D standalone page.
 *
 * Ported from the `atelier-3d-v38.html` prototype (Jumeau Numérique).
 * The prototype's loose `machines[]`/`B`/`zone.userData` shapes are formalised
 * here so the Lit page, the Three.js scene modules, and the integrated config
 * UI share one typed contract.
 */
import type { Group, PointLight } from 'three';

/** Operational state of a machine or zone (drives status colour). */
export type MachineState = 'ok' | 'warn' | 'stop' | 'maint';

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
  | 'safety-zone';

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
export const STATE_COLORS: Record<MachineState, string> = {
  ok: '#10b981',
  warn: '#ef4444',
  stop: '#f59e0b',
  maint: '#3b82f6'
};

/** Human-readable French state labels (for badges, chips, tooltips). */
export const STATE_LABELS: Record<MachineState, string> = {
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
export const DEFAULT_STATE_COLOR_MAP: Record<StateColorKey, string> = {
  ...STATE_COLORS,
  disconnected: DISCONNECTED_COLOR
};

/** French labels for the colour-config rows in the mapping dialog. */
export const STATE_COLOR_LABELS: Record<StateColorKey, string> = {
  ok: 'Production',
  warn: 'Défaut',
  stop: 'Arrêt',
  maint: 'Maintenance',
  disconnected: 'Non connectée'
};

export const STATE_COLOR_KEYS: StateColorKey[] = ['ok', 'warn', 'stop', 'maint', 'disconnected'];

/** Resolve one state/overlay colour for a mapping (its override, else default). */
export function stateColor(mapping: StateMapping | undefined, key: StateColorKey): string {
  return mapping?.colors?.[key] ?? DEFAULT_STATE_COLOR_MAP[key];
}

/** Resolve the full colour map for a mapping (all keys), for the scene/labels. */
export function resolveStateColors(mapping: StateMapping | undefined): Record<StateColorKey, string> {
  return {
    ok: stateColor(mapping, 'ok'),
    warn: stateColor(mapping, 'warn'),
    stop: stateColor(mapping, 'stop'),
    maint: stateColor(mapping, 'maint'),
    disconnected: stateColor(mapping, 'disconnected')
  };
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

export const STATE_HEX: Record<MachineState, number> = {
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
}

/** Maximum number of KPI parameters bound per machine. */
export const MAX_PARAMS = 10;

/** One value→state rule of a state mapping (range bounds optional). */
export interface StateRule {
  state: MachineState;
  min?: number;
  max?: number;
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
}

export const DEFAULT_BUILDING: BuildingConfig = {
  length: 240,
  width: 160,
  height: 18,
  bays: 4,
  roofType: 'shed',
  colStep: 20,
  floorType: 'concrete',
  navCorner: 'bottom-right'
};

/** Scene display toggles. */
export interface DisplayConfig {
  roof: boolean;
  labels: boolean;
  alertOnly: boolean;
}

export const DEFAULT_DISPLAY: DisplayConfig = {
  roof: true,
  labels: true,
  alertOnly: false
};

/** Serialisable machine definition (config input). */
export interface MachineDef {
  id: string;
  name: string;
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
  /** Live values pushed at runtime from the bound production DPs. */
  stopCause?: string | number;
  /** Stop cause resolved against the catalog: "code — description". */
  stopCauseLabel?: string;
  workOrder?: string | number;
  operation?: string | number;
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
  /** Live server-computed KPI values (kpiCalc manager), keyed by `MachineKpi.id`. */
  kpiCalcValues?: Record<string, number>;
  /** Resolved threshold-band colour per KPI (TRS only), keyed by `MachineKpi.id`. */
  kpiCalcColors?: Record<string, string>;
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
  | 'obsolescence'
  | 'param'
  | 'kpi';

export const DISPLAY_KIND_LABEL: Record<DisplayKind, string> = {
  state: 'État',
  stopCause: 'Production',
  workOrder: 'Production',
  operation: 'Production',
  obsolescence: 'ALI',
  param: 'Paramètre',
  kpi: 'KPI'
};

/**
 * One row of the unified "Affichage" tab: a displayable info item with its
 * bubble/popup visibility. The ITEM is identified by `ref`
 * (`state` | `stopCause` | `workOrder` | `operation` | `param:<key>` | `kpi:<id>`);
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
  { ref: 'operation', kind: 'operation', label: 'Opération' }
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
}
