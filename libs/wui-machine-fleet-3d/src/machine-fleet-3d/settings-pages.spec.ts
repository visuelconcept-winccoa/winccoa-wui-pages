// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { settingsPages } from './settings-pages.js';

describe('settings pages of the fleet', () => {
  it('lists the menu entries marked fleetSettings, children too, in menu order', () => {
    const menu = {
      entries: [
        { path: '/fleet-3d', title: { en_US: 'Machine Fleet', fr: 'Parc machine' } },
        { path: '/organisation', hidden: true, fleetSettings: true, icon: 'cogwheel',
          title: { 'en_US.utf8': 'Organisation', 'fr_FR.utf8': 'Organisation', 'de_DE.utf8': 'Organisation' } },
        { path: '/x', children: [{ path: '/x/y', fleetSettings: true, title: { en_US: 'Shifts', fr: 'Équipes' } }] }
      ]
    };
    expect(settingsPages(menu)).toEqual([
      { path: '/organisation', title: { en: 'Organisation', fr: 'Organisation', de: 'Organisation' }, icon: 'cogwheel' },
      { path: '/x/y', title: { en: 'Shifts', fr: 'Équipes', de: 'Shifts' }, icon: 'cogwheel' }
    ]);
  });

  it('has none without a marked entry or a readable menu', () => {
    expect(settingsPages({ entries: [{ path: '/a' }, { fleetSettings: true }] })).toEqual([]);
    expect(settingsPages(null)).toEqual([]);
  });
});
