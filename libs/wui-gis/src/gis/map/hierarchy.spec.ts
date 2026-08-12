// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { groupSite } from '../map/cluster.js';
import { demoSites } from '../data/demo.js';
import type { Asset, Site } from '../types.js';

describe('grouping hierarchy', () => {
  function check(label: string, got: unknown, expected: unknown): void {
    it(label, () => {
      expect(got).toEqual(expected);
    });
  }
  const none = () => false;

  const water = demoSites()[0] as Site;
  const city = demoSites()[1] as Site;

  function at(site: Site, zoom: number, inAlarm: (a: Asset) => boolean = none) {
    return groupSite(site, site.assets, zoom, inAlarm);
  }
  function total(g: ReturnType<typeof at>): number {
    return (
      g.singles.length + g.clusters.reduce((n, c) => n + c.assets.length, 0)
    );
  }

  // --- 1. The three rungs appear, in the right order as you zoom out -----------
  const levels: Record<string, number[]> = { site: [], area: [], asset: [] };
  for (let z = 6; z <= 20; z++) levels[at(water, z).level]!.push(z);
  console.log('   water levels by zoom:', JSON.stringify(levels));
  check(
    'all three rungs are reachable',
    [
      levels['site']!.length > 0,
      levels['area']!.length > 0,
      levels['asset']!.length > 0
    ],
    [true, true, true]
  );
  check(
    'site rung is the most zoomed out',
    Math.max(...levels['site']!) < Math.min(...levels['area']!),
    true
  );
  check(
    'area rung sits between site and asset',
    Math.max(...levels['area']!) < Math.min(...levels['asset']!),
    true
  );

  // --- 2. Conservation at every zoom, on both demo sites ----------------------
  let conserved = true;
  for (const site of [water, city]) {
    for (let z = 4; z <= 22; z++) {
      const g = at(site, z, (a) => a.id.startsWith('pomp'));
      if (total(g) !== site.assets.length) {
        conserved = false;
        console.log('  lost at', site.id, z, total(g));
      }
    }
  }
  check('no asset lost or duplicated, zoom 4..22, both sites', conserved, true);

  // --- 3. Site rung: one badge, carrying the alarm count ----------------------
  const far = at(
    water,
    7,
    (a) => a.id === 'pompage-nord' || a.id === 'pompage-sud'
  );
  check(
    'site rung -> exactly one badge',
    [far.level, far.clusters.length],
    ['site', 1]
  );
  check(
    'site badge holds every asset',
    far.clusters[0]!.assets.length,
    water.assets.length
  );
  check('site badge reports the alarm count', far.clusters[0]!.alarms, 2);
  check('site rung -> no individual markers', far.singles.length, 0);

  // --- 4. Area rung: a badge per area, each reporting its own alarms ----------
  const areaZoom = Math.min(...levels['area']!);
  const mid = at(water, areaZoom, (a) => a.id === 'pompage-nord');
  const areaBadges = mid.clusters.filter((c) => c.kind === 'area');
  check('area rung -> at least one area badge', areaBadges.length > 0, true);
  check(
    'area badges carry their area name',
    areaBadges.every((c) => c.label !== ''),
    true
  );
  check(
    'area badges carry their area colour',
    areaBadges.every((c) => c.color !== ''),
    true
  );
  // An alarmed asset is grouped like any other; what makes it visible is the badge
  // stating how many of its members are in alarm.
  const alarmBadge = areaBadges.find((c) =>
    c.assets.some((a) => a.id === 'pompage-nord')
  );
  check('the alarm is inside its area badge', alarmBadge !== undefined, true);
  check('that badge reports exactly one alarm', alarmBadge?.alarms, 1);
  check(
    'the alarm is not also drawn on its own',
    mid.singles.some((s) => s.asset.id === 'pompage-nord'),
    false
  );
  check(
    'every other area badge reports none',
    areaBadges
      .filter((c) => c.id !== alarmBadge?.id)
      .every((c) => c.alarms === 0),
    true
  );

  // --- 5. Asset rung: nothing grouped by area --------------------------------
  const near = at(water, 20);
  check(
    'asset rung -> no area/site badges',
    near.clusters.every((c) => c.kind === 'cell'),
    true
  );
  check(
    'asset rung -> everything individual',
    near.singles.length,
    water.assets.length
  );

  // --- 6. A per-area override is honoured -------------------------------------
  const overridden: Site = {
    ...water,
    groupZoom: 1, // keep the site rung out of the way
    areas: water.areas.map((a, i) =>
      i === 0 ? { ...a, groupZoom: 19 } : { ...a, groupZoom: 2 }
    )
  };
  const g18 = groupSite(overridden, overridden.assets, 18, none);
  check(
    'area with groupZoom 19 is collapsed at zoom 18',
    g18.clusters.some((c) => c.id === `area:${water.areas[0]!.id}`),
    true
  );
  check(
    'areas with groupZoom 2 are not collapsed at zoom 18',
    g18.clusters.filter((c) => c.kind === 'area').length,
    1
  );

  // --- 7. A site override is honoured and wins over the areas -----------------
  const siteForced: Site = { ...water, groupZoom: 21 };
  const gs = groupSite(siteForced, siteForced.assets, 20, none);
  check(
    'site groupZoom 21 collapses the site at zoom 20',
    [gs.level, gs.clusters.length],
    ['site', 1]
  );

  // --- 8. A site with no areas still declutters on the flat grid --------------
  const noAreas: Site = {
    ...water,
    areas: [],
    groupZoom: 1,
    assets: water.assets.map((a) => ({ ...a, areaIds: [] }))
  };
  const flat = groupSite(noAreas, noAreas.assets, 11, none);
  check(
    'no areas -> asset rung with grid badges',
    [flat.level, flat.clusters.every((c) => c.kind === 'cell')],
    ['asset', true]
  );
  check(
    'no areas -> still conserves every asset',
    total(flat),
    noAreas.assets.length
  );

  // --- 9. Grouping off -> everything individual, no badges -------------------
  const off = groupSite(water, water.assets, 7, none, { group: false });
  check(
    'group:false -> no badges at any zoom',
    [off.clusters.length, off.singles.length],
    [0, water.assets.length]
  );

  // --- 10. THE area invariant, at every zoom, on both demo sites -------------
  // An area is either WHOLLY one badge or WHOLLY individual markers. It is never shown as
  // "a few markers plus an anonymous grey badge holding the rest of the same area" — the
  // split that made grouping look broken, caused by judging an area by its ring instead of
  // by its assets and by measuring a padded extent.
  const mixed: string[] = [];
  let inAnonymousCell = 0;
  for (const site of [water, city]) {
    for (let z = 6; z <= 20; z++) {
      const g = groupSite(site, site.assets, z, none);
      for (const area of site.areas) {
        const owned = site.assets.filter((a) => a.areaId === area.id);
        if (owned.length === 0) continue;
        const badge = g.clusters.find((c) => c.id === `area:${area.id}`);
        const grouped = badge ? badge.assets.length : 0;
        const loose = g.singles.filter(
          (s) => s.asset.areaId === area.id
        ).length;
        const cells = g.clusters
          .filter((c) => c.kind === 'cell')
          .reduce(
            (n, c) => n + c.assets.filter((a) => a.areaId === area.id).length,
            0
          );
        inAnonymousCell += cells;
        const whole = grouped === owned.length || loose === owned.length;
        // The site rung legitimately holds everything in one badge.
        if (!whole && g.level !== 'site')
          mixed.push(`${site.id} z${z} ${area.id}`);
      }
    }
  }
  check('an area is never split between a badge and loose markers', mixed, []);
  check(
    'an area asset never lands in an anonymous grid badge',
    inAnonymousCell,
    0
  );
});
