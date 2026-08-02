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
import { OPCUA_DRV_IDENT } from '../drivers/opcua.js';
import { S7_DRV_IDENT } from '../drivers/s7.js';

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

/** `_drv_ident` per access mode (s7plus rides the S7 driver family). */
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
      return 'MODBUS';
    }
  }
}

/**
 * Atomic `_distrib` + `_address` write for one DPE (generalizes the proven
 * tag-importer OPC UA write to every driver family). `driverNumber` and the
 * ensured poll-group DP come from the device (resolved server-side).
 */
export function buildAddressWrite(dpe: string, config: AddressConfig, driverNumber: number, pollGroupDp: string): ConfigWrite {
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
      `${dpe}:_address.._poll_group`,
      `${dpe}:_address.._active`
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
      0,
      pollGroupDp,
      config.active
    ]
  };
}

/** Deactivate a peripheral address (config stays, polling stops). */
export function buildAddressDeactivate(dpe: string): ConfigWrite {
  return { dpes: [`${dpe}:_address.._active`], values: [false] };
}

/** Binary alert: ok_range TRUE when alarming on FALSE (DESC). */
function buildBinaryAlarm(dpe: string, config: AlarmConfig): ConfigWrite {
  return {
    dpes: [
      `${dpe}:_alert_hdl.._type`,
      `${dpe}:_alert_hdl.._class`,
      `${dpe}:_alert_hdl.._ok_range`,
      `${dpe}:_alert_hdl.._active`
    ],
    values: [DPCONFIG_ALERT_BINARYSIGNAL, `${config.alarmClass}.`, config.direction === 'DESC', config.active]
  };
}

/** Analog alert: n thresholds → n+1 MINMAX ranges (replicates para-alarm). */
function buildAnalogAlarm(dpe: string, config: AlarmConfig): ConfigWrite[] {
  const thresholds = [...(config.thresholds ?? [])].sort((a, b) => a - b);
  if (thresholds.length === 0) {
    throw new Error(`analog alarm on ${dpe}: at least one threshold is required`);
  }
  const [minValue, maxValue] = config.bounds ?? [-3.4e38, 3.4e38];
  const cls = `${config.alarmClass}.`;
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
      if (i > 1) {
        dpes.push(`${dpe}:_alert_hdl.${i}._class`);
        values.push(cls);
      }
    } else {
      dpes.push(`${dpe}:_alert_hdl.${i}._l_incl`, `${dpe}:_alert_hdl.${i}._u_incl`);
      values.push(i === 1, true);
      if (i <= thresholds.length) {
        dpes.push(`${dpe}:_alert_hdl.${i}._class`);
        values.push(cls);
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
