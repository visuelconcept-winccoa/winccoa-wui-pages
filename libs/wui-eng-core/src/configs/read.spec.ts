// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Config read-back (check-out): the attribute list, the parsing of raw dpGet
 * values, the "absent config stays absent" rule, and the WRITE → READ round trip
 * through the builders — the property that makes the diff trustworthy.
 */
import { describe, expect, it } from 'vitest';
import { fingerprint, type DpeConfigs } from '../model.js';
import { buildAddressWrite, buildAlarmWrites, buildArchiveWrite, buildRangeWrite } from './builders.js';
import { CONFIG_READ_ATTRS, comparableConfigs, configReadPaths, configsFromRaw } from './read.js';

/** Build the raw value array from a `{attr: value}` map (absent → null). */
function raw(values: Record<string, unknown>): unknown[] {
  return CONFIG_READ_ATTRS.map((attr) => values[attr] ?? null);
}

describe('configReadPaths', () => {
  it('prefixes every attribute with the DPE', () => {
    const paths = configReadPaths('DP1.Temp');
    expect(paths).toHaveLength(CONFIG_READ_ATTRS.length);
    expect(paths[0]).toBe('DP1.Temp:_address.._type');
    expect(paths).toContain('DP1.Temp:_archive.1._class');
  });
});

describe('configsFromRaw', () => {
  it('returns undefined when the DPE carries no config at all', () => {
    expect(configsFromRaw(raw({}))).toBeUndefined();
  });

  it('reads a peripheral address (without the unrecoverable provenance)', () => {
    const configs = configsFromRaw(
      raw({
        ':_address.._type': 16,
        ':_address.._reference': 'Cellule2$$1$1$ns=2;s=T',
        ':_address.._direction': 4,
        ':_address.._datatype': 761,
        ':_address.._active': true
      })
    );
    expect(configs?.address).toEqual({
      reference: 'Cellule2$$1$1$ns=2;s=T',
      direction: 4,
      datatype: 761,
      active: true
    });
    expect(configs?.address?.deviceId).toBeUndefined();
    expect(configs?.address?.mode).toBeUndefined();
  });

  it('ignores an address whose _type is not PERIPH_ADDR_MAIN', () => {
    expect(configsFromRaw(raw({ ':_address.._type': 0, ':_address.._reference': 'x' }))?.address).toBeUndefined();
  });

  it('reads archiving only when the flag is on, and strips the class notation', () => {
    expect(configsFromRaw(raw({ ':_archive.._archive': true, ':_archive.1._class': 'System1:EVENT.' }))?.archive).toEqual({
      group: 'EVENT',
      active: true
    });
    expect(configsFromRaw(raw({ ':_archive.._archive': false, ':_archive.1._class': 'EVENT.' }))?.archive).toBeUndefined();
  });

  it('reads a binary alert and its direction from _ok_range', () => {
    expect(
      configsFromRaw(raw({ ':_alert_hdl.._type': 12, ':_alert_hdl.._active': true, ':_alert_hdl.._class': 'alert.', ':_alert_hdl.._ok_range': false }))
        ?.alarm
    ).toEqual({ kind: 'binary', alarmClass: 'alert', direction: 'ASC', active: true });
    expect(
      configsFromRaw(raw({ ':_alert_hdl.._type': 12, ':_alert_hdl.._active': true, ':_alert_hdl.._class': 'alert.', ':_alert_hdl.._ok_range': true }))
        ?.alarm?.direction
    ).toBe('DESC');
  });

  it('reads an analog alert as analog', () => {
    expect(configsFromRaw(raw({ ':_alert_hdl.._type': 13, ':_alert_hdl.._active': true, ':_alert_hdl.._class': 'alert.' }))?.alarm).toMatchObject({
      kind: 'analog'
    });
  });

  it('reads a value range only when type and bounds are present', () => {
    expect(
      configsFromRaw(raw({ ':_pv_range.._type': 1, ':_pv_range.._min': 0, ':_pv_range.._max': 450, ':_pv_range.._incl_min': true, ':_pv_range.._incl_max': false }))
        ?.range
    ).toEqual({ min: 0, max: 450, inclMin: true, inclMax: false });
    expect(configsFromRaw(raw({ ':_pv_range.._type': 0, ':_pv_range.._min': 0, ':_pv_range.._max': 1 }))?.range).toBeUndefined();
  });

  it('tolerates {value}-wrapped and string-typed dpGet results', () => {
    const configs = configsFromRaw(
      raw({
        ':_address.._type': { value: '16' },
        ':_address.._reference': { value: 'R' },
        ':_address.._direction': '7',
        ':_address.._datatype': '760',
        ':_address.._active': 'true'
      })
    );
    expect(configs?.address).toMatchObject({ reference: 'R', direction: 7, datatype: 760, active: true });
  });
});

/**
 * `_offset` is only the "Historical" checkbox on the OPC UA driver. Read as one
 * everywhere, a Modbus bit count would report a history nobody configured — and the
 * check-in diff would show that address as modified for ever.
 */
describe('the OPC UA "Historical" flag', () => {
  it('reads _address.._offset as historical for the OPC UA driver', () => {
    const address = configsFromRaw(
      raw({ ':_address.._type': 16, ':_address.._reference': 'C$$1$1$x', ':_address.._drv_ident': 'OPCUA', ':_address.._offset': 1 })
    )?.address;
    expect(address?.historical).toBe(true);
  });

  it('leaves it ABSENT — never false — when the box is not checked', () => {
    const address = configsFromRaw(
      raw({ ':_address.._type': 16, ':_address.._reference': 'C$$1$1$x', ':_address.._drv_ident': 'OPCUA', ':_address.._offset': 0 })
    )?.address;
    expect(address).not.toHaveProperty('historical');
  });

  it('ignores a non-zero _offset on another driver (Modbus: a bit count)', () => {
    const address = configsFromRaw(
      raw({ ':_address.._type': 16, ':_address.._reference': '1.40001', ':_address.._drv_ident': 'MODBUS', ':_address.._offset': 8 })
    )?.address;
    expect(address).not.toHaveProperty('historical');
  });
});

/**
 * The two fields the acquisition decision introduced, and the phantom diff they caused:
 * neither was read back, yet neither was dropped from the comparison — so every address
 * carrying a poll group (the default) read as "to update" at every single check-in.
 */
describe('poll group and subscription in the diff', () => {
  const polled = (extra: Partial<DpeConfigs['address']> = {}): DpeConfigs => ({
    address: { deviceId: 'opc1', mode: 'opcua', reference: 'C$$1$1$ns=2;s=T', direction: 4, datatype: 761, active: true, ...extra }
  });

  it('compares a poll group BY TOKEN — the model names it, the project holds its dpid', () => {
    const model = comparableConfigs(polled({ pollGroup: '_Poll_Normal' }));
    const live = comparableConfigs(polled({ pollGroup: 'System1:_Poll_Normal.' }));
    expect(fingerprint(live)).toBe(fingerprint(model));
    // A REAL change of group still differs — the token normalises the notation, not the name.
    expect(fingerprint(comparableConfigs(polled({ pollGroup: '_Poll_Slow' })))).not.toBe(fingerprint(model));
  });

  it('ignores the poll group on a direction the builder does not write it for', () => {
    const subscribed = { direction: 2, pollGroup: '_Poll_Normal' } as const;
    expect(fingerprint(comparableConfigs(polled(subscribed)))).toBe(fingerprint(comparableConfigs(polled({ direction: 2 }))));
  });

  it('never compares the subscription — it IS field 2 of the reference', () => {
    const withSub: DpeConfigs = {
      address: { mode: 'opcua', reference: 'C$Sub_Fast$1$1$ns=2;s=T', direction: 2, datatype: 761, subscription: 'Sub_Fast', active: true }
    };
    const readBack: DpeConfigs = {
      address: { reference: 'C$Sub_Fast$1$1$ns=2;s=T', direction: 2, datatype: 761, active: true }
    };
    expect(fingerprint(comparableConfigs(readBack))).toBe(fingerprint(comparableConfigs(withSub)));
    // Re-pointing the leaf at ANOTHER subscription is a real change: the reference says so.
    const other: DpeConfigs = { address: { ...readBack.address!, reference: 'C$Sub_Slow$1$1$ns=2;s=T' } };
    expect(fingerprint(comparableConfigs(other))).not.toBe(fingerprint(comparableConfigs(withSub)));
  });

  it('an UNSET dpid reads as no poll group at all', () => {
    const address = configsFromRaw(
      raw({ ':_address.._type': 16, ':_address.._reference': 'C$$1$1$x', ':_address.._direction': 4, ':_address.._poll_group': '(no dp)' })
    )?.address;
    expect(address).not.toHaveProperty('pollGroup');
  });
});

describe('write → read round trip', () => {
  it('an address written by the builder reads back identically (written fields)', () => {
    const configs: DpeConfigs = {
      address: {
        deviceId: 'opc1',
        mode: 'opcua',
        reference: 'C$$1$1$ns=2;s=T',
        direction: 4,
        datatype: 761,
        historical: true,
        pollGroup: '_Poll',
        active: true
      }
    };
    const write = buildAddressWrite('DP1.T', configs.address!, 2, '_Poll');
    // Replay the write into the read-back's raw slots.
    const values = CONFIG_READ_ATTRS.map((attr) => {
      const index = write.dpes.indexOf(`DP1.T${attr}`);
      return index === -1 ? null : write.values[index];
    });
    // Compared the way the DIFF compares them: through `comparableConfigs` on BOTH sides, so
    // the poll group is matched by token rather than by notation (`_Poll` vs the project's dpid).
    const readBack = configsFromRaw(values)!;
    expect(comparableConfigs(readBack).address).toEqual(comparableConfigs(configs).address);
  });

  it('archive, binary alarm and range also round trip', () => {
    const configs: DpeConfigs = {
      archive: { group: 'EVENT', active: true },
      alarm: { kind: 'binary', alarmClass: 'alert', direction: 'DESC', active: true },
      range: { min: 0, max: 100, inclMin: true, inclMax: true }
    };
    const writes = [
      buildArchiveWrite('DP1.T', configs.archive!),
      ...buildAlarmWrites('DP1.T', configs.alarm!),
      buildRangeWrite('DP1.T', configs.range!)
    ];
    const values = CONFIG_READ_ATTRS.map((attr) => {
      for (const write of writes) {
        const index = write.dpes.indexOf(`DP1.T${attr}`);
        if (index !== -1) return write.values[index];
      }
      return null;
    });
    const readBack = configsFromRaw(values);
    expect(readBack?.archive).toEqual(configs.archive);
    expect(readBack?.alarm).toEqual(configs.alarm);
    expect(readBack?.range).toEqual(configs.range);
  });
});

describe('comparableConfigs', () => {
  it('drops the studio provenance of an address (deviceId, mode)', () => {
    const comparable = comparableConfigs({
      address: { deviceId: 'd1', mode: 's7plus', reference: 'R', direction: 4, datatype: 0, active: true }
    });
    expect(comparable.address).toEqual({ reference: 'R', direction: 4, datatype: 0, active: true });
  });

  it('compares an ARCHIVE GROUP by its token, so a model and the project can name it differently', () => {
    // The model carries what an engineer typed, the project the datapoint it resolves to. Compared
    // verbatim, an instance stayed "to update" after every check-in.
    const model: DpeConfigs = { archive: { group: 'EVENT', active: true } };
    const live: DpeConfigs = { archive: { group: '_NGA_G_EVENT', active: true } };
    expect(comparableConfigs(model)).toEqual(comparableConfigs(live));
  });

  it('still sees a REAL change of archive group', () => {
    const before: DpeConfigs = { archive: { group: '_NGA_G_EVENT', active: true } };
    const after: DpeConfigs = { archive: { group: '_NGA_G_SLOW', active: true } };
    expect(comparableConfigs(before)).not.toEqual(comparableConfigs(after));
  });
});
