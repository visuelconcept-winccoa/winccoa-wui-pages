// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { demoSites } from './data/demo.js';
import { normalizeSite } from './data/normalize.js';
import {
  AREA_PALETTE,
  connectionPath,
  connectionsOfAsset,
  connectionsOfRoute,
  layerUsage,
  layersOf,
  routeOrder,
  visibleUnderLayers,
  type Site
} from './types.js';

describe('the network: connections, routes and layers', () => {
  function check(label: string, got: unknown, expected: unknown): void {
    it(label, () => {
      expect(got).toEqual(expected);
    });
  }

  const water = demoSites()[0] as Site;
  const city = demoSites()[1] as Site;

  // --- 1. Geometry is resolved from the ends, never stored ---------------------
  check(
    'every demo connection resolves to a path',
    [water, city].every((site) =>
      site.connections.every((link) => connectionPath(site, link) !== null)
    ),
    true
  );
  const first = water.connections[0]!;
  const path = connectionPath(water, first)!;
  const start = water.assets.find((asset) => asset.id === first.from)!;
  check('the path starts on its start asset', path[0], [start.lon, start.lat]);
  check(
    'a path with no shaping points is just its two ends',
    path.length,
    2 + first.via.length
  );

  // THE point of referencing assets rather than coordinates: move the marker, and the
  // line moves with it. Nothing is recomputed or migrated — the path is derived.
  const moved: Site = {
    ...water,
    assets: water.assets.map((asset) =>
      asset.id === first.from ? { ...asset, lat: 46.5, lon: 6.9 } : asset
    )
  };
  check(
    'moving an asset moves every line attached to it',
    connectionPath(moved, first)![0],
    [6.9, 46.5]
  );

  // --- 2. A dangling end is dropped, and reported ------------------------------
  const orphaned = normalizeSite(
    {
      ...water,
      connections: [
        ...water.connections,
        { id: 'nowhere', from: water.assets[0]!.id, to: 'does-not-exist' },
        { id: 'itself', from: water.assets[0]!.id, to: water.assets[0]!.id }
      ]
    },
    AREA_PALETTE
  );
  check(
    'a connection to a missing asset is dropped',
    orphaned.site.connections.some((link) => link.id === 'nowhere'),
    false
  );
  check(
    'a connection from an asset to itself is dropped',
    orphaned.site.connections.some((link) => link.id === 'itself'),
    false
  );
  check('and both are reported', orphaned.report.droppedConnections >= 2, true);
  check(
    'the valid ones all survive',
    orphaned.site.connections.length,
    water.connections.length
  );

  // Deleting the asset is the same case, seen from the other side: the sanitiser is the
  // backstop for whatever the page forgets to cascade.
  const gone = normalizeSite(
    { ...water, assets: water.assets.filter((a) => a.id !== first.from) },
    AREA_PALETTE
  );
  check(
    'deleting an asset takes its connections with it',
    gone.site.connections.some(
      (link) => link.from === first.from || link.to === first.from
    ),
    false
  );

  // --- 3. An unknown route reference is cleared, not kept ----------------------
  const stray = normalizeSite(
    {
      ...water,
      connections: water.connections.map((link) => ({
        ...link,
        routeId: 'no-such-line'
      }))
    },
    AREA_PALETTE
  );
  check(
    'a connection pointing at no line becomes standalone',
    stray.site.connections.every((link) => link.routeId === ''),
    true
  );

  // --- 4. Route order is derived, and admits when it cannot be ----------------
  check(
    'a simple line reports its stops in travel order',
    routeOrder(city, 'axe-structurant'),
    ['feu-gare', 'feu-hugo', 'feu-villeneuve', 'tunnel-bastille']
  );
  check(
    'a branching line has no single order, and says so',
    routeOrder(water, 'refoulement'),
    null
  );
  check('an unknown line has no order', routeOrder(water, 'nope'), null);
  check(
    'every segment of a line is listed by it',
    connectionsOfRoute(city, 'axe-structurant').length,
    3
  );
  check(
    'a standalone segment is listed under no line',
    connectionsOfRoute(city, '').every((link) => link.routeId === ''),
    true
  );

  // --- 5. What touches one asset ----------------------------------------------
  check(
    'a junction lists every line through it',
    connectionsOfAsset(city, 'feu-hugo')
      .map((link) => link.id)
      .sort(),
    ['axe-1', 'axe-2']
  );
  check(
    'an asset with nothing attached lists nothing',
    connectionsOfAsset(city, 'chauffe-mairie').length,
    0
  );

  // --- 6. Layers: tags, visibility, and what carries them ---------------------
  check('the demo declares its layers', water.layers.length > 0, true);
  check(
    'an unknown tag is dropped rather than kept unnameable',
    normalizeSite(
      {
        ...water,
        assets: water.assets.map((asset) => ({
          ...asset,
          layerIds: ['critique', 'ghost']
        }))
      },
      AREA_PALETTE
    ).site.assets.every((asset) =>
      asset.layerIds.every((id) => id !== 'ghost')
    ),
    true
  );
  check(
    'a known tag survives',
    normalizeSite(
      {
        ...water,
        assets: water.assets.map((asset) => ({
          ...asset,
          layerIds: ['critique']
        }))
      },
      AREA_PALETTE
    ).site.assets.every((asset) => asset.layerIds.includes('critique')),
    true
  );
  check(
    'layersOf resolves ids to layers in site order',
    layersOf(water, ['tranche-2', 'critique']).map((layer) => layer.id),
    ['critique', 'tranche-2']
  );
  check(
    'usage counts assets and connections alike',
    layerUsage(
      {
        ...water,
        assets: water.assets.map((asset, index) =>
          index < 2 ? { ...asset, layerIds: ['critique'] } : asset
        ),
        connections: water.connections.map((link, index) =>
          index < 3 ? { ...link, layerIds: ['critique'] } : link
        )
      },
      'critique'
    ),
    5
  );

  // The visibility rule, which is the one users feel: untagged is never hidden, and a
  // multi-tagged object survives while any of its tags is still on.
  const off = new Set(['critique']);
  check('untagged is always drawn', visibleUnderLayers([], off), true);
  check(
    'its only tag is off ⇒ hidden',
    visibleUnderLayers(['critique'], off),
    false
  );
  check(
    'one tag still on ⇒ drawn',
    visibleUnderLayers(['critique', 'sectorisation'], off),
    true
  );
  check(
    'every tag off ⇒ hidden',
    visibleUnderLayers(
      ['critique', 'sectorisation'],
      new Set(['critique', 'sectorisation'])
    ),
    false
  );

  // --- 7. A site written before any of this still loads ------------------------
  const legacy = normalizeSite(
    {
      name: 'Ancien site',
      areas: [{ id: 'z', name: 'Zone', ring: [] }],
      assets: [{ id: 'a', name: 'A', lat: 45.9, lon: 6.1 }]
    },
    AREA_PALETTE
  );
  check(
    'no layers, routes or connections ⇒ empty lists, not undefined',
    [
      legacy.site.layers,
      legacy.site.routes,
      legacy.site.connections,
      legacy.site.assets[0]!.layerIds
    ],
    [[], [], [], []]
  );
});
