// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What happens when a site saved by an OLDER version of this page is opened.
 *
 * This is the one place a `Site` enters the page without the compiler having checked it —
 * JSON out of the datapoint, cast rather than validated — so it is the one place where a
 * field added to the model can be missing at runtime. It has happened: opening a stored site
 * threw `Cannot read properties of undefined (reading 'length')` because `asset.layerIds` did
 * not exist before information layers did.
 *
 * The fixtures below are deliberately shaped like the records each earlier version actually
 * wrote, and typed as `unknown` on the way in, because that is exactly what the store has.
 */
import { describe, expect, it } from 'vitest';
import { hydrateSite } from './hydrate.js';
import type { Site } from '../types.js';

describe('opening a site saved by an older version', () => {
  function check(label: string, got: unknown, expected: unknown): void {
    it(label, () => {
      expect(got).toEqual(expected);
    });
  }

  /** The store casts parsed JSON to `Site`; the test has to be able to do the same. */
  const asStored = (raw: unknown): Site => hydrateSite(raw as Site);

  // --- 1. The very first shape: one area, one asset, one area membership -------
  const v1 = asStored({
    id: 'ancien',
    name: 'Ancien site',
    areas: [{ id: 'nord', name: 'Secteur Nord' }],
    assets: [
      {
        id: 'p1',
        name: 'Pompe 1',
        kind: 'pump',
        lat: 45.9,
        lon: 6.1,
        areaId: 'nord'
      }
    ]
  });

  check(
    'every list the model has gained is present',
    [v1.layers, v1.routes, v1.connections],
    [[], [], []]
  );
  check('an asset gets its layer tags', v1.assets[0]?.layerIds, []);
  check('and keeps its readings list', v1.assets[0]?.readings, []);
  check(
    'the single areaId is still folded into the list',
    v1.assets[0]?.areaIds,
    ['nord']
  );
  check('an area with no ring gets one', v1.areas[0]?.ring, []);
  check('the basemap is defaulted, not left undefined', v1.basemap.kind, 'osm');
  check('and so is the centre', typeof v1.center.lat, 'number');

  // --- 2. Nothing at all ------------------------------------------------------
  const empty = asStored({});
  check(
    'a record with no content still yields usable empty lists',
    [empty.areas, empty.assets, empty.layers, empty.routes, empty.connections],
    [[], [], [], [], []]
  );

  // --- 3. A site from the version that had connections but not layers ---------
  const v2 = asStored({
    name: 'Réseau',
    assets: [
      { id: 'a', name: 'A', kind: 'pump', lat: 45.9, lon: 6.1, areaIds: [] },
      { id: 'b', name: 'B', kind: 'tank', lat: 45.91, lon: 6.11, areaIds: [] }
    ],
    routes: [
      { id: 'l1', name: 'Ligne 1', color: '#ff0000', kind: 'pipe', link: '' }
    ],
    connections: [{ id: 'c1', name: 'A → B', kind: 'pipe', from: 'a', to: 'b' }]
  });
  check(
    'a connection gets every list it now carries',
    [
      v2.connections[0]?.via,
      v2.connections[0]?.areaIds,
      v2.connections[0]?.layerIds,
      v2.connections[0]?.readings
    ],
    [[], [], [], []]
  );
  check('its route survives untouched', v2.routes[0]?.name, 'Ligne 1');

  // --- 4. Backfilling ADDS; it must never rewrite what was saved --------------
  const configured = asStored({
    name: 'Configuré',
    basemap: {
      kind: 'raster',
      url: 'https://tiles.local/{z}/{x}/{y}.png',
      styleUrl: '',
      attribution: 'ACME',
      maxZoom: 17
    },
    zoom: 15,
    groupZoom: 11,
    areas: [
      {
        id: 'z',
        name: 'Zone',
        ring: [[6, 45]],
        groupZoom: 9,
        color: '#123456',
        link: ''
      }
    ],
    assets: [
      {
        id: 'x',
        name: 'X',
        kind: 'valve',
        lat: 45.5,
        lon: 6.5,
        areaIds: ['z'],
        layerIds: ['crit'],
        dp: 'System1:Real.value',
        readings: [
          {
            id: 'r',
            dp: 'System1:Real.value',
            label: 'Q',
            unit: 'm³/h',
            decimals: 1,
            onMap: true
          }
        ],
        link: '/ampere/x',
        notes: 'gardée'
      }
    ]
  });
  check(
    'a private tile server is not reset to OSM',
    configured.basemap.url,
    'https://tiles.local/{z}/{x}/{y}.png'
  );
  check('an explicit zoom is kept', configured.zoom, 15);
  check('an explicit groupZoom is kept', configured.groupZoom, 11);
  check('a drawn ring is kept as saved', configured.areas[0]?.ring, [[6, 45]]);
  check(
    'a datapoint binding is kept',
    configured.assets[0]?.dp,
    'System1:Real.value'
  );
  check('a reading is kept', configured.assets[0]?.readings.length, 1);
  check('a drill-down route is kept', configured.assets[0]?.link, '/ampere/x');
  check(
    'a tag is kept even though the layer is not declared here',
    configured.assets[0]?.layerIds,
    ['crit']
  );
  // The contrast with the sanitiser, and the reason this is not `normalizeSite`: opening a
  // site must not silently rewrite it. An undeclared tag stays, an unknown kind stays.
  check('an area colour is kept', configured.areas[0]?.color, '#123456');
});
