// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A viewer's display toggles and last view, remembered per atelier in the user's settings; the per-user
 * bubble choices of an earlier version are ignored.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ATELIER_PREFS_SETTING, loadDisplayPrefs, loadViewPrefs, saveDisplayPrefs, saveViewPrefs } from './bubble-prefs.js';
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

describe('remembered last view', () => {
  afterEach(() => settingsCache.connect(null));

  const camera = { pos: [10.123_4, 20, -30.006] as [number, number, number], target: [0, 4, 0] as [number, number, number], mode: '3d' as const };

  it('keeps the camera (to the centimetre) and the machine panel, per atelier', () => {
    saveViewPrefs('a1', { camera });
    saveViewPrefs('a1', { panel: true });
    saveViewPrefs('a2', { panel: false });
    expect(loadViewPrefs('a1')).toEqual({ camera: { pos: [10.12, 20, -30.01], target: [0, 4, 0], mode: '3d' }, panel: true });
    expect(loadViewPrefs('a2')).toEqual({ panel: false });
    expect(loadViewPrefs('a3')).toEqual({});
  });

  it('and the display toggles do not erase each other', () => {
    saveDisplayPrefs('a1', { roof: false });
    saveViewPrefs('a1', { camera: { ...camera, mode: '2d' } });
    saveDisplayPrefs('a1', { labels: true });
    expect(loadDisplayPrefs('a1')).toEqual({ labels: true });
    expect(loadViewPrefs('a1').camera?.mode).toBe('2d');
  });

  it('ignores a malformed camera or panel', () => {
    settingsCache.set(ATELIER_PREFS_SETTING, { a1: { view: { camera: { pos: [1, 2], target: [0, 0, 0], mode: '3d' }, panel: 'yes' } } });
    expect(loadViewPrefs('a1')).toEqual({});
    settingsCache.set(ATELIER_PREFS_SETTING, { a1: { view: { camera: { ...camera, mode: 'iso' } } } });
    expect(loadViewPrefs('a1')).toEqual({});
  });
});
