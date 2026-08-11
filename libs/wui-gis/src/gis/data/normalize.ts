// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Turning an untrusted site object into a {@link Site} the page can safely hold.
 *
 * Used for the AI assistant's proposals, and useful for any future import: the source
 * is a language model, so the shape is *plausible* rather than valid. Every field is
 * coerced, every id is made unique, anything unusable is dropped rather than allowed to
 * reach the map — a NaN latitude silently removes a marker, and an `areaId` pointing at
 * an area that was not proposed would orphan an asset out of the area filter.
 *
 * Nothing here throws. A proposal that survives to zero assets and zero areas is
 * returned as such, and the caller decides that it was not worth offering.
 *
 * The caps are deliberate: a model asked for "the whole city" can emit thousands of
 * assets, which would freeze the map and bloat the datapoint. What was dropped is
 * reported in {@link NormalizeReport} so the UI can say so instead of quietly truncating.
 */
import {
  ASSET_KINDS,
  AUTO_GROUP_ZOOM,
  BASEMAP_KINDS,
  type Basemap,
  type BasemapKind,
  DEFAULT_ZOOM,
  clamp,
  defaultBasemap,
  isValidLatLon,
  type Area,
  type Asset,
  type AssetKind,
  type Reading,
  type Site
} from '../types.js';

/**
 * Ceilings on one site. Generous for real sites, fatal for a runaway answer.
 *
 * Raised for bulk authoring: a `generate` op (see `./site-patch.ts`) turns a few tokens
 * into hundreds of assets, so the old 250 was reachable in one prompt. The remaining
 * ceiling is not this constant but the size of the JSON the site is persisted as, in one
 * WinCC OA String element — a few thousand assets is where that becomes the question, and
 * chunking `DpJsonStore` (not raising this) would be the answer.
 */
const MAX_AREAS = 64;
const MAX_ASSETS = 1000;
const MAX_READINGS = 8;
const MAX_RING_POINTS = 64;
/** A polygon needs three corners; fewer means the area has no drawn outline. */
const MIN_RING = 3;
const DECIMALS_MAX = 6;
const ZOOM_MIN = 0;
const ZOOM_MAX = 22;
/** Longest accepted free-text field, so a rambling answer cannot bloat the datapoint. */
const TEXT_MAX = 400;
/** Per-field length caps. Each mirrors what its editor field and the map can show. */
const NAME_MAX = 80;
const ID_MAX = 40;
const DP_MAX = 200;
const ROUTE_MAX = 200;
const LABEL_MAX = 24;
const UNIT_MAX = 16;
const CATEGORY_MAX = 40;
/** '#rrggbb' is 7 characters; a couple spare so a stray space still fails the regex. */
const COLOR_MAX = 9;

/** What had to be discarded, so the UI can be honest about it. */
export interface NormalizeReport {
  droppedAssets: number;
  droppedAreas: number;
  /** True when a cap was hit rather than a validity check. */
  truncated: boolean;
}

export interface NormalizedSite {
  site: Site;
  report: NormalizeReport;
}

function asText(value: unknown, max = TEXT_MAX): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The basemap, coerced field by field, defaulting when absent or unusable.
 *
 * Absent is the normal case for an AI proposal — the model is told not to invent one — but
 * **not** for an import: a site exported with its own tile server has to come back with it,
 * or a round-trip through a file would silently reset every deployment to the public OSM
 * tiles.
 */
function asBasemap(value: unknown): Basemap {
  const source = record(value);
  if (!source) return defaultBasemap();
  const kind = asText(source['kind'], 12).toLowerCase();
  if (!(BASEMAP_KINDS as readonly string[]).includes(kind))
    return defaultBasemap();
  const fallback = defaultBasemap();
  const maxZoom = Math.round(asNumber(source['maxZoom'], fallback.maxZoom));
  return {
    kind: kind as BasemapKind,
    url: asText(source['url'], ROUTE_MAX),
    styleUrl: asText(source['styleUrl'], ROUTE_MAX),
    attribution: asText(source['attribution'], NAME_MAX),
    maxZoom: clamp(maxZoom, 1, ZOOM_MAX)
  };
}

/** A known asset kind, else `generic` — an unknown kind would draw no glyph. */
function asKind(value: unknown): AssetKind {
  const text = asText(value).toLowerCase();
  return (ASSET_KINDS as readonly string[]).includes(text)
    ? (text as AssetKind)
    : 'generic';
}

/** `#rrggbb`, else the fallback — an invalid colour would paint the area invisible. */
function asColor(value: unknown, fallback: string): string {
  const text = asText(value, COLOR_MAX);
  return /^#[\da-f]{6}$/i.test(text) ? text : fallback;
}

/**
 * An in-app route, or empty. A proposal must not be able to point the dashboard at an
 * external URL, so anything that is not a rooted path is dropped.
 */
function asRoute(value: unknown): string {
  const text = asText(value, ROUTE_MAX);
  if (!text.startsWith('/') || text.startsWith('//') || text.includes(' '))
    return '';
  return text;
}

/** Make `base` unique within `taken`, and never empty. */
function uniqueId(base: string, taken: Set<string>, fallback: string): string {
  const slug =
    base
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')
      .slice(0, ID_MAX) || fallback;
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  let index = 2;
  while (taken.has(`${slug}-${index}`)) index++;
  const unique = `${slug}-${index}`;
  taken.add(unique);
  return unique;
}

/**
 * A collapse threshold: a MapLibre zoom, or {@link AUTO_GROUP_ZOOM} for automatic.
 * Anything outside the zoom range means the model invented a number, and automatic is a
 * better answer than a threshold that never fires.
 */
function asGroupZoom(value: unknown): number {
  const zoom = Math.round(asNumber(value, AUTO_GROUP_ZOOM));
  if (zoom <= ZOOM_MIN || zoom > ZOOM_MAX) return AUTO_GROUP_ZOOM;
  return zoom;
}

function normalizeReadings(raw: unknown): Reading[] {
  const readings: Reading[] = [];
  const taken = new Set<string>();
  for (const item of list(raw).slice(0, MAX_READINGS)) {
    const source = record(item);
    if (!source) continue;
    readings.push({
      id: uniqueId(
        asText(source['id'], ID_MAX) || asText(source['label'], ID_MAX),
        taken,
        `r${readings.length + 1}`
      ),
      dp: asText(source['dp'], DP_MAX),
      label: asText(source['label'], LABEL_MAX),
      unit: asText(source['unit'], UNIT_MAX),
      decimals: Math.round(
        clamp(asNumber(source['decimals'], 1), 0, DECIMALS_MAX)
      ),
      onMap: asBool(source['onMap'])
    });
  }
  return readings;
}

/** The rings, `[lon, lat]` pairs — anything not a usable coordinate pair is dropped. */
function normalizeRing(raw: unknown): [number, number][] {
  const ring: [number, number][] = [];
  for (const point of list(raw).slice(0, MAX_RING_POINTS)) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lon = asNumber(point[0], Number.NaN);
    const lat = asNumber(point[1], Number.NaN);
    if (!isValidLatLon(lat, lon)) continue;
    ring.push([lon, lat]);
  }
  return ring;
}

function normalizeAreas(
  raw: unknown,
  palette: readonly string[]
): { areas: Area[]; dropped: number } {
  const areas: Area[] = [];
  const taken = new Set<string>();
  let dropped = 0;
  for (const item of list(raw).slice(0, MAX_AREAS)) {
    const source = record(item);
    if (!source) {
      dropped++;
      continue;
    }
    const name = asText(source['name'], NAME_MAX);
    const ring = normalizeRing(source['ring']);
    // A named area with no usable ring is still worth keeping — it groups assets and
    // draws no outline. One with NEITHER a name nor a ring carries no information at
    // all, and would only add an unnamed entry to the area filter.
    if (!name && ring.length < MIN_RING) {
      dropped++;
      continue;
    }
    areas.push({
      id: uniqueId(
        asText(source['id'], ID_MAX) || name,
        taken,
        `zone-${areas.length + 1}`
      ),
      name: name || `Zone ${areas.length + 1}`,
      ring: ring.length >= MIN_RING ? ring : [],
      color: asColor(
        source['color'],
        palette[areas.length % palette.length] as string
      ),
      link: asRoute(source['link']),
      groupZoom: asGroupZoom(source['groupZoom'])
    });
  }
  dropped += Math.max(0, list(raw).length - MAX_AREAS);
  return { areas, dropped };
}

function normalizeAssets(
  raw: unknown,
  areaIds: Set<string>
): { assets: Asset[]; dropped: number } {
  const assets: Asset[] = [];
  const taken = new Set<string>();
  let dropped = 0;
  for (const item of list(raw).slice(0, MAX_ASSETS)) {
    const source = record(item);
    if (!source) {
      dropped++;
      continue;
    }
    const lat = asNumber(source['lat'], Number.NaN);
    const lon = asNumber(source['lon'], Number.NaN);
    // Without a usable position the marker would simply not be drawn, so the asset is
    // worse than useless: it would sit in the datapoint invisible and unexplained.
    if (!isValidLatLon(lat, lon)) {
      dropped++;
      continue;
    }
    const name = asText(source['name'], NAME_MAX);
    const areaId = asText(source['areaId'], ID_MAX);
    assets.push({
      id: uniqueId(
        asText(source['id'], ID_MAX) || name,
        taken,
        `asset-${assets.length + 1}`
      ),
      name: name || `Asset ${assets.length + 1}`,
      kind: asKind(source['kind']),
      lat,
      lon,
      // Referencing an area that was not proposed would orphan the asset out of the
      // area filter, so an unknown id becomes "no area".
      areaId: areaIds.has(areaId) ? areaId : '',
      dp: asText(source['dp'], DP_MAX),
      readings: normalizeReadings(source['readings']),
      link: asRoute(source['link']),
      notes: asText(source['notes'])
    });
  }
  dropped += Math.max(0, list(raw).length - MAX_ASSETS);
  return { assets, dropped };
}

/**
 * Coerce an untrusted object into a {@link Site}.
 *
 * `palette` supplies the default area colours (the page's own), so a proposal that omits
 * them still comes out with distinguishable areas.
 */
export function normalizeSite(
  raw: unknown,
  palette: readonly string[]
): NormalizedSite {
  const source = record(raw) ?? {};
  // Tolerate a `{ site: {...} }` wrapper, which models produce about as often as not.
  const body = record(source['site']) ?? source;

  const { areas, dropped: droppedAreas } = normalizeAreas(
    body['areas'],
    palette
  );
  const areaIds = new Set(areas.map((area) => area.id));
  const { assets, dropped: droppedAssets } = normalizeAssets(
    body['assets'],
    areaIds
  );

  const centre = record(body['center']);
  const proposedLat = asNumber(centre?.['lat'], Number.NaN);
  const proposedLon = asNumber(centre?.['lon'], Number.NaN);
  const fallback = meanOf(assets) ?? { lat: 0, lon: 0 };
  const usable = isValidLatLon(proposedLat, proposedLon);

  const site: Site = {
    id: '',
    name: asText(body['name'], NAME_MAX),
    description: asText(body['description']),
    category: asText(body['category'], CATEGORY_MAX) || undefined,
    // A centre the model got wrong would open the map on empty sea, so the assets it
    // actually proposed are the better answer whenever one is available.
    center: usable ? { lat: proposedLat, lon: proposedLon } : fallback,
    zoom: Math.round(
      clamp(asNumber(body['zoom'], DEFAULT_ZOOM), ZOOM_MIN, ZOOM_MAX)
    ),
    basemap: asBasemap(body['basemap']),
    groupZoom: asGroupZoom(body['groupZoom']),
    areas,
    assets,
    updatedAt: ''
  };

  return {
    site,
    report: {
      droppedAssets,
      droppedAreas,
      truncated:
        list(body['assets']).length > MAX_ASSETS ||
        list(body['areas']).length > MAX_AREAS
    }
  };
}

/** Mean position of the proposed assets — the fallback map centre. */
function meanOf(assets: readonly Asset[]): { lat: number; lon: number } | null {
  if (assets.length === 0) return null;
  let lat = 0;
  let lon = 0;
  for (const asset of assets) {
    lat += asset.lat;
    lon += asset.lon;
  }
  return { lat: lat / assets.length, lon: lon / assets.length };
}
