// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A viewer's display toggles, remembered per atelier in the user's settings; the per-user
 * bubble choices of an earlier version are ignored.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ATELIER_PREFS_SETTING, loadDisplayPrefs, saveDisplayPrefs } from './bubble-prefs.js';
import { settingObject, settingsCache } from './settings-cache.js';

describe('remembered display toggles', () => {
  afterEach(() => settingsCache.connect(null));

  it('are kept per atelier', () => {
    saveDisplayPrefs('a1', { labels: false });
    saveDisplayPrefs('a2', { roof: true });
    expect(loadDisplayPrefs('a1')).toEqual({ labels: false });
    expect(loadDisplayPrefs('a2')).toEqual({ roof: true });
    expect(loadDisplayPrefs('a3')).toEqual({});
  });

  it('are empty before loading or with garbage', () => {
    expect(loadDisplayPrefs('a1')).toEqual({});
    settingsCache.set(ATELIER_PREFS_SETTING, { a1: { display: { roof: 'no', alertOnly: true } } });
    expect(loadDisplayPrefs('a1')).toEqual({ alertOnly: true });
  });

  it("drop an earlier version's bubble choices on the next write", () => {
    settingsCache.set(ATELIER_PREFS_SETTING, { a1: { lines: { state: false }, hidden: ['M1'], display: { roof: false } } });
    saveDisplayPrefs('a1', { roof: true });
    expect(settingObject(ATELIER_PREFS_SETTING)['a1']).toEqual({ display: { roof: true } });
  });
});
