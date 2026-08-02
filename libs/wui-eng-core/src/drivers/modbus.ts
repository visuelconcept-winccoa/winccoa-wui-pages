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
 * ⚠️ UNVERIFIED (same policy as `drivers/s7.ts`): the WinCC OA Modbus driver's
 * `_address.._datatype` TRANSFORMATION constants are NOT hardcoded here.
 * {@link modbusDatatypeCode} returns {@link MODBUS_DATATYPE_UNVERIFIED} until
 * checked against a live driver; byte/word order must also be confirmed per
 * device (big-endian vs little-endian is the #1 Modbus pitfall).
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

/** Sentinel: WinCC OA Modbus `_datatype` transformation constants unverified. */
export const MODBUS_DATATYPE_UNVERIFIED = 0;

/** Map a register-map datatype to the WinCC OA element type. */
export function modbusLeafType(dataType: ModbusDataType): OaLeafType {
  return LEAF_TYPE_MAP[dataType] ?? 'Float';
}

/** Registers spanned by a datatype (REAL = 2, LREAL = 4, …). */
export function modbusRegisterCount(dataType: ModbusDataType): number {
  return REGISTER_COUNT[dataType] ?? 1;
}

/**
 * `_address.._datatype` for the WinCC OA Modbus driver — returns
 * {@link MODBUS_DATATYPE_UNVERIFIED} until verified (see file header).
 */
export function modbusDatatypeCode(_dataType: ModbusDataType): number {
  return MODBUS_DATATYPE_UNVERIFIED;
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
