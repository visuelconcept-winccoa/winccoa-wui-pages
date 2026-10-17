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

/**
 * How a connection parameter is entered (drives the input type, not the words).
 *
 * Two kinds beyond the obvious ones:
 *  - `secret` — write-only: rendered as a password field, sent with the save and
 *    then FORGOTTEN. {@link normalizeDevice} never persists it (the engineering
 *    store is a diffable, backed-up file — no secret belongs in it, encrypted or
 *    not), and the backend pushes it to the runtime through the vendor's own
 *    encryption (see docs/wui-eng-studio/OPCUA-CONNECTION-SECURITY.md);
 *  - `bit` — a plain checkbox mapped onto one bit of a driver flag word. Unlike
 *    the tri-state `flag`, absence and `false` mean the same thing here (the bit
 *    is not set), so a checkbox tells the whole truth.
 */
export type DeviceParamKind = 'text' | 'number' | 'host' | 'port' | 'choice' | 'flag' | 'secret' | 'bit';

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
  /**
   * Groups the parameter into its own form card. `security` is the OPC UA
   * user/password/policy/certificate block — kept apart from the connection
   * fields because it is written to the LIVE connection datapoint at save time,
   * not merely recorded.
   */
  section?: 'security';
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
    { key: 'endpoint', kind: 'text', required: false, example: 'opc.tcp://192.168.10.42:4840', declarative: true },
    // --- security block — written to the LIVE `_OPCUAServer` at save time. The
    // vocabulary is the standard OPC UA connection panel's own (verified against
    // the 3.21 plugin + help; see docs/wui-eng-studio/OPCUA-CONNECTION-SECURITY.md):
    // Config.AccessInfo (empty = anonymous), Config.Password (blob, encrypted by
    // the vendor library — hence `secret`), Config.Security.{Policy,MessageMode,
    // Certificate}, and Config.Flags bits 8–15 for the certificate relaxations.
    { key: 'user', kind: 'text', required: false, example: 'operator1', section: 'security' },
    { key: 'password', kind: 'secret', required: false, section: 'security' },
    {
      key: 'securityPolicy',
      kind: 'choice',
      required: false,
      options: ['None', 'Basic256Sha256', 'Aes128Sha256RsaOaep', 'Aes256Sha256RsaPss', 'Basic128Rsa15', 'Basic256'],
      section: 'security'
    },
    { key: 'messageMode', kind: 'choice', required: false, options: ['None', 'Sign', 'SignAndEncrypt'], section: 'security' },
    { key: 'clientCertificate', kind: 'text', required: false, example: 'WinCC_OA_UA_Client.der', section: 'security' },
    { key: 'allowUnsecured', kind: 'bit', required: false, section: 'security' },
    { key: 'ignoreInvalidCert', kind: 'bit', required: false, section: 'security' },
    { key: 'ignoreRevocation', kind: 'bit', required: false, section: 'security' },
    { key: 'ignoreIssuerRevocation', kind: 'bit', required: false, section: 'security' },
    { key: 'ignoreExpiredCert', kind: 'bit', required: false, section: 'security' },
    { key: 'ignoreInvalidHostname', kind: 'bit', required: false, section: 'security' },
    { key: 'ignoreInvalidUri', kind: 'bit', required: false, section: 'security' },
    { key: 'ignoreBasicConstraints', kind: 'bit', required: false, section: 'security' }
  ],
  s7: [
    // The project's own `_S7_Conn`, picked rather than typed — OPTIONAL, because a
    // classic-S7 equipment is legitimately declared before its connection exists
    // (and because devices declared before this field must keep working). Naming it
    // is what makes the state read EXACT: without it the studio can only match the
    // equipment to a connection by searching its IP in `_S7_Conn.Address`, which
    // says nothing when two stations sit behind one address, and nothing at all
    // when the project spells the address differently.
    { key: 'connection', kind: 'text', required: false, example: 'S7_Pompage' },
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

// ---------------------------------------------------------------------------
// Which DRIVER may serve which protocol
// ---------------------------------------------------------------------------

/**
 * `_Driver<n>.DT` value of the SIMULATION driver — never a candidate for a real
 * equipment, whatever the protocol.
 *
 * Verified: `DRVS_DT_SIM = "SIM"` in the vendor's own `scripts/libs/driverSettings.ctl`,
 * where it is treated as a wildcard that matches every driver type
 * (`sDT == DRVS_DT_SIM` beside the real comparison). That is exactly why it must be
 * hidden HERE: it would otherwise pass every filter and look like a valid choice for
 * a machine, and an address bound to the simulator reads invented values that look
 * perfectly plausible.
 */
/**
 * The POLL GROUPS the studio offers and creates — three rhythms, not one.
 *
 * A project needs a fast group for what could not be subscribed, a normal one for the bulk of the
 * process, and a slow one for values that barely move. The periods are starting points to measure
 * against the real driver load, not laws; the names are what the studio creates on demand
 * (`_PollGroup` datapoints, see the CTRL manager's EnsurePollGroup).
 */
export const POLL_GROUPS: { name: string; intervalMs: number }[] = [
  { name: '_Poll_Fast', intervalMs: 500 },
  { name: '_Poll_Normal', intervalMs: 1000 },
  { name: '_Poll_Slow', intervalMs: 10_000 }
];

/** The period of a known poll group, or `undefined` for one the studio did not define. */
export function pollGroupInterval(name: string): number | undefined {
  return POLL_GROUPS.find((group) => group.name === name.trim())?.intervalMs;
}

/**
 * The CONNECTION a device is addressed through — the name an `_address` reference carries.
 *
 * It is the declared connection parameter (`server` for OPC UA, i.e. the `_OPCUAServer`
 * datapoint without its leading `_` — see `PROTOCOL_PARAMS`), and the device's display name
 * only when none is declared. NOT the catalog's: a book names the server it was BROWSED on,
 * which is the same thing only until the catalog is mutualised onto a second machine.
 */
export function connectionNameOf(device: { name?: string; connection?: Record<string, string | number | boolean> } | undefined): string | undefined {
  if (device === undefined) return undefined;
  const declared = String(device.connection?.['server'] ?? '').trim().replace(/^_/, '');
  if (declared !== '') return declared;
  const name = (device.name ?? '').trim();
  return name === '' ? undefined : name;
}

export const SIMULATION_DRIVER_TYPE = 'SIM';

/**
 * `_Driver<n>.DT` values whose protocol mapping is VERIFIED — and only those.
 *
 * `OPCUAC` is the tag importer's long-verified value; `S7PLUS` is the vendor's own
 * (`drvsCheckRunningDrvNums("S7PLUS", …)` in `scripts/libs/s7PlusDrvPara.ctl`).
 * The classic S7 and Modbus drivers are deliberately ABSENT: no `DT` string for
 * them could be found in the installation, and this project does not ship vendor
 * constants from memory (same rule as the `_datatype` tables). The filter below is
 * built to stay useful without them.
 */
export const DRIVER_TYPES_BY_PROTOCOL: Partial<Record<ProtocolKind, string[]>> = {
  opcua: ['OPCUAC'],
  s7plus: ['S7PLUS']
};

/** Every DT whose protocol is known — what makes "this driver belongs elsewhere" provable. */
const KNOWN_DRIVER_TYPES = new Set(Object.values(DRIVER_TYPES_BY_PROTOCOL).flat());

/**
 * May a driver of type `driverType` serve `protocol`?
 *
 * Asymmetric on purpose, because our knowledge is:
 *  - the SIMULATION driver is never offered (see {@link SIMULATION_DRIVER_TYPE});
 *  - an UNREADABLE type (`''`) is offered: "I could not read the DT" is not
 *    evidence against a driver, and hiding a legitimate one is worse than showing
 *    one too many (the operator would have no way to declare their equipment);
 *  - a protocol whose DT set is VERIFIED (OPC UA, S7Plus) shows only those drivers;
 *  - a protocol whose DT is UNKNOWN (classic S7, Modbus) shows everything EXCEPT the
 *    drivers proven to belong to another protocol. Excluding on proof rather than
 *    including on a guess is the only honest filter available there.
 */
export function driverFitsProtocol(driverType: string, protocol: ProtocolKind): boolean {
  const type = driverType.trim().toUpperCase();
  if (type === SIMULATION_DRIVER_TYPE) return false;
  if (type === '') return true;
  const verified = DRIVER_TYPES_BY_PROTOCOL[protocol];
  if (verified !== undefined) return verified.includes(type);
  return !KNOWN_DRIVER_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// OPC UA connection security — the STANDARD panel's vocabulary, as data.
// Codes and bits verified against the installed 3.21 (plugin + help page
// `opc_ua_c_internaldp`); see docs/wui-eng-studio/OPCUA-CONNECTION-SECURITY.md.
// ---------------------------------------------------------------------------

/** `_OPCUAServer.Config.Security.Policy` codes (1 is unused by the vendor). */
export const OPCUA_POLICY_CODE: Record<string, number> = {
  None: 0,
  Basic128Rsa15: 2,
  Basic256: 3,
  Basic256Sha256: 4,
  Aes128Sha256RsaOaep: 5,
  Aes256Sha256RsaPss: 6
};

/** `_OPCUAServer.Config.Security.MessageMode` codes. */
export const OPCUA_MESSAGE_MODE_CODE: Record<string, number> = { None: 0, Sign: 1, SignAndEncrypt: 2 };

/**
 * `Config.Flags` bit per `bit` parameter — the standard panel's advanced
 * settings. Bits 0–7 are communication tuning and stay out of the studio;
 * 8–15 are the security/certificate relaxations the panel exposes.
 */
export const OPCUA_FLAG_BIT: Record<string, number> = {
  allowUnsecured: 8,
  ignoreInvalidCert: 9,
  ignoreRevocation: 10,
  ignoreIssuerRevocation: 11,
  ignoreExpiredCert: 12,
  ignoreInvalidHostname: 13,
  ignoreInvalidUri: 14,
  ignoreBasicConstraints: 15
};

/**
 * What a device declaration asks to write on its `_OPCUAServer` connection —
 * only what is DECLARED: an absent field must leave the live value untouched
 * (the same tri-state honesty as the declarative parameters), so a connection
 * also managed through the standard panel is never silently reset by a save
 * that did not mention security at all.
 */
export interface OpcUaSecurityWrite {
  /** `Config.AccessInfo` — the user name ('' would mean anonymous; only sent when declared). */
  user?: string;
  /** `Config.Security.Policy` code. */
  policy?: number;
  /** `Config.Security.MessageMode` code. */
  messageMode?: number;
  /** `Config.Security.Certificate` — client certificate file. */
  clientCertificate?: string;
  /** `Config.Flags` bits to force (bit → value). Bits absent here stay untouched. */
  flagBits: Record<number, boolean>;
}

/** The security write a connection declaration implies, or `null` when it says nothing. */
export function opcuaSecurityWrite(connection?: Record<string, string | number | boolean>): OpcUaSecurityWrite | null {
  if (connection === undefined) return null;
  const text = (key: string): string => {
    const value = connection[key];
    return value === undefined || value === null ? '' : String(value).trim();
  };
  const out: OpcUaSecurityWrite = { flagBits: {} };
  let declared = false;
  const user = text('user');
  if (user !== '') {
    out.user = user;
    declared = true;
  }
  const policy = text('securityPolicy');
  if (policy !== '' && policy in OPCUA_POLICY_CODE) {
    out.policy = OPCUA_POLICY_CODE[policy] as number;
    declared = true;
  }
  const mode = text('messageMode');
  if (mode !== '' && mode in OPCUA_MESSAGE_MODE_CODE) {
    out.messageMode = OPCUA_MESSAGE_MODE_CODE[mode] as number;
    declared = true;
  }
  const certificate = text('clientCertificate');
  if (certificate !== '') {
    out.clientCertificate = certificate;
    declared = true;
  }
  for (const [key, bit] of Object.entries(OPCUA_FLAG_BIT)) {
    const value = connection[key];
    if (value === true || value === 'true') {
      out.flagBits[bit] = true;
      declared = true;
    } else if (value === false || value === 'false') {
      out.flagBits[bit] = false;
      declared = true;
    }
  }
  return declared ? out : null;
}

/**
 * Apply forced bits onto a CURRENT `Config.Flags` value — read-modify-write,
 * so the tuning bits (0–7) and any future vendor bit survive a studio save.
 *
 * The WRITE itself is performed by the EngStudio CTRL manager (it owns every
 * project mutation of the page), so this function is the **executable
 * specification** of what that manager does: the semantics are pinned here by
 * unit tests, and the CTRL implementation (`applyFlags` in
 * `libs/wui-eng-studio/project-scripts/wui/engStudioService.ctl`) is reviewed against them.
 * Kept in the core rather than deleted for exactly that reason — a bit-masking
 * rule nobody can test is a rule that drifts.
 */
export function applyFlagBits(current: number, bits: Record<number, boolean>): number {
  let flags = current >>> 0;
  for (const [bit, value] of Object.entries(bits)) {
    const mask = 1 << Number(bit);
    flags = value ? flags | mask : flags & ~mask;
  }
  return flags >>> 0;
}

/** What the form edits — a device before it is validated and normalised. */
export interface DeviceDraft {
  /** Absent/empty on a creation: derived from the name (see {@link deviceIdFrom}). */
  id?: string;
  name: string;
  protocol: ProtocolKind;
  /**
   * IGNORED since the access mode follows the protocol (`normalizeDevice`
   * derives it): kept only so older clients and stored drafts still parse.
   * The books keep their candidate addresses PER MODE — which candidate is
   * written is decided by the book's interface protocol, else the device's.
   */
  accessModes?: AccessMode[];
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

  if (draft.protocol === 'opcua') {
    // The standard panel FORCES the pair: policy None → mode None; a real policy →
    // Sign or Sign&Encrypt (verified in the 3.21 plugin's combos). Accepting a
    // half-declared pair here would write a connection the driver refuses later.
    const policy = paramText(draft, 'securityPolicy');
    const mode = paramText(draft, 'messageMode');
    const secured = policy !== '' && policy !== 'None';
    const signed = mode !== '' && mode !== 'None';
    if (secured !== signed) {
      problems.push(
        warn(
          WARNING_CODES.device.SECURITY_MISMATCH,
          'Security policy and message mode go together: either both None, or a policy with Sign / Sign&Encrypt (got policy "{policy}", mode "{mode}").',
          { policy: policy === '' ? 'None' : policy, mode: mode === '' ? 'None' : mode }
        )
      );
    }
    // Advisory: a password logs in as SOMEBODY — with no user name the client
    // connects anonymously and the password is never sent.
    if (paramText(draft, 'password') !== '' && paramText(draft, 'user') === '') {
      problems.push(
        warn(WARNING_CODES.device.PASSWORD_WITHOUT_USER, 'A password without a user name does nothing: the client logs in anonymously when the user is empty.')
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
  const advisory = new Set<string>([WARNING_CODES.device.DRIVER_RECOMMENDED, WARNING_CODES.device.PASSWORD_WITHOUT_USER]);
  return problems.filter((problem) => !advisory.has(problem.code));
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
    // A SECRET is write-through: the backend pushes it to the runtime and forgets
    // it. Persisting it — encrypted or not — would put a credential in a diffable,
    // backed-up engineering file.
    if (spec.kind === 'secret') continue;
    if (spec.kind === 'flag' || spec.kind === 'bit') {
      // THREE states, not two: `false` ("checked, it is not zero-based" / "clear
      // that flag bit") and absent ("nobody said" / "leave the bit alone") are
      // different claims. An empty value stays unset.
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
    // The access mode FOLLOWS the protocol — one declaration, one truth. The
    // multi-mode checkboxes taught a distinction the workflow does not need:
    // the book's interface protocol already decides which candidate address a
    // generation writes, and a device is bound the way its connection speaks.
    accessModes: [draft.protocol],
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
  return { name: '', protocol, connection: {}, bookIds: [] };
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
