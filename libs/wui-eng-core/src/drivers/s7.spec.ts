// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * S7 `_datatype` transformations and the classic absolute-operand notation.
 *
 * The numbers below are asserted ONE BY ONE against the vendor table recorded in
 * `docs/wui-eng-studio/VENDOR-ADDRESS-TRANSFORMATIONS.md` (WinCC OA `_address`
 * appendix, tables S7 and S7Plus). This is the failure mode the tests exist for: a
 * wrong transformation code does not raise an error on a real system, it reads a
 * plausible-looking wrong value — a `LReal` truncated to 32 bits, an `Int` read as
 * unsigned. Pinning each pair is the only way a mistake surfaces here instead of on
 * a plant floor.
 */
import { describe, expect, it } from 'vitest';
import { S7Datatype, S7PlusDatatype, isUnmappedS7Type, s7DatatypeCode, s7LeafType, s7Operand } from './s7.js';

describe('s7 element types', () => {
  it('maps the TIA elementary types to WinCC OA element types', () => {
    expect(s7LeafType('Bool')).toBe('Bool');
    expect(s7LeafType('Int')).toBe('Int');
    expect(s7LeafType('Real')).toBe('Float');
    expect(s7LeafType('DWord')).toBe('Bit32');
    expect(s7LeafType('String[32]')).toBe('String');
  });

  it('reports a struct/array/unknown type as unmapped', () => {
    expect(isUnmappedS7Type('MyUdt')).toBe(true);
    expect(isUnmappedS7Type('Array[0..9] of Real')).toBe(true);
    expect(isUnmappedS7Type('Real')).toBe(false);
  });
});

describe('s7DatatypeCode — classic S7 driver (700–722)', () => {
  it('maps each supported TIA type to its verified transformation', () => {
    const expected: Record<string, number> = {
      Bool: 706, // BIT
      Byte: 704,
      Char: 704, // no CHAR transformation: a byte is what the wire carries
      USInt: 704,
      Word: 703, // UINT16
      Int: 701, // INT16
      UInt: 703, // UINT16
      Date: 703, // 16-bit day count
      DWord: 708, // UINT32
      DInt: 702, // INT32
      UDInt: 708, // UINT32
      Time: 702, // signed millisecond count
      Real: 705, // FLOAT
      Time_Of_Day: 713,
      S5Time: 714,
      Date_And_Time: 709, // DATETIME (S7-300/400)
      DTL: 718 // DATETIMELONG (S7-1200)
    };
    for (const [type, code] of Object.entries(expected)) {
      expect(s7DatatypeCode(type, 's7'), type).toBe(code);
    }
  });

  it('maps String and String[n] to the same STRING transformation', () => {
    expect(s7DatatypeCode('String', 's7')).toBe(S7Datatype.STRING);
    expect(s7DatatypeCode('String[254]', 's7')).toBe(S7Datatype.STRING);
  });

  /**
   * The refusals matter more than the mappings: the classic driver has no 64-bit
   * integer, no 64-bit float and no wide string. Returning FLOAT for an `LReal`
   * would halve its precision on every read, silently.
   */
  it('returns undefined for a type the classic driver cannot carry', () => {
    for (const type of ['LReal', 'LInt', 'ULInt', 'LWord', 'WString', 'LTime', 'LTOD', 'LDT', 'SInt']) {
      expect(s7DatatypeCode(type, 's7'), type).toBeUndefined();
    }
  });

  it('never answers with an S7Plus code', () => {
    const s7Codes = new Set<number>(Object.values(S7Datatype));
    for (const type of ['Bool', 'Int', 'Real', 'String', 'DTL']) {
      expect(s7Codes.has(s7DatatypeCode(type, 's7') as number), type).toBe(true);
    }
  });
});

describe('s7DatatypeCode — S7Plus driver (1001–1027)', () => {
  it('maps each TIA type to its verified transformation (IEC names, 1:1)', () => {
    const expected: Record<string, number> = {
      Bool: 1002,
      Byte: 1003,
      Word: 1004,
      DWord: 1005,
      LWord: 1006,
      USInt: 1007,
      UInt: 1008,
      UDInt: 1009,
      ULInt: 1010,
      SInt: 1011,
      Int: 1012,
      DInt: 1013,
      LInt: 1014,
      Real: 1015,
      LReal: 1016,
      Date: 1017,
      Date_And_Time: 1018,
      Time: 1019,
      Time_Of_Day: 1020,
      LDT: 1021,
      LTime: 1022,
      LTOD: 1023,
      DTL: 1024,
      S5Time: 1025,
      String: 1026,
      WString: 1027
    };
    for (const [type, code] of Object.entries(expected)) {
      expect(s7DatatypeCode(type, 's7plus'), type).toBe(code);
    }
  });

  it('carries the 64-bit types the classic driver cannot', () => {
    for (const type of ['LReal', 'LInt', 'ULInt', 'LWord', 'WString']) {
      expect(s7DatatypeCode(type, 's7'), type).toBeUndefined();
      expect(s7DatatypeCode(type, 's7plus'), type).toBeDefined();
    }
  });

  it('gives a DIFFERENT code than the classic driver for the same type', () => {
    // The two tables are disjoint: picking the wrong one is a silent misread, which
    // is why the variant is a required argument.
    for (const type of ['Bool', 'Int', 'Real', 'String', 'DTL']) {
      expect(s7DatatypeCode(type, 's7'), type).not.toBe(s7DatatypeCode(type, 's7plus'));
    }
    expect(S7PlusDatatype.BOOL).toBe(1002);
  });
});

describe('s7DatatypeCode — input tolerance', () => {
  it('matches type names case-insensitively (exports spell them inconsistently)', () => {
    expect(s7DatatypeCode('BOOL', 's7plus')).toBe(S7PlusDatatype.BOOL);
    expect(s7DatatypeCode('time_of_day', 's7')).toBe(S7Datatype.TIME_OF_DAY);
    expect(s7DatatypeCode('  Real  ', 's7')).toBe(S7Datatype.FLOAT);
  });

  it('returns undefined for a missing or unknown type rather than a default', () => {
    expect(s7DatatypeCode(undefined, 's7')).toBeUndefined();
    expect(s7DatatypeCode('', 's7plus')).toBeUndefined();
    expect(s7DatatypeCode('MyUdt', 's7plus')).toBeUndefined();
  });
});

describe('s7Operand — classic absolute operands', () => {
  it('uses the notation matching the type size', () => {
    expect(s7Operand(10, 'Bool', 4, 3)).toBe('DB10.DBX4.3');
    expect(s7Operand(10, 'Byte', 6)).toBe('DB10.DBB6');
    expect(s7Operand(10, 'Int', 8)).toBe('DB10.DBW8');
    expect(s7Operand(10, 'Real', 12)).toBe('DB10.DBD12');
    // Larger types keep the byte notation — the transformation carries the length.
    expect(s7Operand(10, 'String[32]', 20)).toBe('DB10.DBB20');
    expect(s7Operand(10, 'DTL', 40)).toBe('DB10.DBB40');
  });
});
