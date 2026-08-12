// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The alarm-colour contract of a live snapshot, and the connection it paints.
 *
 * Regression: a connection bound to a datapoint that EXISTS and is quiet vanished from the
 * map. The snapshot stores `''` for "resolved, no alert", `??` kept that empty string, and
 * `line-color: ''` is not a colour — so MapLibre drew nothing. The same `''` read as an
 * alarm in the badge count. Both are tested here rather than in the Lit component, because
 * the rule is about data and has nothing to do with a DOM.
 */
import { describe, expect, it } from 'vitest';
import { alarmColorOr, inAlarm, linkCollection } from './style.js';
import {
  DEFAULT_LINE_COLOR,
  blankConnection,
  blankSite,
  type Asset,
  type Site
} from '../types.js';

function asset(id: string, lat: number, lon: number): Asset {
  return {
    id,
    name: id,
    kind: 'station',
    lat,
    lon,
    areaIds: [],
    layerIds: [],
    dp: `System1:GisSim_${id}_defaut`,
    readings: [],
    link: '',
    notes: ''
  };
}

/** A two-station site joined by one supervised segment, bound like the simulator binds. */
function siteWithOneLink(): Site {
  const site = blankSite();
  site.id = 'net';
  site.assets = [asset('a', 48.85, 2.35), asset('b', 48.86, 2.36)];
  site.routes = [
    { id: 'ligne-1', name: 'Ligne 1', color: '#d32f2f', kind: 'metro', link: '' }
  ];
  site.connections = [
    {
      ...blankConnection('a-b', 'a', 'b', 'metro', 'ligne-1'),
      dp: 'System1:GisLink_a_b_defaut'
    }
  ];
  return site;
}

describe('inAlarm', () => {
  it('is false for a datapoint that could not be followed', () => {
    expect(inAlarm(undefined)).toBe(false);
  });

  it('is false for a datapoint that resolved WITHOUT an active alert', () => {
    // The regression: `!== undefined` said true here, so every quiet asset counted as an
    // alarm and every zone badge showed a red count of all its members.
    expect(inAlarm('')).toBe(false);
  });

  it('is true only for an actual alert colour', () => {
    expect(inAlarm('rgb(255,38,64)')).toBe(true);
  });
});

describe('alarmColorOr', () => {
  it('falls back when the datapoint could not be followed', () => {
    expect(alarmColorOr(undefined, DEFAULT_LINE_COLOR)).toBe(DEFAULT_LINE_COLOR);
  });

  it('falls back when the datapoint resolved without an alert', () => {
    expect(alarmColorOr('', DEFAULT_LINE_COLOR)).toBe(DEFAULT_LINE_COLOR);
  });

  it('paints the alert colour when there is one', () => {
    expect(alarmColorOr('rgb(255,38,64)', DEFAULT_LINE_COLOR)).toBe(
      'rgb(255,38,64)'
    );
  });
});

describe('a connection bound to a quiet datapoint', () => {
  const site = siteWithOneLink();
  const routeColor = '#d32f2f';

  it('is drawn, in its route colour', () => {
    const quiet = new Map<string, string>([['gislink_a_b', '']]);
    const collection = linkCollection(site, '', new Set(), (connection) =>
      alarmColorOr(quiet.get('gislink_a_b'), routeColor)
    );
    expect(collection.features).toHaveLength(1);
    // An empty colour is what removed the line from the map: it must never be emitted.
    expect(collection.features[0]?.properties.color).toBe(routeColor);
  });

  it('takes the alert colour once it IS in alarm', () => {
    const collection = linkCollection(site, '', new Set(), () =>
      alarmColorOr('rgb(255,38,64)', routeColor)
    );
    expect(collection.features[0]?.properties.color).toBe('rgb(255,38,64)');
  });

  it('never emits an empty colour, whatever the snapshot holds', () => {
    for (const held of [undefined, '', 'rgb(1,2,3)']) {
      const collection = linkCollection(site, '', new Set(), () =>
        alarmColorOr(held, routeColor)
      );
      expect(collection.features[0]?.properties.color).not.toBe('');
    }
  });
});
