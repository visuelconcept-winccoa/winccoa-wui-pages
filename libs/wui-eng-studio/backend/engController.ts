// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// EngController — backend of the Engineering Studio page (/api/eng).
// -----------------------------------------------------------------------------
// The engineering LOGIC lives in the pure `@visuelconcept-winccoa/wui-eng-core` (diff,
// plan applier, atomic config builders, config read-back mapping, address-book
// generators, role rules) — unit-tested with no runtime. This controller is the
// THIN runtime seam:
//
//   * it implements the core's `EngPort` over the shared WinCC OA API
//     (WsjServerGlobal.winccoa) — the ONLY place the engine touches OA;
//   * it reads the live project back into the core's `LiveSnapshot` shape
//     (types, datapoints and, for the requested DPEs, their configs);
//   * it resolves the DEVICE context of an address write (driver manager number +
//     ensured poll-group DP);
//   * it persists devices / books / workspaces / role overrides through EngStore
//     (JSON files — engineering data, see engStore.ts);
//   * it ingests address books from the file generators (SimaticML, XVM, CSV).
//
// No dedicated manager: everything runs against WsjServerGlobal.winccoa, as
// paraController and tagImporterController already do.
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { Request, Response } from 'ultimate-express';
import { WinccoaDpTypeNode } from 'winccoa-manager';
import {
  CONN_STATE,
  DEFAULT_ROLE_RULES,
  applyPlan,
  POLL_GROUPS,
  pollGroupInterval,
  baselineOf,
  buildBookFromIngest,
  buildBookFromOpcUaBrowse,
  crossCheckBookAgainstInventory,
  buildBookFromS7PlusBrowse,
  classifyEntries,
  declaredAddressOf,
  connectionVerdict,
  deviceStateOf,
  configReadPaths,
  configsFromRaw,
  diffBooks,
  diffWorkspace,
  excludedWarning,
  liveScopeOf,
  asEngWarnings,
  blockingProblems,
  normalizeDevice,
  opcuaSecurityWrite,
  refreshWarnings,
  validateDevice,
  withAccess,
  withRoles,
  withoutExcluded,
  templateIdFrom,
  OPCUA_OBJECTS_FOLDER,
  S7PLUS_ONLINE_STATION,
  type AddressBook,
  type AddressConfig,
  type BookDiff,
  type ConnStateRead,
  type ConnStateVerdict,
  type DeviceStateUpdate,
  type Device,
  type DeviceDraft,
  type DpTypeStructure,
  type DpeConfigs,
  type EngPlan,
  type EngPort,
  type IngestFormat,
  type S7CrossCheck,
  type S7Inventory,
  type LiveSnapshot,
  type ModelTemplate,
  type SignalRole,
  type TagAccess,
  type Workspace
} from '@visuelconcept-winccoa/wui-eng-core';

import { EngStore } from './engStore';
import { WinccoaOpcUaBrowsePort, listOpcUaConnections } from './engOpcuaBrowse';
import {
  ManagerS7PlusBrowsePort,
  listS7PlusConnections,
  listS7PlusProjects,
  listS7PlusStations,
  s7plusManagerHealth
} from './engS7PlusBrowse';
import { inventoryS7, probeS7, s7EndpointOf, s7ManagerHealth } from './engS7Browse';
import { identityOf, roleAssignments, roleGranted } from './appSecurityGuard';
import { callEng, callEngOrThrow, engManagerAvailable, engManagerHealth, forgetEngManager } from './engVrpc';

/* eslint-disable @typescript-eslint/no-explicit-any */
function win(): any {
  return WsjServerGlobal.winccoa as any;
}

/** Element-type map (mirrors paraTypeNode / tagImporterController). */
const ELEMENT_TYPE_MAP: Record<string, number> = {
  Struct: 1, Int: 21, Float: 22, Bool: 23, Bit32: 24, String: 25, Time: 26, Dpid: 27,
  Char: 19, UInt: 20, Typeref: 41, LangString: 42, Blob: 46, Long: 54, ULong: 58, Bit64: 50,
  DynChar: 3, DynUInt: 4, DynInt: 5, DynFloat: 6, DynBool: 7, DynBit32: 8, DynString: 9,
  DynTime: 10, DynDpid: 29, DynLangString: 44, DynBlob: 48, DynBit64: 51, DynLong: 55, DynULong: 59
};

const ELEMENT_TYPE_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(ELEMENT_TYPE_MAP).map(([name, value]) => [value, name])
);

/** Default poll-group DP the studio ensures for its polled addresses. */
const DEFAULT_POLL_GROUP = '_EngStudio_Poll';
/** Poll interval (ms) of a poll group created by the studio. */
const DEFAULT_POLL_INTERVAL_MS = 1000;
/** Driver-type strings of `_Driver<n>.DT`, per access mode (OPCUAC verified). */
const DRIVER_TYPE_BY_MODE: Record<string, string> = { opcua: 'OPCUAC' };
/** Max DPEs read per dpGet batch (a config read is 16 attributes per DPE). */
const READ_BATCH = 40;

function buildTypeNode(node: DpTypeStructure): WinccoaDpTypeNode {
  const elementType = ELEMENT_TYPE_MAP[node.type];
  if (elementType === undefined) throw new Error(`Invalid element type '${node.type}' for '${node.name}'`);
  const children = (node.children ?? []).map((c) => buildTypeNode(c));
  return new WinccoaDpTypeNode(node.name, elementType, node.refName ?? '', children);
}

/** WinccoaDpTypeNode → DpTypeStructure (reverse of buildTypeNode). */
function structureOf(node: any): DpTypeStructure {
  const out: DpTypeStructure = { name: node.name, type: ELEMENT_TYPE_NAME[node.type] ?? String(node.type) };
  if (node.refName) out.refName = node.refName;
  if (node.children && node.children.length > 0) out.children = node.children.map((c: any) => structureOf(c));
  return out;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * First scalar of a `dpGet` result. The shared API answers a single DPE as the
 * value, as `[value]` or as `{ value }` depending on the call shape.
 *
 * ONLY for elements that hold ONE value (`_Driver<n>.DT`). Never use it on a `dyn_*`
 * element: there the array IS the value, and taking `[0]` silently keeps one item of
 * a list — which is exactly how `_Connections.Driver.ManNums` came to report every
 * driver but the first as stopped. Lists go through {@link numberList}.
 */
function firstValue(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw[0];
  if (raw !== null && typeof raw === 'object' && 'value' in raw) return (raw as { value: unknown }).value;
  return raw;
}

/**
 * Every integer of a `dyn_*` read, whatever wrapping came back: the bare dyn value
 * (`[1,2]`), a one-DPE result holding it (`[[1,2]]`), `{ value: [...] }`, or a lone
 * scalar. Flattened rather than indexed — the whole point is that this is a LIST.
 */
function numberList(raw: unknown): number[] {
  const unwrapped =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw ? (raw as { value: unknown }).value : raw;
  const flat = Array.isArray(unwrapped) ? unwrapped.flat(Number.POSITIVE_INFINITY) : [unwrapped];
  // `Number(null)` is 0 and `Number('')` is 0, so drop the empties BEFORE converting —
  // otherwise an unset element would read as "driver 0 is running".
  return flat
    .filter((item) => item !== null && item !== undefined && item !== '')
    .map(Number)
    .filter((item) => Number.isInteger(item));
}

/**
 * Manager numbers of the drivers currently running (`_Connections.Driver.ManNums`).
 *
 * `null` when the read FAILED — which is not the same as "none is running". Reporting
 * an unreadable state as "stopped" would label a perfectly running driver as down,
 * so the caller passes the distinction on instead of flattening it.
 */
async function runningDriverNums(): Promise<number[] | null> {
  try {
    const running = numberList(await win().dpGet('_Connections.Driver.ManNums'));
    console.info(`engController: running driver managers = [${running.join(', ')}]`);
    return running;
  } catch (error) {
    console.warn('engController: cannot read _Connections.Driver.ManNums:', describeError(error));
    return null;
  }
}

/**
 * Connection datapoint TYPE per protocol (WinCC OA 3.21 base data, verified against
 * the installed `dbdfiles/version_3.21/dptypes.txt`). All of them carry the same
 * `Common.State.ConnState` element, which is what makes one probe cover every
 * protocol the studio declares.
 */
const CONNECTION_DP_TYPE: Record<string, string> = {
  opcua: '_OPCUAServer',
  s7: '_S7_Conn',
  s7plus: '_S7PlusConnection',
  modbus: '_Mod_Plc'
};

/** Where each connection type carries its station address (for an `ip` match). */
const CONNECTION_ADDRESS_DPE: Record<string, string> = {
  _OPCUAServer: 'Config.ConnInfo',
  _S7_Conn: 'Address',
  _S7PlusConnection: 'Config.Address',
  _Mod_Plc: 'HostsAndPorts'
};

/** The driver-agnostic connection state, on every connection type. */
const COMMON_CONN_STATE = 'Common.State.ConnState';

/**
 * The project's classic-S7 connections (`_S7_Conn`), for the device form's picker.
 *
 * Same shape and same purpose as `listOpcUaConnections`: an equipment must be able
 * to NAME the connection it is bound to instead of hoping the studio finds it by
 * searching its IP. The address rides along because two connections often differ
 * only by rack/slot, and the name alone would not tell them apart in a list.
 *
 * Every failure degrades to "no connection listed" rather than an error: a form
 * that cannot be opened because a dpGet failed is worse than one that falls back
 * to free entry, which is exactly what the picker does with an empty list.
 */
interface S7ConnectionInfo {
  /** Connection name, no leading `_` — what the equipment declares. */
  name: string;
  dp: string;
  connected: boolean;
  /** `_S7_Conn.Address`, shown beside the name (two connections often differ only by rack/slot). */
  address?: string;
}

async function listS7Connections(): Promise<S7ConnectionInfo[]> {
  let names: string[] = [];
  try {
    names = (win().dpNames('*', '_S7_Conn') ?? []).map((dpName: string) => dpName.replace(/\.$/, ''));
  } catch (error) {
    console.warn('engController: dpNames("*","_S7_Conn") failed:', describeError(error));
    return [];
  }
  return Promise.all(
    names.map(async (dp) => {
      const afterSystem = dp.includes(':') ? dp.slice(dp.indexOf(':') + 1) : dp;
      const state = await readConnState(dp, COMMON_CONN_STATE);
      const address = await win()
        .dpGet(`${dp}.Address`)
        .then((raw: unknown) => flatText(raw))
        .catch(() => '');
      return {
        name: afterSystem.replace(/^_/, ''),
        dp,
        // The same rule the LED follows (`deviceStateFromConnState`): connected is
        // 256 and up, never "anything non-zero" — `1`, `3` and `5` are all states
        // a connection can sit in without being usable.
        connected: state !== null && state.written && state.code >= CONN_STATE.CONNECTED,
        ...(address === '' ? {} : { address })
      };
    })
  );
}

/** A device's connection datapoint, or why there is none to read. */
type ConnectionMatch =
  | { dp: string; name: string }
  | { dp: null; name: string; reason: 'unknown-connection' | 'ambiguous-connection' | 'unprobed' };

/** `_Remplisseuse` for `Remplisseuse` — a connection DP is the reference, prefixed. */
function findConnectionByName(typeName: string, reference: string): string | null {
  const wanted = reference.replace(/^_/, '').toLowerCase();
  try {
    const names: string[] = win().dpNames('*', typeName) ?? [];
    const hit = names.find((dpName) => {
      const full = dpName.replace(/\.$/, '');
      const afterSystem = full.includes(':') ? full.slice(full.indexOf(':') + 1) : full;
      return afterSystem.replace(/^_/, '').toLowerCase() === wanted;
    });
    return hit === undefined ? null : hit.replace(/\.$/, '');
  } catch (error) {
    console.warn(`engController: dpNames('*','${typeName}') failed:`, describeError(error));
    return null;
  }
}

/** Said by every endpoint that needs a connection to answer at all. */
const CONNECTION_REQUIRED = 'connection is required';

/** Does this DP TYPE exist in the project? (used to tell "absent" from "unreadable") */
function typeExistsIn(w: ReturnType<typeof win>, typeName: string): boolean {
  try {
    return ((w.dpTypes(typeName) ?? []) as string[]).map(String).some((name) => bareDpName(name) === typeName);
  } catch {
    return false;
  }
}

/** Bare datapoint name: no system prefix, no trailing dot. */
function bareDpName(name: string): string {
  const withoutDot = name.replace(/\.$/, '');
  return withoutDot.includes(':') ? withoutDot.slice(withoutDot.indexOf(':') + 1) : withoutDot;
}

/**
 * The project's ALARM CLASSES — the `_AlertClass` datapoints.
 *
 * An alert class IS a datapoint in WinCC OA: `_alert_hdl.._class` stores `<name>.` and
 * that name must be an existing `_AlertClass` instance, so a class typed from memory
 * produces a config the runtime rejects. The studio therefore offers the project's own
 * list (same source as the PARA page's Alarming tab, `libs/wui-para/para-alarm.ts`).
 *
 * Never fatal: an empty list means "could not tell", and the form falls back to free
 * entry — which is also how a class created after this read stays usable.
 */
async function listAlarmClasses(): Promise<string[]> {
  try {
    const names: string[] = win().dpNames('*', '_AlertClass') ?? [];
    const bare = new Set<string>(names.map((name) => bareDpName(name)).filter((name) => name !== ''));
    return [...bare].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.warn('engController: dpNames("*","_AlertClass") failed:', describeError(error));
    return [];
  }
}

/**
 * The project's ARCHIVE GROUPS — the usable `_NGA_Group` datapoints.
 *
 * Same reading as the machine-fleet page (`libs/wui-fleet-core/fleet-store.ts`), and the
 * same two exclusions, both of which would otherwise offer a group that cannot archive a
 * process value: a group that is not `active`, and one specialised for alerts
 * (`isAlert` — `_NGA_G_ALERT` archives alarms). The `_2` twins are the second partition of
 * a group, not a group to assign.
 */
async function listArchiveGroups(): Promise<string[]> {
  let groups: string[] = [];
  try {
    // Typed explicitly: `dpNames` is untyped in the manager API, and the webserver's own
    // tsc (stricter than the page's) infers `unknown[]` through the Set round-trip.
    const names: string[] = win().dpNames('*', '_NGA_Group') ?? [];
    const bare = new Set<string>(names.map((name) => bareDpName(name)).filter((name) => name !== '' && !name.endsWith('_2')));
    groups = [...bare].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.warn('engController: dpNames("*","_NGA_Group") failed:', describeError(error));
    return [];
  }
  const usable: string[] = [];
  for (const group of groups) {
    try {
      const active = isTrueText(flatText(await win().dpGet(`${group}.active`)));
      const alerts = isTrueText(flatText(await win().dpGet(`${group}.isAlert`)));
      if (active && !alerts) usable.push(group);
    } catch {
      // Unreadable flags: offered rather than hidden — the project may still archive
      // into it, and a missing group is worse than an extra one in a picker.
      usable.push(group);
    }
  }
  return usable;
}

/** A WinCC OA boolean as read back: `TRUE`/`true`/`1` all mean set. */
function isTrueText(text: string): boolean {
  const value = text.trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * The project's OPC UA SUBSCRIPTIONS — `_OPCUASubscription` datapoints, named without their
 * leading underscore (that is how a reference names them: `<Conn>$<Sub>$1$1$<NodeId>`).
 *
 * Verified against the vendor's own `opcuaDriver_plugin.ctl`, which creates them as
 * `"_" + <name>` of that type and holds the publishing interval, the sampling interval and the
 * deadband on the subscription — which is why a subscription is chosen per leaf exactly like a
 * poll group, and why the studio offers the project's own list rather than a typed name.
 */
async function listOpcUaSubscriptions(): Promise<string[]> {
  try {
    if (!typeExistsIn(win(), '_OPCUASubscription')) return [];
    const names: string[] = win().dpNames('*', '_OPCUASubscription') ?? [];
    const bare = new Set<string>(
      names.map((name) => bareDpName(name).replace(/^_/, '')).filter((name) => name !== '' && !name.endsWith('_2'))
    );
    return [...bare].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.warn('engController: dpNames("*","_OPCUASubscription") failed:', describeError(error));
    return [];
  }
}

/**
 * Connections of `typeName` whose address CONTAINS `ip`.
 *
 * A substring match, because the element holds more than the address: `_S7_Conn.Address`
 * carries the rack/slot too and `_Mod_Plc.HostsAndPorts` is a list of `host:port`. It
 * can therefore match more than one connection — which is why the caller reports
 * ambiguity instead of picking the first.
 */
async function findConnectionsByAddress(typeName: string, ip: string): Promise<string[]> {
  const element = CONNECTION_ADDRESS_DPE[typeName];
  if (element === undefined) return [];
  let names: string[] = [];
  try {
    names = (win().dpNames('*', typeName) ?? []).map((dpName: string) => dpName.replace(/\.$/, ''));
  } catch (error) {
    console.warn(`engController: dpNames('*','${typeName}') failed:`, describeError(error));
    return [];
  }
  const addresses = await Promise.all(
    names.map(async (dp) => {
      try {
        return flatText(await win().dpGet(`${dp}.${element}`));
      } catch {
        return ''; // an unreadable address is not a match — and not a reason to stop
      }
    })
  );
  return names.filter((_dp, index) => (addresses[index] ?? '').includes(ip));
}

/** Whether a datapoint instance exists (either spelling the API accepts). */
function dpInstanceExists(name: string): boolean {
  const w = win();
  try {
    return Boolean(w.dpExists(name)) || Boolean(w.dpExists(`${name}.`));
  } catch {
    return false;
  }
}

/** Outcome of the connection provisioning a device save may trigger. */
interface ConnectionProvision {
  /** Connection name as the device declares it (the `_address` reference). */
  name: string;
  /** The `_OPCUAServer` datapoint, when it was created. */
  dp?: string;
  created: boolean;
  warnings: string[];
}

/**
 * The password a save carries, taken from the RAW draft before the core strips it.
 *
 * `undefined` means "the request said nothing about the password" — the live one
 * is kept; `''` means "clear it" (log in anonymously). It is read here and passed
 * straight to the manager: `normalizeDevice` deliberately never persists a
 * secret, so this is the only moment it exists on this side.
 */
function transientPassword(draft: DeviceDraft): string | undefined {
  const raw = (draft.connection ?? {})['password'];
  return raw === undefined || raw === null ? undefined : String(raw);
}

/** What a save did about the connection's SECURITY settings. */
interface SecurityOutcome {
  /** Families actually written ('user' | 'policy' | 'mode' | 'certificate' | 'flags' | 'password'). */
  applied: string[];
  /** Present when a password was pushed: what the stored blob READS BACK. */
  passwordSet?: boolean;
  warnings: string[];
}

/**
 * Non-empty test for whatever shape the API returns a blob in (Buffer, string,
 * array) — used to decorate a device with `passwordSet`, which is a READ.
 */
function blobNonEmpty(raw: unknown): boolean {
  const value = firstValue(raw);
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  if (value instanceof Uint8Array) return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

/** A JSON answer's array field as a string list (a service answer is untyped JSON). */
function stringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(String) : [];
}

/** Any dpGet result → one searchable string (a `dyn_string` is joined, not indexed). */
function flatText(raw: unknown): string {
  const unwrapped = raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw ? (raw as { value: unknown }).value : raw;
  return Array.isArray(unwrapped) ? unwrapped.flat(Number.POSITIVE_INFINITY).map(String).join(' ') : String(unwrapped ?? '');
}

/** Source time of a DPE — the same config-attribute path the PARA page reads. */
const STIME_ATTR = ':_original.._stime';

/**
 * One state element: its value plus whether anything ever WROTE it (the source time is
 * still the epoch on an element no driver has touched — see the core's `ConnStateRead`).
 */
async function readConnState(dp: string, element: string): Promise<ConnStateRead | null> {
  try {
    const value = Number(firstValue(await win().dpGet(`${dp}.${element}`)));
    if (!Number.isFinite(value)) return null;
    const stamp = await win()
      .dpGet(`${dp}.${element}${STIME_ATTR}`)
      .catch(() => undefined);
    return { code: value, written: wasWritten(firstValue(stamp)) };
  } catch (error) {
    console.warn(`engController: cannot read ${dp}.${element}:`, describeError(error));
    return null;
  }
}

/** A source time above the epoch means the driver wrote the value at least once. */
function wasWritten(raw: unknown): boolean {
  // No timestamp available (an older API, a refused attribute) → do NOT cast doubt on a
  // value that was read successfully; that would turn every state into "unknown".
  if (raw === undefined || raw === null || raw === '') return true;
  const time = raw instanceof Date ? raw.getTime() : new Date(String(raw)).getTime();
  return Number.isFinite(time) ? time > 0 : true;
}

/**
 * Read a connection's state and let the CORE conclude (`connectionVerdict`): the common
 * element first, `_OPCUAServer.State.ConnState` as a fallback when the driver leaves the
 * common one undefined. The decision — including "a never-written value is unknown, not
 * a disconnection" — is pure and unit-tested against values measured on a live project;
 * this function only performs the two reads.
 */
async function probeConnectionState(dp: string): Promise<ConnStateVerdict> {
  const [common, own] = await Promise.all([readConnState(dp, COMMON_CONN_STATE), readConnState(dp, 'State.ConnState')]);
  return connectionVerdict(common, own);
}

/** One driver of the project, as the device form offers it. */
interface EngDriverInfo {
  number: number;
  /** Raw `_Driver<n>.DT` ("OPCUAC", "S7", "MODBUS"…), '' when unreadable. */
  type: string;
  /** Absent when the running set could not be read — NOT the same as stopped. */
  running?: boolean;
  /** Access mode, only for the DT values whose mapping is verified. */
  mode?: string;
}

/** `_Driver<n>` datapoints of the project — the DP name carries the manager number. */
function driverDpNumbers(): number[] {
  const w = win();
  // The type filter is the precise query; an installation whose driver DPs are not
  // `_DriverCommon` still answers the plain name pattern, so try both rather than
  // reporting "no driver" on a project that has them.
  const candidates: string[] = [];
  for (const query of [() => w.dpNames('_Driver*', '_DriverCommon'), () => w.dpNames('_Driver*')]) {
    try {
      const names = (query() ?? []) as string[];
      if (names.length > 0) {
        candidates.push(...names);
        break;
      }
    } catch {
      continue;
    }
  }
  const numbers = new Set<number>();
  for (const name of candidates) {
    const match = /_Driver(\d+)\b/.exec(String(name));
    if (match) numbers.add(Number(match[1]));
  }
  return [...numbers];
}

/**
 * Every driver of the project, with its type and whether it runs.
 *
 * The union of the `_Driver<n>` datapoints and the RUNNING manager numbers: a
 * configured-but-stopped driver must still be offerable (an engineer declares an
 * equipment before starting its driver), and a running driver whose DP could not
 * be listed must not disappear from the list either.
 */
async function listProjectDrivers(): Promise<EngDriverInfo[]> {
  const runningNums = await runningDriverNums();
  const running = runningNums === null ? null : new Set(runningNums);
  const numbers = new Set([...driverDpNumbers(), ...(runningNums ?? [])]);
  const byMode = Object.entries(DRIVER_TYPE_BY_MODE);
  const drivers: EngDriverInfo[] = [];
  for (const number of [...numbers].sort((a, b) => a - b)) {
    let type = '';
    try {
      const value = firstValue(await win().dpGet(`_Driver${number}.DT`));
      type = value == null ? '' : String(value);
    } catch {
      type = ''; // an unreadable DT is reported as unknown, never as an error
    }
    const mode = byMode.find(([, dt]) => dt === type)?.[0];
    drivers.push({
      number,
      type,
      // Omitted, not false, when the running set is unknown — see runningDriverNums.
      ...(running === null ? {} : { running: running.has(number) }),
      ...(mode === undefined ? {} : { mode })
    });
  }
  return drivers;
}

/** One row of WinCC OA's own `dpTypeCreate` layout: a name at its nesting DEPTH. */
interface TypeRow {
  depth: number;
  name: string;
  type: number;
}

/**
 * The core's nested {@link DpTypeStructure} → the row/depth layout `dpTypeCreate`
 * expects (`names[row][depth]`, verified in the vendor's own `libs/ac.ctl`).
 *
 * Flattened HERE rather than in the CTRL manager on purpose: the element-type
 * codes are engineering data owned by this repo (`ELEMENT_TYPE_MAP`), so the
 * manager stays a dumb execution arm with no second copy of the mapping to drift.
 */
function typeRows(node: DpTypeStructure, depth = 1, rows: TypeRow[] = []): TypeRow[] {
  const type = ELEMENT_TYPE_MAP[node.type];
  if (type === undefined) throw new Error(`Invalid element type '${node.type}' for '${node.name}'`);
  rows.push({ depth, name: node.name, type });
  for (const child of node.children ?? []) typeRows(child, depth + 1, rows);
  return rows;
}

/**
 * The core's {@link EngPort} — the only place the engineering engine touches the
 * runtime.
 *
 * WRITES go to the **EngStudio CTRL manager** over vRPC when it is available
 * (`viaManager`): one auditable service owns every project mutation of this page,
 * and it is the only side that can encrypt a connection password. When the
 * manager is absent — an older deployment, MSA unavailable — the same calls fall
 * back to `WsjServerGlobal.winccoa` directly, so a project that has not deployed
 * the manager yet keeps working instead of losing its check-in. Which path is
 * taken is logged once per controller (see the constructor).
 *
 * READS (type/dp existence, driver detection) stay local: they are cheap, they
 * need no vendor library, and putting a round-trip in front of each of them
 * would slow a check-out down for nothing.
 *
 * The device context of an address (driver number + poll group) is resolved from
 * the STORED device first (explicit beats guessing), then auto-detected for the
 * protocols where detection is verified.
 */
class WinccoaEngPort implements EngPort {
  private readonly pollGroups = new Map<string, string>();

  constructor(
    private readonly devices: Device[],
    private readonly viaManager = false
  ) {}

  async typeExists(typeName: string): Promise<boolean> {
    try {
      win().dpTypeGet(typeName);
      return true;
    } catch {
      return false;
    }
  }
  async dpTypeCreate(structure: DpTypeStructure): Promise<void> {
    if (this.viaManager) {
      await callEngOrThrow('DpTypeCreate', { name: structure.name, rows: typeRows(structure) });
      return;
    }
    const ok = await win().dpTypeCreate(buildTypeNode(structure));
    if (!ok) throw new Error(`dpTypeCreate('${structure.name}') returned false`);
  }
  async dpTypeChange(structure: DpTypeStructure): Promise<void> {
    // One manager method for both: it creates or changes depending on what the
    // project already has, which is the same decision `dpTypes()` answers there.
    if (this.viaManager) {
      await callEngOrThrow('DpTypeCreate', { name: structure.name, rows: typeRows(structure) });
      return;
    }
    const ok = await win().dpTypeChange(buildTypeNode(structure));
    if (!ok) throw new Error(`dpTypeChange('${structure.name}') returned false`);
  }
  async dpTypeDelete(typeName: string): Promise<void> {
    if (this.viaManager) {
      await callEngOrThrow('DpTypeDelete', { name: typeName });
      return;
    }
    const ok = await win().dpTypeDelete(typeName);
    if (!ok) throw new Error(`dpTypeDelete('${typeName}') returned false`);
  }
  async dpExists(dpName: string): Promise<boolean> {
    const w = win();
    try {
      return Boolean(w.dpExists(dpName)) || Boolean(w.dpExists(`${dpName}.`));
    } catch {
      return false;
    }
  }
  async dpCreate(dpName: string, dpType: string): Promise<void> {
    // Same precondition as the CTRL arm states (see engStudioService.ctl): a datapoint cannot
    // exist without its type, and the runtime answers "Invalid argument in function" — which
    // names neither the argument nor the reason.
    if (!typeExistsIn(win(), dpType)) {
      throw new Error(`dpCreate('${dpName}','${dpType}'): DP type '${dpType}' does not exist — check the type in before its datapoints`);
    }
    if (this.viaManager) {
      await callEngOrThrow('DpCreate', { name: dpName, type: dpType });
      return;
    }
    const ok = await win().dpCreate(dpName, dpType);
    if (!ok) throw new Error(`dpCreate('${dpName}','${dpType}') returned false`);
  }
  async dpDelete(dpName: string): Promise<void> {
    if (this.viaManager) {
      await callEngOrThrow('DpDelete', { name: dpName });
      return;
    }
    const ok = await win().dpDelete(dpName);
    if (!ok) throw new Error(`dpDelete('${dpName}') returned false`);
  }
  async dpSetWait(dpes: string[], values: unknown[]): Promise<void> {
    if (this.viaManager) {
      await callEngOrThrow('DpSetWait', { dpes, values });
      return;
    }
    const ok = dpes.length === 1 ? await win().dpSetWait(dpes[0], values[0]) : await win().dpSetWait(dpes, values);
    if (!ok) throw new Error(`dpSetWait failed for ${dpes[0]}${dpes.length > 1 ? ` (+${dpes.length - 1} more)` : ''}`);
  }

  /**
   * Driver manager number + ensured poll-group DP for one address.
   *
   * Order: the stored device's `driverNumber` (declared by the engineer) → the
   * running driver auto-detected for the protocol (only OPC UA's `_Driver<n>.DT`
   * value is verified) → a clear error, because writing an address to the wrong
   * driver silently breaks the binding.
   */
  async resolveAddressContext(config: AddressConfig): Promise<{ driverNumber: number; pollGroupDp: string }> {
    const device = this.devices.find((d) => d.id === config.deviceId);
    // The LEAF's group first (the model's own choice), then the equipment's, then the default —
    // narrowest decision wins, like everywhere else here.
    const pollGroupDp = await this.ensurePollGroup(config.pollGroup ?? device?.pollGroup ?? DEFAULT_POLL_GROUP);
    if (device?.driverNumber !== undefined) {
      return { driverNumber: device.driverNumber, pollGroupDp };
    }
    const detected = await this.detectDriver(config.mode);
    if (detected !== null) {
      return { driverNumber: detected, pollGroupDp };
    }
    throw new Error(
      `no driver number for device '${config.deviceId ?? '?'}' (mode '${config.mode ?? '?'}') — set driverNumber on the device or start the driver`
    );
  }

  /**
   * First running driver whose `DT` matches the mode; null when unknown.
   *
   * MEMOISED PER PORT — that is, per check-in — because it was the cost of the button: this
   * runs for every address of the plan, and each call re-read `_Connections.Driver.ManNums`
   * plus one `_Driver<n>.DT` per running driver (and logged a line each time). A check-in of
   * a thousand DPEs did thousands of round-trips to learn the same answer. A port lives for
   * one request, so the cache cannot go stale within a run — a driver started mid-check-in
   * would not have been picked up by the old code either, since the first address already
   * fixed the answer for the whole write.
   */
  private async detectDriver(mode: AddressConfig['mode']): Promise<number | null> {
    const wanted = mode === undefined ? undefined : DRIVER_TYPE_BY_MODE[mode];
    if (wanted === undefined) return null; // only verified mappings are auto-detected
    const cached = this.driverByMode.get(wanted);
    if (cached !== undefined) return cached;
    // Every running driver is a candidate, not just the first the read returned.
    for (const num of (await this.runningDrivers()) ?? []) {
      try {
        if (firstValue(await win().dpGet(`_Driver${num}.DT`)) === wanted) {
          this.driverByMode.set(wanted, num);
          return num;
        }
      } catch {
        continue;
      }
    }
    this.driverByMode.set(wanted, null);
    return null;
  }

  /** The running driver numbers, read ONCE per port (see `detectDriver`). */
  private async runningDrivers(): Promise<number[] | null> {
    this.runningDriverCache ??= runningDriverNums();
    return this.runningDriverCache;
  }

  /**
   * The `_NGA_Group` datapoint to write for the group a model names.
   *
   * A model carries a token an engineer typed (`EVENT`, the studio's own default) while a project
   * holds `_NGA_G_EVENT`; `_archive.1._class` must name the DATAPOINT, so writing the token
   * verbatim failed the whole config write (`dpSetWait … rc=-1 on …:_archive.._type`). Resolution,
   * in order:
   *
   *  1. an exact match among the project's usable groups (already the normal case for a model
   *     built with the picker);
   *  2. the FIRST group whose name contains the token — `EVENT` → `_NGA_G_EVENT`, which is what an
   *     engineer means by it;
   *  3. the first usable group, with a warning: archiving into another group is a visible,
   *     correctable outcome, whereas failing the write loses the whole DPE's configs;
   *  4. no usable group at all → a clear error, because there is nothing honest to write.
   */
  async resolveArchiveGroup(group: string): Promise<string> {
    const wanted = group.trim();
    const cached = this.archiveGroupCache.get(wanted);
    if (cached !== undefined) return cached;
    this.archiveGroups ??= listArchiveGroups();
    const groups = await this.archiveGroups;
    if (groups.length === 0) {
      throw new Error(`no usable archive group (_NGA_Group) in this project — cannot archive '${wanted}'`);
    }
    const exact = groups.find((candidate) => candidate === wanted);
    const token = wanted.replace(/^_NGA_G_/i, '').toLowerCase();
    const contains = groups.find((candidate) => candidate.toLowerCase().includes(token));
    const resolved = exact ?? contains ?? groups[0];
    if (exact === undefined) {
      console.info(`engController: archive group '${wanted}' resolved to '${resolved}'${contains === undefined ? ' (no name matched — first usable group)' : ''}`);
    }
    this.archiveGroupCache.set(wanted, resolved);
    return resolved;
  }

  /** Group name as written by a model → the project's datapoint, resolved once per port. */
  private readonly archiveGroupCache = new Map<string, string>();
  private archiveGroups: Promise<string[]> | null = null;

  /** Mode → driver number resolved once for this port (`null` = none matched). */
  private readonly driverByMode = new Map<string, number | null>();
  /** The running-driver read, shared by every address of this port's run. */
  private runningDriverCache: Promise<number[] | null> | null = null;

  /** Ensure the poll-group DP exists (type `_PollGroup`, active); cached. */
  private async ensurePollGroup(pollGroup: string): Promise<string> {
    const cached = this.pollGroups.get(pollGroup);
    if (cached !== undefined) return cached;
    const normalized = pollGroup.startsWith('_') ? pollGroup : `_${pollGroup}`;
    if (this.viaManager) {
      // Each of the studio's groups has its OWN period (POLL_GROUPS): creating `_Poll_Slow` with a
      // one-second interval would make the three names a lie.
      const interval = pollGroupInterval(normalized) ?? DEFAULT_POLL_INTERVAL_MS;
      const answer = await callEngOrThrow('EnsurePollGroup', { name: normalized, interval });
      const dp = typeof answer['dp'] === 'string' ? (answer['dp'] as string) : normalized;
      this.pollGroups.set(pollGroup, dp);
      return dp;
    }
    if (!(await this.dpExists(normalized))) {
      const created = await win().dpCreate(normalized, '_PollGroup');
      if (!created) throw new Error(`failed to create poll group ${normalized}`);
      await win().dpSetWait([`${normalized}.Active`, `${normalized}.PollInterval`], [1, pollGroupInterval(normalized) ?? DEFAULT_POLL_INTERVAL_MS]);
    }
    this.pollGroups.set(pollGroup, normalized);
    return normalized;
  }
}

/** Handlers for /api/eng/* (arrow functions keep their binding for the router). */
export class EngController {
  private readonly store = new EngStore();
  /** Shared so browses of one connection serialise across HTTP requests. */
  private readonly browsePort = new WinccoaOpcUaBrowsePort();
  /**
   * S7Plus browse, over the dedicated `s7plusBrowse` JS manager. Stateless here:
   * the per-connection serialisation lives in the manager, which is the only
   * process that can enforce it across callers (see `engS7PlusBrowse.ts`).
   */
  private readonly s7plusPort = new ManagerS7PlusBrowsePort();

  public constructor() {
    // Say at BOOT which path the project writes go through — the EngStudio CTRL
    // manager, or the direct API fallback. This one log line is the health-check
    // an operator reads before blaming the page, and it also reports whether the
    // project has the driver certificate every password write needs.
    void engManagerHealth().then((health) => {
      if (health === null || health.ok !== true) {
        console.warn(
          'engController: the EngStudio CTRL manager is NOT reachable — project writes use the direct API fallback, ' +
            'and OPC UA passwords cannot be set (only the manager can encrypt them). Copy it into the project scripts and register it in config/progs.'
        );
        return;
      }
      const cert = health['driverCertificate'] === true;
      console.info(
        `engController: EngStudio CTRL manager reachable (system '${String(health['system'] ?? '?')}') — ` +
          `project writes go through it; driver certificate ${cert ? 'present' : 'MISSING (passwords will be refused)'}.`
      );
    });
  }

  public health = async (_req: Request, res: Response): Promise<void> => {
    const [manager, s7] = await Promise.all([engManagerHealth(), s7ManagerHealth()]);
    res.status(200).json({
      ok: true,
      service: 'eng',
      store: this.store.path(),
      // The page shows this: "the studio cannot write to the project" and "the
      // studio is not installed" are different problems with different fixes.
      manager: manager === null ? { reachable: false } : { reachable: manager.ok === true, ...manager },
      // Reported separately, and its absence is NOT a degradation of the studio:
      // the S7 catalogs are built from the project's exports and work without it.
      // Only the online CROSS-CHECK of those catalogs needs this manager, so the
      // page hides that one action instead of announcing a broken page.
      s7Browse: s7 === null ? { reachable: false } : { reachable: s7.ok === true, ...s7 }
    });
  };

  // --- roles (Application Security) -----------------------------------------

  /**
   * GET /api/eng/roles -> { roles } — the studio roles granted to the session
   * user, evaluated with the shared app-security rules (unassigned = open).
   */
  public roles = async (req: Request, res: Response): Promise<void> => {
    const declared = ['view', 'edit-model', 'manage-devices', 'checkin'];
    try {
      const [assign, who] = await Promise.all([roleAssignments('eng-studio'), identityOf(req)]);
      // NO SESSION IDENTITY → report the declared roles, exactly as `requireRole`
      // SKIPS its check in that case (webserver HTTP auth disabled: the SPA
      // authenticates at the websocket layer, so a request carries no attributable
      // user). `roleGranted` fails CLOSED there, and using it here made the studio
      // disable Check-in — and Generate, and the device form — while the very same
      // API accepted those calls. A UI stricter than the endpoint it fronts protects
      // nothing: it only hides the action and makes the page look broken.
      //
      // Nothing is weakened: with webserver auth ENABLED `who.username` is set and
      // the assignments decide, exactly as before.
      if (who.username === '') {
        const warning =
          'no session identity (server-side webserver authentication disabled) — role gating is inert here, as it is on the API guard. Enable webserver authentication for real enforcement.';
        console.warn(`engController.roles: ${warning}`);
        res.status(200).json({ ok: true, roles: declared, warning });
        return;
      }
      const granted = declared.filter((role) => roleGranted(assign, role, who));
      res.status(200).json({ ok: true, roles: granted });
    } catch (error) {
      // Never lock the UI out on a directory failure: open roles + a warning.
      console.warn('engController.roles:', describeError(error));
      res.status(200).json({ ok: true, roles: declared, warning: describeError(error) });
    }
  };

  // --- devices ---------------------------------------------------------------

  public listDevices = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({ ok: true, devices: await this.withLiveState(this.store.listDevices<Device>()) });
  };

  /**
   * GET /api/eng/devices/state -> { states: DeviceStateUpdate[] }
   *
   * The same probe as `/devices`, answering ONLY the live fields. It exists because the
   * page refreshes the state on a timer: a poll must not carry the whole registry
   * (books, parameters, driver numbers) — both for its own weight and because a
   * registry landing on a page mid-edit would overwrite the operator's work with a
   * copy that is seconds old. `view` like the listing: it says nothing more.
   */
  public deviceStates = async (_req: Request, res: Response): Promise<void> => {
    // No password probe on the 5 s poll: `passwordSet` only changes through a save,
    // and the poll's cost must stay proportional to what it can say.
    const devices = await this.withLiveState(this.store.listDevices<Device>(), false);
    res.status(200).json({ ok: true, states: devices.map((device) => deviceStateOf(device)) });
  };

  /**
   * PUT /api/eng/devices  body { devices } — replace the WHOLE registry.
   * Kept for bulk provisioning (an import, a migration script). The studio's form
   * uses the single-device routes below instead: replacing the list from a UI that
   * loaded it minutes ago silently discards whatever another operator added since.
   */
  public saveDevices = async (req: Request, res: Response): Promise<void> => {
    const devices = (req.body ?? {}).devices as Device[] | undefined;
    if (!Array.isArray(devices)) {
      res.status(400).json({ ok: false, error: 'devices[] is required' });
      return;
    }
    this.store.saveDevices(devices);
    res.status(200).json({ ok: true, devices: await this.withLiveState(devices) });
  };

  /**
   * POST /api/eng/devices  body { device } — CREATE one device.
   *
   * A creation has its own route rather than an "empty id" in the path: `POST
   * /devices/` would collide with the registry route, and any in-band sentinel
   * ("new", "-") could one day be a legitimate slug. The SERVER derives the id —
   * two operators creating the same name concurrently then get `four1` and
   * `four1-2`, where a client-derived id would have made the second silently
   * overwrite the first.
   */
  public createDevice = async (req: Request, res: Response): Promise<void> => {
    const draft = this.readDraft(req, res);
    if (!draft) return;
    const secret = transientPassword(draft);
    const devices = this.store.listDevices<Device>();
    if (this.refuse(res, { ...draft, id: '' }, devices)) return;
    const device = normalizeDevice({ ...draft, id: '' }, devices);
    this.store.saveDevices([...devices, device]);
    const provision = await this.provisionConnection(device);
    // AFTER provisioning: the declared security lands on the (possibly fresh) DP.
    const security = await this.applySecurity(device, secret);
    res.status(201).json({
      ok: true,
      device,
      devices: await this.withLiveState([...devices, device]),
      ...(provision === null ? {} : { connectionProvision: provision }),
      ...(security === null ? {} : { connectionSecurity: security })
    });
  };

  /**
   * POST /api/eng/devices/:id  body { device } — UPDATE one device.
   *
   * 404 when `:id` is unknown: a client that thinks it is editing must not create
   * (that is what the route above is for). The id is taken from the PATH and the
   * body's own `id` is ignored, so a rename can never re-parent the books and
   * configs that reference it.
   */
  public saveDevice = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params['id']);
    const draft = this.readDraft(req, res);
    if (!draft) return;
    const secret = transientPassword(draft);
    const devices = this.store.listDevices<Device>();
    const index = devices.findIndex((device) => device.id === id);
    if (index === -1) {
      res.status(404).json({ ok: false, error: `unknown device '${id}'` });
      return;
    }
    const others = devices.filter((device) => device.id !== id);
    if (this.refuse(res, { ...draft, id }, others)) return;
    const device = normalizeDevice({ ...draft, id }, others);
    const merged: Device = { ...devices[index], ...device };
    const updated = [...devices];
    updated[index] = merged;
    this.store.saveDevices(updated);
    const provision = await this.provisionConnection(merged);
    const security = await this.applySecurity(merged, secret);
    res.status(200).json({
      ok: true,
      device: merged,
      devices: await this.withLiveState(updated),
      ...(provision === null ? {} : { connectionProvision: provision }),
      ...(security === null ? {} : { connectionSecurity: security })
    });
  };

  /**
   * Provision the DECLARED OPC UA connection when the project does not have it —
   * never failing the save: the device registry write already went through, and a
   * connection that could not be created is reported (`created: false`) for the
   * operator to act on, not thrown away with the whole request.
   */
  private async provisionConnection(device: Device): Promise<ConnectionProvision | null> {
    if (device.protocol !== 'opcua') return null;
    const server = String(device.connection?.['server'] ?? '').trim();
    if (server === '') return null;
    const name = server.replace(/^_/, '');
    // Already there? Then this is not a provisioning — the security pass below
    // handles an existing connection.
    if (findConnectionByName('_OPCUAServer', server) !== null || dpInstanceExists(`_${name}`)) return null;
    try {
      const answer = await callEngOrThrow('CreateOpcuaConnection', this.connectionRequest(device));
      return {
        name,
        ...(typeof answer['dp'] === 'string' ? { dp: answer['dp'] as string } : {}),
        created: answer['created'] === true,
        warnings: stringList(answer['warnings'])
      };
    } catch (error) {
      console.warn(`engController: could not create the connection '${server}':`, describeError(error));
      forgetEngManager();
      return { name, created: false, warnings: [describeError(error)] };
    }
  }

  /** Apply the declared security to the connection — never failing the save. */
  private async applySecurity(device: Device, password: string | undefined): Promise<SecurityOutcome | null> {
    try {
      return await this.applyOpcUaSecurity(device, password);
    } catch (error) {
      console.warn('engController: security write failed:', describeError(error));
      return { applied: [], warnings: [describeError(error)] };
    }
  }

  /**
   * Write the DECLARED security of an OPC UA equipment onto its live connection:
   * user (`Config.AccessInfo`), policy/mode/client certificate
   * (`Config.Security.*`) and the certificate-relaxation bits (`Config.Flags`,
   * read-modify-write so the tuning bits 0–7 survive). Only what the declaration
   * carries is touched — a connection also managed through the standard panel is
   * never reset by a save that said nothing about security (the same tri-state
   * honesty as the declarative parameters).
   *
   * The password goes through the VENDOR encryption (see the module header) and
   * `passwordSet` reports what the blob READS BACK — not what we hope happened.
   */
  private async applyOpcUaSecurity(device: Device, password: string | undefined): Promise<SecurityOutcome | null> {
    if (device.protocol !== 'opcua') return null;
    const write = opcuaSecurityWrite(device.connection);
    if (write === null && password === undefined) return null;
    const server = String(device.connection?.['server'] ?? '').trim();
    if (server === '') {
      return { applied: [], warnings: ['No server declared on the equipment — the security settings were not applied.'] };
    }
    const answer = await callEng('ApplyOpcuaSecurity', this.connectionRequest(device, password));
    if (!answer.ok) {
      return { applied: [], warnings: [answer.error ?? 'the security settings were not applied'] };
    }
    return {
      applied: stringList(answer['applied']),
      ...(typeof answer['passwordSet'] === 'boolean' ? { passwordSet: answer['passwordSet'] } : {}),
      warnings: stringList(answer['warnings'])
    };
  }

  /**
   * The manager's request body for a connection create / security apply.
   *
   * The CORE decides what it contains (`opcuaSecurityWrite`: only the declared
   * fields, the vendor's numeric policy/mode codes, the flag bits to force), so
   * the manager receives values rather than choices — and a field the operator
   * left empty is simply absent, which is what leaves the live connection alone.
   *
   * The password is passed THROUGH, never stored: it came from the request body
   * and dies with it (the service encrypts it with the project's driver
   * certificate on the other side).
   */
  private connectionRequest(device: Device, password?: string): Record<string, unknown> {
    const server = String(device.connection?.['server'] ?? '')
      .trim()
      .replace(/^_/, '');
    const write = opcuaSecurityWrite(device.connection);
    const endpoint = String(device.connection?.['endpoint'] ?? '').trim();
    return {
      name: server,
      connection: server,
      ...(endpoint === '' ? {} : { endpoint }),
      ...(device.driverNumber === undefined ? {} : { driverNumber: device.driverNumber }),
      ...(write?.user === undefined ? {} : { user: write.user }),
      ...(write?.policy === undefined ? {} : { policy: write.policy }),
      ...(write?.messageMode === undefined ? {} : { messageMode: write.messageMode }),
      ...(write?.clientCertificate === undefined ? {} : { certificate: write.clientCertificate }),
      // `{ "<bit>": bool }` — the manager applies them read-modify-write, so the
      // bits nobody named (and every future vendor bit) survive the save.
      ...(write === null || Object.keys(write.flagBits).length === 0 ? {} : { flags: write.flagBits }),
      ...(password === undefined ? {} : { password })
    };
  }

  /** Body → draft, answering 400 itself when the body is not one. */
  private readDraft(req: Request, res: Response): DeviceDraft | null {
    const draft = (req.body ?? {}).device as DeviceDraft | undefined;
    if (!draft || typeof draft.name !== 'string') {
      res.status(400).json({ ok: false, error: 'device {name, protocol, …} is required' });
      return null;
    }
    return draft;
  }

  /**
   * Re-validate with the CORE's rules — the form already did, but a client is not a
   * guard — and answer 400 + the structured `problems` when they refuse. Returns
   * true when the request was answered (the caller must stop).
   */
  private refuse(res: Response, draft: DeviceDraft, others: Device[]): boolean {
    const problems = blockingProblems(validateDevice(draft, others));
    if (problems.length === 0) return false;
    res.status(400).json({ ok: false, error: problems.map((problem) => problem.message).join(' '), problems });
    return true;
  }

  /**
   * DELETE /api/eng/devices/:id — forget an equipment.
   *
   * Its BOOKS are deliberately kept: the relation is many-to-many, so a catalog may
   * be shared with other equipments, and deleting a device must not delete a
   * catalog. Datapoints and configs already checked in are untouched too — this is
   * an engineering-registry deletion, not a project one.
   */
  public deleteDevice = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params['id']);
    const devices = this.store.listDevices<Device>();
    const remaining = devices.filter((device) => device.id !== id);
    if (remaining.length === devices.length) {
      res.status(404).json({ ok: false, error: `unknown device '${id}'` });
      return;
    }
    this.store.saveDevices(remaining);
    res.status(200).json({ ok: true, devices: await this.withLiveState(remaining) });
  };

  /**
   * Decorate the stored equipments with their LIVE connection state.
   *
   * The state is DERIVED, never stored: a JSON file cannot know whether a PLC is
   * reachable, and a stale "connected" persisted from last week would be worse than
   * no LED at all. So it is probed at read time, and each device carries WHY its state
   * says what it says (see the core's `DeviceStateSource`) plus the raw `ConnState`.
   *
   * One read per device, on `Common.State.ConnState` — the driver-agnostic element
   * every WinCC OA connection type carries, mapped by the core with the vendor's own
   * thresholds (see `deviceStateFromConnState`). A device the declaration cannot tie
   * to exactly one connection stays `unknown` and says which case it is: nothing
   * matched, several matched, or nothing to match on. Never `disconnected` — that is a
   * statement about the machine, and only a driver may make it.
   */
  private async withLiveState(devices: Device[], includePasswordSet = true): Promise<Device[]> {
    return Promise.all(
      devices.map(async (device) => {
        const connection = await this.connectionDpOf(device);
        if (connection.dp === null) {
          return {
            ...device,
            state: 'unknown' as const,
            stateSource: connection.reason,
            ...(connection.name === '' ? {} : { stateConnection: connection.name })
          };
        }
        const probed = await probeConnectionState(connection.dp);
        // "A password is set" is the only honest indicator the page may show: the
        // secret itself is write-through, so the runtime's blob is the sole record.
        const passwordSet =
          includePasswordSet && device.protocol === 'opcua'
            ? blobNonEmpty(await win().dpGet(`${connection.dp}.Config.Password`).catch(() => null))
            : undefined;
        return {
          ...device,
          state: probed.state,
          stateSource: probed.source,
          stateConnection: connection.name,
          ...(probed.code === undefined ? {} : { stateCode: probed.code }),
          ...(passwordSet === undefined ? {} : { passwordSet })
        };
      })
    );
  }

  /**
   * The connection datapoint whose state stands for this equipment.
   *
   * Two ways in, tried in this order because they carry different certainty:
   *  1. an OPC UA REFERENCE NAME (`server` parameter, or the connection of one of the
   *     device's OPC UA catalogs) — the same name its addresses are bound through, so
   *     the match is exact;
   *  2. the declared ADDRESS (`ip`, or the host of an `endpoint`), searched in the
   *     address element of the protocol's connection type. A single hit is the
   *     connection; SEVERAL hits are reported as ambiguous rather than resolved by
   *     picking one — two stations behind one address is precisely the case where a
   *     wrong LED would send an engineer to the wrong panel.
   *
   * A named reference that matches NOTHING falls through to the address rather than
   * ending the search: a declaration typed from memory (`simu1` where the project has
   * `Simulator1`) is a wrong *name*, not a missing machine, and the endpoint beside it
   * often still identifies the connection. What must not happen is silently binding the
   * state to a connection the operator did not name — hence the ambiguity report, and
   * the form now picking the name from the project (see `eng-connection-select.ts`).
   *
   * `reason` is what the state falls back to when there is no datapoint to read.
   */
  private async connectionDpOf(device: Device): Promise<ConnectionMatch> {
    const typeName = CONNECTION_DP_TYPE[device.protocol ?? ''] ?? '';
    const reference = this.opcUaConnectionOf(device);
    if (reference !== null) {
      const dp = findConnectionByName('_OPCUAServer', reference);
      if (dp !== null) return { dp, name: reference };
    }
    // Classic S7 may NAME its connection too. Tried before the address search for
    // the same reason OPC UA is: a name is an exact match, while an address is a
    // substring of an element that also holds the rack and the slot — so two
    // stations on one PLC resolve to `ambiguous-connection` and light no lamp,
    // when the operator knew perfectly well which connection they meant.
    const declared = device.protocol === 's7' ? String(device.connection?.['connection'] ?? '').trim() : '';
    if (declared !== '') {
      const dp = findConnectionByName('_S7_Conn', declared);
      if (dp !== null) return { dp, name: declared };
    }
    const address = declaredAddressOf(device);
    const named = reference ?? (declared === '' ? '' : declared);
    if (typeName === '' || address === '') {
      return named === '' ? { dp: null, name: '', reason: 'unprobed' } : { dp: null, name: named, reason: 'unknown-connection' };
    }
    const matches = await findConnectionsByAddress(typeName, address);
    const single = matches[0];
    // One hit binds the state to THAT datapoint, and the badge names it — so an
    // equipment matched through its address never looks like it was matched by name.
    if (matches.length === 1 && single !== undefined) return { dp: single, name: single };
    if (matches.length > 1) return { dp: null, name: address, reason: 'ambiguous-connection' };
    // Nothing at all: report the name the operator gave when there was one, since that
    // is what they can fix (the form now offers the project's list beside it).
    return { dp: null, name: named === '' ? address : named, reason: 'unknown-connection' };
  }

  /**
   * The OPC UA connection REFERENCE this device addresses through, or `null`.
   *
   * The device's own `server` parameter first (what the declaration form fills in),
   * then the first OPC UA interface among its catalogs — a device may aggregate
   * several servers, and the one that answers is named beside the LED
   * (`stateConnection`), so the badge never speaks for an interface it did not read.
   */
  private opcUaConnectionOf(device: Device): string | null {
    const declared = String(device.connection?.['server'] ?? '').trim();
    if (device.protocol === 'opcua' && declared !== '') return declared;
    const fromBook = this.allBooks()
      .filter((book) => device.bookIds.includes(book.id))
      .map((book) => (book.interface?.protocol === 'opcua' ? (book.interface.connection ?? '').trim() : ''))
      .find((name) => name !== '');
    return fromBook === undefined || fromBook === '' ? null : fromBook;
  }

  // --- address books ---------------------------------------------------------

  /**
   * Books are stored qualified. ACCESS overrides are applied FIRST, then the role
   * rules — several structural rules match on the access mode, so qualifying
   * before fixing the access would classify from a value the operator corrected.
   */
  private qualified(book: AddressBook): AddressBook {
    const access = this.store.readAccess(book.id) as Record<string, TagAccess>;
    const entries = withAccess(book.entries, access);
    const manual = this.store.readRoles(book.id) as Record<string, SignalRole>;
    const assignments = classifyEntries(entries, DEFAULT_ROLE_RULES, manual);
    // `asEngWarnings` tolerates the plain strings of books stored BEFORE the
    // structured warnings, so an existing store keeps loading (see core warnings.ts).
    return { ...book, entries: withRoles(entries, assignments), warnings: asEngWarnings(book.warnings) };
  }

  /**
   * What a CLIENT sees: the qualified book minus the signals hidden by hand, plus a
   * warning stating how many are hidden.
   *
   * Kept apart from {@link qualified} on purpose. `qualified()` is what gets STORED,
   * and the store must keep the full reading of the source: if the exclusion were
   * folded in before `saveBook`, hiding a signal would delete it from the catalog and
   * "restore" would have nothing to restore.
   */
  private presented(book: AddressBook): AddressBook {
    const qualified = this.qualified(book);
    const excluded = Object.keys(this.store.readExcluded(book.id));
    if (excluded.length === 0) return qualified;
    const entries = withoutExcluded(qualified.entries, excluded);
    const hidden = qualified.entries.length - entries.length;
    return {
      ...qualified,
      entries,
      excludedPaths: excluded,
      warnings: hidden === 0 ? qualified.warnings : [excludedWarning(hidden, qualified.entries.length), ...qualified.warnings]
    };
  }

  /** Every stored book, as a client sees it (`/books` and every mutation return it). */
  private allBooks(): AddressBook[] {
    return this.store
      .listBookIds()
      .map((id) => this.store.readBook<AddressBook>(id))
      .filter((book): book is AddressBook => book !== null)
      .map((book) => this.presented(book));
  }

  public listBooks = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, books: this.allBooks() });
  };

  public getBook = (req: Request, res: Response): void => {
    const book = this.store.readBook<AddressBook>(String(req.params['id']));
    res.status(200).json({ ok: true, book: book === null ? null : this.presented(book) });
  };

  /**
   * POST /api/eng/books  body { bookId, name?, interface? }
   *
   * Create an EMPTY catalog. This is what makes "declare the catalog, then browse
   * into it" possible: a walk of a large server takes minutes, and committing the
   * identity (id, name, interface, driver) first means the operator is not holding a
   * form open while it runs — and that a walk interrupted half-way leaves a catalog
   * to retry into rather than nothing at all.
   *
   * Refuses to overwrite: replacing a catalog is what a re-browse does, deliberately.
   */
  public createBook = (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as { bookId?: string; name?: string; interface?: AddressBook['interface'] };
    if (!body.bookId) {
      res.status(400).json({ ok: false, error: 'bookId is required' });
      return;
    }
    if (this.store.readBook<AddressBook>(body.bookId) !== null) {
      res.status(409).json({ ok: false, error: `a catalog '${body.bookId}' already exists` });
      return;
    }
    const book: AddressBook = {
      id: body.bookId,
      name: body.name ?? body.bookId,
      provenance: { kind: 'manual', generatedAt: new Date().toISOString(), detail: 'declared, not yet generated' },
      ...(body.interface === undefined ? {} : { interface: body.interface }),
      entries: [],
      types: [],
      warnings: []
    };
    this.store.saveBook(book);
    res.status(201).json({ ok: true, book, books: this.allBooks() });
  };

  /**
   * PUT /api/eng/books/:id  body { book }
   *
   * Store a book the CLIENT built. This is the landing point of the client-driven
   * walk (see `data/walk.ts`): the page runs the core's walker level by level so it
   * can show progress and be cancelled, and then has a finished book to persist.
   *
   * Not a hole: the generator is the SAME core module on both sides, the route is
   * gated by `manage-devices` like every other catalog write, and the id comes from
   * the PATH — a body claiming another id cannot overwrite another catalog. The
   * server still owns qualification: roles, access and exclusions are re-applied
   * here, exactly as for a server-side browse.
   */
  public putBook = (req: Request, res: Response): void => {
    const id = String(req.params['id']);
    const book = (req.body ?? {}).book as AddressBook | undefined;
    if (!book || !Array.isArray(book.entries) || typeof book.provenance !== 'object') {
      res.status(400).json({ ok: false, error: 'book {provenance, entries[], …} is required' });
      return;
    }
    const stored: AddressBook = { ...book, id };
    this.store.saveBook(this.qualified(stored));
    res.status(200).json({ ok: true, book: this.presented(stored), books: this.allBooks() });
  };

  /**
   * POST /api/eng/books/:id/exclude  body { excluded: {path: boolean} }
   *
   * Hide (or restore) signals by hand. `true` hides, `false` restores; the book
   * itself is untouched, so a re-browse keeps the operator's choices and every
   * hidden signal can come back.
   */
  public saveBookExcluded = (req: Request, res: Response): void => {
    const id = String(req.params['id']);
    const excluded = (req.body ?? {}).excluded as Record<string, boolean> | undefined;
    if (excluded === undefined || typeof excluded !== 'object') {
      res.status(400).json({ ok: false, error: 'excluded {path: boolean} is required' });
      return;
    }
    const book = this.store.readBook<AddressBook>(id);
    if (book === null) {
      res.status(404).json({ ok: false, error: 'unknown book' });
      return;
    }
    this.store.saveExcluded(id, excluded);
    res.status(200).json({ ok: true, book: this.presented(book) });
  };

  /**
   * POST /api/eng/browse/level  body { connection, nodeId? } -> { nodes }
   *
   * ONE level of an OPC UA address space. Two things need it, and neither can use
   * `/books/browse` (which walks everything server-side and answers once, minutes
   * later): **exploring** a server before committing to a catalog, and running the
   * walk from the CLIENT so it can report progress. The walker itself is the core's
   * — the page drives the same verified code over this endpoint.
   */
  public browseLevel = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { connection?: string; nodeId?: string };
    if (!body.connection) {
      res.status(400).json({ ok: false, error: CONNECTION_REQUIRED });
      return;
    }
    try {
      const nodes = await this.browsePort.browseLevel(body.connection, body.nodeId ?? OPCUA_OBJECTS_FOLDER);
      res.status(200).json({ ok: true, nodes });
    } catch (error) {
      res.status(502).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * DELETE /api/eng/books/:id — forget a catalog.
   *
   * The counterpart of `deleteDevice`, and deliberately NOT its mirror: deleting a
   * device keeps its books (they may be shared), but deleting a book must DETACH it
   * from every equipment that references it — a `bookIds` entry pointing at a file
   * that no longer exists would make those equipments render a phantom catalog.
   * Nothing already checked in is touched: the addresses written from this catalog
   * live in the project, not here.
   *
   * Returns the fresh books AND devices, since both registries just changed.
   */
  public deleteBook = (req: Request, res: Response): void => {
    const id = String(req.params['id']);
    if (this.store.readBook<AddressBook>(id) === null) {
      res.status(404).json({ ok: false, error: `unknown book '${id}'` });
      return;
    }
    const devices = this.store.listDevices<Device>();
    const detached = devices.map((device) =>
      device.bookIds.includes(id) ? { ...device, bookIds: device.bookIds.filter((bookId) => bookId !== id) } : device
    );
    if (detached.some((device, at) => device !== devices[at])) this.store.saveDevices(detached);
    this.store.deleteBook(id);
    res.status(200).json({ ok: true, books: this.allBooks(), devices: detached });
  };

  /**
   * POST /api/eng/books/:id/refresh
   *
   * Re-read the book's SOURCE when that is possible, then re-qualify:
   *  - `opcua-browse` with replayable `provenance.browse` → **re-browse the live
   *    server** with the very same parameters, and return the delta;
   *  - anything else (file-based, AI, manual) → re-run the role rules only. A file
   *    book is regenerated by re-ingesting its source (`/books/ingest`), because
   *    the server does not keep the uploaded document.
   *
   * The delta is the point of a refresh: `removed` entries may still be referenced
   * by a workspace, and silently swapping the catalog under a model is how a
   * project ends up with addresses pointing at nodes that no longer exist.
   */
  public refreshBook = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params['id']);
    const previous = this.store.readBook<AddressBook>(id);
    if (previous === null) {
      res.status(404).json({ ok: false, error: 'unknown book' });
      return;
    }
    const source = previous.provenance.browse;
    const replayable = previous.provenance.kind === 'opcua-browse' || previous.provenance.kind === 's7plus-browse';
    if (!replayable || source === undefined) {
      const qualified = this.qualified(previous);
      this.store.saveBook(qualified);
      res.status(200).json({
        ok: true,
        book: this.presented(previous),
        rebrowsed: false,
        note: replayable
          ? 'Carnet parcouru avant l’enregistrement des paramètres de parcours : relancer un parcours pour le rendre rafraîchissable.'
          : 'Source hors ligne : seules les règles de qualification ont été rejouées. Ré-ingérer le fichier source pour régénérer le catalogue.'
      });
      return;
    }
    try {
      // Each protocol replays with its OWN walker: the recorded parameters are the
      // ones of the walk that produced the book, and an S7Plus source is a
      // `project|station` where an OPC UA one is a node id.
      const fresh =
        previous.provenance.kind === 's7plus-browse'
          ? await buildBookFromS7PlusBrowse(this.s7plusPort, {
              ...source,
              station: source.station ?? S7PLUS_ONLINE_STATION,
              bookId: previous.id,
              name: previous.name,
              ...(previous.interface?.driverNumber === undefined ? {} : { driverNumber: previous.interface.driverNumber })
            })
          : await buildBookFromOpcUaBrowse(this.browsePort, {
              ...source,
              bookId: previous.id,
              name: previous.name,
              driverNumber: previous.interface?.driverNumber
            });
      const delta = diffBooks(previous, fresh);
      const stored = this.withRefreshWarnings(fresh, delta);
      this.store.saveBook(this.qualified(stored));
      res.status(200).json({ ok: true, book: this.presented(stored), rebrowsed: true, delta: this.summariseDelta(delta) });
    } catch (error) {
      // A failed re-browse must NOT destroy the stored catalog.
      res.status(502).json({ ok: false, error: describeError(error), book: this.presented(previous) });
    }
  };

  /** Paths of a delta (the full entries would bloat the response). */
  private summariseDelta(delta: BookDiff): { added: string[]; removed: string[]; changed: string[] } {
    return {
      added: delta.added.map((e) => e.path),
      removed: delta.removed.map((e) => e.path),
      changed: delta.changed.map((c) => c.after.path)
    };
  }

  /** Surface a destructive refresh in the book itself, where the operator looks. */
  private withRefreshWarnings(book: AddressBook, delta: BookDiff): AddressBook {
    return { ...book, warnings: [...refreshWarnings(delta), ...book.warnings] };
  }

  // --- online OPC UA browse ---------------------------------------------------

  /** GET /api/eng/connections — the project's OPC UA connections, browsable. */
  public connections = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json({ ok: true, connections: await listOpcUaConnections() });
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * GET /api/eng/drivers -> { drivers: [{ number, type, running, mode? }] }
   *
   * The project's drivers, so the device form OFFERS the manager number instead of
   * asking an engineer to remember it. It is not cosmetic: `driverNumber` is what
   * every `_address` write of the equipment lands on, a wrong one silently binds
   * the datapoint to another driver, and auto-detection only covers OPC UA (see
   * `resolveAddressContext`). Stopped drivers are listed too — an equipment is
   * declared before its driver is started — with their state, never filtered out.
   *
   * Never fatal: an empty list means "could not tell", and the form falls back to
   * free entry.
   */
  public drivers = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json({ ok: true, drivers: await listProjectDrivers() });
    } catch (error) {
      res.status(200).json({ ok: true, drivers: [], warning: describeError(error) });
    }
  };

  /**
   * GET /api/eng/dptypes            -> { types: string[] }
   * GET /api/eng/dptypes/:name      -> { type: { typeName, structure } }
   *
   * The project's DP TYPES, so a model can be started from one that already exists — the
   * common case on a project that was engineered in PARA before the studio arrived. Internal
   * types (`_`-prefixed) are left out of the list: they are the runtime's own and a model of
   * one would be meaningless.
   *
   * The list is names only; the structure is read on demand, because reading every type of a
   * real project to fill a picker would cost far more than the one the operator picks.
   */
  public listDpTypes = async (_req: Request, res: Response): Promise<void> => {
    try {
      const names = ((win().dpTypes('*') ?? []) as string[])
        .map(String)
        .filter((name) => name.length > 0 && !name.startsWith('_'))
        .sort((a, b) => a.localeCompare(b));
      res.status(200).json({ ok: true, types: [...new Set(names)] });
    } catch (error) {
      res.status(200).json({ ok: true, types: [], warning: describeError(error) });
    }
  };

  public readDpType = async (req: Request, res: Response): Promise<void> => {
    const name = String(req.params['name'] ?? '').trim();
    if (name === '') {
      res.status(400).json({ ok: false, error: 'a DP type name is required' });
      return;
    }
    try {
      const structure = structureOf(win().dpTypeGet(name));
      res.status(200).json({ ok: true, type: { typeName: name, structure } });
    } catch (error) {
      res.status(404).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * GET /api/eng/dps?pattern=&type=&limit= -> { dps: string[], truncated }
   *
   * Search the project's datapoints — what the model editor's magnifier offers when the
   * value wanted is a datapoint the studio's own lists do not carry (an alert class added
   * by a customer, a group named outside the convention). `dpNames` does the matching, so
   * the wildcards are WinCC OA's own; the result is capped and the truncation reported,
   * because a bare `*` on a real project answers with tens of thousands of names.
   */
  public searchDps = async (req: Request, res: Response): Promise<void> => {
    const pattern = String(req.query['pattern'] ?? '*').trim() || '*';
    const type = req.query['type'] === undefined ? '' : String(req.query['type']).trim();
    const limit = Math.min(Math.max(Number(req.query['limit'] ?? 200), 1), 2000);
    try {
      const raw: string[] = (type === '' ? win().dpNames(pattern) : win().dpNames(pattern, type)) ?? [];
      const names = [...new Set(raw.map((name) => bareDpName(name)).filter((name) => name !== ''))].sort((a, b) =>
        a.localeCompare(b)
      );
      res.status(200).json({ ok: true, dps: names.slice(0, limit), truncated: names.length > limit });
    } catch (error) {
      res.status(200).json({ ok: true, dps: [], truncated: false, warning: describeError(error) });
    }
  };

  /**
   * GET /api/eng/config-options -> { alarmClasses: string[], archiveGroups: string[] }
   *
   * What a deployment decision may REFER TO in this project: the `_AlertClass` datapoints
   * and the usable `_NGA_Group` ones. One endpoint because the model editor needs both at
   * once, on the same screen, for every leaf.
   *
   * Never fatal — an empty list means "could not tell" and the editor falls back to free
   * entry, which is also what keeps a class or group created after this read usable.
   */
  public configOptions = async (_req: Request, res: Response): Promise<void> => {
    try {
      const [alarmClasses, archiveGroups, subscriptions] = await Promise.all([
        listAlarmClasses(),
        listArchiveGroups(),
        listOpcUaSubscriptions()
      ]);
      res.status(200).json({ ok: true, alarmClasses, archiveGroups, subscriptions, pollGroups: POLL_GROUPS.map((group) => group.name) });
    } catch (error) {
      res.status(200).json({ ok: true, alarmClasses: [], archiveGroups: [], subscriptions: [], pollGroups: [], warning: describeError(error) });
    }
  };

  /**
   * POST /api/eng/books/browse
   * body { bookId, connection, name?, rootNodeId?, maxDepth?, maxEntries?, maxRequests?, driverNumber? }
   *
   * Walk a live OPC UA server into an address book and store it. Replaces a book
   * of the same id (that is what "re-browse" means), and returns the delta when
   * one existed — same contract as `/books/:id/refresh`.
   */
  public browseBook = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as {
      bookId?: string;
      connection?: string;
      name?: string;
      rootNodeId?: string;
      maxDepth?: number;
      maxEntries?: number;
      maxRequests?: number;
      driverNumber?: number;
    };
    if (!body.bookId || !body.connection) {
      res.status(400).json({ ok: false, error: 'bookId and connection are required' });
      return;
    }
    const previous = this.store.readBook<AddressBook>(body.bookId);
    try {
      const fresh = await buildBookFromOpcUaBrowse(this.browsePort, {
        bookId: body.bookId,
        connection: body.connection,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.rootNodeId === undefined ? {} : { rootNodeId: body.rootNodeId }),
        ...(body.maxDepth === undefined ? {} : { maxDepth: body.maxDepth }),
        ...(body.maxEntries === undefined ? {} : { maxEntries: body.maxEntries }),
        ...(body.maxRequests === undefined ? {} : { maxRequests: body.maxRequests }),
        ...(body.driverNumber === undefined ? {} : { driverNumber: body.driverNumber })
      });
      const delta = previous === null ? null : diffBooks(previous, fresh);
      const stored = delta === null ? fresh : this.withRefreshWarnings(fresh, delta);
      this.store.saveBook(this.qualified(stored));
      res.status(200).json({
        ok: true,
        book: this.presented(stored),
        rebrowsed: true,
        ...(delta === null ? {} : { delta: this.summariseDelta(delta) })
      });
    } catch (error) {
      res.status(502).json({ ok: false, error: describeError(error) });
    }
  };

  // --- online S7Plus browse (through the s7plusBrowse JS manager) ------------
  //
  // Same four shapes as the OPC UA side — list what can be browsed, one level,
  // one whole walk — with the two differences the protocol imposes: a source is a
  // TIA `project|station` (or the reserved online marker) rather than a node id,
  // and the dialogue goes through the dedicated manager rather than this process
  // (`engS7PlusBrowse.ts` says why). Everything here reports the manager's absence
  // as its own problem: "no S7Plus connection" and "the browse service is not
  // installed" send an engineer to two different places.

  /** GET /api/eng/s7plus/connections — the project's S7Plus connections. */
  public s7plusConnections = async (_req: Request, res: Response): Promise<void> => {
    const { connections, warning } = await listS7PlusConnections();
    res.status(200).json({ ok: true, connections, ...(warning === undefined ? {} : { warning }) });
  };

  /**
   * GET /api/eng/s7plus/health -> { ok, manager }
   *
   * Whether the browse service is reachable, and what it can see (S7Plus drivers
   * running, connections declared). The page needs the distinction: with no
   * manager there is nothing to fix on the PLC side.
   */
  public s7plusHealth = async (_req: Request, res: Response): Promise<void> => {
    const health = await s7plusManagerHealth();
    res.status(200).json({
      ok: true,
      manager:
        health === null
          ? { reachable: false, error: "le manager 's7plusBrowse' est injoignable (déployé et démarré dans pmon ?)" }
          : { reachable: true, ...health }
    });
  };

  /**
   * POST /api/eng/s7plus/projects  body { connection } -> { projects }
   *
   * The browsable SOURCES of a connection: the TIA exports the driver found under
   * `<proj>/data/TIA_Projects`, plus the reserved online project that reads the
   * live PLC.
   */
  public s7plusProjects = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { connection?: string };
    if (!body.connection) {
      res.status(400).json({ ok: false, error: CONNECTION_REQUIRED });
      return;
    }
    try {
      const result = await listS7PlusProjects(body.connection);
      res.status(result.ok ? 200 : 502).json(result);
    } catch (error) {
      res.status(502).json({ ok: false, error: describeError(error) });
    }
  };

  /** POST /api/eng/s7plus/stations  body { connection, project } -> { stations } */
  public s7plusStations = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { connection?: string; project?: string };
    if (!body.connection || !body.project) {
      res.status(400).json({ ok: false, error: 'connection and project are required' });
      return;
    }
    try {
      const result = await listS7PlusStations(body.connection, body.project);
      res.status(result.ok ? 200 : 502).json(result);
    } catch (error) {
      res.status(502).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * POST /api/eng/s7plus/level  body { connection, item?, hmiVisibleOnly? } -> { nodes }
   *
   * ONE level, for the same two reasons as its OPC UA twin: exploring a station
   * before committing to a catalog, and letting the PAGE drive the core's walker so
   * it can show progress and be cancelled. `item` defaults to the projects list.
   */
  public s7plusLevel = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { connection?: string; item?: string; hmiVisibleOnly?: boolean };
    if (!body.connection) {
      res.status(400).json({ ok: false, error: CONNECTION_REQUIRED });
      return;
    }
    try {
      const nodes = await this.s7plusPort.browseLevel(body.connection, body.item ?? '', body.hmiVisibleOnly !== false);
      res.status(200).json({ ok: true, nodes });
    } catch (error) {
      res.status(502).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * POST /api/eng/books/browse-s7plus
   * body { bookId, connection, station?, name?, root?, hmiVisibleOnly?, maxDepth?,
   *        maxEntries?, maxRequests?, maxArrayElements?, driverNumber? }
   *
   * Walk an S7-1200/1500 station into an address book and store it, server-side in
   * one call. Replaces a book of the same id (that is what a re-browse is) and
   * returns the delta when one existed — same contract as `/books/browse`.
   *
   * `station` defaults to the ONLINE marker: asking to browse an S7Plus connection
   * without saying which TIA export to read means "read the machine".
   */
  public browseS7PlusBook = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as {
      bookId?: string;
      connection?: string;
      station?: string;
      name?: string;
      root?: string;
      hmiVisibleOnly?: boolean;
      maxDepth?: number;
      maxEntries?: number;
      maxRequests?: number;
      maxArrayElements?: number;
      driverNumber?: number;
    };
    if (!body.bookId || !body.connection) {
      res.status(400).json({ ok: false, error: 'bookId and connection are required' });
      return;
    }
    const previous = this.store.readBook<AddressBook>(body.bookId);
    try {
      const fresh = await buildBookFromS7PlusBrowse(this.s7plusPort, {
        bookId: body.bookId,
        connection: body.connection,
        station: body.station ?? S7PLUS_ONLINE_STATION,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.root === undefined ? {} : { root: body.root }),
        ...(body.hmiVisibleOnly === undefined ? {} : { hmiVisibleOnly: body.hmiVisibleOnly }),
        ...(body.maxDepth === undefined ? {} : { maxDepth: body.maxDepth }),
        ...(body.maxEntries === undefined ? {} : { maxEntries: body.maxEntries }),
        ...(body.maxRequests === undefined ? {} : { maxRequests: body.maxRequests }),
        ...(body.maxArrayElements === undefined ? {} : { maxArrayElements: body.maxArrayElements }),
        ...(body.driverNumber === undefined ? {} : { driverNumber: body.driverNumber })
      });
      const delta = previous === null ? null : diffBooks(previous, fresh);
      const stored = delta === null ? fresh : this.withRefreshWarnings(fresh, delta);
      this.store.saveBook(this.qualified(stored));
      res.status(200).json({
        ok: true,
        book: this.presented(stored),
        rebrowsed: true,
        ...(delta === null ? {} : { delta: this.summariseDelta(delta) })
      });
    } catch (error) {
      res.status(502).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * POST /api/eng/books/:id/access  body { access: {path: 'r'|'w'|'rw'} }
   *
   * Manual ACCESS overrides. This is what makes a browse without `AccessLevel`
   * usable: the operator marks the writable signals, the override counts as
   * evidence (`accessSource: 'manual'`) and the generated address direction follows.
   * An empty string clears an override.
   */
  public saveBookAccess = (req: Request, res: Response): void => {
    const id = String(req.params['id']);
    const access = (req.body ?? {}).access as Record<string, string> | undefined;
    if (access === undefined || typeof access !== 'object') {
      res.status(400).json({ ok: false, error: "access {path: 'r'|'w'|'rw'} is required" });
      return;
    }
    const invalid = Object.entries(access).filter(([, mode]) => !['r', 'w', 'rw', ''].includes(mode));
    if (invalid.length > 0) {
      res.status(400).json({ ok: false, error: `invalid access mode(s): ${invalid.map(([p, m]) => `${p}='${m}'`).join(', ')}` });
      return;
    }
    const book = this.store.readBook<AddressBook>(id);
    if (book === null) {
      res.status(404).json({ ok: false, error: 'unknown book' });
      return;
    }
    this.store.saveAccess(id, access);
    this.store.saveBook(this.qualified(book));
    res.status(200).json({ ok: true, book: this.presented(book) });
  };

  /** POST /api/eng/books/:id/roles  body { roles } — manual role overrides. */
  public saveBookRoles = (req: Request, res: Response): void => {
    const id = String(req.params['id']);
    const roles = (req.body ?? {}).roles as Record<string, string> | undefined;
    if (roles === undefined || typeof roles !== 'object') {
      res.status(400).json({ ok: false, error: 'roles {path: role} is required' });
      return;
    }
    const book = this.store.readBook<AddressBook>(id);
    if (book === null) {
      res.status(404).json({ ok: false, error: 'unknown book' });
      return;
    }
    this.store.saveRoles(id, roles);
    this.store.saveBook(this.qualified(book));
    res.status(200).json({ ok: true, book: this.presented(book) });
  };

  /**
   * POST /api/eng/books/ingest
   * body { bookId, name?, format, interface?, documents? | text? | xml? }
   *
   * Builds an address book with the core's file generators and stores it:
   *   simaticml → documents[{fileName,xml}]   (TIA Openness export bundle)
   *   xvm       → xml                          (Control Expert XVM/XSY)
   *   csv       → text                         (Control Expert variables export)
   *   nodeset   → xml                          (OPC UA NodeSet2 / companion spec)
   */
  // --- classic S7: the ONLINE side is a verifier, never a generator ----------

  /**
   * POST /api/eng/s7/probe  body { deviceId } | { host, rack?, slot? }
   *   -> { ok, cpu, pduLength, endpoint }
   *
   * "Which machine answers at this address?" — one connect, no block walk. It is
   * the question an operator asks before trusting anything else the CPU says, and
   * it is cheap enough to ask from a form.
   *
   * A `deviceId` is preferred to a typed address for the same reason the OPC UA
   * form picks a connection from the project rather than accepting an endpoint
   * from memory: the equipment already declares its ip/rack/slot, and a second
   * declaration is a second thing to keep in step.
   */
  /**
   * GET /api/eng/s7/connections -> { connections }
   *
   * What the device form offers for a classic-S7 equipment, so a connection is
   * PICKED from the project rather than typed from memory — the same rule the OPC
   * UA form follows, and the thing that makes the connection state exact.
   */
  public s7Connections = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json({ ok: true, connections: await listS7Connections() });
    } catch (error) {
      // Never fail the form on a listing: it degrades to free entry.
      console.warn('engController.s7Connections:', describeError(error));
      res.status(200).json({ ok: true, connections: [], warning: describeError(error) });
    }
  };

  public s7Probe = async (req: Request, res: Response): Promise<void> => {
    const endpoint = this.s7EndpointFrom(req.body ?? {});
    if ('error' in endpoint) {
      res.status(400).json({ ok: false, error: endpoint.error });
      return;
    }
    try {
      res.status(200).json(await probeS7(endpoint));
    } catch (error) {
      res.status(502).json({ ok: false, error: describeError(error), manager: 's7Browse' });
    }
  };

  /**
   * POST /api/eng/books/:id/s7-inventory  body { deviceId } | { host, rack?, slot? }
   *   -> { ok, inventory, crossCheck }
   *
   * Read the CPU's block directory and say how far this catalog — built from the
   * project's STEP 7 exports — is still true of the machine that is running now.
   *
   * The book is NOT modified. A catalog is a reading of the project and an
   * inventory is a reading of the machine; storing the reconciliation would
   * destroy the only thing worth having, which is that the two disagree. The
   * verdicts come back beside the book and the operator decides — re-export, or
   * fix the PLC.
   */
  public s7Inventory = async (req: Request, res: Response): Promise<void> => {
    const bookId = String(req.params['id'] ?? '');
    const book = this.store.readBook<AddressBook>(bookId);
    if (book === null) {
      res.status(404).json({ ok: false, error: `catalog '${bookId}' not found` });
      return;
    }
    const endpoint = this.s7EndpointFrom(req.body ?? {});
    if ('error' in endpoint) {
      res.status(400).json({ ok: false, error: endpoint.error });
      return;
    }
    try {
      const body = (req.body ?? {}) as { maxBlocks?: number; withBlockInfo?: boolean; connection?: string };
      const result = await inventoryS7(
        {
          ...endpoint,
          ...(body.maxBlocks === undefined ? {} : { maxBlocks: Number(body.maxBlocks) }),
          ...(body.withBlockInfo === undefined ? {} : { withBlockInfo: body.withBlockInfo !== false })
        },
        body.connection ?? book.interface?.connection
      );
      if (result.inventory === undefined) {
        res.status(200).json({ ok: false, error: result.error });
        return;
      }
      // The verdicts are the PURE core's, exactly as the offline demo computes
      // them: the manager speaks the protocol, the core decides what it means.
      const crossCheck: S7CrossCheck = crossCheckBookAgainstInventory(this.presented(book), result.inventory);
      const inventory: S7Inventory = result.inventory;
      res.status(200).json({ ok: true, inventory, crossCheck });
    } catch (error) {
      res.status(502).json({ ok: false, error: describeError(error), manager: 's7Browse' });
    }
  };

  /**
   * Where to dial, from a device id or from an explicit address.
   *
   * Returns a REFUSAL naming what is missing rather than a default: an inventory
   * sent to the wrong host would report a catalog's blocks as absent and send an
   * engineer looking for a fault in a PLC that is perfectly fine.
   */
  private s7EndpointFrom(body: Record<string, unknown>): { host: string; rack: number; slot: number; timeoutMs?: number } | { error: string } {
    const timeout = body['timeoutMs'] === undefined ? {} : { timeoutMs: Number(body['timeoutMs']) };
    const deviceId = String(body['deviceId'] ?? '');
    if (deviceId !== '') {
      const device = this.store.listDevices<Device>().find((candidate) => candidate.id === deviceId);
      if (device === undefined) return { error: `equipment '${deviceId}' not found` };
      const endpoint = s7EndpointOf(device);
      if (endpoint === null) {
        return {
          error:
            device.protocol === 's7'
              ? `equipment '${device.name}' declares no IP address — fill it in on the equipment before reading its CPU`
              : `equipment '${device.name}' speaks ${device.protocol}, not classic S7 — there is no block directory to read`
        };
      }
      return { ...endpoint, ...timeout };
    }
    const host = String(body['host'] ?? '').trim();
    if (host === '') return { error: 'deviceId, or host (the PLC IP address), is required' };
    return { host, rack: Number(body['rack'] ?? 0), slot: Number(body['slot'] ?? 2), ...timeout };
  }

  public ingestBook = (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as {
      bookId?: string;
      name?: string;
      format?: IngestFormat;
      interface?: AddressBook['interface'];
      documents?: { fileName: string; xml: string }[];
      xml?: string;
      text?: string;
      /** `s7awl`: the AWL/STL sources (plain text, not XML — see the core's ingest). */
      sources?: { fileName: string; text: string }[];
      /** `s7awl`: the symbol table, read for its BLOCK DIRECTORY only. */
      symbolText?: string;
      file?: string;
    };
    if (!body.bookId || !body.format) {
      res.status(400).json({ ok: false, error: 'bookId and format (simaticml | s7sym | s7awl | xvm | csv | nodeset) are required' });
      return;
    }
    try {
      // ONE decision, shared with the offline demo and with the page's import
      // preview (see the core's ingest.ts): a preview that chose the generator
      // differently from the ingestion would be worse than no preview at all.
      const book = buildBookFromIngest({
        bookId: body.bookId,
        format: body.format,
        generatedAt: new Date().toISOString(),
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.file === undefined ? {} : { file: body.file }),
        ...(body.interface === undefined ? {} : { interface: body.interface }),
        ...(body.documents === undefined ? {} : { documents: body.documents }),
        ...(body.xml === undefined ? {} : { xml: body.xml }),
        ...(body.text === undefined ? {} : { text: body.text }),
        ...(body.sources === undefined ? {} : { sources: body.sources }),
        ...(body.symbolText === undefined ? {} : { symbolText: body.symbolText })
      });
      this.store.saveBook(this.qualified(book));
      // The books list travels back too: an ingestion from the catalogue panel adds
      // a row to a registry the client is showing, and re-fetching it would race.
      res.status(200).json({ ok: true, book: this.presented(book), books: this.allBooks() });
    } catch (error) {
      res.status(400).json({ ok: false, error: describeError(error) });
    }
  };

  // --- reusable model templates ----------------------------------------------

  /** GET /api/eng/models -> { models } — the reusable models, newest name order. */
  public listModels = (_req: Request, res: Response): void => {
    const models = this.store
      .listModelIds()
      .map((id) => this.store.readModel<ModelTemplate>(id))
      .filter((model): model is ModelTemplate => model !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    res.status(200).json({ ok: true, models });
  };

  /**
   * POST /api/eng/models  body { model }
   *
   * Create or replace one reusable model. `edit-model`, not `manage-devices`: a
   * template IS the engineering output being authored, like a workspace — it writes
   * nothing to the project.
   *
   * The id is derived from the name when absent, so a client cannot invent one that
   * would not survive the store's own sanitising.
   */
  public saveModel = (req: Request, res: Response): void => {
    const model = (req.body ?? {}).model as ModelTemplate | undefined;
    if (!model || typeof model.name !== 'string' || model.name.trim() === '' || typeof model.typeName !== 'string') {
      res.status(400).json({ ok: false, error: 'model {name, typeName, structure, bindings} is required' });
      return;
    }
    const stored: ModelTemplate = {
      ...model,
      id: model.id && model.id.trim() !== '' ? model.id : templateIdFrom(model.name),
      savedAt: new Date().toISOString()
    };
    this.store.saveModel(stored);
    res.status(200).json({ ok: true, model: stored });
  };

  public deleteModel = (req: Request, res: Response): void => {
    const id = String(req.params['id']);
    if (this.store.readModel<ModelTemplate>(id) === null) {
      res.status(404).json({ ok: false, error: `unknown model '${id}'` });
      return;
    }
    this.store.deleteModel(id);
    res.status(200).json({ ok: true });
  };

  // --- workspace -------------------------------------------------------------

  /** GET /api/eng/workspace?name= — the working copy (default: the first one). */
  public getWorkspace = (req: Request, res: Response): void => {
    const requested = req.query['name'] === undefined ? undefined : String(req.query['name']);
    const name = requested ?? this.store.listWorkspaceNames()[0];
    const workspace =
      name === undefined
        ? null
        : this.store.readWorkspace<Workspace>(name);
    res.status(200).json({
      ok: true,
      workspace: workspace ?? { name: requested ?? 'default', types: [], dps: [], configs: {}, baseline: {} }
    });
  };

  public saveWorkspace = (req: Request, res: Response): void => {
    const workspace = (req.body ?? {}).workspace as Workspace | undefined;
    if (!workspace || typeof workspace.name !== 'string') {
      res.status(400).json({ ok: false, error: 'workspace {name,…} is required' });
      return;
    }
    this.store.saveWorkspace(workspace);
    res.status(200).json({ ok: true });
  };

  /**
   * POST /api/eng/checkout  body { name, types?: string[], dpes?: string[] }
   * Read the live project and return a workspace pre-loaded with it, plus the
   * BASELINE fingerprints — that is what makes conflict detection possible.
   */
  public checkout = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { name?: string; types?: string[]; dpes?: string[] };
    try {
      const snapshot = await this.readSnapshot(body.types, body.dpes);
      const workspace: Workspace = {
        name: body.name ?? 'default',
        types: snapshot.types,
        dps: snapshot.dps,
        configs: snapshot.configs,
        baseline: baselineOf(snapshot),
        checkedOutAt: new Date().toISOString(),
        checkedOutBy: (await identityOf(req)).username || undefined
      };
      this.store.saveWorkspace(workspace);
      res.status(200).json({ ok: true, workspace });
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  // --- live snapshot + check-in ----------------------------------------------

  /**
   * POST /api/eng/live  body { types?: string[], dpes?: string[] }
   * (GET is accepted too, types/DPs only.) `dpes` requests the CONFIG read-back
   * for those DPEs — the caller passes the union of its workspace config keys and
   * its baseline `cfg:` keys, so a config DELETED from the workspace is still seen
   * live and can be planned for removal.
   */
  public live = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { types?: string[]; dpes?: string[] };
    try {
      const snapshot = await this.readSnapshot(body.types, body.dpes);
      res.status(200).json({ ok: true, snapshot });
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  /** POST /api/eng/checkin  body { plan, dryRun } */
  public checkin = async (req: Request, res: Response): Promise<void> => {
    const { plan, dryRun, recreate } = (req.body ?? {}) as { plan?: EngPlan; dryRun?: boolean; recreate?: boolean };
    if (!plan || !Array.isArray(plan.items)) {
      res.status(400).json({ ok: false, error: 'a plan with items[] is required' });
      return;
    }
    try {
      // Prefer the CTRL manager for every project write of the check-in; fall
      // back to the direct API when it is not deployed, so a project that has
      // not installed it yet can still check in (with a warning at boot).
      const port = new WinccoaEngPort(this.store.listDevices<Device>(), await engManagerAvailable());
      // Config deletes need the live configs to know which families to retire.
      const deletes = plan.items.filter((item) => item.kind === 'config' && item.op === 'delete').map((item) => item.name);
      const previousConfigs = deletes.length > 0 ? (await this.readConfigs(deletes)) : {};
      // `recreate` is DESTRUCTIVE and opt-in per request: without it an existing type is
      // changed in place and an existing datapoint is left alone (only its configs are
      // written), which is what keeps a running project's datapoints and their history.
      const report = await applyPlan(plan, port, { dryRun: dryRun === true, previousConfigs, recreate: recreate === true });
      res.status(200).json(report);
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  /** POST /api/eng/plan  body { workspace } -> the diff against the live project. */
  public plan = async (req: Request, res: Response): Promise<void> => {
    const workspace = (req.body ?? {}).workspace as Workspace | undefined;
    if (!workspace) {
      res.status(400).json({ ok: false, error: 'workspace is required' });
      return;
    }
    try {
      // The read scope comes from the core (same helper the UI uses) so a config
      // deleted from the workspace is still read live and can be planned away.
      const scope = liveScopeOf(workspace);
      const snapshot = await this.readSnapshot(scope.types, scope.dpes);
      res.status(200).json({ ok: true, plan: diffWorkspace(workspace, snapshot) });
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  /** POST /api/eng/test-read  body { dpes } — current values (pre-check-in). */
  public testRead = async (req: Request, res: Response): Promise<void> => {
    const dpes = ((req.body ?? {}) as { dpes?: string[] }).dpes ?? [];
    if (dpes.length === 0) {
      res.status(200).json({ ok: true, results: [] });
      return;
    }
    try {
      const raw = await win().dpGet(dpes.map((dpe) => `${dpe}:_original.._value`));
      const values = Array.isArray(raw) ? raw : [raw];
      res.status(200).json({
        ok: true,
        results: dpes.map((dpe, index) => ({ dpe, value: values[index] ?? null, ok: values[index] != null }))
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  // --- live reading helpers --------------------------------------------------

  /**
   * Read the live project into the core's snapshot shape.
   *
   * @param typeNames restrict to these DP types (default: every non-internal type)
   * @param dpes      DPEs whose CONFIGS must be read back (default: none — types
   *                  and datapoints only, which is all the type/DP diff needs)
   */
  private async readSnapshot(typeNames?: string[], dpes?: string[]): Promise<LiveSnapshot> {
    const w = win();
    const wanted = typeNames && typeNames.length > 0
      ? typeNames
      : ((w.dpTypes('*') ?? []) as string[]).map(String).filter((name) => name.length > 0 && !name.startsWith('_'));
    const types: LiveSnapshot['types'] = [];
    const dps: LiveSnapshot['dps'] = [];
    for (const typeName of wanted) {
      try {
        this.readTypeInto(w, typeName, types, dps);
      } catch (error) {
        // ONE type must never blank the page. This read feeds the first paint (and the plan), so
        // an unexpected failure on a single type used to surface as "could not load" with every
        // panel empty — the symptom of the `dpNames` error 76 below. Skipped, logged, and the
        // rest of the project is still read.
        console.warn(`engController: live read of type '${typeName}' failed:`, describeError(error));
      }
    }
    const configs = dpes && dpes.length > 0 ? await this.readConfigs(dpes) : {};
    return { types, dps, configs };
  }

  /** One type of the live read: its structure, and the datapoints that carry it. */
  private readTypeInto(
    w: ReturnType<typeof win>,
    typeName: string,
    types: LiveSnapshot['types'],
    dps: LiveSnapshot['dps']
  ): void {
    // Does the project HAVE this type? Asked first, because neither read below is legal
    // otherwise: `dpNames('*', <unknown type>)` raises WinCC OA error 76 ("Invalid argument …
    // no such type"), which is exactly what a model targeting a type nobody created yet
    // produced once the datapoint listing stopped being skipped — and that error reached the
    // page as a failed load.
    if (!typeExistsIn(w, typeName)) return; // a workspace/model type not created yet
    try {
      types.push({ typeName, structure: structureOf(w.dpTypeGet(typeName)) });
    } catch (error) {
      // It exists and its structure could not be read: worth saying, and it must NOT skip the
      // datapoint listing — doing so reported every existing datapoint of the type as
      // "to create".
      console.warn(`engController: dpTypeGet('${typeName}') failed although the type exists:`, describeError(error));
    }
    let liveDps: string[] = [];
    try {
      liveDps = ((w.dpNames('*', typeName) ?? []) as string[]).map(String);
    } catch (error) {
      console.warn(`engController: dpNames('*','${typeName}') failed:`, describeError(error));
    }
    for (const dp of liveDps) {
      // BARE name: `dpNames` answers with the SYSTEM PREFIX (`System1:Z01_FOUR002.`) as soon as
      // the project is named or distributed, while a workspace holds `Z01_FOUR002`. Left
      // prefixed, every existing datapoint failed to match its workspace entry and the diff
      // reported it as "to create" — a datapoint that exists, queued for creation.
      dps.push({ dpName: bareDpName(dp), dpType: typeName });
    }
  }

  /**
   * Read the configs of the given DPEs, batched. The raw → {@link DpeConfigs}
   * mapping lives in the core (`configsFromRaw`), unit-tested without a runtime;
   * a DPE with no config at all is simply absent from the result.
   */
  private async readConfigs(dpes: string[]): Promise<Record<string, DpeConfigs>> {
    const out: Record<string, DpeConfigs> = {};
    const attrsPerDpe = configReadPaths('x').length;
    for (let start = 0; start < dpes.length; start += READ_BATCH) {
      const batch = dpes.slice(start, start + READ_BATCH);
      const paths = batch.flatMap((dpe) => configReadPaths(dpe));
      let values: unknown[];
      try {
        const raw = await win().dpGet(paths);
        values = Array.isArray(raw) ? raw : [raw];
      } catch (error) {
        // A batch can fail as a whole (one absent DPE) — fall back to per-DPE.
        console.warn('engController.readConfigs: batch failed, retrying per DPE:', describeError(error));
        for (const dpe of batch) {
          try {
            const raw = await win().dpGet(configReadPaths(dpe));
            const configs = configsFromRaw(Array.isArray(raw) ? raw : [raw]);
            if (configs) out[dpe] = configs;
          } catch {
            continue; // DPE does not exist yet (a workspace creation) — no config
          }
        }
        continue;
      }
      for (const [index, dpe] of batch.entries()) {
        const slice = values.slice(index * attrsPerDpe, (index + 1) * attrsPerDpe);
        const configs = configsFromRaw(slice);
        if (configs) out[dpe] = configs;
      }
    }
    return out;
  }
}
