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
  MODBUS_DATATYPE_UNVERIFIED,
  modbusDatatypeCode,
  modbusHoldingRef,
  modbusLeafType,
  modbusRegisterCount,
  modbusWordRef
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

  it('leaves the driver transformation code explicitly unverified', () => {
    expect(modbusDatatypeCode('REAL')).toBe(MODBUS_DATATYPE_UNVERIFIED);
  });
});
