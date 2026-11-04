// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The fleet pages' own choices of the logged-in user (filters, bubbles, display toggles,
 * analysis selections), read synchronously by the pages from this cache, which loads them
 * from the user's WinCC OA settings (user-settings.ts, backend/fleetSettings.ts of
 * machine-fleet-3d) and sends every change back.
 *
 * - `watch(keys, onReady)`: loads `keys` for the logged-in user, then calls `onReady` — and
 *   again after every login ("Switch user", badge), the previous user's values forgotten;
 * - `get(key)` / `set(key, value)`: the loaded value (undefined until then) / a change, kept
 *   at once and written after a short delay.
 *
 * Takeover: a user with no value yet gets the choices this browser remembered before they
 * moved to the user settings (localStorage, LEGACY), which are then saved to their account
 * and removed from the browser.
 *
 * Without a backend (`wui dev` without shell, tests) the values live in memory only.
 */
import { Subscription, type Observable } from 'rxjs';

/** Setting keys (FLEET_SETTINGS of machine-fleet-3d backend/fleetSettings.ts). */
export type FleetSettingKey =
  | 'fleet-filter'
  | 'fleet-ateliers'
  | 'fleet-dashboard'
  | 'fleet-stop-analysis'
  | 'fleet-kpi-analysis'
  | 'fleet-closures'
  | 'fleet-views';

/** Where the values come from and go to (the user settings client). */
export interface SettingsBackend {
  readonly user$: Observable<string>;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): void;
}

/** Browser storage of the choices before the user settings, per setting. */
export const LEGACY_STORAGE: Readonly<Partial<Record<FleetSettingKey, readonly string[]>>> = Object.freeze({
  // Tag filter, then state filter.
  'fleet-filter': ['wui.machine-fleet.filter', 'wui.machine-fleet.state-filter'],
  'fleet-ateliers': ['wui.machine-fleet.bubbles'],
  'fleet-dashboard': ['wui.machine-fleet.dashboard-filter']
});

function readStorage(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** The value a setting had in the browser, null when none. */
export function legacyValue(key: FleetSettingKey): unknown {
  const keys = LEGACY_STORAGE[key];
  if (!keys) return null;
  const raw = keys.map(readStorage);
  if (raw.every((v) => v === null)) return null;
  if (key === 'fleet-filter') return { tags: raw[0] ?? {}, states: raw[1] ?? [] };
  return raw[0];
}

function forgetLegacy(key: FleetSettingKey): void {
  for (const k of LEGACY_STORAGE[key] ?? []) {
    try {
      globalThis.localStorage?.removeItem(k);
    } catch {
      // Storage unavailable: nothing to remove.
    }
  }
}

export class SettingsCache {
  private backend: SettingsBackend | null = null;
  private user: string | null = null;
  private readonly values = new Map<string, unknown>();
  private readonly loads = new Map<string, Promise<void>>();

  /** Plug the user settings client in (null: memory only). Forgets every value. */
  connect(backend: SettingsBackend | null): void {
    this.backend = backend;
    this.user = null;
    this.values.clear();
    this.loads.clear();
  }

  get(key: FleetSettingKey): unknown {
    return this.values.get(key);
  }

  set(key: FleetSettingKey, value: unknown): void {
    this.values.set(key, value);
    this.backend?.set(key, value);
  }

  /** Load `key` for the current user (once). */
  load(key: FleetSettingKey): Promise<void> {
    let loading = this.loads.get(key);
    if (!loading) {
      loading = this.fetch(key);
      this.loads.set(key, loading);
    }
    return loading;
  }

  private async fetch(key: FleetSettingKey): Promise<void> {
    const user = this.user;
    const backend = this.backend;
    let value = backend ? await backend.get(key) : null;
    if (value === null || value === undefined) {
      value = legacyValue(key);
      if (value !== null && backend) {
        backend.set(key, value);
        forgetLegacy(key);
      }
    }
    // Another user logged in meanwhile, or the page already changed the value: keep it.
    if (this.user !== user || this.values.has(key)) return;
    if (value !== null && value !== undefined) this.values.set(key, value);
  }

  /** Load `keys` for the logged-in user, then `onReady()`; again after every login. */
  watch(keys: readonly FleetSettingKey[], onReady: () => void): Subscription {
    const run = (): void => {
      void Promise.all(keys.map((k) => this.load(k))).then(onReady, onReady);
    };
    if (!this.backend) {
      run();
      return new Subscription();
    }
    return this.backend.user$.subscribe((u) => {
      if (u !== this.user) {
        this.user = u;
        this.values.clear();
        this.loads.clear();
      }
      run();
    });
  }
}

/** The pages' shared cache (plugged into the user settings by fleet-settings-service.ts). */
export const settingsCache = new SettingsCache();

/** A setting's value as a plain object, {} when absent or not an object. */
export function settingObject(key: FleetSettingKey): Record<string, unknown> {
  const v = settingsCache.get(key);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Strings of an array, [] otherwise. */
export function stringList(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [];
}
