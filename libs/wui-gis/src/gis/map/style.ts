// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The MapLibre style the GIS page draws on, and the GeoJSON it feeds its overlays.
 *
 * **No symbol (text) layers, on purpose.** A MapLibre symbol layer needs a `glyphs`
 * font endpoint, which would make every label depend on reaching a font server —
 * unacceptable for the offline basemap this page has to support. So every piece of
 * text on the map (asset names, values, area names) is an HTML marker instead, and
 * the GL layers only draw geometry: a background, the raster basemap, and the area
 * fills and outlines. Those need no glyphs at all.
 */
import {
  OSM_TILE_URL,
  connectionPath,
  visibleUnderLayers,
  type Area,
  type Basemap,
  type Connection,
  type Site
} from '../types.js';
import type { LayerSpecification, StyleSpecification } from './maplibre.js';

/** Source and layer ids owned by this page (a user's own style must not collide). */
export const AREA_SOURCE = 'wui-gis-areas';
export const AREA_FILL_LAYER = 'wui-gis-area-fill';
export const AREA_LINE_LAYER = 'wui-gis-area-line';
export const DRAFT_SOURCE = 'wui-gis-draft';
export const DRAFT_FILL_LAYER = 'wui-gis-draft-fill';
export const DRAFT_LINE_LAYER = 'wui-gis-draft-line';
export const LINK_SOURCE = 'wui-gis-links';
export const LINK_HIT_LAYER = 'wui-gis-link-hit';
export const LINK_LINE_LAYER = 'wui-gis-link-line';
export const LINK_CASING_LAYER = 'wui-gis-link-casing';
export const LINK_DRAFT_SOURCE = 'wui-gis-link-draft';
export const LINK_DRAFT_LAYER = 'wui-gis-link-draft-line';
const BASEMAP_SOURCE = 'wui-gis-basemap';
const BACKGROUND_LAYER = 'wui-gis-background';

/** Standard raster tile edge, in pixels. */
const TILE_SIZE = 256;

/** Opacity of an area's fill, unselected then selected. */
const AREA_FILL_OPACITY = 0.16;
const AREA_FILL_OPACITY_SELECTED = 0.34;
/** Outline width of an area, unselected then selected. */
const AREA_LINE_WIDTH = 1.5;
const AREA_LINE_WIDTH_SELECTED = 3;
/** The ring being drawn is neutral white — it belongs to no area yet. */
const DRAFT_COLOR = '#ffffff';
const DRAFT_FILL_OPACITY = 0.2;
const DRAFT_LINE_WIDTH = 2;
/** Dash pattern marking the ring as provisional: dash length, then gap length. */
const DRAFT_DASH_ON = 2;
const DRAFT_DASH_OFF = 1;
const DRAFT_DASH: [number, number] = [DRAFT_DASH_ON, DRAFT_DASH_OFF];

/**
 * Connection line widths, by role.
 *
 * `HIT` is an invisible fat line under the visible one: a 3 px track is nearly impossible to
 * click, and MapLibre hit-tests the rendered geometry, so the clickable target has to exist
 * as its own wide, fully transparent layer.
 *
 * `CASING` is the dark halo under the line, which is what keeps a coloured route legible
 * over a busy raster basemap — the same trick every transit map uses.
 */
const LINK_WIDTH = 3.5;
const LINK_WIDTH_SELECTED = 6;
const LINK_CASING_EXTRA = 3;
const LINK_HIT_WIDTH = 18;
const LINK_CASING_COLOR = '#101319';
const LINK_CASING_OPACITY = 0.55;
/** Dash patterns per kind: a cable is buried, a pipe is continuous, a rail is ticked. */
const LINK_DASH_CABLE: [number, number] = [2, 1.5];
const LINK_DASH_RAIL: [number, number] = [3, 1];

/** A polygon needs three corners before it encloses anything. */
export const MIN_RING = 3;

/**
 * The tile URL a basemap actually fetches: the OSM service for `osm`, the user's
 * own template for `raster`, nothing for the other kinds.
 */
export function tileUrl(basemap: Basemap): string {
  if (basemap.kind === 'osm') return OSM_TILE_URL;
  return basemap.kind === 'raster' ? basemap.url.trim() : '';
}

/**
 * The style for a site's basemap.
 *
 * Returns the URL *string* for a user-supplied vector style — MapLibre fetches and
 * validates it itself, and its own sources/layers/glyphs then apply. Every other
 * kind is built here, so an offline deployment needs no network at all.
 */
export function buildStyle(
  basemap: Basemap,
  backgroundColor: string
): StyleSpecification | string {
  if (basemap.kind === 'style') {
    const url = basemap.styleUrl.trim();
    if (url) return url;
  }
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [
      {
        id: BACKGROUND_LAYER,
        type: 'background',
        paint: { 'background-color': backgroundColor }
      }
    ]
  };
  const tiles = tileUrl(basemap);
  if (tiles) {
    style.sources[BASEMAP_SOURCE] = {
      type: 'raster',
      tiles: [tiles],
      tileSize: TILE_SIZE,
      // MapLibre renders this in its attribution control — it is how the tile
      // licence's credit requirement is actually met.
      attribution: basemap.attribution,
      maxzoom: basemap.maxZoom
    };
    style.layers.push({
      id: BASEMAP_SOURCE,
      type: 'raster',
      source: BASEMAP_SOURCE
    });
  }
  return style;
}

/** True when the two basemaps would produce different styles (⇒ `setStyle`). */
export function styleChanged(
  a: Basemap | undefined,
  b: Basemap | undefined
): boolean {
  if (!a || !b) return a !== b;
  return (
    a.kind !== b.kind ||
    a.url !== b.url ||
    a.styleUrl !== b.styleUrl ||
    a.maxZoom !== b.maxZoom ||
    a.attribution !== b.attribution
  );
}

// --- overlays ----------------------------------------------------------------

/** A GeoJSON polygon feature carrying what the paint expressions read. */
interface AreaFeature {
  type: 'Feature';
  id: number;
  properties: { areaId: string; color: string; selected: boolean };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

export interface AreaCollection {
  type: 'FeatureCollection';
  features: AreaFeature[];
}

/** The initial, empty content of a GeoJSON source (before the first sync). */
export const EMPTY_COLLECTION: AreaCollection = {
  type: 'FeatureCollection',
  features: []
};

/**
 * The areas as GeoJSON. Rings are stored in `[lon, lat]` order — GeoJSON's own
 * axis order — so they pass straight through, closed back onto their first point
 * as the spec requires.
 */
export function areaCollection(
  areas: readonly Area[],
  selectedId: string
): AreaCollection {
  const features: AreaFeature[] = [];
  for (const [index, area] of areas.entries()) {
    if (area.ring.length < MIN_RING) continue;
    const ring = area.ring.map(([lon, lat]) => [lon, lat]);
    const first = ring[0] as number[];
    ring.push([first[0] as number, first[1] as number]);
    features.push({
      type: 'Feature',
      id: index,
      properties: {
        areaId: area.id,
        color: area.color,
        selected: area.id === selectedId
      },
      geometry: { type: 'Polygon', coordinates: [ring] }
    });
  }
  return { type: 'FeatureCollection', features };
}

/** The ring being drawn: a polygon once it encloses something, else a line. */
export function draftCollection(
  points: readonly (readonly [number, number])[]
): AreaCollection {
  if (points.length < MIN_RING) {
    return { type: 'FeatureCollection', features: [] };
  }
  const ring = points.map(([lon, lat]) => [lon, lat]);
  const first = ring[0] as number[];
  ring.push([first[0] as number, first[1] as number]);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 0,
        properties: { areaId: '', color: '#ffffff', selected: true },
        geometry: { type: 'Polygon', coordinates: [ring] }
      }
    ]
  };
}

/**
 * The line being drawn, as an **open** dashed path — the connection counterpart of
 * {@link draftCollection}, which closes its points into a ring.
 *
 * A separate function rather than a flag on that one: a ring and a path are different
 * geometries with different rules (a ring needs three points and repeats the first, a path
 * needs two and must not), and one function pretending to do both reads worse than two.
 */
export function pathDraftCollection(
  points: readonly (readonly [number, number])[]
): LinkCollection {
  const MIN_PATH = 2;
  if (points.length < MIN_PATH) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 0,
        properties: {
          linkId: '',
          kind: 'draft',
          color: DRAFT_COLOR,
          selected: true
        },
        geometry: {
          type: 'LineString',
          coordinates: points.map(([lon, lat]) => [lon, lat])
        }
      }
    ]
  };
}

/**
 * The area fill and outline layers. Both read their colour from the feature and
 * their emphasis from its `selected` flag, so selecting an area is a `setData` on
 * the source rather than a layer rebuild.
 */
export function areaLayers(): LayerSpecification[] {
  return [
    {
      id: AREA_FILL_LAYER,
      type: 'fill',
      source: AREA_SOURCE,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': [
          'case',
          ['boolean', ['get', 'selected'], false],
          AREA_FILL_OPACITY_SELECTED,
          AREA_FILL_OPACITY
        ]
      }
    },
    {
      id: AREA_LINE_LAYER,
      type: 'line',
      source: AREA_SOURCE,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': [
          'case',
          ['boolean', ['get', 'selected'], false],
          AREA_LINE_WIDTH_SELECTED,
          AREA_LINE_WIDTH
        ]
      }
    }
  ];
}

/**
 * The connection layers: an invisible fat hit line, a dark casing, then the coloured line.
 *
 * Three layers rather than one, and the order matters — casing under line so the halo reads
 * as a halo, hit line under both so it never paints over anything. They sit **below** the
 * area outlines in `addOverlayLayers`, and markers are HTML so they are above everything by
 * construction.
 *
 * No glyphs are involved, so an offline basemap still draws the whole network.
 */
export function linkLayers(): LayerSpecification[] {
  const width: LayerSpecification['paint'] = {
    'line-width': [
      'case',
      ['boolean', ['get', 'selected'], false],
      LINK_WIDTH_SELECTED,
      LINK_WIDTH
    ]
  };
  return [
    {
      id: LINK_HIT_LAYER,
      type: 'line',
      source: LINK_SOURCE,
      paint: {
        'line-color': LINK_CASING_COLOR,
        'line-opacity': 0,
        'line-width': LINK_HIT_WIDTH
      }
    },
    {
      id: LINK_CASING_LAYER,
      type: 'line',
      source: LINK_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': LINK_CASING_COLOR,
        'line-opacity': LINK_CASING_OPACITY,
        'line-width': [
          'case',
          ['boolean', ['get', 'selected'], false],
          LINK_WIDTH_SELECTED + LINK_CASING_EXTRA,
          LINK_WIDTH + LINK_CASING_EXTRA
        ]
      }
    },
    {
      id: LINK_LINE_LAYER,
      type: 'line',
      source: LINK_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        ...width,
        // Dashes come from the kind, so a buried cable and a surface main read differently.
        'line-dasharray': [
          'case',
          ['==', ['get', 'kind'], 'cable'],
          ['literal', LINK_DASH_CABLE],
          ['==', ['get', 'kind'], 'rail'],
          ['literal', LINK_DASH_RAIL],
          ['==', ['get', 'kind'], 'metro'],
          ['literal', LINK_DASH_RAIL],
          ['literal', [1, 0]]
        ]
      }
    },
    // The line being drawn, dashed and neutral white: it belongs to no route yet, exactly
    // as the ring being drawn belongs to no area yet.
    {
      id: LINK_DRAFT_LAYER,
      type: 'line',
      source: LINK_DRAFT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': DRAFT_COLOR,
        'line-width': LINK_WIDTH_SELECTED,
        'line-dasharray': ['literal', DRAFT_DASH]
      }
    }
  ];
}

/**
 * Is this datapoint in alarm, given the colour a live snapshot holds for it?
 *
 * The snapshot holds **`''` for a datapoint that RESOLVED and has no active alert** (that is
 * what `oaColorToCss` returns for an empty `_act_state_color`), and no entry at all for one
 * that could not be followed. Both mean "not in alarm", so the test has to be truthiness:
 * `!== undefined` reads every quiet datapoint as an alarm, which turned every zone badge into
 * a red count of all its assets as soon as the bindings pointed at datapoints that exist.
 */
export function inAlarm(alarmColor: string | undefined): boolean {
  return Boolean(alarmColor);
}

/**
 * The colour to paint: the active alert colour when there IS one, else the fallback.
 *
 * `??` is wrong here for the same reason, and worse: `''` survives it, reaches MapLibre as the
 * value of `line-color`, is not a colour — and the line is then **not drawn at all**. The trap
 * only springs once a binding points at a datapoint that exists, so a site drawn without
 * bindings looks perfect and the very same site bound to real datapoints loses its whole
 * network. Hence one named function, used by every caller, rather than an operator per site.
 */
export function alarmColorOr(
  alarmColor: string | undefined,
  fallback: string
): string {
  return alarmColor || fallback;
}

/** One `LineString` per connection whose two ends still resolve to assets. */
export function linkCollection(
  site: Site | null,
  selectedId: string,
  hiddenLayers: ReadonlySet<string>,
  colorOf: (connection: Connection) => string
): LinkCollection {
  const features: LinkFeature[] = [];
  for (const [index, connection] of (site?.connections ?? []).entries()) {
    if (!visibleUnderLayers(connection.layerIds, hiddenLayers)) continue;
    const path = site ? connectionPath(site, connection) : null;
    if (!path) continue;
    features.push({
      type: 'Feature',
      id: index,
      properties: {
        linkId: connection.id,
        kind: connection.kind,
        color: colorOf(connection),
        selected: connection.id === selectedId
      },
      geometry: {
        type: 'LineString',
        coordinates: path.map(([lon, lat]) => [lon, lat])
      }
    });
  }
  return { type: 'FeatureCollection', features };
}

export interface LinkFeature {
  type: 'Feature';
  id: number;
  properties: {
    linkId: string;
    kind: string;
    color: string;
    selected: boolean;
  };
  geometry: { type: 'LineString'; coordinates: number[][] };
}

export interface LinkCollection {
  type: 'FeatureCollection';
  features: LinkFeature[];
}

/** The initial, empty content of the connection source. */
export const EMPTY_LINKS: LinkCollection = {
  type: 'FeatureCollection',
  features: []
};

/** The dashed outline of the ring being drawn, over a faint fill. */
export function draftLayers(): LayerSpecification[] {
  return [
    {
      id: DRAFT_FILL_LAYER,
      type: 'fill',
      source: DRAFT_SOURCE,
      paint: { 'fill-color': DRAFT_COLOR, 'fill-opacity': DRAFT_FILL_OPACITY }
    },
    {
      id: DRAFT_LINE_LAYER,
      type: 'line',
      source: DRAFT_SOURCE,
      paint: {
        'line-color': DRAFT_COLOR,
        'line-width': DRAFT_LINE_WIDTH,
        'line-dasharray': DRAFT_DASH
      }
    }
  ];
}

/** Centroid of a ring — where its HTML name label is anchored. */
export function ringCentroid(
  ring: readonly (readonly [number, number])[]
): { lat: number; lon: number } | null {
  if (ring.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return { lon: lon / ring.length, lat: lat / ring.length };
}
