// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Machine filters: dimensions found on the machines' tags, OR within a dimension, AND
 * across dimensions, stale remembered values pruned, remembered in the user's settings.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  CARD_TAGS_DIMENSION,
  FLEET_FILTER_SETTING,
  filterDimensions,
  isFilterActive,
  isFilterDimension,
  loadFleetFilter,
  loadStateFilter,
  matchesFilter,
  pruneFilter,
  saveFleetFilter,
  saveStateFilter
} from './filters.js';
import { settingsCache } from './settings-cache.js';

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
  afterEach(() => settingsCache.connect(null));

  it('comes back as saved', () => {
    saveFleetFilter({ Line: ['L3'] });
    expect(settingsCache.get(FLEET_FILTER_SETTING)).toEqual({ tags: { Line: ['L3'] } });
    expect(loadFleetFilter()).toEqual({ Line: ['L3'] });
  });

  it('is empty before loading or with garbage', () => {
    expect(loadFleetFilter()).toEqual({});
    settingsCache.set(FLEET_FILTER_SETTING, { tags: [1, 2] });
    expect(loadFleetFilter()).toEqual({});
    settingsCache.set(FLEET_FILTER_SETTING, 'nope');
    expect(loadFleetFilter()).toEqual({});
  });

  it('keeps the state filter apart, as state keys, in the same setting', () => {
    saveFleetFilter({ Line: ['L3'] });
    saveStateFilter(['arret', 'maintenance']);
    expect(settingsCache.get(FLEET_FILTER_SETTING)).toEqual({ tags: { Line: ['L3'] }, states: ['arret', 'maintenance'] });
    expect(loadStateFilter()).toEqual(['arret', 'maintenance']);
    expect(loadFleetFilter()).toEqual({ Line: ['L3'] });
    settingsCache.set(FLEET_FILTER_SETTING, { states: { a: 1 } });
    expect(loadStateFilter()).toEqual([]);
  });

  it('offer the free tags of the atelier as one more dimension, and filter on them', () => {
    const tagged = { ...PRESS, cardTags: ['Zone A', ''] };
    expect(filterDimensions([tagged, OVEN]).find((d) => d.key === CARD_TAGS_DIMENSION)).toEqual({ key: CARD_TAGS_DIMENSION, values: ['Zone A'] });
    expect(matchesFilter(tagged, { [CARD_TAGS_DIMENSION]: ['Zone A'], Line: ['L2'] })).toBe(true);
    expect(matchesFilter(OVEN, { [CARD_TAGS_DIMENSION]: ['Zone A'] })).toBe(false);
  });
});

describe('work-centre dimensions (#66)', () => {
  it('are neither offered nor filtered on', () => {
    const m = { tags: { Îlot: ['I1'], Workcenter: ['WC1'], 'Work-Center': ['x'], Activité: ['Soudure'], UAP: ['U2'] } };
    expect(filterDimensions([m]).map((d) => d.key)).toEqual(['Activité', 'UAP']);
    expect(matchesFilter(m, { Îlot: ['other'] })).toBe(true);
    expect(isFilterDimension('ilot')).toBe(false);
    expect(isFilterDimension('UAP')).toBe(true);
  });
});
