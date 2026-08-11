// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { normalizeSite } from './normalize.js';
import { AREA_PALETTE } from '../ai-context.js';
import { ASSET_KINDS, isValidLatLon } from '../types.js';

describe('site sanitiser', () => {
  function check(label: string, got: unknown, expected: unknown): void {
    it(label, () => {
      expect(got).toEqual(expected);
    });
  }

  // A deliberately messy proposal, holding every mistake a model actually makes.
  const messy = {
    site: {
      // the {site:{…}} wrapper
      name: '  Réseau test  ',
      description: 'x'.repeat(900), // over-long text
      category: 'Eau',
      zoom: 99, // out of range
      center: { lat: 'not-a-number', lon: 6.1 },
      areas: [
        {
          id: 'Nord!!',
          name: 'Secteur Nord',
          color: 'blue',
          ring: [
            [6.1, 45.9],
            [6.15, 45.91],
            [6.14, 45.88]
          ]
        },
        {
          id: 'Nord!!',
          name: 'Doublon',
          ring: [
            [6.2, 45.9],
            [6.3, 45.9]
          ]
        }, // dup id + 2-pt ring
        { name: 'Sans ring' }, // no ring at all
        { notAnArea: true }
      ],
      assets: [
        {
          id: 'p1',
          name: 'Pompe 1',
          kind: 'pump',
          lat: 45.905,
          lon: 6.11,
          areaId: 'nord',
          dp: 'System1:X.',
          readings: [
            {
              label: 'Q',
              unit: 'm³/h',
              decimals: 99,
              onMap: true,
              dp: 'System1:X.'
            }
          ]
        },
        {
          id: 'p2',
          name: 'Sonde',
          kind: 'wormhole',
          lat: 45.906,
          lon: 6.12,
          areaId: 'inexistant'
        }, // bad kind + bad areaId
        { id: 'p3', name: 'NaN', kind: 'tank', lat: 'oops', lon: 6.13 }, // unusable position
        { id: 'p4', name: 'Hors monde', kind: 'tank', lat: 200, lon: 6.13 }, // out of range
        {
          id: 'p5',
          name: 'Lien externe',
          kind: 'tank',
          lat: 45.907,
          lon: 6.14,
          link: 'https://evil.example/x'
        },
        {
          id: 'p6',
          name: 'Lien interne',
          kind: 'tank',
          lat: 45.908,
          lon: 6.15,
          link: '/fleet-3d/station'
        },
        {
          id: 'p7',
          name: 'Protocole relatif',
          kind: 'tank',
          lat: 45.909,
          lon: 6.16,
          link: '//evil.example/x'
        },
        { name: 'Coords en string', kind: 'valve', lat: '45.910', lon: '6.17' } // numeric strings
      ]
    }
  };

  const { site, report } = normalizeSite(messy, AREA_PALETTE);

  check('name trimmed', site.name, 'Réseau test');
  check('description capped at 400', site.description.length, 400);
  check('zoom clamped into 0..22', site.zoom, 22);
  check(
    'bad centre falls back to assets mean',
    isValidLatLon(site.center.lat, site.center.lon),
    true
  );

  check('area with neither name nor ring dropped', site.areas.length, 3);
  check('area ids made unique', new Set(site.areas.map((a) => a.id)).size, 3);
  check(
    'invalid colour replaced from palette',
    site.areas[0]!.color,
    AREA_PALETTE[0]
  );
  check('2-point ring cleared', site.areas[1]!.ring.length, 0);
  check('valid ring kept', site.areas[0]!.ring.length, 3);

  const ids = site.assets.map((a) => a.id);
  check(
    'unusable positions dropped (NaN + out-of-range)',
    site.assets.length,
    6
  );
  check('asset ids unique', new Set(ids).size, ids.length);
  check(
    'every kind is known',
    site.assets.every((a) =>
      (ASSET_KINDS as readonly string[]).includes(a.kind)
    ),
    true
  );
  check(
    'unknown kind -> generic',
    site.assets.find((a) => a.name === 'Sonde')!.kind,
    'generic'
  );
  check(
    'every position valid',
    site.assets.every((a) => isValidLatLon(a.lat, a.lon)),
    true
  );
  check('decimals clamped to 6', site.assets[0]!.readings[0]!.decimals, 6);

  // Security: a proposal must not be able to point the dashboard off-site.
  check(
    'external https link stripped',
    site.assets.find((a) => a.name === 'Lien externe')!.link,
    ''
  );
  check(
    'protocol-relative link stripped',
    site.assets.find((a) => a.name === 'Protocole relatif')!.link,
    ''
  );
  check(
    'in-app route kept',
    site.assets.find((a) => a.name === 'Lien interne')!.link,
    '/fleet-3d/station'
  );

  // Referential integrity: areaId must name an area that exists.
  const areaIds = new Set(site.areas.map((a) => a.id));
  check(
    'every areaId resolves (or is empty)',
    site.assets.every((a) => a.areaId === '' || areaIds.has(a.areaId)),
    true
  );
  check(
    'dangling areaId cleared',
    site.assets.find((a) => a.name === 'Sonde')!.areaId,
    ''
  );

  check(
    'numeric strings coerced',
    site.assets.find((a) => a.name === 'Coords en string')!.lat,
    45.91
  );
  check('report counts the dropped assets', report.droppedAssets, 2);
  check('basemap defaulted', site.basemap.kind, 'osm');
  check('id left blank for the store to assign', site.id, '');

  // Caps: a runaway answer is truncated and says so. The ceilings are deliberately
  // generous (a parametric generate op legitimately makes hundreds of assets), so the
  // fixture has to exceed the real MAX_ASSETS to exercise truncation at all.
  const huge = {
    name: 'Huge',
    assets: Array.from({ length: 1200 }, (_, i) => ({
      name: `a${i}`,
      lat: 45 + i / 10_000,
      lon: 6
    }))
  };
  const big = normalizeSite(huge, AREA_PALETTE);
  check('assets capped at MAX_ASSETS', big.site.assets.length, 1000);
  check('truncation reported', big.report.truncated, true);

  // Garbage in, empty site out — never a throw.
  for (const junk of [
    null,
    undefined,
    42,
    'text',
    [],
    {},
    { assets: 'nope' }
  ]) {
    try {
      const out = normalizeSite(junk, AREA_PALETTE);
      if (out.site.assets.length > 0 || out.site.areas.length > 0) failures++;
    } catch {
      failures++;
      console.log('FAIL  normalizeSite threw on', JSON.stringify(junk));
    }
  }
  check('junk input yields an empty site without throwing', true, true);

  // NOTE: extracting proposals from an answer moved to the patch contract; it is
  // covered by site-patch.spec.ts, which owns that vocabulary.
});
