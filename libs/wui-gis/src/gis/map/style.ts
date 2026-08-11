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
import { OSM_TILE_URL, type Area, type Basemap } from '../types.js';
import type { LayerSpecification, StyleSpecification } from './maplibre.js';

/** Source and layer ids owned by this page (a user's own style must not collide). */
export const AREA_SOURCE = 'wui-gis-areas';
export const AREA_FILL_LAYER = 'wui-gis-area-fill';
export const AREA_LINE_LAYER = 'wui-gis-area-line';
export const DRAFT_SOURCE = 'wui-gis-draft';
export const DRAFT_FILL_LAYER = 'wui-gis-draft-fill';
export const DRAFT_LINE_LAYER = 'wui-gis-draft-line';
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
