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

import type { SignalRole } from './roles/roles.js';
import type { EngWarning } from './warnings.js';

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

/**
 * WHY a device's {@link DeviceState} says what it says.
 *
 * `unknown` is a real answer, not a failure, and it has several causes an operator
 * must be able to tell apart — a grey LED can equally mean "the driver has not filled
 * the state in", "the connection you named does not exist" and "two connections match
 * this declaration". So the reason travels with the state:
 *  - `connstate`            — read from `<connection>.Common.State.ConnState`, the
 *                             driver-agnostic connection state every WinCC OA
 *                             connection type carries (`_OPCUAServer`, `_S7_Conn`,
 *                             `_S7PlusConnection`, `_Mod_Plc`, …);
 *  - `opcua-connstate`      — read from `_OPCUAServer.State.ConnState`, used when the
 *                             common element is undefined (`0`/`-1`);
 *  - `unknown-connection`   — nothing in the project matches the declaration: a
 *                             declaration error, not a downtime;
 *  - `ambiguous-connection` — SEVERAL connections match it, so no single one may
 *                             speak for the equipment;
 *  - `probe-failed`         — the read itself failed (driver stopped, no permission).
 *                             Deliberately NOT reported as disconnected;
 *  - `unprobed`             — the declaration carries nothing to match a connection
 *                             on (no server name, no address). A running driver is not
 *                             a connected station, so a driver's state is never
 *                             borrowed to fill this in.
 */
export type DeviceStateSource =
  | 'connstate'
  | 'opcua-connstate'
  | 'unknown-connection'
  | 'ambiguous-connection'
  | 'probe-failed'
  | 'unprobed';

export interface Device {
  /** Stable id (referenced by books and bindings). */
  id: string;
  /** Display name, e.g. `S7_Four1`. */
  name: string;
  /**
   * Address books associated to this equipment. The relation is MANY-TO-MANY:
   *  - a book may be listed by SEVERAL devices → the catalog is *mutualised*;
   *  - a device may list SEVERAL books → it aggregates several interfaces
   *    (e.g. two OPC UA servers of one machine), each seen as a book.
   */
  bookIds: string[];
  /** Primary/aggregate protocol hint for the rail badge (books carry the real interface). */
  protocol?: ProtocolKind;
  /** Optional device-level connection (fallback; per-book interfaces are authoritative). */
  connection?: Record<string, string | number | boolean>;
  /** Access modes this device offers (see {@link AccessMode}). */
  accessModes: AccessMode[];
  /** WinCC OA driver manager number, when known (resolved by the backend). */
  driverNumber?: number;
  /** Poll group DP used for its bound addresses. */
  pollGroup?: string;
  state: DeviceState;
  /** Why `state` says what it says — see {@link DeviceStateSource}. */
  stateSource?: DeviceStateSource;
  /**
   * The connection the state was read on (or looked for), so a wrong declaration
   * names itself instead of leaving the operator to guess which of the device's
   * interfaces the LED is talking about.
   */
  stateConnection?: string;
  /**
   * The RAW WinCC OA `ConnState` behind {@link state}, when one was read.
   *
   * Three states cannot carry what the driver actually said: `1` (not connected), `3`
   * (inactive — somebody disabled the connection) and `5` (failure) all light the same
   * red lamp, yet they call for three different actions. The number travels so the UI
   * can name it, and it is passed through rather than interpreted here: the mapping
   * to connected / disconnected / unknown follows the driver plugin shipped with
   * WinCC OA (`>= 256` connected, `1` or `5` down, anything else undefined).
   */
  stateCode?: number;
}

// ---------------------------------------------------------------------------
// Address books (the persistent catalogs — iba-style)
// ---------------------------------------------------------------------------

/** Where a book (or a book refresh) came from. */
export interface BookProvenance {
  /** Generator kind. */
  kind: 'opcua-browse' | 'simaticml' | 'xvm' | 'csv' | 'nodeset' | 'ai-proposal' | 'manual';
  /** Source file name (file-based generators). */
  file?: string;
  /** Content hash of the source (change detection / audit). */
  hash?: string;
  /** ISO timestamp of generation. */
  generatedAt: string;
  /** Free-form generator detail (agent version, browse root, …). */
  detail?: string;
  /**
   * Parameters of an ONLINE browse (`kind: 'opcua-browse'`), so a refresh can
   * REPLAY the exact same walk instead of guessing. A file-based book has no
   * equivalent: it is regenerated by re-ingesting its source.
   * (Typed loosely here to keep `model.ts` free of protocol imports; the shape is
   * `opcua/browse.ts`'s `BrowseSource`.)
   */
  browse?: {
    connection: string;
    rootNodeId?: string;
    maxDepth?: number;
    maxEntries?: number;
    maxRequests?: number;
  };
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
  /**
   * Where `access` comes from — it decides how much the config generator may
   * TRUST it (see `roles/profiles.ts`):
   *  - `declared` (default when absent) — the source states it: an OPC UA
   *    `AccessLevel`, a Modbus register class, a TIA member attribute;
   *  - `assumed`  — the generator could NOT read it and defaulted to read-only
   *    (an online browse whose driver does not expose `AccessLevel`). A role's
   *    write intent then WINS, because the access is not evidence;
   *  - `manual`   — the operator set it; it wins over everything.
   */
  accessSource?: 'declared' | 'assumed' | 'manual';
  /** Candidate address per access mode. */
  addresses: Partial<Record<AccessMode, string>>;
  /** Source comment (→ DPE description). */
  comment?: string;
  /** Engineering unit of the signal (→ DPE unit), e.g. `V`, `A`, `kWh`. */
  unit?: string;
  /**
   * Semantic qualification driving the model + configs (see `roles/`). Set by
   * the rule engine or by the operator; carried BY THE BOOK so a mutualised
   * catalog is qualified once and reused everywhere.
   */
  role?: SignalRole;
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

/**
 * The concrete communication interface/source a book binds through — an OPC UA
 * server, an S7 connection, … Absent for a pure FILE catalog (a SimaticML /
 * NodeSet export reused as a template): such a catalog has no live binding of
 * its own and is bound when paired with an equipment's interface.
 */
export interface BookInterface {
  protocol: ProtocolKind;
  /** Connection/server name used to build the address reference (e.g. OPC UA `<Conn>`). */
  connection?: string;
  /** Connection parameters (endpoint, ip/rack/slot…), for display. */
  params?: Record<string, string | number | boolean>;
  /** WinCC OA driver manager number of this interface, when known. */
  driverNumber?: number;
}

/**
 * A first-class address book: a catalog of addressable signals with its own
 * identity, so it can be MUTUALISED across equipments and a device can hold
 * SEVERAL of them (see {@link Device.bookIds}).
 */
export interface AddressBook {
  /** Stable book identity, referenced by {@link Device.bookIds}. */
  id: string;
  /** Human name, e.g. `TIA Four1 · DB_Echange` or `OPC UA Remplisseuse`. */
  name: string;
  provenance: BookProvenance;
  /** The interface this book binds through, when live (absent for a file catalog). */
  interface?: BookInterface;
  entries: BookEntry[];
  /** Structured types discovered in the source (UDTs → DPT candidates). */
  types: BookType[];
  /** Non-fatal issues raised by the generator (unsupported members, …). */
  warnings: EngWarning[];
  /**
   * Entry paths the operator has HIDDEN by hand, present only on a book being shown
   * (`entries` already excludes them — see `withoutExcluded`).
   *
   * Carried here so a UI can say how many are hidden and offer them back: a catalog
   * that quietly shows less than its source would have the next engineer model from
   * an incomplete reading. It is NOT part of a stored book — the exclusions live
   * beside it, so a re-read of the source cannot erase them.
   */
  excludedPaths?: string[];
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

/**
 * Peripheral-address config of one DPE (protocol-agnostic envelope).
 *
 * `deviceId` and `mode` are studio-side PROVENANCE: they are not values written
 * to the project (`s7` and `s7plus` both write `_drv_ident = "S7"`), so they are
 * absent from a read-back and excluded from diff comparison — see
 * `configs/read.ts` (`comparableConfigs`).
 */
export interface AddressConfig {
  deviceId?: string;
  mode?: AccessMode;
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
  warnings: EngWarning[];
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
