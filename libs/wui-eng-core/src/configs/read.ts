// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Config READ-BACK — the inverse of `./builders.ts`: which attributes to read for
 * one DPE, and how to turn the raw values into a {@link DpeConfigs}. Pure, so the
 * check-out mapping is unit-tested without any WinCC OA runtime; the backend only
 * supplies the `dpGet` results.
 *
 * It also defines what is COMPARABLE ({@link comparableConfigs}): some fields of
 * an {@link AddressConfig} are studio-side provenance, not values written to the
 * project — `deviceId` (which equipment the studio bound) and `mode` (`s7` vs
 * `s7plus` both write `_drv_ident = "S7"`). Comparing them against a read-back
 * would produce phantom "modified" items on every diff, so the diff engine
 * compares the written values only.
 */

import type { AddressConfig, AlarmConfig, ArchiveConfig, DpeConfigs, RangeConfig } from '../model.js';

/** Attribute suffixes read for one DPE, in a stable order. */
export const CONFIG_READ_ATTRS: string[] = [
  ':_address.._type',
  ':_address.._reference',
  ':_address.._direction',
  ':_address.._datatype',
  ':_address.._active',
  ':_archive.._archive',
  ':_archive.1._class',
  ':_alert_hdl.._type',
  ':_alert_hdl.._active',
  ':_alert_hdl.._class',
  ':_alert_hdl.._ok_range',
  ':_pv_range.._type',
  ':_pv_range.._min',
  ':_pv_range.._max',
  ':_pv_range.._incl_min',
  ':_pv_range.._incl_max'
];

/** WinCC OA config-type constants recognised on read-back. */
const DPCONFIG_PERIPH_ADDR_MAIN = 16;
const DPCONFIG_ALERT_BINARYSIGNAL = 12;
const DPCONFIG_ALERT_NONBINARYSIGNAL = 13;

/** The DPE paths to `dpGet` for one DPE (same order as {@link CONFIG_READ_ATTRS}). */
export function configReadPaths(dpe: string): string[] {
  return CONFIG_READ_ATTRS.map((attr) => `${dpe}${attr}`);
}

/** Unwrap a possibly `{value}`-wrapped or single-element-array dpGet result. */
function unwrap(raw: unknown): unknown {
  const value = raw && typeof raw === 'object' && 'value' in (raw as object) ? (raw as { value: unknown }).value : raw;
  return Array.isArray(value) ? value[0] : value;
}

function asNumber(raw: unknown): number | undefined {
  const value = unwrap(raw);
  if (value === null || value === undefined || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function asBool(raw: unknown): boolean {
  const value = unwrap(raw);
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').toLowerCase();
  return text === 'true' || text === '1';
}

function asString(raw: unknown): string {
  const value = unwrap(raw);
  return value === null || value === undefined ? '' : String(value);
}

/** Strip the WinCC OA alert-class notation (`alert.` → `alert`). */
function bareClass(raw: unknown): string {
  const text = asString(raw);
  const withoutSystem = text.includes(':') ? text.slice(text.indexOf(':') + 1) : text;
  return withoutSystem.replace(/\.$/, '');
}

/**
 * Rebuild the configs of one DPE from the raw values of {@link configReadPaths}.
 * A config family is reported only when it actually exists on the DPE (its
 * `_type` is set, or the archive flag is on), so an absent config stays absent —
 * that is what makes the diff meaningful.
 *
 * `address.deviceId` and `address.mode` are NOT recoverable from the project (see
 * the module header): they are left undefined and excluded from comparison.
 */
export function configsFromRaw(values: unknown[]): DpeConfigs | undefined {
  const configs: DpeConfigs = {};

  const addressType = asNumber(values[0]);
  if (addressType === DPCONFIG_PERIPH_ADDR_MAIN) {
    const address: AddressConfig = {
      reference: asString(values[1]),
      direction: asNumber(values[2]) ?? 0,
      datatype: asNumber(values[3]) ?? 0,
      active: asBool(values[4])
    };
    configs.address = address;
  }

  // Archiving is "present" when the flag is on (the group lives in `.1._class`).
  const archiveActive = asBool(values[5]);
  if (archiveActive) {
    const archive: ArchiveConfig = { group: bareClass(values[6]), active: true };
    configs.archive = archive;
  }

  const alertType = asNumber(values[7]);
  if (alertType === DPCONFIG_ALERT_BINARYSIGNAL || alertType === DPCONFIG_ALERT_NONBINARYSIGNAL) {
    const alarm: AlarmConfig = {
      kind: alertType === DPCONFIG_ALERT_BINARYSIGNAL ? 'binary' : 'analog',
      alarmClass: bareClass(values[9]),
      // Binary: `_ok_range` TRUE means the alarm is on FALSE (DESC).
      direction: alertType === DPCONFIG_ALERT_BINARYSIGNAL && asBool(values[10]) ? 'DESC' : 'ASC',
      active: asBool(values[8])
    };
    configs.alarm = alarm;
  }

  const rangeType = asNumber(values[11]);
  const min = asNumber(values[12]);
  const max = asNumber(values[13]);
  if (rangeType !== undefined && rangeType > 0 && min !== undefined && max !== undefined) {
    const range: RangeConfig = {
      min,
      max,
      inclMin: asBool(values[14]),
      inclMax: asBool(values[15])
    };
    configs.range = range;
  }

  return Object.keys(configs).length === 0 ? undefined : configs;
}

/**
 * The comparable view of a DPE's configs: studio-side provenance is dropped so a
 * read-back can be compared to a workspace entry without phantom differences.
 * Used by the diff engine — never for writing.
 */
export function comparableConfigs(configs: DpeConfigs): DpeConfigs {
  if (!configs.address) return configs;
  const { deviceId: _deviceId, mode: _mode, ...written } = configs.address;
  return { ...configs, address: written as AddressConfig };
}
