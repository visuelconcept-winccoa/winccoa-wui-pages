// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Catalog of WinCC OA datapoint configs and their detail attributes, driving
 * the PARA config-attribute panel (view + edit).
 *
 * Attribute names/types follow the WinCC OA help "Config attributes" pages.
 * Each attribute is read with dpGet `:<config>..<attr>` and written with the
 * same path via POST /api/para/dp/set. A config is considered present when any
 * of its attributes resolves (its `_type` is the canonical existence probe).
 *
 * Editing semantics by kind:
 *   number/string/bool -> inline editor, written as that scalar
 *   dyn                -> multi-line editor (one string item per line)
 *   time               -> read-only local timestamp
 *   status             -> read-only named info-bit flags (_status64)
 *   userbits           -> read-only 1..32 bit matrix (_userbits)
 *   readonly           -> read-only text (manager/user/ids/runtime state)
 */

export type AttrKind = 'number' | 'bool' | 'string' | 'dyn' | 'time' | 'status' | 'userbits' | 'readonly';

export interface AttrSpec {
  attr: string;
  label: string;
  kind: AttrKind;
}

export interface ConfigSpec {
  config: string;
  label: string;
  attrs: AttrSpec[];
}

/** Number of user bits, held together in the `_userbits` attribute (bits 0-31). */
export const USER_BIT_COUNT = 32;

/** Positions decoded from `_status64`; bits 0-23 are the named system bits. */
export const STATUS_BIT_COUNT = 24;

/**
 * Named system/info bits of the value status (`_status64`, positions 0-23).
 * Bits 24-55 are the user bits (exposed separately as `_userbits`).
 * Source: WinCC OA help "Config '_original'" status bit table.
 */
export const INFO_BITS: { position: number; name: string; meaning: string }[] = [
  { position: 0, name: 'active', meaning: 'Configuration is active' },
  { position: 1, name: 'exp_default', meaning: 'Default value explicitly set in PARA' },
  { position: 2, name: 'aut_default', meaning: 'Default value set automatically (invalid value)' },
  { position: 3, name: 'out_prange', meaning: 'WinCC OA value range violated' },
  { position: 4, name: 'out_range', meaning: 'PLC value could not be converted' },
  { position: 5, name: 'exp_inv', meaning: 'Value explicitly set invalid in PARA' },
  { position: 6, name: 'aut_inv', meaning: 'Invalid value set by interface driver' },
  { position: 8, name: 'default_bad', meaning: 'Invalid default value' },
  { position: 9, name: 'from_GI', meaning: 'Value set during general query' },
  { position: 10, name: 'from_SI', meaning: 'Value set during individual query' },
  { position: 12, name: 'corr', meaning: 'Correction value (archived values)' },
  { position: 13, name: 'compr', meaning: 'Archived value compressed in database' },
  { position: 14, name: 'comp_corr', meaning: 'Compression based on correction values' },
  { position: 15, name: 'corr_add', meaning: 'Additional correction value' },
  { position: 16, name: 'comp_inv', meaning: 'Compression based on invalid values' },
  { position: 17, name: 'stime_inv', meaning: 'Source time is invalid' },
  { position: 18, name: 'transition', meaning: 'Command sent to PLC, awaiting confirmation' },
  { position: 19, name: 'last_value_storage_off', meaning: 'Last value storage deactivated' },
  { position: 20, name: 'value_changed', meaning: 'Original value has changed' },
  { position: 21, name: 'value_up', meaning: 'Original value is increasing' },
  { position: 22, name: 'uncertain', meaning: 'Peripheral address not currently polled' }
];

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);

/** Decode a status word into the 0-based positions of its set bits. */
export function decodeBits(raw: unknown, count: number): number[] {
  let bits: bigint;
  try {
    if (typeof raw === 'bigint') {
      bits = raw;
    } else if (typeof raw === 'number') {
      bits = BigInt(Math.trunc(raw));
    } else if (typeof raw === 'boolean') {
      bits = raw ? BIG_ONE : BIG_ZERO;
    } else if (typeof raw === 'string' && raw.trim() !== '') {
      bits = BigInt(raw.trim());
    } else {
      return [];
    }
  } catch {
    return [];
  }
  const set: number[] = [];
  for (let position = 0; position < count; position += 1) {
    if (((bits >> BigInt(position)) & BIG_ONE) === BIG_ONE) {
      set.push(position);
    }
  }
  return set;
}

/** Value configs share the runtime attribute set (value, time, status, bits). */
const VALUE_ATTRS: AttrSpec[] = [
  { attr: '_value', label: 'Value', kind: 'readonly' },
  { attr: '_stime', label: 'Source time', kind: 'time' },
  { attr: '_status64', label: 'Status', kind: 'status' },
  { attr: '_userbits', label: 'User bits', kind: 'userbits' },
  { attr: '_manager', label: 'Manager', kind: 'readonly' },
  { attr: '_user', label: 'User', kind: 'readonly' },
  { attr: '_aut', label: 'Authority', kind: 'readonly' }
];

/**
 * All configs shown in the panel. Non-applicable configs (or attributes) for an
 * element simply don't resolve and are hidden, so the list is safe to extend.
 * Indexed configs (`_msg_conv`, `_cmd_conv`) expose their `_type` here; their
 * per-index parameters are not yet edited inline.
 */
export const CONFIG_SPECS: ConfigSpec[] = [
  { config: '_original', label: 'Original value', attrs: VALUE_ATTRS },
  { config: '_online', label: 'Online value', attrs: VALUE_ATTRS },
  { config: '_offline', label: 'Offline value', attrs: VALUE_ATTRS },
  {
    config: '_default',
    label: 'Default value',
    attrs: [
      { attr: '_type', label: 'Type', kind: 'number' },
      { attr: '_value', label: 'Default value', kind: 'string' },
      { attr: '_set_ibit', label: 'Set invalid bit', kind: 'bool' },
      { attr: '_set_pvrange', label: 'Set on range violation', kind: 'bool' }
    ]
  },
  {
    config: '_pv_range',
    label: 'Value range',
    attrs: [
      { attr: '_type', label: 'Type', kind: 'number' },
      { attr: '_min', label: 'Min', kind: 'string' },
      { attr: '_max', label: 'Max', kind: 'string' },
      { attr: '_incl_min', label: 'Include min', kind: 'bool' },
      { attr: '_incl_max', label: 'Include max', kind: 'bool' },
      { attr: '_neg', label: 'Negate', kind: 'bool' },
      { attr: '_ignor_inv', label: 'Ignore invalid', kind: 'bool' },
      { attr: '_match', label: 'Match pattern', kind: 'string' }
    ]
  },
  {
    config: '_u_range',
    label: 'User range',
    attrs: [
      { attr: '_type', label: 'Type', kind: 'number' },
      { attr: '_min', label: 'Min', kind: 'string' },
      { attr: '_max', label: 'Max', kind: 'string' },
      { attr: '_incl_min', label: 'Include min', kind: 'bool' },
      { attr: '_incl_max', label: 'Include max', kind: 'bool' },
      { attr: '_neg', label: 'Negate', kind: 'bool' }
    ]
  },
  {
    config: '_smooth',
    label: 'Smoothing',
    attrs: [
      { attr: '_type', label: 'Type', kind: 'number' },
      { attr: '_std_type', label: 'Procedure', kind: 'number' },
      { attr: '_std_time', label: 'Interval', kind: 'time' },
      { attr: '_std_tol', label: 'Tolerance', kind: 'number' },
      { attr: '_deriv_limit', label: 'Phase limit', kind: 'number' },
      { attr: '_deriv_time', label: 'Deriv. interval', kind: 'time' },
      { attr: '_deriv_tol1', label: 'Tolerance 1', kind: 'number' },
      { attr: '_deriv_tol2', label: 'Tolerance 2', kind: 'number' },
      { attr: '_flut_time', label: 'Flicker interval', kind: 'time' },
      { attr: '_old_new', label: 'Compare old/new', kind: 'bool' }
    ]
  },
  {
    config: '_archive',
    label: 'Archiving',
    attrs: [{ attr: '_type', label: 'Type', kind: 'number' }]
  },
  {
    config: '_address',
    label: 'Peripheral address',
    attrs: [
      { attr: '_type', label: 'Type', kind: 'number' },
      { attr: '_reference', label: 'Reference', kind: 'string' },
      { attr: '_drv_ident', label: 'Driver', kind: 'number' },
      { attr: '_direction', label: 'Direction', kind: 'number' },
      { attr: '_datatype', label: 'Transformation', kind: 'number' },
      { attr: '_active', label: 'Active', kind: 'bool' },
      { attr: '_lowlevel', label: 'Lowlevel', kind: 'bool' },
      { attr: '_subindex', label: 'Subindex', kind: 'number' },
      { attr: '_poll_group', label: 'Poll group', kind: 'string' }
    ]
  },
  {
    config: '_msg_conv',
    label: 'Message conversion',
    attrs: [{ attr: '_type', label: 'Type', kind: 'number' }]
  },
  {
    config: '_cmd_conv',
    label: 'Command conversion',
    attrs: [{ attr: '_type', label: 'Type', kind: 'number' }]
  },
  {
    config: '_alert_hdl',
    label: 'Alarm handling',
    attrs: [
      { attr: '_type', label: 'Type', kind: 'number' },
      { attr: '_active', label: 'Active', kind: 'bool' },
      { attr: '_prior', label: 'Priority', kind: 'number' },
      { attr: '_text', label: 'Text', kind: 'string' }
    ]
  },
  {
    config: '_alert_class',
    label: 'Alert class',
    attrs: [{ attr: '_type', label: 'Type', kind: 'number' }]
  },
  {
    config: '_corr',
    label: 'Correction',
    attrs: [
      { attr: '_type', label: 'Type', kind: 'number' },
      { attr: '_value', label: 'Value', kind: 'string' },
      { attr: '_status64', label: 'Status', kind: 'status' },
      { attr: '_stime', label: 'Source time', kind: 'time' }
    ]
  },
  {
    config: '_dp_fct',
    label: 'DP function',
    attrs: [
      { attr: '_type', label: 'Type', kind: 'number' },
      { attr: '_fct', label: 'Function', kind: 'string' },
      { attr: '_param', label: 'Parameters', kind: 'dyn' },
      { attr: '_global', label: 'Global inputs', kind: 'dyn' }
    ]
  },
  {
    config: '_lock',
    label: 'Lock',
    attrs: [
      { attr: '_type', label: 'Type', kind: 'number' },
      { attr: '_locked', label: 'Locked', kind: 'bool' },
      { attr: '_man_id', label: 'Manager id', kind: 'readonly' },
      { attr: '_user_id', label: 'User id', kind: 'readonly' }
    ]
  },
  {
    config: '_distrib',
    label: 'Driver allocation',
    attrs: [
      { attr: '_type', label: 'Type', kind: 'number' },
      { attr: '_driver', label: 'Driver', kind: 'number' }
    ]
  },
  {
    config: '_general',
    label: 'Value storage',
    attrs: [{ attr: '_type', label: 'Type', kind: 'number' }]
  },
  {
    config: '_auth',
    label: 'Authorization',
    attrs: [{ attr: '_type', label: 'Type', kind: 'number' }]
  }
];
