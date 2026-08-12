// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The alarms module's configuration: the priority ranges, in ONE datapoint.
 *
 * Stored as JSON in `Alarms_Config` (a Struct with a single String element,
 * auto-created on first use) through the kit's {@link DpSingleJsonStore} — the
 * same mechanism the fleet and audit modules use, including its offline fallback:
 * a project where the page cannot write keeps working on the defaults instead of
 * failing to open.
 *
 * Reads go through {@link loadAlarmConfig}, NOT through a store per component.
 * A page can hold a dozen alarm views (one per machine tile), and they must not
 * each query the datapoint — the promise is cached and shared, and invalidated on
 * write. A save also announces itself on `window` so every open view re-ranks its
 * alarms immediately, without the page having to wire anything.
 */
import { DpSingleJsonStore } from '@visuelconcept/wui-kit/data/dp-single-json-store.js';
import { DEFAULT_RANGES, normaliseRanges, type AlarmRange } from '../types.js';

/** DP type and instance holding the module's configuration. */
export const ALARM_CONFIG_TYPE = 'Alarms_Config';
export const ALARM_CONFIG_DP = 'Alarms_Config';

/**
 * Fired on `window` after a successful save; detail = the saved configuration.
 *
 * The name is repeated as a literal at the `dispatchEvent` below: the workspace
 * lint rule reads the event name off the `CustomEvent` construction itself, and
 * cannot follow a constant.
 */
export const ALARM_CONFIG_EVENT = 'wui:alarmconfig';

export interface AlarmConfig {
  ranges: AlarmRange[];
}

export function defaultAlarmConfig(): AlarmConfig {
  return { ranges: structuredClone(DEFAULT_RANGES) as AlarmRange[] };
}

/** Read / write the module's configuration datapoint. */
export class AlarmConfigStore {
  private readonly store = new DpSingleJsonStore<AlarmConfig>(ALARM_CONFIG_TYPE, ALARM_CONFIG_DP, defaultAlarmConfig);

  /** True when the configuration could not be reached and defaults are in use. */
  get offline(): boolean {
    return this.store.offline;
  }

  async load(): Promise<AlarmConfig> {
    const config = await this.store.load();
    return { ranges: normaliseRanges(config.ranges) };
  }

  /** Persist, then invalidate the shared read and tell the open views. */
  async save(config: AlarmConfig): Promise<void> {
    const normalised: AlarmConfig = { ranges: normaliseRanges(config.ranges) };
    await this.store.save(normalised);
    shared = Promise.resolve(normalised);
    globalThis.dispatchEvent(new CustomEvent('wui:alarmconfig', { detail: normalised }));
  }
}

/** The shared, cached read — one datapoint query per session, not per component. */
let shared: Promise<AlarmConfig> | null = null;

export function loadAlarmConfig(): Promise<AlarmConfig> {
  shared ??= new AlarmConfigStore().load().catch(() => defaultAlarmConfig());
  return shared;
}

/** Drop the cached read (the next {@link loadAlarmConfig} queries the datapoint). */
export function invalidateAlarmConfig(): void {
  shared = null;
}
