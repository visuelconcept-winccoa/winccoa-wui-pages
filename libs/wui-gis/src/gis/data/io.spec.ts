// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  baseName,
  exportSiteGeoJson,
  parseImport,
  siteToGeoJson
} from './io.js';
import { demoSites } from './demo.js';
import type { Site } from '../types.js';

describe('import / export', () => {
  function check(label: string, got: unknown, expected: unknown): void {
    it(label, () => {
      expect(got).toEqual(expected);
    });
  }

  const water = demoSites()[0] as Site;
  const city = demoSites()[1] as Site;

  // --- 1. Native JSON round-trip keeps the whole configuration -----------------
  const envelope = JSON.stringify({
    kind: 'gis-sites',
    version: 1,
    sites: [water, city]
  });
  const back = parseImport(envelope, 'x');
  check('native import detects the format', back.format, 'json');
  check('native import returns both sites', back.sites.length, 2);

  const rt = back.sites[0]!.site;
  check('name round-trips', rt.name, water.name);
  check('category round-trips', rt.category, water.category);
  check('zoom round-trips', rt.zoom, water.zoom);
  check('centre round-trips', rt.center, water.center);
  check('site groupZoom round-trips', rt.groupZoom, water.groupZoom);
  check('area count round-trips', rt.areas.length, water.areas.length);
  check('asset count round-trips', rt.assets.length, water.assets.length);
  check(
    'rings round-trip exactly',
    rt.areas.map((a) => a.ring),
    water.areas.map((a) => a.ring)
  );
  check(
    'area colours round-trip',
    rt.areas.map((a) => a.color),
    water.areas.map((a) => a.color)
  );
  check(
    'area ids round-trip',
    rt.areas.map((a) => a.id),
    water.areas.map((a) => a.id)
  );
  check(
    'datapoint bindings round-trip',
    rt.assets.map((a) => a.dp),
    water.assets.map((a) => a.dp)
  );
  check(
    'readings round-trip',
    rt.assets.map((a) => a.readings.length),
    water.assets.map((a) => a.readings.length)
  );
  check(
    'drill-down routes round-trip',
    rt.assets.map((a) => a.link),
    water.assets.map((a) => a.link)
  );
  check(
    'area membership round-trips',
    rt.assets.map((a) => a.areaId),
    water.assets.map((a) => a.areaId)
  );
  check('basemap round-trips', rt.basemap, water.basemap);

  // A non-default basemap must survive — the regression this specifically guards.
  const custom: Site = {
    ...water,
    basemap: {
      kind: 'raster',
      url: 'https://tiles.local/{z}/{x}/{y}.png',
      styleUrl: '',
      attribution: 'ACME',
      maxZoom: 17
    }
  };
  const customBack = parseImport(
    JSON.stringify({ kind: 'gis-sites', version: 1, sites: [custom] }),
    'x'
  );
  check(
    'a custom tile server is not reset to OSM',
    customBack.sites[0]!.site.basemap,
    custom.basemap
  );

  // --- 2. GeoJSON round-trip keeps geometry + the useful properties -----------
  const geo = siteToGeoJson(water);
  check('GeoJSON is a FeatureCollection', geo.type, 'FeatureCollection');
  check(
    'one feature per area with a ring, plus one per asset',
    geo.features.length,
    water.areas.filter((a) => a.ring.length >= 3).length + water.assets.length
  );
  check(
    'polygon rings are closed for GeoJSON',
    geo.features
      .filter((f) => f.geometry.type === 'Polygon')
      .every((f) => {
        const ring = (f.geometry as { coordinates: number[][][] })
          .coordinates[0]!;
        return JSON.stringify(ring[0]) === JSON.stringify(ring.at(-1));
      }),
    true
  );
  check(
    'assets are Points in lon,lat order',
    (
      geo.features.find((f) => f.properties['gisType'] === 'asset')!
        .geometry as { coordinates: [number, number] }
    ).coordinates,
    [water.assets[0]!.lon, water.assets[0]!.lat]
  );

  const geoBack = parseImport(JSON.stringify(geo), 'fallback');
  check('GeoJSON import detects the format', geoBack.format, 'geojson');
  const g = geoBack.sites[0]!.site;
  check('GeoJSON keeps the site name', g.name, water.name);
  check('GeoJSON keeps every asset', g.assets.length, water.assets.length);
  check(
    'GeoJSON keeps every drawn area',
    g.areas.length,
    water.areas.filter((a) => a.ring.length >= 3).length
  );
  check(
    'GeoJSON re-opens the rings (no duplicated last point)',
    g.areas.map((a) => a.ring.length),
    water.areas.filter((a) => a.ring.length >= 3).map((a) => a.ring.length)
  );
  check(
    'GeoJSON keeps coordinates to the last decimal',
    g.assets.map((a) => [a.lat, a.lon]),
    water.assets.map((a) => [a.lat, a.lon])
  );
  check(
    'GeoJSON keeps the datapoint bindings',
    g.assets.map((a) => a.dp),
    water.assets.map((a) => a.dp)
  );
  check(
    'GeoJSON keeps area membership',
    g.assets.map((a) => a.areaId),
    water.assets.map((a) => a.areaId)
  );
  check(
    'GeoJSON keeps the readings',
    g.assets.map((a) => a.readings.length),
    water.assets.map((a) => a.readings.length)
  );
  check('GeoJSON keeps the basemap', g.basemap, water.basemap);

  // --- 3. A FOREIGN layer: geometry only, no gisType, no site properties ------
  const foreign = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Secteur A' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [6.1, 45.9],
              [6.2, 45.9],
              [6.2, 46],
              [6.1, 45.9]
            ]
          ]
        }
      },
      {
        type: 'Feature',
        properties: { name: 'Pompe 7' },
        geometry: { type: 'Point', coordinates: [6.15, 45.95] }
      },
      {
        type: 'Feature',
        properties: { name: 'Ligne' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [6.1, 45.9],
            [6.2, 46]
          ]
        }
      }
    ]
  };
  const f = parseImport(JSON.stringify(foreign), 'Survey 2026').sites[0]!.site;
  check('a foreign layer names itself from the file', f.name, 'Survey 2026');
  check('a polygon becomes an area', f.areas.length, 1);
  check('a point becomes an asset', f.assets.length, 1);
  check(
    'an unsupported geometry is ignored',
    f.assets.length + f.areas.length,
    2
  );
  check(
    'a foreign point keeps its coordinates',
    [f.assets[0]!.lat, f.assets[0]!.lon],
    [45.95, 6.15]
  );
  check(
    'a foreign asset gets a safe default kind',
    f.assets[0]!.kind,
    'generic'
  );
  check(
    'a foreign area gets a palette colour',
    /^#[\da-f]{6}$/i.test(f.areas[0]!.color),
    true
  );

  // --- 4. Rubbish in, a clear error out (never a crash) ----------------------
  for (const [label, text] of [
    ['not JSON at all', 'hello {'],
    ['JSON but not a site', '{"foo":1}'],
    ['an empty site list', '{"kind":"gis-sites","version":1,"sites":[]}'],
    [
      'a site with nothing in it',
      '{"kind":"gis-sites","version":1,"sites":[{"name":"Empty"}]}'
    ]
  ] as [string, string][]) {
    let threw = '';
    try {
      parseImport(text, 'x');
    } catch (error) {
      threw = error instanceof Error ? error.message : 'non-error';
    }
    check(`rejects ${label} with a message`, threw.length > 0, true);
  }

  // A bare array and a single bare object are both accepted (hand-edited exports).
  check(
    'a bare array of sites is accepted',
    parseImport(JSON.stringify([water]), 'x').sites.length,
    1
  );
  check(
    'a single bare site object is accepted',
    parseImport(JSON.stringify(water), 'x').sites.length,
    1
  );

  // --- 5. Filenames ----------------------------------------------------------
  check(
    'baseName strips the extension',
    baseName('reseau-eau.geojson'),
    'reseau eau'
  );
  check(
    'baseName survives a dotted name',
    baseName('survey.v2.json'),
    'survey.v2'
  );
  check('baseName has a fallback', baseName('.json'), 'Import');

  check(
    'exportSiteGeoJson is callable (no DOM here, so only its shape)',
    typeof exportSiteGeoJson,
    'function'
  );
});
