// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Device declaration — the connection parameters a protocol needs, and the
 * validation of a device draft. Pure: the UI renders a form from the SPECS below
 * and the backend re-validates the same way, so neither owns the rules.
 *
 * Why the parameters are DATA (`PROTOCOL_PARAMS`) and not a hand-written form per
 * protocol: adding a protocol must not mean touching the page. The spec says what
 * a field is (`key`, `kind`, `required`, `example`); the page only translates the
 * LABEL of each key — words stay in the i18n layer, the shape stays here.
 *
 * What the validation refuses, and why each one matters in this domain:
 *  - an empty name, or an id that collides with another device — books reference a
 *    device by id, so a collision silently re-parents catalogs;
 *  - a name that is not a usable WinCC OA identifier fragment — datapoint names are
 *    built from it (`{Zone}_{Equipement}`), and an invalid name fails at check-in,
 *    far from here;
 *  - no access mode — the model generator needs one to pick a candidate address;
 *  - a missing REQUIRED connection parameter, per protocol;
 *  - a non-integer or negative `driverNumber` — it is a manager number, and a
 *    wrong one binds addresses to the wrong driver *silently* (see the backend's
 *    `resolveAddressContext`).
 *
 * Everything is returned as {@link EngWarning}s, so the form shows them in the
 * operator's language like any other diagnostic.
 */

import type { AccessMode, Device, DeviceState, DeviceStateSource, ProtocolKind } from './model.js';
import { sanitizeSegment } from './naming.js';
import { WARNING_CODES, warn, type EngWarning } from './warnings.js';

/** How a connection parameter is entered (drives the input type, not the words). */
export type DeviceParamKind = 'text' | 'number' | 'host' | 'port' | 'choice' | 'flag';

/** One connection parameter of a protocol. */
export interface DeviceParamSpec {
  /** Stable key, used in `Device.connection` AND to look up the label. */
  key: string;
  kind: DeviceParamKind;
  required: boolean;
  /** Example value shown as the input placeholder (not a default). */
  example?: string;
  /** Allowed values of a `choice` parameter (the first one is the default). */
  options?: string[];
  /**
   * True when the parameter only RECORDS how the driver is configured elsewhere,
   * and nothing the studio writes depends on it being right. Those are shown apart
   * in the form: an operator must not think filling them in changes the driver.
   */
  declarative?: boolean;
}

/**
 * Connection parameters per protocol.
 *
 * OPC UA asks for the SERVER NAME rather than an endpoint: the studio binds through
 * an existing `_OPCUAServer` connection (that name is what an `_address.._reference`
 * carries), and creating a connection is the tag importer's job, not the studio's.
 * The endpoint is offered as an optional note so the form documents what it points
 * at.
 *
 * The Modbus `wordOrder` and `zeroBased` parameters are **declarative**: those two
 * are configured on the WinCC OA side — in the project `config` file / when the
 * connection to the device is created — never per address. The `_address` attribute
 * set has no byte-order attribute at all (see
 * `docs/wui-eng-studio/VENDOR-ADDRESS-TRANSFORMATIONS.md`), which is the same fact
 * seen from the other end. They are recorded here anyway because they decide how
 * every register of the book is *interpreted*: a word swap turns a REAL into
 * nonsense and a one-register shift moves every measurement. Written down next to
 * the equipment, they can be compared with the driver's configuration; guessed,
 * they cost an afternoon of "the values move on their own".
 */
export const PROTOCOL_PARAMS: Record<ProtocolKind, DeviceParamSpec[]> = {
  opcua: [
    { key: 'server', kind: 'text', required: true, example: 'Remplisseuse' },
    { key: 'endpoint', kind: 'text', required: false, example: 'opc.tcp://192.168.10.42:4840', declarative: true }
  ],
  s7: [
    { key: 'ip', kind: 'host', required: true, example: '192.168.10.21' },
    { key: 'rack', kind: 'number', required: false, example: '0' },
    { key: 'slot', kind: 'number', required: false, example: '1' }
  ],
  s7plus: [
    { key: 'ip', kind: 'host', required: true, example: '192.168.10.21' },
    { key: 'rack', kind: 'number', required: false, example: '0' },
    { key: 'slot', kind: 'number', required: false, example: '1' }
  ],
  modbus: [
    { key: 'ip', kind: 'host', required: true, example: '192.168.10.30' },
    { key: 'port', kind: 'port', required: false, example: '502' },
    { key: 'unitId', kind: 'number', required: false, example: '255' },
    { key: 'cpu', kind: 'text', required: false, example: 'BMEP582040' },
    { key: 'wordOrder', kind: 'choice', required: false, options: ['big', 'little'], declarative: true },
    { key: 'zeroBased', kind: 'flag', required: false, declarative: true }
  ]
};

/** Every protocol, in the order the form offers them. */
export const PROTOCOLS: ProtocolKind[] = ['opcua', 's7', 's7plus', 'modbus'];

/** What the form edits — a device before it is validated and normalised. */
export interface DeviceDraft {
  /** Absent/empty on a creation: derived from the name (see {@link deviceIdFrom}). */
  id?: string;
  name: string;
  protocol: ProtocolKind;
  accessModes: AccessMode[];
  connection: Record<string, string | number | boolean>;
  driverNumber?: number | string;
  pollGroup?: string;
  bookIds: string[];
}

/**
 * Slug used as a device id: lower-case, separator-normalised, ASCII.
 *
 * The id is generated ONCE at creation and never re-derived from the name
 * afterwards — books and address configs reference it, so renaming a device must
 * not re-parent its catalogs.
 */
export function deviceIdFrom(name: string): string {
  const slug = sanitizeSegment(name)
    .toLowerCase()
    .replaceAll(/_+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return slug === '' ? 'device' : slug;
}

/** `deviceIdFrom` + a numeric suffix while the id is taken. */
export function uniqueDeviceId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = deviceIdFrom(name);
  if (!used.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Trimmed string value of a draft parameter ('' when absent). */
function paramText(draft: DeviceDraft, key: string): string {
  const value = draft.connection[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * Validate a draft against the OTHER devices. Returns the blocking problems; an
 * empty array means {@link normalizeDevice} may be called.
 */
export function validateDevice(draft: DeviceDraft, others: Device[] = []): EngWarning[] {
  const problems: EngWarning[] = [];
  const name = draft.name.trim();
  if (name === '') {
    problems.push(warn(WARNING_CODES.device.NAME_REQUIRED, 'A device name is required.'));
  } else if (sanitizeSegment(name) !== name) {
    // The name feeds `{Zone}_{Equipement}` datapoint names; catch it HERE rather
    // than at check-in, where the failure is far from its cause.
    problems.push(
      warn(WARNING_CODES.device.NAME_INVALID, 'The name "{name}" is not a valid WinCC OA identifier — use "{clean}" (letters, digits and _).', {
        name,
        clean: sanitizeSegment(name) || 'Equipement'
      })
    );
  }

  const id = (draft.id ?? '').trim();
  if (id !== '' && others.some((device) => device.id === id)) {
    problems.push(warn(WARNING_CODES.device.ID_TAKEN, 'The identifier "{id}" is already used by another device.', { id }));
  }
  if (name !== '' && others.some((device) => device.name.trim().toLowerCase() === name.toLowerCase())) {
    problems.push(warn(WARNING_CODES.device.NAME_TAKEN, 'Another device is already named "{name}".', { name }));
  }

  if (draft.accessModes.length === 0) {
    problems.push(warn(WARNING_CODES.device.NO_ACCESS_MODE, 'Select at least one access mode — the model generator needs one to pick an address.'));
  }

  for (const spec of PROTOCOL_PARAMS[draft.protocol] ?? []) {
    const text = paramText(draft, spec.key);
    if (spec.required && text === '') {
      problems.push(
        warn(WARNING_CODES.device.PARAM_REQUIRED, 'The "{param}" parameter is required for the {protocol} protocol.', {
          param: spec.key,
          protocol: draft.protocol
        })
      );
      continue;
    }
    // A `choice` value comes from a <select> in the UI, but an API client sends
    // whatever it likes — and a word order of "bug" would be stored as gospel.
    if (spec.kind === 'choice' && text !== '' && !(spec.options ?? []).includes(text)) {
      problems.push(
        warn(WARNING_CODES.device.PARAM_INVALID, 'The "{param}" parameter must be one of: {options} (got "{value}").', {
          param: spec.key,
          options: (spec.options ?? []).join(', '),
          value: text
        })
      );
    }
  }

  const driver = draft.driverNumber;
  if (driver !== undefined && String(driver).trim() !== '') {
    const value = Number(driver);
    if (!Number.isInteger(value) || value < 1) {
      problems.push(
        warn(WARNING_CODES.device.DRIVER_INVALID, 'The driver number "{value}" must be a positive integer (a WinCC OA manager number).', {
          value: String(driver)
        })
      );
    }
  } else if (draft.protocol !== 'opcua') {
    // Not blocking: auto-detection is only verified for OPC UA, so a missing
    // number on any other protocol will fail at check-in — say it now.
    problems.push(
      warn(
        WARNING_CODES.device.DRIVER_RECOMMENDED,
        'No driver number: auto-detection is only verified for OPC UA, so a {protocol} address will be refused at check-in until this is set.',
        { protocol: draft.protocol }
      )
    );
  }
  return problems;
}

/** Problems that must BLOCK a save (everything except the advisory ones). */
export function blockingProblems(problems: EngWarning[]): EngWarning[] {
  return problems.filter((problem) => problem.code !== WARNING_CODES.device.DRIVER_RECOMMENDED);
}

/**
 * Draft → {@link Device}: trims, drops empty parameters, coerces numeric ones and
 * assigns an id on creation. `state` stays `unknown` — only the backend probes a
 * connection, and claiming `connected` from a form would be a lie.
 */
export function normalizeDevice(draft: DeviceDraft, others: Device[] = []): Device {
  const name = draft.name.trim();
  const specs = PROTOCOL_PARAMS[draft.protocol] ?? [];
  const connection: Record<string, string | number | boolean> = {};
  for (const spec of specs) {
    if (spec.kind === 'flag') {
      // THREE states, not two: `false` ("checked, it is not zero-based") and absent
      // ("nobody said") are different claims, and a declarative parameter exists
      // precisely to record which one it is. An empty value stays unset.
      const value = draft.connection[spec.key];
      if (value === true || value === 'true') connection[spec.key] = true;
      else if (value === false || value === 'false') connection[spec.key] = false;
      continue;
    }
    const text = paramText(draft, spec.key);
    if (text === '') continue;
    connection[spec.key] = spec.kind === 'number' || spec.kind === 'port' ? Number(text) : text;
  }
  const driverText = draft.driverNumber === undefined ? '' : String(draft.driverNumber).trim();
  const pollGroup = (draft.pollGroup ?? '').trim();
  const id = (draft.id ?? '').trim() === '' ? uniqueDeviceId(name, others.map((device) => device.id)) : (draft.id as string).trim();
  return {
    id,
    name,
    protocol: draft.protocol,
    accessModes: [...draft.accessModes],
    ...(Object.keys(connection).length > 0 ? { connection } : {}),
    ...(driverText === '' ? {} : { driverNumber: Number(driverText) }),
    ...(pollGroup === '' ? {} : { pollGroup }),
    bookIds: [...draft.bookIds],
    state: 'unknown'
  };
}

/** An existing device → an editable draft (the form's other direction). */
export function draftFromDevice(device: Device): DeviceDraft {
  return {
    id: device.id,
    name: device.name,
    protocol: device.protocol ?? device.accessModes[0] ?? 'opcua',
    accessModes: [...device.accessModes],
    connection: { ...(device.connection ?? {}) },
    ...(device.driverNumber === undefined ? {} : { driverNumber: device.driverNumber }),
    ...(device.pollGroup === undefined ? {} : { pollGroup: device.pollGroup }),
    bookIds: [...device.bookIds]
  };
}

/** A blank draft for a creation (the protocol drives the visible parameters). */
export function emptyDraft(protocol: ProtocolKind = 'opcua'): DeviceDraft {
  return { name: '', protocol, accessModes: [protocol], connection: {}, bookIds: [] };
}

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

/**
 * The WinCC OA connection-state datapoint element, and how to read its value.
 *
 * Every connection type of the base data (`_OPCUAServer`, `_S7_Conn`,
 * `_S7PlusConnection`, `_Mod_Plc`, `_IecConnection`, `_BacnetDevice`, … — 16 of them
 * in 3.21) carries the same driver-agnostic element `Common.State.ConnState`, so ONE
 * read covers every protocol the studio declares. Its codes are documented in the
 * OPC UA message catalogue shipped with WinCC OA (`opcua.cat`, keys `CommonConnState…`).
 */
export const CONN_STATE = {
  /** `-1` — undefined. */
  UNDEFINED: -1,
  /** `0` — the driver does not fill this element in. */
  UNDEFINED_BY_DRIVER: 0,
  /** `1` — not connected. */
  NOT_CONNECTED: 1,
  /** `3` — inactive: the connection is DISABLED, not broken. */
  INACTIVE: 3,
  /** `5` — failure. */
  FAILURE: 5,
  /** `256` and above — connected (257…260 add which server/connection carries it). */
  CONNECTED: 256
} as const;

/**
 * A raw `ConnState` → the studio's three-state {@link DeviceState}.
 *
 * The thresholds are NOT invented here: they are the ones the driver panel plugin
 * shipped with WinCC OA paints its own lamp with (`scripts/libs/opcuaDriver_plugin.ctl`,
 * `setCommonConnStateShape`) — green from 256 up, red on `1` and `5`, yellow for
 * everything else. Following the vendor's own rule matters because an operator reads
 * both screens: a studio that called "inactive" a red disconnection where para shows
 * yellow would be teaching a state the project does not have.
 *
 * `stateCode` travels beside the result so the UI can still name the exact code — `1`,
 * `3` and `5` all light one red lamp but call for three different actions.
 */
export function deviceStateFromConnState(code: number): DeviceState {
  if (!Number.isFinite(code)) return 'unknown';
  if (code >= CONN_STATE.CONNECTED) return 'connected';
  return code === CONN_STATE.NOT_CONNECTED || code === CONN_STATE.FAILURE ? 'disconnected' : 'unknown';
}

/**
 * The address a device declaration can be matched to a CONNECTION datapoint on: the
 * `ip` parameter, or the HOST of an OPC UA `endpoint`.
 *
 * The host rather than the whole URL, because a connection datapoint stores its address
 * in its own shape (`opc.tcp://host:port/path`, `host:port`, `host,rack,slot`): the host
 * is the part they all share. Empty when the declaration carries neither — the state
 * then stays honestly unknown instead of being matched on a guess.
 */
export function declaredAddressOf(device: Device): string {
  const ip = String(device.connection?.['ip'] ?? '').trim();
  if (ip !== '') return ip;
  const endpoint = String(device.connection?.['endpoint'] ?? '').trim();
  // A bracketed IPv6 literal first — its own colons would otherwise cut the host short.
  const bracketed = /:\/\/\[([^\]]+)\]/.exec(endpoint)?.[1];
  return bracketed ?? /:\/\/([^:/]+)/.exec(endpoint)?.[1] ?? '';
}

/** One connection-state element as the runtime read it. */
export interface ConnStateRead {
  /** Raw `ConnState` value. */
  code: number;
  /**
   * False when nothing ever WROTE the element (its source time is still the epoch).
   *
   * Measured on a live project: an `_OPCUAServer` that has never connected reads
   * `ConnState = 0` stamped `1970-01-01`, while a connected one reads `257` stamped
   * now. Reporting the first as "disconnected" would be the same class of lie as
   * `Number(null) === 0` reporting "driver 0 is running" — a never-written state is an
   * unknown state, and the raw `0` ("undefined by the driver") says exactly that.
   */
  written: boolean;
}

/** What the studio concludes from a connection's state elements. */
export interface ConnStateVerdict {
  state: DeviceState;
  /** Which element the verdict came from — see {@link DeviceStateSource}. */
  source: 'connstate' | 'opcua-connstate' | 'probe-failed';
  /** The raw code behind it, absent only when nothing could be read. */
  code?: number;
}

/**
 * Conclude from the two elements a connection may carry.
 *
 * `common` is `Common.State.ConnState` (the driver-agnostic one, 256-based); `own` is
 * `_OPCUAServer.State.ConnState` (that type's own `0`/`1` scale). The common element
 * wins when it says something, and `own` is the FALLBACK for the drivers that leave it
 * undefined — without it, a perfectly connected server would show a grey lamp.
 *
 * Both `null` means the read itself failed (`probe-failed`), which is deliberately not
 * a disconnection: the state of the machine is unknown, and that is a different
 * statement from "the machine is down".
 */
export function connectionVerdict(common: ConnStateRead | null, own: ConnStateRead | null): ConnStateVerdict {
  if (common !== null && common.written && common.code !== CONN_STATE.UNDEFINED && common.code !== CONN_STATE.UNDEFINED_BY_DRIVER) {
    return { state: deviceStateFromConnState(common.code), source: 'connstate', code: common.code };
  }
  if (own !== null && own.written) {
    return { state: own.code > 0 ? 'connected' : 'disconnected', source: 'opcua-connstate', code: own.code };
  }
  if (common === null && own === null) return { state: 'unknown', source: 'probe-failed' };
  return { state: 'unknown', source: 'connstate', code: common?.code ?? CONN_STATE.UNDEFINED_BY_DRIVER };
}

/**
 * The LIVE part of a device: what a state refresh sends, and nothing else.
 *
 * A connection state is the only thing about an equipment that changes on its own, so
 * refreshing it must not mean re-sending the registry. Two reasons beyond bandwidth:
 * the payload of a poll every few seconds should be proportional to what it can say,
 * and a full registry landing on a page whose operator is editing a device would
 * overwrite work with a stale copy. This carries the `id` and the four state fields —
 * `state` alone would be a lamp with no explanation, which is what {@link
 * DeviceStateSource} exists to prevent.
 */
export interface DeviceStateUpdate {
  id: string;
  state: DeviceState;
  stateSource?: DeviceStateSource;
  stateConnection?: string;
  stateCode?: number;
}

/** The live fields of a device, as a {@link DeviceStateUpdate}. */
export function deviceStateOf(device: Device): DeviceStateUpdate {
  return {
    id: device.id,
    state: device.state,
    ...(device.stateSource === undefined ? {} : { stateSource: device.stateSource }),
    ...(device.stateConnection === undefined ? {} : { stateConnection: device.stateConnection }),
    ...(device.stateCode === undefined ? {} : { stateCode: device.stateCode })
  };
}

/**
 * Merge a state refresh into a device list, by id.
 *
 * Only the state fields move: everything else in the list is the operator's own view
 * of the registry (a device they just renamed, a book they just attached), and a
 * refresh has no business touching it. A device the refresh does not mention keeps
 * what it had — a partial answer is not evidence that an equipment vanished.
 */
export function withDeviceStates(devices: Device[], updates: DeviceStateUpdate[]): Device[] {
  if (updates.length === 0) return devices;
  const byId = new Map(updates.map((update) => [update.id, update]));
  return devices.map((device) => {
    const update = byId.get(device.id);
    if (update === undefined) return device;
    return {
      ...device,
      state: update.state,
      stateSource: update.stateSource,
      stateConnection: update.stateConnection,
      stateCode: update.stateCode
    };
  });
}

/**
 * Mark every device's state as UNREADABLE — what a page applies when the refresh
 * itself keeps failing.
 *
 * A frozen green lamp is the worst outcome of a polled state: it says "this machine is
 * answering" long after the page stopped being able to ask. So a refresh that fails
 * repeatedly turns the lamps grey with `probe-failed`, which is exactly what happened.
 * The raw code is dropped with it: keeping `257` beside "unknown" would suggest the
 * number is current.
 */
export function statesUnreadable(devices: Device[]): Device[] {
  return devices.map((device) => {
    const stale = { ...device, state: 'unknown' as const, stateSource: 'probe-failed' as const };
    delete stale.stateCode;
    return stale;
  });
}
