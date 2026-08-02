// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Engineering Studio — protocol-neutral domain model (pure, no WinCC OA
 * dependency). Everything the studio manipulates is described here:
 *
 *  - {@link Device}       a communicating equipment (protocol + connection),
 *  - {@link AddressBook}  the persistent, refreshable catalog of the device's
 *                         addressable entries (generated from a browse, a
 *                         SimaticML export, a CSV, or an AI proposal),
 *  - {@link Workspace}    the check-out working copy: DP types, datapoints and
 *                         their configs (address/alarm/archive/range),
 *  - {@link LiveSnapshot} the same shape read from the live project, so the
 *                         diff engine ({@link import('./diff.js')}) can compute
 *                         a check-in plan.
 *
 * The DPE path notation follows WinCC OA: a structured element is
 * `<dp>.<element>[.<sub>…]`; a scalar DP root is addressed `<dp>.` (trailing
 * dot — see docs 'adressage-datapoints-wincc-oa').
 */

/** WinCC OA scalar element types the studio maps source datatypes onto. */
export type OaLeafType =
  | 'Bool'
  | 'Char'
  | 'UInt'
  | 'Int'
  | 'Long'
  | 'ULong'
  | 'Float'
  | 'String'
  | 'Time'
  | 'Blob'
  | 'Bit32'
  | 'LangString';

/** Access mode of a source tag (drives the peripheral-address direction). */
export type TagAccess = 'r' | 'rw' | 'w';

/** Protocols the studio can bind addresses for (extensible). */
export type ProtocolKind = 'opcua' | 's7' | 's7plus' | 'modbus';

/**
 * How a device's address space is reached at runtime. One physical PLC may
 * offer several modes (e.g. an S7-1500: `s7` classic absolute operands for
 * non-optimized DBs, `opcua` via its embedded server for everything).
 */
export type AccessMode = ProtocolKind;

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/** Connection state as last probed by the backend (demo: simulated). */
export type DeviceState = 'connected' | 'disconnected' | 'unknown';

export interface Device {
  /** Stable id (referenced by books and bindings). */
  id: string;
  /** Display name, e.g. `S7_Four1`. */
  name: string;
  protocol: ProtocolKind;
  /** Protocol-specific connection settings (endpoint, ip/rack/slot, …). */
  connection: Record<string, string | number | boolean>;
  /** Access modes this device offers (see {@link AccessMode}). */
  accessModes: AccessMode[];
  /** WinCC OA driver manager number, when known (resolved by the backend). */
  driverNumber?: number;
  /** Poll group DP used for its bound addresses. */
  pollGroup?: string;
  state: DeviceState;
}

// ---------------------------------------------------------------------------
// Address books (the persistent catalogs — iba-style)
// ---------------------------------------------------------------------------

/** Where a book (or a book refresh) came from. */
export interface BookProvenance {
  /** Generator kind. */
  kind: 'opcua-browse' | 'simaticml' | 'csv' | 'nodeset' | 'ai-proposal' | 'manual';
  /** Source file name (file-based generators). */
  file?: string;
  /** Content hash of the source (change detection / audit). */
  hash?: string;
  /** ISO timestamp of generation. */
  generatedAt: string;
  /** Free-form generator detail (agent version, browse root, …). */
  detail?: string;
}

/**
 * One addressable entry of a book. `addresses` carries the CANDIDATE address
 * per access mode — e.g. a standard-DB member has both an `s7` absolute
 * operand (`DB12.DBD4`) and a symbolic `s7plus`/`opcua` path; an optimized-DB
 * member has only symbolic candidates.
 */
export interface BookEntry {
  /** Symbolic path within the device, dot-joined (e.g. `DB_Echange.Consigne`). */
  path: string;
  /** Source datatype name (protocol notation, e.g. `Real`, `Double`). */
  sourceType: string;
  /** Mapped WinCC OA element type. */
  leafType: OaLeafType;
  access: TagAccess;
  /** Candidate address per access mode. */
  addresses: Partial<Record<AccessMode, string>>;
  /** Source comment (→ DPE description). */
  comment?: string;
  /** Id of the source structured type (UDT) this entry belongs to, if any. */
  typeId?: string;
  /** True when the datatype could not be mapped (bound as default/String). */
  unmapped?: boolean;
}

/** A structured source type (e.g. a TIA UDT) carried by the book. */
export interface BookType {
  id: string;
  name: string;
  /** Member paths relative to the type root, with their leaf info. */
  members: { path: string; sourceType: string; leafType: OaLeafType; comment?: string }[];
}

export interface AddressBook {
  deviceId: string;
  provenance: BookProvenance;
  entries: BookEntry[];
  /** Structured types discovered in the source (UDTs → DPT candidates). */
  types: BookType[];
  /** Non-fatal issues raised by the generator (unsupported members, …). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Workspace (the check-out working copy) and live snapshot
// ---------------------------------------------------------------------------

/** A DP-type node tree (same shape the /api/para engineering API accepts). */
export interface DpTypeStructure {
  name: string;
  type: string;
  refName?: string;
  children?: DpTypeStructure[];
}

export interface EngType {
  typeName: string;
  structure: DpTypeStructure;
}

export interface EngDp {
  dpName: string;
  dpType: string;
  /** DPE description overrides, keyed by relative element path. */
  descriptions?: Record<string, string>;
}

/** Peripheral-address config of one DPE (protocol-agnostic envelope). */
export interface AddressConfig {
  deviceId: string;
  mode: AccessMode;
  /** Driver reference string (built by the protocol's address builder). */
  reference: string;
  /** `_address.._direction` value. */
  direction: number;
  /** `_address.._datatype` transformation value. */
  datatype: number;
  /** Poll group DP name (polled modes). */
  pollGroup?: string;
  active: boolean;
}

/** Binary or analog alert on one DPE (mirrors the proven PARA alarm writes). */
export interface AlarmConfig {
  kind: 'binary' | 'analog';
  alarmClass: string;
  /** binary: alarm on TRUE (asc) / FALSE (desc); analog: high / low. */
  direction: 'ASC' | 'DESC';
  /** Analog thresholds (1..3), ascending. */
  thresholds?: number[];
  /** Bounds of the outer analog ranges (from the element type). */
  bounds?: [number, number];
  active: boolean;
}

export interface ArchiveConfig {
  /** NGA archive group DP (bare name). */
  group: string;
  active: boolean;
}

export interface RangeConfig {
  min: number;
  max: number;
  inclMin: boolean;
  inclMax: boolean;
}

/** The configs the studio manages on one DPE. All optional (absent = unset). */
export interface DpeConfigs {
  address?: AddressConfig;
  alarm?: AlarmConfig;
  archive?: ArchiveConfig;
  range?: RangeConfig;
}

/**
 * The check-out working copy. `baseline` carries the fingerprint of each
 * object as it was read from the live project at check-out time — the diff
 * engine uses it to detect conflicts (live changed since check-out).
 */
export interface Workspace {
  name: string;
  types: EngType[];
  dps: EngDp[];
  /** Configs keyed by full DPE path (`<dp>.<element…>` / `<dp>.`). */
  configs: Record<string, DpeConfigs>;
  /** Object fingerprints at check-out (`type:<name>` / `dp:<name>` / `cfg:<dpe>`). */
  baseline: Record<string, string>;
  checkedOutAt?: string;
  checkedOutBy?: string;
}

/** The same shape, read from the live project (check-out / check-in probe). */
export interface LiveSnapshot {
  types: EngType[];
  dps: EngDp[];
  configs: Record<string, DpeConfigs>;
}

// ---------------------------------------------------------------------------
// Check-in plan (diff result = preview = apply request)
// ---------------------------------------------------------------------------

export type PlanOp = 'create' | 'update' | 'delete';
export type PlanItemKind = 'type' | 'dp' | 'config';

export interface PlanItem {
  kind: PlanItemKind;
  op: PlanOp;
  /** typeName / dpName / DPE path. */
  name: string;
  /** Human summary of the change (attribute-level for configs). */
  detail?: string;
  /**
   * True when the live object changed since check-out (baseline mismatch).
   * A conflicting item is NEVER applied silently — the user must resolve it.
   */
  conflict?: boolean;
  /** Payload consumed by the applier (structure / dp / configs). */
  payload?: unknown;
}

export interface EngPlan {
  workspace: string;
  items: PlanItem[];
  warnings: string[];
}

/** Per-item outcome of an apply (check-in) run. */
export interface ApplyItemResult {
  kind: PlanItemKind;
  op: PlanOp;
  name: string;
  status: 'applied' | 'skipped' | 'failed';
  error?: string;
}

export interface ApplyReport {
  ok: boolean;
  dryRun: boolean;
  results: ApplyItemResult[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Stable JSON fingerprint used for baselines (key-sorted, whitespace-free). */
export function fingerprint(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/** Full DPE name for a leaf: scalar root -> `<dp>.`, else `<dp>.<relPath>`. */
export function makeDpeName(root: string, relPath: string): string {
  return relPath === '' ? `${root}.` : `${root}.${relPath}`;
}
