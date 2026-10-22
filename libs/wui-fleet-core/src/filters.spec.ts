// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Machine filters: dimensions found on the machines' tags, OR within a dimension, AND
 * across dimensions, stale remembered values pruned, remembered in the browser.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FLEET_FILTER_STORAGE_KEY,
  FLEET_STATE_FILTER_STORAGE_KEY,
  filterDimensions,
  isFilterActive,
  loadFleetFilter,
  loadStateFilter,
  matchesFilter,
  pruneFilter,
  saveFleetFilter,
  saveStateFilter
} from './filters.js';

const PRESS = { tags: { Line: ['L2'], Activity: ['Pressing'] } };
const OVEN = { tags: { Line: ['L3'], Activity: ['Heat', 'Welding'] } };
const BARE = {};

describe('filters', () => {
  it('offer every dimension found, values sorted', () => {
    expect(filterDimensions([PRESS, OVEN, BARE])).toEqual([
      { key: 'Line', values: ['L2', 'L3'] },
      { key: 'Activity', values: ['Heat', 'Pressing', 'Welding'] }
    ]);
  });

  it('OR within a dimension, AND across dimensions', () => {
    expect(matchesFilter(OVEN, {})).toBe(true);
    expect(matchesFilter(OVEN, { Line: ['L2', 'L3'] })).toBe(true);
    expect(matchesFilter(OVEN, { Line: ['L3'], Activity: ['Pressing'] })).toBe(false);
    expect(matchesFilter(OVEN, { Line: ['L3'], Activity: ['Welding'] })).toBe(true);
    expect(matchesFilter(BARE, { Line: ['L3'] })).toBe(false);
    expect(matchesFilter(BARE, { Line: [] })).toBe(true);
  });

  it('a remembered value that no longer exists is dropped', () => {
    const dims = filterDimensions([PRESS, OVEN]);
    expect(pruneFilter({ Line: ['L9', 'L2'], Gone: ['x'] }, dims)).toEqual({ Line: ['L2'] });
    expect(isFilterActive(pruneFilter({ Line: ['L9'] }, dims))).toBe(false);
  });
});

describe('remembered filter', () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v)
  };
  afterEach(() => {
    store.clear();
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('comes back as saved', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
    saveFleetFilter({ Line: ['L3'] });
    expect(store.get(FLEET_FILTER_STORAGE_KEY)).toBe('{"Line":["L3"]}');
    expect(loadFleetFilter()).toEqual({ Line: ['L3'] });
  });

  it('is empty when the storage is missing or holds garbage', () => {
    expect(loadFleetFilter()).toEqual({});
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
    store.set(FLEET_FILTER_STORAGE_KEY, '[1,2]');
    expect(loadFleetFilter()).toEqual({});
    store.set(FLEET_FILTER_STORAGE_KEY, '{nope');
    expect(loadFleetFilter()).toEqual({});
  });

  it('keeps the state filter apart, as state keys', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
    saveStateFilter(['arret', 'maintenance']);
    expect(store.get(FLEET_STATE_FILTER_STORAGE_KEY)).toBe('["arret","maintenance"]');
    expect(loadStateFilter()).toEqual(['arret', 'maintenance']);
    expect(loadFleetFilter()).toEqual({});
    store.set(FLEET_STATE_FILTER_STORAGE_KEY, '{"a":1}');
    expect(loadStateFilter()).toEqual([]);
  });
});
