// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Config write builders: each family emits the proven attribute sets as
 * parallel arrays for ONE atomic dpSetWait.
 */
import { describe, expect, it } from 'vitest';
import type { AddressConfig } from '../model.js';
import { buildOpcUaReference, directionFor, opcUaDatatypeCode } from '../drivers/opcua.js';
import { s7Operand } from '../drivers/s7.js';
import {
  buildAddressWrite,
  buildAlarmWrites,
  buildArchiveWrite,
  buildRangeRemove,
  buildRangeWrite
} from './builders.js';

describe('address write', () => {
  it('emits the verified _distrib + _address attribute set in one write', () => {
    const config: AddressConfig = {
      deviceId: 'opc1',
      mode: 'opcua',
      reference: buildOpcUaReference('Cellule1', 'ns=2;s=Pump1.Flow'),
      direction: directionFor('r'),
      datatype: opcUaDatatypeCode('Double'),
      active: true
    };
    const write = buildAddressWrite('Z01_PMP001.Debit', config, 2, '_EngStudio_Poll');
    expect(write.dpes).toHaveLength(13);
    expect(write.values).toHaveLength(13);
    const at = (attr: string): unknown => write.values[write.dpes.findIndex((d) => d.endsWith(attr))];
    expect(at(':_distrib.._type')).toBe(56);
    expect(at(':_distrib.._driver')).toBe(2);
    expect(at(':_address.._type')).toBe(16);
    expect(at(':_address.._drv_ident')).toBe('OPCUA');
    expect(at(':_address.._reference')).toBe('Cellule1$$1$1$ns=2;s=Pump1.Flow');
    expect(at(':_address.._direction')).toBe(4);
    expect(at(':_address.._datatype')).toBe(761);
    expect(at(':_address.._active')).toBe(true);
  });

  it('maps the S7 driver family ident', () => {
    const config: AddressConfig = {
      deviceId: 's71',
      mode: 's7',
      reference: s7Operand(12, 'Real', 2),
      direction: 4,
      datatype: 0,
      active: true
    };
    const write = buildAddressWrite('Z01_FOUR001.ConsigneTemp', config, 3, '_EngStudio_Poll');
    const at = (attr: string): unknown => write.values[write.dpes.findIndex((d) => d.endsWith(attr))];
    expect(at(':_address.._drv_ident')).toBe('S7');
    expect(at(':_address.._reference')).toBe('DB12.DBD2');
  });
});

describe('alarm writes', () => {
  it('binary alarm is one atomic write with ok_range from the direction', () => {
    const writes = buildAlarmWrites('DP1.Defaut', {
      kind: 'binary',
      alarmClass: 'alert',
      direction: 'ASC',
      active: true
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].dpes).toEqual([
      'DP1.Defaut:_alert_hdl.._type',
      'DP1.Defaut:_alert_hdl.._class',
      'DP1.Defaut:_alert_hdl.._ok_range',
      'DP1.Defaut:_alert_hdl.._active'
    ]);
    expect(writes[0].values).toEqual([12, 'alert.', false, true]);
  });

  it('analog alarm with 2 thresholds emits 3 ranges over 3 atomic steps', () => {
    const writes = buildAlarmWrites('DP1.Temp', {
      kind: 'analog',
      alarmClass: 'alert',
      direction: 'ASC',
      thresholds: [100, 200],
      bounds: [-1000, 1000],
      active: true
    });
    expect(writes).toHaveLength(3);
    const ranges = writes[1];
    expect(ranges.dpes.filter((d) => d.endsWith('._type'))).toHaveLength(3);
    const limits = ranges.dpes
      .map((dpe, i) => [dpe, ranges.values[i]] as const)
      .filter(([dpe]) => dpe.includes('._l_limit') || dpe.includes('._u_limit'));
    expect(limits.map(([, v]) => v)).toEqual([-1000, 100, 100, 200, 200, 1000]);
  });

  it('rejects an analog alarm without thresholds', () => {
    expect(() =>
      buildAlarmWrites('DP1.Temp', { kind: 'analog', alarmClass: 'alert', direction: 'ASC', thresholds: [], active: true })
    ).toThrow(/threshold/);
  });
});

describe('archive + range writes', () => {
  it('enable archive writes the NGA attribute set atomically', () => {
    const write = buildArchiveWrite('DP1.Temp', { group: 'EVENT', active: true });
    expect(write.dpes).toEqual([
      'DP1.Temp:_archive.._type',
      'DP1.Temp:_archive.1._type',
      'DP1.Temp:_archive.1._class',
      'DP1.Temp:_archive.._archive'
    ]);
    expect(write.values).toEqual([45, 15, 'EVENT', true]);
  });

  it('disable archive only clears the _archive flag', () => {
    expect(buildArchiveWrite('DP1.Temp', { group: 'EVENT', active: false })).toEqual({
      dpes: ['DP1.Temp:_archive.._archive'],
      values: [false]
    });
  });

  it('range write and remove', () => {
    expect(buildRangeWrite('DP1.Temp', { min: 0, max: 450, inclMin: true, inclMax: false }).values).toEqual([
      1, 0, 450, true, false
    ]);
    expect(buildRangeRemove('DP1.Temp')).toEqual({ dpes: ['DP1.Temp:_pv_range.._type'], values: [0] });
  });
});
