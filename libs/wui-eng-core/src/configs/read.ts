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
 * `s7plus` both write `_drv_ident = "S7"`). `connection` IS written (S7Plus needs
 * it) but is not read back, so it is dropped for the same reason: comparing any of
 * them against a read-back would produce phantom "modified" items on every diff,
 * so the diff engine compares the written values only.
 */

import type { AddressConfig, AlarmConfig, ArchiveConfig, DpeConfigs, RangeConfig } from '../model.js';
import { isPolledDirection } from '../drivers/opcua.js';

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
  ':_pv_range.._incl_max',
  // The OPC UA "Historical" checkbox and the driver it belongs to. `_offset` is read LAST
  // (appended rather than inserted) because the backend slices these values by position, and
  // `_drv_ident` beside it because the attribute is driver specific: on Modbus the very same
  // `_offset` is a bit count, which read as a history flag would report a change on every diff.
  ':_address.._drv_ident',
  ':_address.._offset',
  // The poll group, so the diff can compare an attribute the builder really writes. Read LAST
  // (appended, never inserted) because the backend slices these values by position.
  ':_address.._poll_group'
];

/** WinCC OA config-type constants recognised on read-back. */
const DPCONFIG_PERIPH_ADDR_MAIN = 16;
const DPCONFIG_ALERT_BINARYSIGNAL = 12;
const DPCONFIG_ALERT_NONBINARYSIGNAL = 13;
/** `_drv_ident` of the OPC UA client driver — the only one whose `_offset` is a history flag. */
const OPCUA_DRV_IDENT_READ = 'OPCUA';

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

/**
 * The poll group of a read-back address, or `''` for none.
 *
 * `_poll_group` is a dpid: it comes back system-qualified and dot-terminated
 * (`System1:_Poll_Normal.`), and an UNSET one comes back as a parenthesised placeholder —
 * both handled by the vendor's own read (`para.ctl`, which drops anything starting with
 * `(` and calls `dpSubStr(…, DPSUB_DP)` on the rest).
 */
function readPollGroup(raw: unknown): string {
  const text = asString(raw).trim();
  if (text === '' || text.startsWith('(')) return '';
  return text;
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
    // TRUE only, never false — an address that is not part of the historical queries carries
    // no `historical` at all, exactly like the one a model generated (see `AddressConfig`).
    const historical = asString(values[16]).trim().toUpperCase() === OPCUA_DRV_IDENT_READ && (asNumber(values[17]) ?? 0) > 0;
    const pollGroup = readPollGroup(values[18]);
    const address: AddressConfig = {
      reference: asString(values[1]),
      direction: asNumber(values[2]) ?? 0,
      datatype: asNumber(values[3]) ?? 0,
      active: asBool(values[4]),
      ...(historical ? { historical: true } : {}),
      ...(pollGroup === '' ? {} : { pollGroup })
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
 *
 * The ARCHIVE GROUP is compared by its TOKEN, for the same reason: a model may carry the name an
 * engineer typed (`EVENT`) while the project holds the datapoint it resolves to
 * (`_NGA_G_EVENT` — see `EngPort.resolveArchiveGroup`). Compared verbatim, the two never match
 * and the instance stays "to update" for ever, one check-in after another. A real change of
 * group (`_NGA_G_EVENT` → `_NGA_G_SLOW`) still differs, because only the `_NGA_G_` prefix and the
 * case are normalised away.
 */
export function comparableConfigs(configs: DpeConfigs): DpeConfigs {
  const archive = configs.archive === undefined ? undefined : { ...configs.archive, group: archiveGroupToken(configs.archive.group) };
  const address = configs.address === undefined ? undefined : dropProvenance(configs.address);
  return {
    ...configs,
    ...(archive === undefined ? {} : { archive }),
    ...(address === undefined ? {} : { address })
  };
}

/** `_NGA_G_EVENT` and `EVENT` are the same group named two ways. */
function archiveGroupToken(group: string): string {
  return group.trim().replace(/^_NGA_G_/i, '').toLowerCase();
}

/**
 * The WRITTEN half of an address config — what `buildAddressWrite` actually puts in the
 * project, and nothing else. Anything compared here that is not written on both sides makes
 * every address differ for ever, which is the same as not diffing at all.
 *
 * Dropped:
 *  - `deviceId` / `mode` — studio provenance, absent from any read-back;
 *  - `connection` — written for S7Plus, but not read back (see the module header);
 *  - `subscription` — NOT a separate attribute. It lives in field 2 of the reference, which
 *    is compared already; comparing it twice only meant comparing it once against nothing.
 *
 * Normalised:
 *  - `pollGroup` — compared BY TOKEN, like the archive group beside it: the model carries the
 *    name (`_Poll_Normal`) while the project holds the dpid it resolves to
 *    (`System1:_Poll_Normal.`). Verbatim, the two never match. And it is compared only on a
 *    POLLED direction, because that is the only direction the builder writes it for.
 */
function dropProvenance(address: AddressConfig): AddressConfig {
  const {
    deviceId: _deviceId,
    mode: _mode,
    connection: _connection,
    subscription: _subscription,
    pollGroup,
    ...written
  } = address;
  const token = pollGroup === undefined ? '' : pollGroupToken(pollGroup);
  const compared = isPolledDirection(written.direction) && token !== '';
  return (compared ? { ...written, pollGroup: token } : written) as AddressConfig;
}

/** `_Poll_Normal`, `Poll_Normal` and `System1:_Poll_Normal.` are one group named three ways. */
function pollGroupToken(group: string): string {
  const withoutSystem = group.includes(':') ? group.slice(group.indexOf(':') + 1) : group;
  return withoutSystem.trim().replace(/\.$/, '').replace(/^_/, '').toLowerCase();
}
