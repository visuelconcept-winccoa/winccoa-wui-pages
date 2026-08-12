// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The merge guarantee lives here, not in the prompt.
 *
 * A model can be told "complete, do not replace" a hundred ways; what actually protects a
 * configured site is that an omitted field is preserved, that an id is matched rather than
 * duplicated, and that a removal only happens when it was asked for. Those are the tests
 * below — plus the parametric expansion, which is what makes bulk creation possible without
 * the model writing (and truncating) hundreds of objects.
 */
import { describe, expect, it } from 'vitest';
import {
  applySitePatch,
  diffSites,
  isEmptyDiff,
  isEmptyPatch,
  parseSitePatch,
  replacePatchOf,
  type SitePatch
} from './site-patch.js';
import { blankSite, type Asset, type Site } from '../types.js';

const PALETTE = ['#111111', '#222222'] as const;

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: 'pompe-1',
    name: 'Pompe 1',
    kind: 'pump',
    lat: 45.9,
    lon: 6.12,
    areaIds: ['nord'],
    layerIds: [],
    dp: 'System1:Pompe01.state',
    readings: [
      {
        id: 'q',
        dp: 'System1:Pompe01.flow',
        label: 'Q',
        unit: 'm³/h',
        decimals: 1,
        onMap: true
      }
    ],
    link: '',
    notes: 'Notée par l’ingénieur',
    ...over
  };
}

function site(over: Partial<Site> = {}): Site {
  return {
    ...blankSite(),
    id: 'reseau',
    name: 'Réseau Nord',
    center: { lat: 45.9, lon: 6.12 },
    areas: [
      {
        id: 'nord',
        name: 'Secteur Nord',
        ring: [],
        color: '#111111',
        link: '',
        groupZoom: 0
      }
    ],
    assets: [asset()],
    ...over
  };
}

function patch(over: Partial<SitePatch> = {}): SitePatch {
  return {
    mode: 'patch',
    site: null,
    areas: { upsert: [], remove: [] },
    assets: { upsert: [], remove: [], generate: [] },
    ...over
  };
}

describe('parseSitePatch', () => {
  it('reads the patch contract', () => {
    const parsed = parseSitePatch({
      mode: 'patch',
      assets: { upsert: [{ id: 'a' }], remove: ['b'] }
    });
    expect(parsed?.mode).toBe('patch');
    expect(parsed?.assets.upsert).toHaveLength(1);
    expect(parsed?.assets.remove).toEqual(['b']);
  });

  it('treats a bare Site object as a replace — that IS what it asks for', () => {
    const parsed = parseSitePatch({
      name: 'X',
      areas: [],
      assets: [{ id: 'a' }]
    });
    expect(parsed?.mode).toBe('replace');
  });

  it('rejects a block that is not either contract', () => {
    expect(parseSitePatch({ hello: 'world' })).toBeNull();
    expect(parseSitePatch('a string')).toBeNull();
  });

  it('reports a patch that asks for nothing, so no apply button is offered', () => {
    expect(isEmptyPatch(patch())).toBe(true);
    expect(
      isEmptyPatch(
        patch({ assets: { upsert: [{ id: 'a' }], remove: [], generate: [] } })
      )
    ).toBe(false);
  });
});

describe('applySitePatch — completing, not replacing', () => {
  it('adds an asset without touching the existing ones', () => {
    const before = site();
    const { site: after } = applySitePatch(
      before,
      patch({
        assets: {
          upsert: [
            {
              id: 'forage-1',
              name: 'Forage 1',
              kind: 'well',
              lat: 45.95,
              lon: 6.2,
              areaId: 'nord'
            }
          ],
          remove: [],
          generate: []
        }
      }),
      PALETTE
    );
    expect(after.assets.map((item) => item.id)).toEqual([
      'pompe-1',
      'forage-1'
    ]);
    expect(after.assets[0]).toEqual(before.assets[0]);
  });

  it('merges a partial upsert into a known id and PRESERVES the dp binding', () => {
    // The whole point: the model is never given `dp`, so an omitted field must survive.
    const { site: after } = applySitePatch(
      site(),
      patch({
        assets: {
          upsert: [{ id: 'pompe-1', name: 'Pompe Nord' }],
          remove: [],
          generate: []
        }
      }),
      PALETTE
    );
    expect(after.assets).toHaveLength(1);
    const [updated] = after.assets;
    expect(updated?.name).toBe('Pompe Nord');
    expect(updated?.dp).toBe('System1:Pompe01.state');
    expect(updated?.notes).toBe('Notée par l’ingénieur');
    expect(updated?.readings[0]?.dp).toBe('System1:Pompe01.flow');
    expect(updated?.lat).toBe(45.9);
  });

  it('does not duplicate an existing id (the sanitiser used to suffix it)', () => {
    const { site: after } = applySitePatch(
      site(),
      patch({
        assets: {
          upsert: [{ id: 'pompe-1', kind: 'valve' }],
          remove: [],
          generate: []
        }
      }),
      PALETTE
    );
    expect(after.assets.map((item) => item.id)).toEqual(['pompe-1']);
    expect(after.assets[0]?.kind).toBe('valve');
  });

  it('removes only what `remove` names', () => {
    const before = site({
      assets: [asset(), asset({ id: 'pompe-2', name: 'Pompe 2', dp: '' })]
    });
    const { site: after } = applySitePatch(
      before,
      patch({ assets: { upsert: [], remove: ['pompe-2'], generate: [] } }),
      PALETTE
    );
    expect(after.assets.map((item) => item.id)).toEqual(['pompe-1']);
  });

  it('ignores a remove for an id that is not there', () => {
    const { site: after } = applySitePatch(
      site(),
      patch({ assets: { upsert: [], remove: ['nexiste-pas'], generate: [] } }),
      PALETTE
    );
    expect(after.assets).toHaveLength(1);
  });

  it('keeps the site basemap out of the model’s reach', () => {
    const before = site({
      basemap: {
        kind: 'raster',
        url: 'https://tiles.interne/{z}/{x}/{y}.png',
        styleUrl: '',
        attribution: 'Interne',
        maxZoom: 18
      }
    });
    const { site: after } = applySitePatch(
      before,
      // A model emitting a basemap (it is told not to) must not reset the private one.
      {
        ...patch(),
        site: { name: 'Réseau Nord', basemap: { kind: 'osm' } } as Record<
          string,
          unknown
        >
      },
      PALETTE
    );
    expect(after.basemap.url).toBe('https://tiles.interne/{z}/{x}/{y}.png');
  });

  it('creates from nothing when no site is open', () => {
    const { site: after } = applySitePatch(
      null,
      patch({
        site: { name: 'Nouveau' },
        assets: {
          upsert: [{ name: 'P1', kind: 'pump', lat: 1, lon: 2 }],
          remove: [],
          generate: []
        }
      }),
      PALETTE
    );
    expect(after.name).toBe('Nouveau');
    expect(after.assets).toHaveLength(1);
  });

  it('replace mode drops what it does not list', () => {
    const { site: after } = applySitePatch(
      site(),
      {
        mode: 'replace',
        site: { name: 'Remis à zéro' },
        areas: { upsert: [], remove: [] },
        assets: { upsert: [], remove: [], generate: [] }
      },
      PALETTE
    );
    expect(after.assets).toHaveLength(0);
    expect(after.areas).toHaveLength(0);
  });

  it('round-trips a site through replacePatchOf (the file-import path)', () => {
    const before = site();
    const { site: after } = applySitePatch(
      null,
      replacePatchOf(before),
      PALETTE
    );
    expect(after.assets.map((item) => item.id)).toEqual(['pompe-1']);
    expect(after.assets[0]?.dp).toBe('System1:Pompe01.state');
  });
});

describe('generate — bulk without writing every object', () => {
  it('lays a line of assets between two points, endpoints included', () => {
    const { site: after } = applySitePatch(
      site({ assets: [] }),
      patch({
        assets: {
          upsert: [],
          remove: [],
          generate: [
            {
              pattern: 'line',
              count: 5,
              kind: 'valve',
              nameTemplate: 'V-%03d',
              from: { lat: 45, lon: 6 },
              to: { lat: 45.4, lon: 6 }
            }
          ]
        }
      }),
      PALETTE
    );
    expect(after.assets).toHaveLength(5);
    expect(after.assets.map((item) => item.name)).toEqual([
      'V-001',
      'V-002',
      'V-003',
      'V-004',
      'V-005'
    ]);
    expect(after.assets[0]?.lat).toBeCloseTo(45, 6);
    expect(after.assets[4]?.lat).toBeCloseTo(45.4, 6);
    expect(after.assets.every((item) => item.kind === 'valve')).toBe(true);
    // Ids are derived from the names, so they stay addressable in the next patch.
    expect(after.assets.map((item) => item.id)).toEqual([
      'v-001',
      'v-002',
      'v-003',
      'v-004',
      'v-005'
    ]);
  });

  it('fills a grid and carries the shared fields onto every asset', () => {
    const { site: after } = applySitePatch(
      site({ assets: [] }),
      patch({
        assets: {
          upsert: [],
          remove: [],
          generate: [
            {
              pattern: 'grid',
              count: 6,
              cols: 3,
              kind: 'light',
              areaId: 'nord',
              readings: [{ label: 'P', unit: 'W', decimals: 0 }],
              from: { lat: 45, lon: 6 },
              to: { lat: 45.1, lon: 6.1 }
            }
          ]
        }
      }),
      PALETTE
    );
    expect(after.assets).toHaveLength(6);
    expect(after.assets.every((item) => item.areaIds.includes('nord'))).toBe(
      true
    );
    expect(after.assets[0]?.readings[0]?.label).toBe('P');
  });

  it('produces a ring around the site centre when no `from` is given', () => {
    const { site: after } = applySitePatch(
      site({ assets: [] }),
      patch({
        assets: {
          upsert: [],
          remove: [],
          generate: [
            { pattern: 'ring', count: 4, radiusM: 500, kind: 'sensor' }
          ]
        }
      }),
      PALETTE
    );
    expect(after.assets).toHaveLength(4);
    // Ring points sit off the centre, and none is a NaN that the sanitiser would drop.
    expect(
      after.assets.every((item) => item.lat !== 45.9 || item.lon !== 6.12)
    ).toBe(true);
  });

  it('yields nothing rather than NaNs when the geometry is unusable', () => {
    const { site: after } = applySitePatch(
      site({ assets: [] }),
      patch({
        assets: {
          upsert: [],
          remove: [],
          generate: [{ pattern: 'line', count: 10 }]
        }
      }),
      PALETTE
    );
    expect(after.assets).toHaveLength(0);
  });

  it('caps a runaway count at the per-op ceiling, and says so', () => {
    const { site: after, report } = applySitePatch(
      site({ assets: [] }),
      patch({
        assets: {
          upsert: [],
          remove: [],
          generate: [
            {
              pattern: 'line',
              count: 5000,
              kind: 'meter',
              from: { lat: 45, lon: 6 },
              to: { lat: 46, lon: 6 }
            }
          ]
        }
      }),
      PALETTE
    );
    // GENERATE_MAX bounds one op. It used to be the SITE ceiling that caught this and
    // reported the truncation; that ceiling is now 10 000, which one op cannot reach, so
    // the clamp has to report itself or a request for 5000 would quietly yield 2000.
    expect(after.assets).toHaveLength(2000);
    expect(report.truncated).toBe(true);
  });

  it('still caps the whole site when several ops together overflow it', () => {
    const runaway = Array.from({ length: 6 }, () => ({
      pattern: 'line',
      count: 2000,
      kind: 'meter',
      from: { lat: 45, lon: 6 },
      to: { lat: 46, lon: 6 }
    }));
    const { site: after, report } = applySitePatch(
      site({ assets: [] }),
      patch({ assets: { upsert: [], remove: [], generate: runaway } }),
      PALETTE
    );
    expect(after.assets).toHaveLength(10_000);
    expect(report.truncated).toBe(true);
  });
});

describe('diffSites — what the user is shown before applying', () => {
  it('counts an addition', () => {
    const before = site();
    const { site: after } = applySitePatch(
      before,
      patch({
        assets: {
          upsert: [{ id: 'x', name: 'X', kind: 'pump', lat: 45, lon: 6 }],
          remove: [],
          generate: []
        }
      }),
      PALETTE
    );
    const diff = diffSites(before, after);
    expect(diff.assets.added).toEqual([{ id: 'x', name: 'X' }]);
    expect(diff.assets.updated).toEqual([]);
    expect(diff.assets.removed).toEqual([]);
  });

  it('counts a modification, and says nothing changed when nothing did', () => {
    const before = site();
    const renamed = applySitePatch(
      before,
      patch({
        assets: {
          upsert: [{ id: 'pompe-1', name: 'Pompe Nord' }],
          remove: [],
          generate: []
        }
      }),
      PALETTE
    ).site;
    expect(diffSites(before, renamed).assets.updated).toEqual([
      { id: 'pompe-1', name: 'Pompe Nord' }
    ]);

    const identical = applySitePatch(
      before,
      patch({
        assets: {
          upsert: [{ id: 'pompe-1', name: 'Pompe 1' }],
          remove: [],
          generate: []
        }
      }),
      PALETTE
    ).site;
    expect(isEmptyDiff(diffSites(before, identical))).toBe(true);
  });

  it('counts what a replace destroys — the warning is a number, not an adjective', () => {
    const before = site({
      assets: [asset(), asset({ id: 'pompe-2', name: 'Pompe 2' })]
    });
    const { site: after } = applySitePatch(
      before,
      {
        mode: 'replace',
        site: null,
        areas: { upsert: [], remove: [] },
        assets: { upsert: [], remove: [], generate: [] }
      },
      PALETTE
    );
    const diff = diffSites(before, after);
    expect(diff.assets.removed.map((entry) => entry.id)).toEqual([
      'pompe-1',
      'pompe-2'
    ]);
    expect(diff.areas.removed.map((entry) => entry.id)).toEqual(['nord']);
  });

  it('flags a framing change on its own', () => {
    const before = site();
    const { site: after } = applySitePatch(
      before,
      patch({ site: { zoom: 15 } }),
      PALETTE
    );
    const diff = diffSites(before, after);
    expect(diff.view).toBe(true);
    expect(isEmptyDiff(diff)).toBe(false);
  });
});
