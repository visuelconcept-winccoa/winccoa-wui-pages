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

import type { AccessMode, Device, ProtocolKind } from './model.js';
import { sanitizeSegment } from './naming.js';
import { WARNING_CODES, warn, type EngWarning } from './warnings.js';

/** How a connection parameter is entered (drives the input type, not the words). */
export type DeviceParamKind = 'text' | 'number' | 'host' | 'port';

/** One connection parameter of a protocol. */
export interface DeviceParamSpec {
  /** Stable key, used in `Device.connection` AND to look up the label. */
  key: string;
  kind: DeviceParamKind;
  required: boolean;
  /** Example value shown as the input placeholder (not a default). */
  example?: string;
}

/**
 * Connection parameters per protocol.
 *
 * OPC UA asks for the SERVER NAME rather than an endpoint: the studio binds through
 * an existing `_OPCUAServer` connection (that name is what an `_address.._reference`
 * carries), and creating a connection is the tag importer's job, not the studio's.
 * The endpoint is offered as an optional note so the form documents what it points
 * at.
 */
export const PROTOCOL_PARAMS: Record<ProtocolKind, DeviceParamSpec[]> = {
  opcua: [
    { key: 'server', kind: 'text', required: true, example: 'Remplisseuse' },
    { key: 'endpoint', kind: 'text', required: false, example: 'opc.tcp://192.168.10.42:4840' }
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
    { key: 'cpu', kind: 'text', required: false, example: 'BMEP582040' }
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
    if (spec.required && paramText(draft, spec.key) === '') {
      problems.push(
        warn(WARNING_CODES.device.PARAM_REQUIRED, 'The "{param}" parameter is required for the {protocol} protocol.', {
          param: spec.key,
          protocol: draft.protocol
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
