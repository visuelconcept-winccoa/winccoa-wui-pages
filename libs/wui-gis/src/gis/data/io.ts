// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Import / export for GIS sites, in two formats that answer two different needs.
 *
 * **Native JSON** (`{ kind: 'gis-sites', version, sites }`) round-trips *everything* — the
 * datapoint bindings, the readings, the drill-down routes, the basemap, the grouping
 * thresholds. It is the format for moving a configuration between projects, for backing one
 * up, and for reviewing it in a diff.
 *
 * **GeoJSON** is the interoperable one: areas become `Polygon` features and assets become
 * `Point` features, so a site opens in QGIS, ArcGIS or anything else that reads GeoJSON —
 * and, more usefully, a surveyed layer produced by those tools can be imported here. That
 * is the practical answer to the assistant's approximate coordinates: draft the site with
 * the AI, then bring the real positions in from the survey.
 *
 * Every import goes through {@link normalizeSite}, the same sanitiser the AI assistant
 * uses, because a file is exactly as untrusted as a language model: hand-edited, produced
 * by another tool, or simply from an older version of this page.
 */
import {
  JSON_INDENT,
  download,
  timestampSlug
} from '@visuelconcept/wui-kit/data/io.js';
import { normalizeSite, type NormalizedSite } from './normalize.js';
import { MIN_RING } from '../map/style.js';
import { AREA_PALETTE, connectionPath, type Site } from '../types.js';

/** Why an import was refused. The CALLER localises it — see {@link ImportError}. */
export type ImportProblem = 'not-json' | 'no-site';

/**
 * An import that produced nothing usable.
 *
 * Carries a `problem` CODE rather than a message. This is a data module: reaching into the
 * i18n layer for a user-facing string inverts the layering, and because that chain pulls in
 * `lit-translate` it also made this module impossible to load in a plain Node test. The page
 * maps the code onto `MSG.io.*`.
 */
export class ImportError extends Error {
  constructor(readonly problem: ImportProblem) {
    super(problem);
    this.name = 'ImportError';
  }
}

/** Envelope marker, so an unrelated JSON file is rejected rather than half-read. */
const KIND = 'gis-sites';
const VERSION = 1;
const SLUG_MAX = 40;

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')
      .slice(0, SLUG_MAX) || 'site'
  );
}

// --- native JSON -------------------------------------------------------------

function envelope(sites: readonly Site[]): string {
  return JSON.stringify(
    { kind: KIND, version: VERSION, sites },
    null,
    JSON_INDENT
  );
}

/** Download every site as one JSON file. */
export function exportSitesJson(sites: readonly Site[]): void {
  download(
    `gis-sites-${timestampSlug()}.json`,
    envelope(sites),
    'application/json'
  );
}

/** Download a single site as JSON (same envelope, so it re-imports the same way). */
export function exportSiteJson(site: Site): void {
  download(`gis-${slug(site.name)}.json`, envelope([site]), 'application/json');
}

// --- GeoJSON -----------------------------------------------------------------

/** A GeoJSON feature as this module writes and reads it. */
interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry:
    | { type: 'Point'; coordinates: [number, number] }
    | { type: 'LineString'; coordinates: number[][] }
    | { type: 'Polygon'; coordinates: number[][][] };
}

interface GeoCollection {
  type: 'FeatureCollection';
  /** Site-level fields, so a GeoJSON round-trip keeps more than the geometry. */
  properties?: Record<string, unknown>;
  features: GeoFeature[];
}

/**
 * A site as GeoJSON. `gisType` on each feature is what tells areas from assets on the way
 * back in; everything else is a plain property so foreign tools show something meaningful
 * in their attribute table.
 */
export function siteToGeoJson(site: Site): GeoCollection {
  const features: GeoFeature[] = [];
  for (const area of site.areas) {
    if (area.ring.length < MIN_RING) continue;
    const ring = area.ring.map(([lon, lat]) => [lon, lat]);
    const first = ring[0] as number[];
    ring.push([first[0] as number, first[1] as number]);
    features.push({
      type: 'Feature',
      properties: {
        gisType: 'area',
        id: area.id,
        name: area.name,
        color: area.color,
        link: area.link,
        groupZoom: area.groupZoom
      },
      geometry: { type: 'Polygon', coordinates: [ring] }
    });
  }
  for (const asset of site.assets) {
    features.push({
      type: 'Feature',
      properties: {
        gisType: 'asset',
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        areaIds: asset.areaIds,
        dp: asset.dp,
        link: asset.link,
        notes: asset.notes,
        readings: asset.readings
      },
      geometry: { type: 'Point', coordinates: [asset.lon, asset.lat] }
    });
  }
  // Connections as LineStrings, so QGIS shows the network and not just its ends. The
  // geometry is resolved (endpoints + shaping points) because that is what a foreign tool
  // can read; `from`/`to` ride along in the properties so OUR importer can rebuild the
  // topology rather than a frozen pair of coordinates.
  for (const connection of site.connections) {
    const path = connectionPath(site, connection);
    if (!path) continue;
    features.push({
      type: 'Feature',
      properties: {
        gisType: 'connection',
        id: connection.id,
        name: connection.name,
        kind: connection.kind,
        from: connection.from,
        to: connection.to,
        via: connection.via,
        routeId: connection.routeId,
        areaIds: connection.areaIds,
        layerIds: connection.layerIds,
        dp: connection.dp,
        link: connection.link,
        notes: connection.notes,
        readings: connection.readings
      },
      geometry: {
        type: 'LineString',
        coordinates: path.map(([lon, lat]) => [lon, lat])
      }
    });
  }
  return {
    type: 'FeatureCollection',
    properties: {
      gisKind: KIND,
      name: site.name,
      description: site.description,
      category: site.category ?? '',
      center: site.center,
      zoom: site.zoom,
      basemap: site.basemap,
      groupZoom: site.groupZoom,
      // Routes and layers have no geometry of their own, so they travel as collection
      // metadata. Dropping them would turn a round-trip into a silent loss of every line
      // name, colour and tag.
      routes: site.routes,
      layers: site.layers
    },
    features
  };
}

/** Download a site as GeoJSON, for QGIS and friends. */
export function exportSiteGeoJson(site: Site): void {
  download(
    `gis-${slug(site.name)}.geojson`,
    JSON.stringify(siteToGeoJson(site), null, JSON_INDENT),
    'application/geo+json'
  );
}

// --- import ------------------------------------------------------------------

/** What an import produced, and which format it came from. */
export interface ImportResult {
  format: 'json' | 'geojson';
  sites: NormalizedSite[];
}

/**
 * Parse an imported file, sniffing the format from its content rather than its extension —
 * a `.json` holding a FeatureCollection is common, and so is a `.geojson` that a tool wrote
 * with the wrong suffix.
 *
 * `fallbackName` names a GeoJSON site that carries no name of its own (a layer exported
 * from a foreign tool); the file's own base name is the sensible thing to pass.
 *
 * Throws with a localised message when nothing usable is found — the caller shows it.
 */
export function parseImport(text: string, fallbackName: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('not-json');
  }
  const body =
    raw !== null && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : null;
  if (body?.['type'] === 'FeatureCollection') {
    return {
      format: 'geojson',
      sites: [geoJsonToSite(body as unknown as GeoCollection, fallbackName)]
    };
  }
  const sites = nativeSites(raw).map((site) =>
    normalizeSite(site, AREA_PALETTE)
  );
  const usable = sites.filter(
    ({ site }) => site.areas.length > 0 || site.assets.length > 0
  );
  if (usable.length === 0) throw new ImportError('no-site');
  return { format: 'json', sites: usable };
}

/** The site list inside a native file: the envelope, a bare array, or a single site. */
function nativeSites(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw === null || typeof raw !== 'object') return [];
  const body = raw as Record<string, unknown>;
  if (Array.isArray(body['sites'])) return body['sites'];
  // A single site object, which is what a hand-edited export usually ends up as.
  if ('assets' in body || 'areas' in body || 'name' in body) return [body];
  return [];
}

/**
 * Turn a FeatureCollection into a site.
 *
 * Features written by this module carry `gisType`; a foreign layer will not, so the
 * **geometry decides**: a polygon is an area and a point is an asset. That is what makes a
 * plain QGIS export importable without anyone having to prepare it first.
 */
export function geoJsonToSite(
  collection: GeoCollection,
  fallbackName: string
): NormalizedSite {
  const meta = collection.properties ?? {};
  const areas: Record<string, unknown>[] = [];
  const assets: Record<string, unknown>[] = [];
  const connections: Record<string, unknown>[] = [];
  for (const feature of collection.features ?? []) {
    const properties = feature?.properties ?? {};
    const geometry = feature?.geometry;
    if (!geometry) continue;
    if (geometry.type === 'Polygon') {
      const ring = geometry.coordinates?.[0] ?? [];
      // GeoJSON closes its rings by repeating the first point; ours do not.
      const open =
        ring.length > 1 && samepoint(ring[0], ring.at(-1))
          ? ring.slice(0, -1)
          : ring;
      areas.push({ ...properties, ring: open });
      continue;
    }
    if (geometry.type === 'Point') {
      const [lon, lat] = geometry.coordinates ?? [];
      assets.push({ ...properties, lat, lon });
      continue;
    }
    // A LineString is only a connection when it says which assets it joins. A foreign line
    // (a QGIS track with no `from`/`to`) has no topology to rebuild, and inventing one by
    // snapping to whatever marker is nearest would quietly wire up the wrong network — so
    // it is dropped, and the sanitiser's report says how many.
    if (geometry.type === 'LineString') {
      connections.push({ ...properties });
    }
  }
  return normalizeSite(
    {
      ...meta,
      name:
        typeof meta['name'] === 'string' && meta['name']
          ? meta['name']
          : fallbackName,
      areas,
      assets,
      connections
    },
    AREA_PALETTE
  );
}

function samepoint(a: number[] | undefined, b: number[] | undefined): boolean {
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1]);
}

/** The base name of an uploaded file, used to name a nameless GeoJSON layer. */
export function baseName(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, '')
      .replaceAll(/[_-]+/g, ' ')
      .trim() || 'Import'
  );
}
