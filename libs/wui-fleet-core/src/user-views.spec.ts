// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** A user's own viewpoints and default page (#60). */
import { afterEach, describe, expect, it } from 'vitest';
import { settingsCache } from './settings-cache.js';
import {
  OVERVIEW_PAGE,
  USER_VIEWS_SETTING,
  landingAtelier,
  loadUserViews,
  saveDefaultPage,
  saveUserViews
} from './user-views.js';

const vp = (id: string): { id: string; name: string; pos: [number, number, number]; target: [number, number, number] } => ({
  id,
  name: id,
  pos: [1, 2, 3],
  target: [0, 0, 0]
});

describe("a user's own views", () => {
  afterEach(() => settingsCache.connect(null));

  it('are kept per atelier, with their default', () => {
    saveUserViews('a1', { viewpoints: [vp('v1'), { ...vp('v2'), mode: '2d' }], defaultViewpointId: 'v2' });
    saveUserViews('a2', { viewpoints: [vp('w')] });
    expect(loadUserViews('a1')).toEqual({ viewpoints: [vp('v1'), { ...vp('v2'), mode: '2d' }], defaultViewpointId: 'v2' });
    expect(loadUserViews('a2').viewpoints).toHaveLength(1);
    expect(loadUserViews('a3')).toEqual({ viewpoints: [] });
  });

  it('drop garbage and a default that is not one of them', () => {
    settingsCache.set(USER_VIEWS_SETTING, { ateliers: { a1: { viewpoints: [vp('v1'), { id: 'x' }], defaultViewpointId: 'gone' } } });
    expect(loadUserViews('a1')).toEqual({ viewpoints: [vp('v1')] });
  });

  it("land on the user's page, else the public one, else the overview", () => {
    const ateliers = [{ id: 'a1' }, { id: 'a2', landing: true }];
    expect(landingAtelier(ateliers)).toBe('a2');
    saveDefaultPage('a1');
    expect(landingAtelier(ateliers)).toBe('a1');
    saveDefaultPage(OVERVIEW_PAGE);
    expect(landingAtelier(ateliers)).toBeUndefined();
    saveDefaultPage('deleted');
    expect(landingAtelier(ateliers)).toBe('a2');
    saveDefaultPage(undefined);
    expect(landingAtelier([{ id: 'a1' }])).toBeUndefined();
  });
});
