// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * S7 datatype mapping + classic absolute-operand builder.
 *
 * The LEAF map (S7/TIA elementary type → WinCC OA element type) follows the
 * SIMATIC data-type table. The absolute operand notation is the standard
 * `DB<n>.DBX<byte>.<bit>` / `DBB` / `DBW` / `DBD` addressing used by the
 * WinCC OA S7 driver for non-optimized blocks.
 *
 * ⚠️ UNVERIFIED (must be checked against a live S7 driver before the first
 * real check-in — same verification culture as the DPL/`-filter` work in
 * `docs/wui-para/NOTES.md`): the `_address.._datatype` TRANSFORMATION codes
 * of the S7 driver are NOT hardcoded here. {@link s7DatatypeCode} returns
 * `S7_DATATYPE_UNVERIFIED` (0) and the address builder keeps the value
 * injectable — the backend resolves the real constants once verified.
 */

import type { OaLeafType } from '../model.js';

/** S7 elementary datatype → WinCC OA element type. */
const LEAF_TYPE_MAP: Record<string, OaLeafType> = {
  Bool: 'Bool',
  Byte: 'Int',
  Char: 'Char',
  Word: 'UInt',
  DWord: 'Bit32',
  Int: 'Int',
  DInt: 'Int',
  UInt: 'UInt',
  UDInt: 'UInt',
  SInt: 'Int',
  USInt: 'Int',
  LInt: 'Long',
  ULInt: 'ULong',
  Real: 'Float',
  LReal: 'Float',
  Time: 'Time',
  Date: 'Time',
  Time_Of_Day: 'Time',
  DTL: 'Time',
  String: 'String',
  WString: 'String'
};

/** Byte size of each S7 elementary type in a NON-optimized (standard) block. */
export const S7_TYPE_SIZE: Record<string, number> = {
  Bool: 0, // bit-packed
  Byte: 1,
  Char: 1,
  SInt: 1,
  USInt: 1,
  Word: 2,
  Int: 2,
  UInt: 2,
  Date: 2,
  DWord: 4,
  DInt: 4,
  UDInt: 4,
  Real: 4,
  Time: 4,
  Time_Of_Day: 4,
  LReal: 8,
  LInt: 8,
  ULInt: 8,
  DTL: 12
  // String[n] handled separately: n + 2 bytes.
};

/** Sentinel: S7 `_datatype` transformation constants are resolved later. */
export const S7_DATATYPE_UNVERIFIED = 0;

/** Map an S7 elementary datatype to the WinCC OA element type. */
export function s7LeafType(dataType: string | undefined): OaLeafType {
  const name = (dataType ?? '').trim();
  if (/^String(\[\d+\])?$/i.test(name)) {
    return 'String';
  }
  return LEAF_TYPE_MAP[name] ?? 'String';
}

/** True when an S7 datatype has no scalar mapping (struct/array/unknown). */
export function isUnmappedS7Type(dataType: string | undefined): boolean {
  const name = (dataType ?? '').trim();
  return !(name in LEAF_TYPE_MAP) && !/^String(\[\d+\])?$/i.test(name);
}

/**
 * S7 `_address.._datatype` transformation for an elementary type.
 * Returns {@link S7_DATATYPE_UNVERIFIED} until the driver constants are
 * verified against a live system (see file header).
 */
export function s7DatatypeCode(_dataType: string | undefined): number {
  return S7_DATATYPE_UNVERIFIED;
}

/**
 * Classic absolute operand of a member of a NON-optimized DB:
 * Bool → `DB<n>.DBX<byte>.<bit>`, 1 byte → `DBB`, 2 bytes → `DBW`,
 * 4 bytes → `DBD`, larger types (String, LReal, DTL…) keep the byte offset
 * notation `DB<n>.DBB<byte>` (the driver's datatype/transformation carries
 * the length).
 */
export function s7Operand(dbNumber: number, dataType: string, byteOffset: number, bitOffset = 0): string {
  const name = dataType.trim();
  if (name === 'Bool') {
    return `DB${dbNumber}.DBX${byteOffset}.${bitOffset}`;
  }
  const size = /^String(\[\d+\])?$/i.test(name) ? 0 : (S7_TYPE_SIZE[name] ?? 0);
  if (size === 2) {
    return `DB${dbNumber}.DBW${byteOffset}`;
  }
  if (size === 4) {
    return `DB${dbNumber}.DBD${byteOffset}`;
  }
  return `DB${dbNumber}.DBB${byteOffset}`;
}

/** `_address.._drv_ident` for the S7 driver family. */
export const S7_DRV_IDENT = 'S7';
