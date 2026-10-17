// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Config write builders — each turns one {@link DpeConfigs} member into the
 * `{ dpes, values }` pair of ONE atomic `dpSetWait`, plus the matching
 * "remove/deactivate" write. Pure: no WinCC OA import; the applier (or the
 * demo gateway) executes the writes.
 *
 * Sources of truth (proven in this repo):
 *  - `_address`/`_distrib`  → tagImporterController.writeAddress (verified
 *    against the OPC UA driver);
 *  - `_alert_hdl` binary/analog → para-alarm.ts (verified alarm_set.js port);
 *  - `_archive` NGA → para-archive.ts (verified fleet-core logic);
 *  - `_pv_range` MINMAX → WinCC OA config reference.
 */

import type { AddressConfig, AlarmConfig, ArchiveConfig, RangeConfig } from '../model.js';
import { isPolledDirection, OPCUA_DRV_IDENT } from '../drivers/opcua.js';
import { S7_DRV_IDENT } from '../drivers/s7.js';
import { MODBUS_DRV_IDENT } from '../drivers/modbus.js';

/** One atomic write: parallel DPE/value arrays for a single dpSetWait. */
export interface ConfigWrite {
  dpes: string[];
  values: unknown[];
}

// --- WinCC OA config constants (verified in-repo, see file header) ----------
const DPCONFIG_PERIPH_ADDR_MAIN = 16;
const DPCONFIG_DISTRIBUTION_INFO = 56;
const DPCONFIG_ALERT_BINARYSIGNAL = 12;
const DPCONFIG_ALERT_NONBINARYSIGNAL = 13;
const DPDETAIL_RANGETYPE_MINMAX = 4;
const DPCONFIG_DB_ARCHIVEINFO = 45;
const DPATTR_ARCH_PROC_VALARCH = 15;
const DPCONFIG_MINMAX_PVSS_RANGECHECK = 1;
const DPCONFIG_NONE = 0;

/**
 * `_drv_ident` per access mode (s7plus rides the S7 driver family). The mode is
 * studio provenance and therefore optional on a READ-BACK config — but a WRITE
 * cannot happen without knowing the driver, so it is required here.
 */
function drvIdentFor(mode: AddressConfig['mode']): string {
  switch (mode) {
    case 'opcua': {
      return OPCUA_DRV_IDENT;
    }
    case 's7':
    case 's7plus': {
      return S7_DRV_IDENT;
    }
    case 'modbus': {
      return MODBUS_DRV_IDENT;
    }
    default: {
      throw new Error('address write: the access mode is required (opcua | s7 | s7plus | modbus)');
    }
  }
}

/**
 * Atomic `_distrib` + `_address` write for one DPE (generalizes the proven
 * tag-importer OPC UA write to every driver family). `driverNumber` and the
 * ensured poll-group DP come from the device (resolved server-side).
 */
export function buildAddressWrite(dpe: string, config: AddressConfig, driverNumber: number, pollGroupDp: string): ConfigWrite {
  // `_address.._connection` is appended only when the config carries one: the
  // S7Plus driver resolves a symbol THROUGH its connection (para writes the pair
  // together — `para.ctl`, `case "s7plus"`), while an OPC UA reference already
  // names its server. Writing an empty connection on a driver that does not use
  // one is a change nobody asked for, so absence stays absence.
  const connection = config.connection?.trim() ?? '';
  // `_poll_group` only for a POLLED direction: on a subscribed (or written) address the attribute
  // configures nothing, and writing one there states a rhythm that does not exist.
  const polled = isPolledDirection(config.direction);
  // `_address.._offset` is the "Historical" checkbox of the OPC UA address tab — the driver
  // includes the address in its historical queries (`opcuaDrvPara.ctl` puts `cbHistory` into
  // `dpc[10]`, `para.ctl` writes that to `_offset` under `case "opcua"`). The attribute is
  // DRIVER SPECIFIC: on Modbus the same one carries a bit count, so the flag is honoured for
  // the OPC UA driver alone — anywhere else it stays the 0 every address had.
  const historical = config.mode === 'opcua' && config.historical === true ? 1 : 0;
  return {
    dpes: [
      `${dpe}:_distrib.._type`,
      `${dpe}:_distrib.._driver`,
      `${dpe}:_address.._type`,
      `${dpe}:_address.._drv_ident`,
      `${dpe}:_address.._reference`,
      `${dpe}:_address.._direction`,
      `${dpe}:_address.._datatype`,
      `${dpe}:_address.._subindex`,
      `${dpe}:_address.._internal`,
      `${dpe}:_address.._lowlevel`,
      `${dpe}:_address.._offset`,
      ...(polled ? [`${dpe}:_address.._poll_group`] : []),
      `${dpe}:_address.._active`,
      ...(connection === '' ? [] : [`${dpe}:_address.._connection`])
    ],
    values: [
      DPCONFIG_DISTRIBUTION_INFO,
      driverNumber,
      DPCONFIG_PERIPH_ADDR_MAIN,
      drvIdentFor(config.mode),
      config.reference,
      config.direction,
      config.datatype,
      0,
      false,
      true,
      historical,
      ...(polled ? [pollGroupDp] : []),
      config.active,
      ...(connection === '' ? [] : [connection])
    ]
  };
}

/** Deactivate a peripheral address (config stays, polling stops). */
export function buildAddressDeactivate(dpe: string): ConfigWrite {
  return { dpes: [`${dpe}:_address.._active`], values: [false] };
}

/**
 * Binary alert. `_ok_range` is the HEALTHY value: the model states it (`goodRange`), and
 * only when it does not is it derived from the direction as before (`DESC` = FALSE is fine).
 */
function buildBinaryAlarm(dpe: string, config: AlarmConfig): ConfigWrite {
  const okRange = config.goodRange ?? config.direction === 'DESC';
  return {
    dpes: [
      `${dpe}:_alert_hdl.._type`,
      `${dpe}:_alert_hdl.._class`,
      `${dpe}:_alert_hdl.._ok_range`,
      `${dpe}:_alert_hdl.._active`
    ],
    values: [DPCONFIG_ALERT_BINARYSIGNAL, `${config.alarmClass}.`, okRange, config.active]
  };
}

/** Analog alert: n thresholds → n+1 MINMAX ranges (replicates para-alarm). */
function buildAnalogAlarm(dpe: string, config: AlarmConfig): ConfigWrite[] {
  const thresholds = [...(config.thresholds ?? [])].sort((a, b) => a - b);
  if (thresholds.length === 0) {
    throw new Error(`analog alarm on ${dpe}: at least one threshold is required`);
  }
  const [minValue, maxValue] = config.bounds ?? [-3.4e38, 3.4e38];
  /**
   * The class of the k-th ALARMING range (k counted in threshold order, from the first
   * threshold crossed), falling back to the config's single class. That is how an alarm
   * escalates in WinCC OA: same limits, a stronger class on the further range.
   */
  const classAt = (index: number): string => `${config.alarmClasses?.[index] ?? config.alarmClass}.`;
  const head: ConfigWrite = {
    dpes: [`${dpe}:_alert_hdl.._type`, `${dpe}:_alert_hdl.._orig_hdl`],
    values: [DPCONFIG_ALERT_NONBINARYSIGNAL, false]
  };
  const dpes: string[] = [];
  const values: unknown[] = [];
  const asc = config.direction === 'ASC';
  for (let i = 1; i <= thresholds.length + 1; i += 1) {
    dpes.push(`${dpe}:_alert_hdl.${i}._type`);
    values.push(DPDETAIL_RANGETYPE_MINMAX);
    dpes.push(`${dpe}:_alert_hdl.${i}._l_limit`);
    values.push(i === 1 ? minValue : thresholds[i - 2]);
    dpes.push(`${dpe}:_alert_hdl.${i}._u_limit`);
    values.push(i > thresholds.length ? maxValue : thresholds[i - 1]);
    if (asc) {
      dpes.push(`${dpe}:_alert_hdl.${i}._l_incl`, `${dpe}:_alert_hdl.${i}._u_incl`);
      values.push(true, i > thresholds.length);
      // Ascending: ranges 2..N+1 alarm — range i sits ABOVE threshold i-1, so it takes the
      // (i-2)-th class in threshold order.
      if (i > 1) {
        dpes.push(`${dpe}:_alert_hdl.${i}._class`);
        values.push(classAt(i - 2));
      }
    } else {
      dpes.push(`${dpe}:_alert_hdl.${i}._l_incl`, `${dpe}:_alert_hdl.${i}._u_incl`);
      values.push(i === 1, true);
      // Descending: ranges 1..N alarm — range i sits BELOW threshold i, and the classes are
      // still read in threshold order, so the LOWEST range takes the last one.
      if (i <= thresholds.length) {
        dpes.push(`${dpe}:_alert_hdl.${i}._class`);
        values.push(classAt(thresholds.length - i));
      }
    }
  }
  const ranges: ConfigWrite = { dpes, values };
  const activate: ConfigWrite = { dpes: [`${dpe}:_alert_hdl.._active`], values: [true] };
  return [head, ranges, activate];
}

/**
 * Alert-handling writes for one DPE. Binary alarms are a single atomic write;
 * analog alarms need the proven 3-step sequence (type+orig_hdl → ranges →
 * active), each step atomic.
 */
export function buildAlarmWrites(dpe: string, config: AlarmConfig): ConfigWrite[] {
  return config.kind === 'binary' ? [buildBinaryAlarm(dpe, config)] : buildAnalogAlarm(dpe, config);
}

/** Deactivate the alert handling of a DPE. */
export function buildAlarmDeactivate(dpe: string): ConfigWrite {
  return { dpes: [`${dpe}:_alert_hdl.._active`], values: [false] };
}

/** NGA value-archiving write (enable) / disable. */
export function buildArchiveWrite(dpe: string, config: ArchiveConfig): ConfigWrite {
  if (!config.active) {
    return { dpes: [`${dpe}:_archive.._archive`], values: [false] };
  }
  return {
    dpes: [
      `${dpe}:_archive.._type`,
      `${dpe}:_archive.1._type`,
      `${dpe}:_archive.1._class`,
      `${dpe}:_archive.._archive`
    ],
    values: [DPCONFIG_DB_ARCHIVEINFO, DPATTR_ARCH_PROC_VALARCH, config.group, true]
  };
}

/** `_pv_range` MINMAX write for one DPE. */
export function buildRangeWrite(dpe: string, config: RangeConfig): ConfigWrite {
  return {
    dpes: [
      `${dpe}:_pv_range.._type`,
      `${dpe}:_pv_range.._min`,
      `${dpe}:_pv_range.._max`,
      `${dpe}:_pv_range.._incl_min`,
      `${dpe}:_pv_range.._incl_max`
    ],
    values: [DPCONFIG_MINMAX_PVSS_RANGECHECK, config.min, config.max, config.inclMin, config.inclMax]
  };
}

/** Remove the `_pv_range` config of a DPE. */
export function buildRangeRemove(dpe: string): ConfigWrite {
  return { dpes: [`${dpe}:_pv_range.._type`], values: [DPCONFIG_NONE] };
}
