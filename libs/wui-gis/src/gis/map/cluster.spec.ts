// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { cellOf, declutterAssets } from '../map/cluster.js';
import type { Asset } from '../types.js';

describe('cluster grid + label rule', () => {
  function asset(id: string, lat: number, lon: number): Asset {
    return {
      id,
      name: id,
      kind: 'generic',
      lat,
      lon,
      areaIds: [],
      dp: '',
      readings: [],
      link: '',
      notes: ''
    };
  }

  const none = () => false;
  function check(label: string, got: unknown, expected: unknown): void {
    it(label, () => {
      expect(got).toEqual(expected);
    });
  }

  // The Annecy water demo: 13 assets spread over ~8 km.
  const water = [
    asset('usine', 45.9048, 6.1005),
    asset('captage', 45.8862, 6.1521),
    asset('forage', 45.9124, 6.0884),
    asset('pompN', 45.9251, 6.1347),
    asset('pompS', 45.8703, 6.1448),
    asset('resSemnoz', 45.8709, 6.1103),
    asset('resPuisots', 45.8953, 6.1052),
    asset('resNord', 45.9312, 6.1108),
    asset('vanneN', 45.9188, 6.1235),
    asset('vanneC', 45.8991, 6.1288),
    asset('debitC', 45.8964, 6.1401),
    asset('debitS', 45.8641, 6.1312),
    asset('sonde', 45.8577, 6.1489)
  ];

  // 1. Zoomed way out: everything collapses into a couple of badges, nothing left loose.
  //    (The site straddles a cell boundary at this zoom, so 2 badges is correct.)
  const far = declutterAssets(water, 9, none);
  check('zoom 9  -> few badges', far.clusters.length <= 3, true);
  check(
    'zoom 9  -> singles + badges cover all 13',
    far.singles.length + far.clusters.reduce((n, c) => n + c.assets.length, 0),
    13
  );

  // 2. Zoomed in: every asset stands alone, nothing is grouped.
  const near = declutterAssets(water, 17, none);
  check(
    'zoom 17 -> all individual',
    [near.clusters.length, near.singles.length],
    [0, 13]
  );

  // 3. Monotonic: zooming in never increases how many assets are hidden in badges.
  let previous = Number.POSITIVE_INFINITY;
  let monotonic = true;
  for (let z = 8; z <= 18; z++) {
    const hidden = declutterAssets(water, z, none).clusters.reduce(
      (n, c) => n + c.assets.length,
      0
    );
    if (hidden > previous) monotonic = false;
    previous = hidden;
  }
  check('hidden count never grows as you zoom in', monotonic, true);

  // 4. An asset in alarm groups like any other — and the badge that swallowed it says so,
  //    which is how the alarm survives being folded in.
  const withAlarm = declutterAssets(water, 9, (a) => a.id === 'pompN');
  const holder = withAlarm.clusters.find((c) =>
    c.assets.some((a) => a.id === 'pompN')
  );
  check(
    'zoom 9  -> the alarm asset is inside a badge',
    holder !== undefined,
    true
  );
  check('the badge holding it reports one alarm', holder?.alarms, 1);
  check(
    'a badge holding no alarm reports none',
    withAlarm.clusters
      .filter((c) => c.assets.every((a) => a.id !== 'pompN'))
      .every((c) => c.alarms === 0),
    true
  );

  // 5. Cluster identity is stable across a fractional (pinch) zoom.
  // Use a zoom where clusters actually exist, so the assertion is not vacuous.
  const a = declutterAssets(water, 10.1, none)
    .clusters.map((c) => c.id)
    .sort();
  const b = declutterAssets(water, 10.9, none)
    .clusters.map((c) => c.id)
    .sort();
  check('pinch zoom keeps cluster ids (non-empty)', a.length > 0, true);
  check('cluster ids identical across pinch', a, b);

  // 6. Panning cannot change grouping (grid is world-anchored, not screen-anchored):
  //    the same assets at the same zoom always yield the same cells.
  const c1 = declutterAssets(water, 11, none)
    .clusters.map((c) => c.id)
    .sort();
  const c2 = declutterAssets([...water].reverse(), 11, none)
    .clusters.map((c) => c.id)
    .sort();
  check('grouping independent of input order', c1, c2);

  // 7. Poles do not produce a non-finite cell.
  check(
    'lat +90 gives a finite cell',
    /^\d+\/\d+\/\d+$/.test(cellOf(asset('n', 90, 0), 10)),
    true
  );
  check(
    'lat -90 gives a finite cell',
    /^\d+\/\d+\/\d+$/.test(cellOf(asset('s', -90, 0), 10)),
    true
  );

  // 8. Every asset is accounted for exactly once, at every zoom.
  let conserved = true;
  for (let z = 6; z <= 20; z++) {
    const d = declutterAssets(water, z, (x) => x.id === 'usine');
    const total =
      d.singles.length + d.clusters.reduce((n, c) => n + c.assets.length, 0);
    const ids = new Set([
      ...d.singles.map((x) => x.asset.id),
      ...d.clusters.flatMap((c) => c.assets.map((x) => x.id))
    ]);
    if (total !== water.length || ids.size !== water.length) conserved = false;
  }
  check('no asset lost or duplicated, zoom 6..20', conserved, true);

  // 9. Label rule: a plate only when the disc really is on its own.
  //    'a' and 'b' are 0.00003° apart — about 19 world px at zoom 18, so their 28 px discs
  //    genuinely overlap. 'far' is kilometres away.
  const tight = [
    asset('a', 45.9, 6.1),
    asset('b', 45.900_03, 6.100_03),
    asset('far', 45.95, 6.2)
  ];
  const dense = declutterAssets(tight, 18, none); // zoomed in: all individual
  check('zoom 18 -> nothing grouped', dense.clusters.length, 0);
  check(
    'two touching discs are unlabelled',
    dense.singles.filter((s) => s.asset.id !== 'far').every((s) => !s.labelled),
    true
  );
  check(
    'the isolated disc keeps its label',
    dense.singles.find((s) => s.asset.id === 'far')!.labelled,
    true
  );

  // 10. An alarm left individual (alone in its cell) still loses its plate when crowded.
  const crowdedAlarm = declutterAssets(tight, 18, (x) => x.id === 'a');
  check(
    'crowded alarm disc is unlabelled',
    crowdedAlarm.singles.find((s) => s.asset.id === 'a')!.labelled,
    false
  );

  // 11. group:false shows everything, and the label rule still applies.
  const ungrouped = declutterAssets(water, 9, none, { group: false });
  check(
    'group:false -> no badges, all singles',
    [ungrouped.clusters.length, ungrouped.singles.length],
    [0, 13]
  );
  const ungroupedNear = declutterAssets(water, 17, none, { group: false });
  check(
    'group:false at zoom 17 -> plates shown',
    ungroupedNear.singles.every((s) => s.labelled),
    true
  );

  // 12. THE label invariant, at every zoom and in both modes: a labelled disc never has
  //     another asset closer than the clearance, and a crowded one is never labelled.
  const CLEAR = 40;
  const TILE = 512;
  function worldPx(a: Asset, z: number): { x: number; y: number } {
    const world = TILE * 2 ** z;
    const rad =
      (Math.min(Math.max(a.lat, -85.051_129), 85.051_129) * Math.PI) / 180;
    return {
      x: ((a.lon + 180) / 360) * world,
      y:
        (0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI)) *
        world
    };
  }
  let labelInvariant = true;
  const sawBoth = { labelled: false, unlabelled: false };
  for (const group of [true, false]) {
    for (let z = 6; z <= 20; z++) {
      for (const s of declutterAssets(water, z, none, { group }).singles) {
        const me = worldPx(s.asset, Math.floor(z));
        const nearest = Math.min(
          ...water
            .filter((o) => o.id !== s.asset.id)
            .map((o) => {
              const p = worldPx(o, Math.floor(z));
              return Math.hypot(p.x - me.x, p.y - me.y);
            })
        );
        if (s.labelled) {
          sawBoth.labelled = true;
          if (nearest < CLEAR) labelInvariant = false;
        } else {
          sawBoth.unlabelled = true;
          if (nearest >= CLEAR) labelInvariant = false;
        }
      }
    }
  }
  check('labelled <=> nearest neighbour >= 40 world px', labelInvariant, true);
  check(
    'both labelled and unlabelled cases exercised',
    sawBoth.labelled && sawBoth.unlabelled,
    true
  );
});
