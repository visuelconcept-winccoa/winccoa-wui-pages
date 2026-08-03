// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modbus datatype mapping + register address notations.
 *
 * Modbus has NO browse/discovery (see the VC driver catalog): a Modbus book is
 * always built from a REGISTER MAP — a device-type catalog (CSV / vendor table),
 * which is exactly why such a book is a template mutualised across N identical
 * devices.
 *
 * Two equivalent notations are produced for the same register, because mixing
 * them up is a classic field mistake (documented in the VC PAC3200 fiche):
 *   - {@link modbusHoldingRef}  `4xxxx`     — standard Modbus holding-register
 *                                             notation (what configurators show);
 *   - {@link modbusWordRef}     `%MW<n>`    — Siemens-style word notation used by
 *                                             the Industrial Edge Modbus TCP
 *                                             connector templates.
 * Both derive from the vendor table's **1-based offset**: offset 1 → `40002` /
 * `%MW2` (verified against the SENTRON PAC3200 manual A5E01168664B-04 §3.9.3
 * via the VC fiche `templates-import-tags-modbus-pac3200`).
 *
 * The `_address.._datatype` TRANSFORMATION constants (560–577) come from the
 * WinCC OA help, `_address` config appendix, table MODBUS — recorded verbatim in
 * `docs/wui-eng-studio/VENDOR-ADDRESS-TRANSFORMATIONS.md`.
 *
 * ⚠️ Still to confirm PER DEVICE, and no table can answer it: the byte/word order
 * of 32/64-bit values (big-endian vs little-endian is the #1 Modbus pitfall) and
 * the connector's "zero based addressing" option — a one-register shift offsets
 * every measurement. See {@link ModbusWordOrder} and the PAC3200 book's warnings.
 */

import type { OaLeafType } from '../model.js';

/** Register-map datatypes, named as the vendor/connector templates name them. */
export type ModbusDataType = 'REAL' | 'LREAL' | 'UDINT' | 'DINT' | 'UINT' | 'INT' | 'BOOL';

/** Register-map datatype → WinCC OA element type. */
const LEAF_TYPE_MAP: Record<ModbusDataType, OaLeafType> = {
  REAL: 'Float',
  LREAL: 'Float',
  UDINT: 'UInt',
  DINT: 'Int',
  UINT: 'UInt',
  INT: 'Int',
  BOOL: 'Bool'
};

/** Number of 16-bit registers each datatype spans. */
const REGISTER_COUNT: Record<ModbusDataType, number> = {
  REAL: 2,
  LREAL: 4,
  UDINT: 2,
  DINT: 2,
  UINT: 1,
  INT: 1,
  BOOL: 1
};

/** Word order of 32/64-bit values — the classic Modbus pitfall. */
export type ModbusWordOrder = 'big' | 'little';

/**
 * `_address.._datatype` transformations of the WinCC OA **Modbus** driver.
 * Verbatim from the `_address` appendix (note the non-contiguous numbering: the
 * 64-bit types were appended after the original block).
 */
export const ModbusDatatype = {
  UNDEFINED: 560,
  INT16: 561,
  INT32: 562,
  UINT16: 563,
  UINT32: 564,
  CHAR: 565,
  FLOAT: 566,
  BIT: 567,
  BOOLEAN_AS_BYTE: 568,
  STRING: 569,
  BLOB: 570,
  INT64: 571,
  DOUBLE: 572,
  FLOAT_WITH_TIMESTAMP: 573,
  UINT64: 574,
  /** PLC-specific MOD10 spanning 2 / 3 / 4 registers. */
  MOD10_SIZE_2: 575,
  MOD10_SIZE_3: 576,
  MOD10_SIZE_4: 577
} as const;

/**
 * Source-type name → Modbus transformation constant.
 *
 * Two vocabularies land here, because a Modbus book has two possible origins and
 * both name their types their own way: a **vendor register map** ({@link
 * ModbusDataType}: `REAL`, `UDINT`…) and a **Control Expert export** (IEC-61131:
 * `EBOOL`, `WORD`, `DWORD`, `TIME`…). Keys are normalised upper-case heads, so
 * `STRING[16]` resolves like `STRING`.
 *
 * Absent on purpose: `DATE` / `TOD` / `DT`. Schneider packs those as
 * vendor-specific BCD across several registers and the Modbus driver has no
 * transformation for them — reading one as `UINT32` would return a number that
 * looks like a date and is not.
 */
const DATATYPE_CODE_MAP: Record<string, number> = {
  BOOL: ModbusDatatype.BIT,
  EBOOL: ModbusDatatype.BIT,
  INT: ModbusDatatype.INT16,
  UINT: ModbusDatatype.UINT16,
  WORD: ModbusDatatype.UINT16,
  BYTE: ModbusDatatype.UINT16,
  DINT: ModbusDatatype.INT32,
  UDINT: ModbusDatatype.UINT32,
  DWORD: ModbusDatatype.UINT32,
  /** Schneider `TIME` is a DURATION in ms — an unsigned 32-bit count. */
  TIME: ModbusDatatype.UINT32,
  LINT: ModbusDatatype.INT64,
  ULINT: ModbusDatatype.UINT64,
  REAL: ModbusDatatype.FLOAT,
  LREAL: ModbusDatatype.DOUBLE,
  STRING: ModbusDatatype.STRING
};

/** Map a register-map datatype to the WinCC OA element type. */
export function modbusLeafType(dataType: ModbusDataType): OaLeafType {
  return LEAF_TYPE_MAP[dataType] ?? 'Float';
}

/** Registers spanned by a datatype (REAL = 2, LREAL = 4, …). */
export function modbusRegisterCount(dataType: ModbusDataType): number {
  return REGISTER_COUNT[dataType] ?? 1;
}

/**
 * `_address.._datatype` for the WinCC OA Modbus driver, or `undefined` when the
 * driver has no transformation for that source type — the generator then leaves the
 * DPE without an address rather than guessing (see {@link DATATYPE_CODE_MAP}).
 *
 * Takes a plain string, not {@link ModbusDataType}: a Modbus book may come from a
 * Control Expert export, whose type names are the IEC ones.
 */
export function modbusDatatypeCode(dataType: string | undefined): number | undefined {
  const text = (dataType ?? '').trim().toUpperCase();
  // `STRING[16]`, `ARRAY[0..9] OF INT` → the leading identifier.
  const head = /^([A-Z_]+)/.exec(text)?.[1] ?? text;
  return DATATYPE_CODE_MAP[head];
}

/**
 * Standard Modbus **holding register** (4x) notation of a register index:
 * `40001 + index`.
 *
 * The meaning of `index` is source-specific — the notation is not:
 *  - vendor register tables (SENTRON PAC3200) give a **1-based table offset**
 *    → offset 1 → `40002`;
 *  - Schneider located variables give the **`%MW` number (0-based)**
 *    → `%MW0` → `40001`, `%MW4513` → `44514`.
 */
export function modbusHoldingRef(offset: number): string {
  return String(40_001 + offset);
}

/** Standard Modbus **coil** (0x) notation: `00001 + index` (`%M0` → `00001`). */
export function modbusCoilRef(index: number): string {
  return `0${String(index + 1).padStart(4, '0')}`;
}

/** Standard Modbus **discrete input** (1x) notation: `10001 + index`. */
export function modbusDiscreteInputRef(index: number): string {
  return String(10_001 + index);
}

/** Standard Modbus **input register** (3x) notation: `30001 + index`. */
export function modbusInputRegisterRef(index: number): string {
  return String(30_001 + index);
}

/**
 * Siemens-style word notation of the same register: `%MW<offset + 1>`
 * (offset 1 → `%MW2`) — the Industrial Edge Modbus TCP connector template form.
 */
export function modbusWordRef(offset: number): string {
  return `%MW${offset + 1}`;
}

/** `_address.._drv_ident` for the Modbus driver family. */
export const MODBUS_DRV_IDENT = 'MODBUS';
