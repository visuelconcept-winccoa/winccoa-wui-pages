// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modbus register notations + datatype mapping. The offset↔notation triplets are
 * the ones verified against the SENTRON PAC3200 manual (A5E01168664B-04 §3.9.3)
 * through the VC fiche `templates-import-tags-modbus-pac3200`:
 *   offset 1 → 40002 / %MW2 · offset 65 → 40066 / %MW66 · offset 801 → 40802 / %MW802
 */
import { describe, expect, it } from 'vitest';
import {
  ModbusDatatype,
  modbusDatatypeCode,
  modbusHoldingRef,
  modbusLeafType,
  modbusRegisterCount,
  modbusWordRef,
  type ModbusDataType
} from './modbus.js';

describe('modbus register notations', () => {
  it('maps a 1-based vendor offset to the standard 4xxxx notation', () => {
    expect(modbusHoldingRef(1)).toBe('40002');
    expect(modbusHoldingRef(65)).toBe('40066');
    expect(modbusHoldingRef(801)).toBe('40802');
  });

  it('maps the same offset to the %MW word notation', () => {
    expect(modbusWordRef(1)).toBe('%MW2');
    expect(modbusWordRef(65)).toBe('%MW66');
    expect(modbusWordRef(801)).toBe('%MW802');
  });

  it('keeps both notations consistent (same register)', () => {
    for (const offset of [1, 13, 55, 65, 2801]) {
      expect(modbusHoldingRef(offset)).toBe(`4${modbusWordRef(offset).replace('%MW', '').padStart(4, '0')}`);
    }
  });
});

describe('modbus datatypes', () => {
  it('maps register-map types to WinCC OA element types', () => {
    expect(modbusLeafType('REAL')).toBe('Float');
    expect(modbusLeafType('LREAL')).toBe('Float');
    expect(modbusLeafType('UDINT')).toBe('UInt');
    expect(modbusLeafType('INT')).toBe('Int');
    expect(modbusLeafType('BOOL')).toBe('Bool');
  });

  it('reports the register span of each type', () => {
    expect(modbusRegisterCount('REAL')).toBe(2);
    expect(modbusRegisterCount('LREAL')).toBe(4);
    expect(modbusRegisterCount('UDINT')).toBe(2);
    expect(modbusRegisterCount('INT')).toBe(1);
  });

  /**
   * The transformation constants of the WinCC OA Modbus driver, asserted one by one
   * against the vendor table (see docs/wui-eng-studio/VENDOR-ADDRESS-TRANSFORMATIONS
   * .md). A wrong number here does not fail loudly on a real system — it reads a
   * plausible-looking wrong value — so each pair is pinned.
   */
  it('maps each register-map type to its verified driver transformation', () => {
    const expected: Record<ModbusDataType, number> = {
      BOOL: 567, // BIT
      INT: 561, // INT16
      UINT: 563, // UINT16
      DINT: 562, // INT32
      UDINT: 564, // UINT32
      REAL: 566, // FLOAT
      LREAL: 572 // DOUBLE — 64-bit IEEE 754, NOT FLOAT
    };
    for (const [type, code] of Object.entries(expected)) {
      expect(modbusDatatypeCode(type as ModbusDataType), type).toBe(code);
    }
  });

  it('exposes the whole vendor table, including the types the register map does not use', () => {
    // Pinned so an upgrade that renumbers or adds a transformation is noticed here
    // rather than in an address that silently misreads.
    expect(ModbusDatatype).toMatchObject({
      UNDEFINED: 560,
      CHAR: 565,
      BOOLEAN_AS_BYTE: 568,
      STRING: 569,
      BLOB: 570,
      INT64: 571,
      FLOAT_WITH_TIMESTAMP: 573,
      UINT64: 574,
      MOD10_SIZE_2: 575,
      MOD10_SIZE_3: 576,
      MOD10_SIZE_4: 577
    });
  });

  /**
   * A Modbus book may also come from a Control Expert export, whose type names are
   * the IEC ones — the M580 demo books are exactly that. Before the verified table
   * these all shared one sentinel, so the vocabulary gap was invisible.
   */
  it('also maps the Control Expert (IEC) type names of a Schneider export', () => {
    expect(modbusDatatypeCode('EBOOL')).toBe(567); // BIT
    expect(modbusDatatypeCode('WORD')).toBe(563); // UINT16
    expect(modbusDatatypeCode('DWORD')).toBe(564); // UINT32
    expect(modbusDatatypeCode('TIME')).toBe(564); // a duration in ms, unsigned 32-bit
    expect(modbusDatatypeCode('STRING[16]')).toBe(569); // the length is not part of the type
    expect(modbusDatatypeCode('real')).toBe(566); // case-insensitive
  });

  it('returns undefined rather than a lookalike for a type the driver cannot carry', () => {
    // Schneider packs these as vendor-specific BCD over several registers: read as
    // UINT32 they would return a number that looks like a date and is not.
    for (const type of ['DATE', 'TOD', 'DT', 'ARRAY[0..9] OF INT', 'MyDDT', '']) {
      expect(modbusDatatypeCode(type), type).toBeUndefined();
    }
    expect(modbusDatatypeCode(undefined)).toBeUndefined();
  });
});
