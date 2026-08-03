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
 * **`_datatype` transformations — two DIFFERENT drivers.** The classic **S7**
 * driver (S7-300/400, `_drv_ident` "S7") and **S7Plus** (S7-1200/1500) have
 * disjoint code ranges and different vocabularies: 700–722 with driver-flavoured
 * names (`INT16`, `BIT`, `TimeOfDay`…) versus 1001–1027 with the IEC names TIA
 * itself uses (`BOOL`, `UDINT`, `LREAL`…). Choosing the S7Plus code for an S7
 * address would silently address the wrong transformation, so the two tables are
 * kept apart and {@link s7DatatypeCode} takes the driver as an argument.
 *
 * Source: WinCC OA help, `_address` config appendix, "`_address.._datatype`
 * peripheral address" (tables S7 and S7Plus) — see
 * `docs/wui-eng-studio/VENDOR-ADDRESS-TRANSFORMATIONS.md`, which records the
 * tables verbatim.
 *
 * A type the driver has NO transformation for returns `undefined` rather than a
 * plausible neighbour: the classic S7 driver has no 64-bit integer, no 64-bit
 * float and no wide string, and quietly mapping `LReal` onto `FLOAT` (32-bit)
 * would truncate every value. The generator then creates the DPE without a
 * peripheral address and says so.
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

/**
 * `_address.._datatype` transformations of the CLASSIC **S7** driver (S7-300/400).
 * Verbatim from the WinCC OA `_address` appendix.
 */
export const S7Datatype = {
  UNDEFINED: 700,
  INT16: 701,
  INT32: 702,
  UINT16: 703,
  BYTE: 704,
  FLOAT: 705,
  /** The driver's name for a boolean. */
  BIT: 706,
  STRING: 707,
  UINT32: 708,
  /** S7-300/400 `DATE_AND_TIME` (8-byte BCD). */
  DATETIME: 709,
  BLOB: 710,
  BITSTRING: 711,
  TIME_OF_DAY: 713,
  S5TIME: 714,
  /** S7-1200 date/time — reachable through the classic driver. */
  DATETIME_LONG: 718,
  INT32_WITH_QUALITY: 719,
  UINT32_WITH_QUALITY: 720,
  FLOAT_WITH_QUALITY: 721,
  S5TIME_AS_MILLISECONDS: 722
} as const;

/**
 * `_address.._datatype` transformations of the **S7Plus** driver (S7-1200/1500).
 * The names are the IEC ones, so the mapping from a TIA datatype is 1:1 for every
 * elementary type TIA can declare — except `Char`/`WChar`, which the driver table
 * does not list (mapped to `BYTE`/`WORD`, see {@link S7PLUS_CODE_MAP}).
 */
export const S7PlusDatatype = {
  DEFAULT: 1001,
  BOOL: 1002,
  BYTE: 1003,
  WORD: 1004,
  DWORD: 1005,
  LWORD: 1006,
  USINT: 1007,
  UINT: 1008,
  UDINT: 1009,
  ULINT: 1010,
  SINT: 1011,
  INT: 1012,
  DINT: 1013,
  LINT: 1014,
  REAL: 1015,
  LREAL: 1016,
  DATE: 1017,
  DATETIME: 1018,
  TIME: 1019,
  TIME_OF_DAY: 1020,
  LDATETIME: 1021,
  LTIME: 1022,
  LTOD: 1023,
  DTL: 1024,
  S5TIME: 1025,
  STRING: 1026,
  WSTRING: 1027
} as const;

/** Which S7 driver an address targets. */
export type S7Variant = 's7' | 's7plus';

/**
 * TIA datatype → classic **S7** transformation.
 *
 * Absent on purpose (the driver table has no counterpart, so the generator must
 * NOT invent one): `LInt`/`ULInt`/`LWord` (no 64-bit), `LReal` (no 64-bit float —
 * `FLOAT` would truncate), `WString`, `LTime`/`LTod`/`LDT`.
 * Judgement calls, flagged here rather than buried: `Char` and `USInt` ride on
 * `BYTE` (a byte is what the wire carries), `Date` on `UINT16` (S7 `DATE` is a
 * 16-bit day count) and `Time` on `INT32` (a signed millisecond count).
 */
const S7_CODE_MAP: Record<string, number> = {
  Bool: S7Datatype.BIT,
  Byte: S7Datatype.BYTE,
  Char: S7Datatype.BYTE,
  USInt: S7Datatype.BYTE,
  Word: S7Datatype.UINT16,
  Int: S7Datatype.INT16,
  UInt: S7Datatype.UINT16,
  Date: S7Datatype.UINT16,
  DWord: S7Datatype.UINT32,
  DInt: S7Datatype.INT32,
  UDInt: S7Datatype.UINT32,
  Time: S7Datatype.INT32,
  Real: S7Datatype.FLOAT,
  Time_Of_Day: S7Datatype.TIME_OF_DAY,
  TOD: S7Datatype.TIME_OF_DAY,
  S5Time: S7Datatype.S5TIME,
  Date_And_Time: S7Datatype.DATETIME,
  DT: S7Datatype.DATETIME,
  DTL: S7Datatype.DATETIME_LONG
  // String[n] is handled by s7DatatypeCode (the length is part of the name).
};

/** TIA datatype → **S7Plus** transformation (the IEC names line up 1:1). */
const S7PLUS_CODE_MAP: Record<string, number> = {
  Bool: S7PlusDatatype.BOOL,
  Byte: S7PlusDatatype.BYTE,
  Char: S7PlusDatatype.BYTE,
  WChar: S7PlusDatatype.WORD,
  Word: S7PlusDatatype.WORD,
  DWord: S7PlusDatatype.DWORD,
  LWord: S7PlusDatatype.LWORD,
  USInt: S7PlusDatatype.USINT,
  UInt: S7PlusDatatype.UINT,
  UDInt: S7PlusDatatype.UDINT,
  ULInt: S7PlusDatatype.ULINT,
  SInt: S7PlusDatatype.SINT,
  Int: S7PlusDatatype.INT,
  DInt: S7PlusDatatype.DINT,
  LInt: S7PlusDatatype.LINT,
  Real: S7PlusDatatype.REAL,
  LReal: S7PlusDatatype.LREAL,
  Date: S7PlusDatatype.DATE,
  Date_And_Time: S7PlusDatatype.DATETIME,
  DT: S7PlusDatatype.DATETIME,
  Time: S7PlusDatatype.TIME,
  Time_Of_Day: S7PlusDatatype.TIME_OF_DAY,
  TOD: S7PlusDatatype.TIME_OF_DAY,
  LDT: S7PlusDatatype.LDATETIME,
  LTime: S7PlusDatatype.LTIME,
  LTOD: S7PlusDatatype.LTOD,
  DTL: S7PlusDatatype.DTL,
  S5Time: S7PlusDatatype.S5TIME,
  WString: S7PlusDatatype.WSTRING
};

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
 * `_address.._datatype` transformation of an elementary TIA type for the given
 * driver, or `undefined` when that driver has none for it (see the file header:
 * a missing transformation must not be replaced by a plausible neighbour).
 *
 * Type names are matched case-insensitively, since exports spell them
 * inconsistently (`Bool`/`BOOL`, `Time_Of_Day`/`TIME_OF_DAY`).
 */
export function s7DatatypeCode(dataType: string | undefined, variant: S7Variant): number | undefined {
  const name = (dataType ?? '').trim();
  if (name === '') return undefined;
  const map = variant === 's7plus' ? S7PLUS_CODE_MAP : S7_CODE_MAP;
  // `String` and `String[254]` are the same transformation — the length lives in
  // the address, not in the type code.
  if (/^W?String(\[\d+\])?$/i.test(name)) {
    const wide = /^WString/i.test(name);
    if (!wide) return variant === 's7plus' ? S7PlusDatatype.STRING : S7Datatype.STRING;
    return variant === 's7plus' ? S7PlusDatatype.WSTRING : undefined;
  }
  const key = Object.keys(map).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : map[key];
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
