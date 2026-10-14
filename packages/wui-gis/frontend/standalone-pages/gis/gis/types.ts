// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domain model for the GIS page.
 *
 * A *site* is one geographic supervision scope: a basemap, a set of {@link Area}s
 * (districts, sectors, catchments — the intermediate drill-down level) and the
 * {@link Asset}s placed on it. Geometry is WGS 84 **degrees** (`lat` / `lon`), the
 * coordinate space MapLibre and OpenStreetMap already speak, so nothing has to be
 * projected on the way in or out.
 *
 * Live behaviour is NOT stored — only the *binding*. Each asset keeps the names of
 * the datapoint elements it reads ({@link Asset.dp} and its {@link Reading}s); the
 * values, and the alarm colour derived from the OA alert state, are resolved at
 * runtime by `./data/live.ts` and never persisted.
 *
 * Each site is persisted as one WinCC OA datapoint of type `GIS_Site` (a Struct
 * with String elements `name` + `json`) — see {@link ./data/gis-store.ts}.
 */

/** A geographic point, WGS 84 degrees. */
export interface LatLon {
  lat: number;
  lon: number;
}

// --- basemap -----------------------------------------------------------------

/**
 * Where the background map comes from.
 *
 * `none` matters as much as the others: an industrial site is often air-gapped, so
 * a deployment with no route to a tile server still has to render its assets and
 * areas — over a themed background instead of a map.
 */
export type BasemapKind = 'osm' | 'raster' | 'style' | 'none';

export const BASEMAP_KINDS: readonly BasemapKind[] = [
  'osm',
  'raster',
  'style',
  'none'
];

/**
 * OpenStreetMap's public tile service. Free of licence cost, but the OSMF tile
 * usage policy caps it at light/non-commercial traffic — a production or
 * multi-workstation deployment is expected to point `raster` at its own tile
 * server or `style` at its own vector style. See docs/wui-gis/NOTES.md.
 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
/** Zoom past which the OSM raster service serves nothing. */
export const OSM_MAX_ZOOM = 19;

export interface Basemap {
  kind: BasemapKind;
  /** `raster`: XYZ tile template, with the `{z}` / `{x}` / `{y}` placeholders. */
  url: string;
  /** `style`: URL of a full MapLibre style JSON (a vector basemap). */
  styleUrl: string;
  /** Credit line the tile licence requires; shown in the map corner. */
  attribution: string;
  /** Highest zoom the tile source actually serves (raster sources overzoom past it). */
  maxZoom: number;
}

/** The default basemap of a new site: OSM, credited, at its real zoom ceiling. */
export function defaultBasemap(): Basemap {
  return {
    kind: 'osm',
    url: '',
    styleUrl: '',
    attribution: OSM_ATTRIBUTION,
    maxZoom: OSM_MAX_ZOOM
  };
}

// --- assets ------------------------------------------------------------------

/**
 * What an asset is, which picks its map glyph. Deliberately a closed list: the
 * glyphs are drawn by the marker, and an unknown kind would have nothing to draw.
 * `generic` is the escape hatch.
 */
export type AssetKind =
  | 'generic'
  | 'pump'
  | 'tank'
  | 'valve'
  | 'meter'
  | 'sensor'
  | 'treatment'
  | 'well'
  | 'station'
  | 'cabinet'
  | 'light'
  | 'traffic'
  | 'air'
  | 'charger'
  | 'tunnel'
  | 'building';

export const ASSET_KINDS: readonly AssetKind[] = [
  'generic',
  'pump',
  'tank',
  'valve',
  'meter',
  'sensor',
  'treatment',
  'well',
  'station',
  'cabinet',
  'light',
  'traffic',
  'air',
  'charger',
  'tunnel',
  'building'
];

/** One live datapoint value shown on an asset. */
export interface Reading {
  /** Stable id, unique within the asset. */
  id: string;
  /** Datapoint element read live (e.g. `System1:Pump01.flow`). */
  dp: string;
  /** Short caption shown before the value (e.g. `Q`, `P`, `NO₂`). */
  label: string;
  /** Unit suffix appended after the value (e.g. `m³/h`, `bar`, `µg/m³`). */
  unit: string;
  /** Decimal places used when formatting a numeric value (0–6). */
  decimals: number;
  /**
   * Show this value in the marker's map label. Only a couple of readings fit
   * before the map turns into a wall of text, so it is opt-in per reading; the
   * inspector always shows them all.
   */
  onMap: boolean;
}

/** A geo-located, datapoint-bound asset. */
export interface Asset {
  /** Stable id, unique within the site. */
  id: string;
  /** Display name shown next to the marker (e.g. `Pompage Nord`, `PL-14`). */
  name: string;
  /** Which glyph the marker draws. */
  kind: AssetKind;
  lat: number;
  lon: number;
  /**
   * The {@link Area}s this asset belongs to; empty ⇒ none. An asset can sit in several —
   * a booster pump on a sector boundary belongs to both sectors, a shared cabinet feeds
   * two districts — and every one of them lists it and counts it in its roll-up.
   *
   * **Order matters for drawing.** `areaIds[0]` is the asset's *primary* area: the one
   * whose badge swallows the marker when areas collapse. A marker has to be drawn once, so
   * one area has to own it visually, and taking the first is the only choice the user can
   * see and reorder. See {@link primaryArea}.
   */
  areaIds: string[];
  /**
   * Information layers tagging this asset — free classification, unrelated to geography.
   * See {@link Layer}.
   */
  layerIds: string[];
  /**
   * The asset's *primary* datapoint element. Its `_alert_hdl` active-state colour
   * is what highlights the marker, and it is the scope handed to the Alarms page
   * on drill-down. Empty ⇒ the asset shows no state (a purely locational marker).
   */
  dp: string;
  /** Live values shown on the marker and in the inspector. */
  readings: Reading[];
  /**
   * Drill-down target — an in-app route opened for this asset, e.g.
   * `/fleet-3d/station-nord` (3D view), `/ampere/tgbt-a` (single-line process
   * view), `/mosaic/vue-pompage`, or any other page. Empty ⇒ only the built-in
   * Alarms drill-down is offered. See `DRILL_PRESETS` in `./drill.ts`.
   */
  link: string;
  /** Free-text note shown in the inspector. */
  notes: string;
}

// --- information layers ------------------------------------------------------

/**
 * An **information layer**: a free tag put on assets and connections, and switched on and
 off in the layer browser.
 *
 * Orthogonal to an {@link Area} on purpose. A zone is *geography* — a polygon, with assets
 * inside it, used for grouping and roll-ups. A layer is *classification* — "critical",
 * "phase 2", "public lighting", "to be renewed" — with no shape of its own and no
 * containment rule. Forcing one concept to do both jobs is how you end up with zones that
 * overlap for reasons that have nothing to do with the map.
 *
 * **Visibility is not stored here.** Which layers are shown is a property of *the person
 * looking*, not of the site, so it lives in the page for the session and every layer is
 * visible when a site opens. A stored default would be a second kind of truth about
 * visibility, and the first question would be whose default it is.
 */
export interface Layer {
  /** Stable id, unique within the site. */
  id: string;
  /** Display name — what the tag reads as (e.g. `Critique`, `Tranche 2`). */
  name: string;
  /** Colour of its chip and of the dot on a tagged marker, as `#rrggbb`. */
  color: string;
}

/**
 * Is this object drawn, given the layers currently switched off?
 *
 * An object carrying **no** layer is always drawn — it is untagged, not hidden, and hiding
 * everything untagged the moment one layer is switched off would make the browser unusable.
 * A tagged object survives while **at least one** of its layers is still on, which is the
 * useful reading for tags: something both `Critique` and `Tranche 2` stays visible while
 * either of those is being looked at.
 */
export function visibleUnderLayers(
  layerIds: readonly string[],
  hidden: ReadonlySet<string>
): boolean {
  if (layerIds.length === 0) return true;
  return layerIds.some((id) => !hidden.has(id));
}

/** The layers of this site named by these ids, in the site's own order. */
export function layersOf(site: Site, layerIds: readonly string[]): Layer[] {
  return site.layers.filter((layer) => layerIds.includes(layer.id));
}

/** How many assets and connections carry this layer. */
export function layerUsage(site: Site, layerId: string): number {
  const tagged = (ids: readonly string[]): boolean => ids.includes(layerId);
  return (
    site.assets.filter((asset) => tagged(asset.layerIds)).length +
    site.connections.filter((link) => tagged(link.layerIds)).length
  );
}

/** A blank layer. */
export function blankLayer(id: string, name: string, color: string): Layer {
  return { id, name, color };
}

// --- connections and routes --------------------------------------------------

/**
 * What a connection represents, which picks how the line is drawn (width, dashes) —
 * a closed list for the same reason {@link AssetKind} is one.
 */
export type ConnectionKind =
  'generic' | 'metro' | 'rail' | 'power' | 'cable' | 'pipe' | 'road';

export const CONNECTION_KINDS: readonly ConnectionKind[] = [
  'generic',
  'metro',
  'rail',
  'power',
  'cable',
  'pipe',
  'road'
];

/**
 * A **supervised link between two assets** — a metro segment, a feeder, a main, a road.
 *
 * It carries everything an {@link Asset} carries except a position: a primary datapoint
 * whose alert state colours it, live readings, a drill-down route, zone membership. A line
 * on this map is a supervised object, not decoration; that is the whole point of the
 * concept, because a feeder has a current and a track section has a status.
 *
 * **Its geometry is topology, not coordinates.** `from` and `to` name assets, so dragging a
 * substation drags every line attached to it. Storing endpoint coordinates instead would
 * desynchronise the network on the first edit, which is how this kind of feature ends up
 * switched off. `via` only *shapes* the line between those two ends.
 */
export interface Connection {
  /** Stable id, unique within the site. */
  id: string;
  /** Display name (e.g. `Gare → Centre`, `Départ HTA n°3`). */
  name: string;
  /** Which line style is drawn. */
  kind: ConnectionKind;
  /** Id of the {@link Asset} this starts at. A connection with no such asset is dropped. */
  from: string;
  /** Id of the {@link Asset} this ends at. */
  to: string;
  /**
   * Optional shaping vertices between the two ends, as `[lon, lat]` pairs (GeoJSON axis
   * order, like {@link Area.ring}). Empty ⇒ a straight line. This is what lets a track
   * follow its real alignment rather than a chord.
   */
  via: readonly (readonly [number, number])[];
  /** The {@link Route} this belongs to; empty ⇒ standalone. */
  routeId: string;
  /** Zones this connection belongs to — several, exactly as {@link Asset.areaIds}. */
  areaIds: string[];
  /** Information layers tagging this connection, exactly as {@link Asset.layerIds}. */
  layerIds: string[];
  /** Primary datapoint element: its alert colour paints the line. Same contract as an asset's. */
  dp: string;
  /** Live values, shown on hover and in the inspector. */
  readings: Reading[];
  /** Drill-down target (same contract as {@link Asset.link}). */
  link: string;
  /** Free-text note shown in the inspector. */
  notes: string;
}

/**
 * A named line made of {@link Connection}s — « Ligne 1 », « Départ HTA n°3 ».
 *
 * **It deliberately does not list its stops.** The order is derived by walking the
 * `from`/`to` chain of its connections ({@link routeOrder}); storing a stop list beside the
 * segments would be two versions of the same truth, and they diverge on the first insertion.
 * A branching line has no single order, and the derivation says so rather than inventing one.
 */
export interface Route {
  /** Stable id, unique within the site. */
  id: string;
  /** Display name (e.g. `Ligne 1`). */
  name: string;
  /** Colour of every connection on this line, as `#rrggbb`. */
  color: string;
  /** Default kind offered when drawing onto this line. */
  kind: ConnectionKind;
  /** Drill-down target for the line itself (same contract as {@link Asset.link}). */
  link: string;
}

// --- areas -------------------------------------------------------------------

/**
 * A geographic zone grouping assets: the middle step of the map → area → asset
 * drill-down. Selecting one zooms the map to it and narrows the asset list.
 */
export interface Area {
  /** Stable id, unique within the site. */
  id: string;
  /** Display name (e.g. `Secteur Nord`, `Quartier Gare`). */
  name: string;
  /**
   * Closed polygon ring as `[lon, lat]` pairs — GeoJSON axis order, so the ring
   * goes to MapLibre untouched. Fewer than 3 points ⇒ the area has no drawn
   * outline and is only a grouping label.
   */
  ring: readonly (readonly [number, number])[];
  /** Fill / outline colour as `#rrggbb`. */
  color: string;
  /** Drill-down target for the area itself (same contract as {@link Asset.link}). */
  link: string;
  /**
   * Zoom below which this area collapses into a single count badge.
   *
   * `0` = **automatic**: the area collapses once its own extent on screen is too small to
   * tell its assets apart. Automatic is right for almost every area, because the zoom at
   * which a district becomes a dot depends on how big the district is — a figure that
   * would have to be re-tuned per area if it were written down. Set a value to override.
   */
  groupZoom: number;
}

// --- site --------------------------------------------------------------------

export interface Site {
  /** Stable identifier (slug); the `/gis/:siteid` route param and the DP suffix. */
  id: string;
  /** Full backing DP name (e.g. `System1:GIS_x`); absent until persisted. */
  dp?: string;
  /** Display name. */
  name: string;
  /** Free-text description / notes. */
  description: string;
  /** Free-text grouping chip on the overview, also its sort key (e.g. `Eau`). */
  category?: string;
  /** Where the map opens when nothing is selected. */
  center: LatLon;
  /** Zoom the map opens at (MapLibre zoom levels). */
  zoom: number;
  basemap: Basemap;
  areas: Area[];
  assets: Asset[];
  /** Information layers: free tags on assets and connections, toggled in the browser. */
  layers: Layer[];
  /** Named lines grouping the connections below (« Ligne 1 »). */
  routes: Route[];
  /** Supervised links between assets — the network drawn over the map. */
  connections: Connection[];
  /**
   * Zoom below which the WHOLE site collapses into a single count badge — the outermost
   * step of the grouping hierarchy.
   *
   * `0` = **automatic**: the site collapses once it is too small on screen for its own
   * area badges to sit side by side. That is the honest trigger, because it depends on
   * both the site's extent and how many areas it has; see `map/cluster.ts`.
   */
  groupZoom: number;
  /** ISO-ish local timestamp of the last save (empty = never). */
  updatedAt: string;
}

/** Zoom used for a brand-new site — a whole town in view. */
export const DEFAULT_ZOOM = 12;

/** A blank site centred on nothing in particular (Paris), with the OSM basemap. */
export function blankSite(): Site {
  return {
    id: '',
    name: '',
    description: '',
    center: { lat: 48.8566, lon: 2.3522 },
    zoom: DEFAULT_ZOOM,
    basemap: defaultBasemap(),
    areas: [],
    assets: [],
    layers: [],
    routes: [],
    connections: [],
    groupZoom: AUTO_GROUP_ZOOM,
    updatedAt: ''
  };
}

/** `groupZoom` sentinel: work the collapse threshold out from the extent on screen. */
export const AUTO_GROUP_ZOOM = 0;

/**
 * Default colours for successive areas, so a new one is never invisible and an
 * AI-authored or imported site looks like a hand-authored one.
 *
 * Kept here, in the domain module, because three callers need it — the map's own "draw an
 * area", the AI sanitiser and the importer — and `types.ts` is the one file all three can
 * import without dragging in the UI or the i18n layer.
 */
export const AREA_PALETTE: readonly string[] = [
  '#1a9be0',
  '#00b0a0',
  '#7d5bbe',
  '#e26a1b',
  '#8ab63f',
  '#d4326e'
];

/** The palette colour for the n-th area, wrapping round. */
export function nextAreaColor(index: number): string {
  return AREA_PALETTE[index % AREA_PALETTE.length] as string;
}

/** A blank area with sensible defaults. */
export function blankArea(id: string, name: string, color: string): Area {
  return { id, name, ring: [], color, link: '', groupZoom: AUTO_GROUP_ZOOM };
}

/** A blank reading with sensible defaults. */
export function blankReading(): Reading {
  return { id: '', dp: '', label: '', unit: '', decimals: 1, onMap: false };
}

// --- geometry ----------------------------------------------------------------

/** A geographic bounding box, in the `[west, south, east, north]` MapLibre order. */
export type Bounds = readonly [number, number, number, number];

/** The WGS 84 domain. */
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;
/** Default slack around a fitted box, in degrees (~200 m) — see {@link boundsOf}. */
const DEFAULT_FIT_PAD = 0.002;

/** Clamp a value into [lo, hi]. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** True for a usable WGS 84 pair — guards demo data, imports and hand edits alike. */
export function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= MAX_LATITUDE &&
    Math.abs(lon) <= MAX_LONGITUDE
  );
}

/**
 * Bounding box of a set of points, grown by `pad` degrees so markers near the
 * edge are not clipped by their own icon. `null` when there is nothing to bound —
 * the caller then keeps the site's configured centre/zoom instead of fitting.
 */
export function boundsOf(
  points: readonly LatLon[],
  pad = DEFAULT_FIT_PAD
): Bounds | null {
  if (points.length === 0) return null;
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!isValidLatLon(point.lat, point.lon)) continue;
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  if (!Number.isFinite(west)) return null;
  return [west - pad, south - pad, east + pad, north + pad];
}

/** Bounding box of an area's ring (`null` when it has no drawn outline). */
export function areaBounds(area: Area): Bounds | null {
  return boundsOf(area.ring.map(([lon, lat]) => ({ lat, lon })));
}

/** Bounding box covering everything drawn for a site (its areas and its assets). */
export function siteBounds(site: Site): Bounds | null {
  const points: LatLon[] = site.assets.map((asset) => ({
    lat: asset.lat,
    lon: asset.lon
  }));
  for (const area of site.areas) {
    for (const [lon, lat] of area.ring) points.push({ lat, lon });
  }
  return boundsOf(points);
}

/**
 * The area that owns this asset **for drawing** — the first it belongs to, `''` when it
 * belongs to none. Grouping, and only grouping, uses this: a marker is drawn once, so one
 * area has to claim it.
 */
export function primaryArea(asset: Asset): string {
  return asset.areaIds[0] ?? '';
}

/** True when the asset belongs to this area, primary or not. */
export function inArea(asset: Asset, areaId: string): boolean {
  return asset.areaIds.includes(areaId);
}

/**
 * The assets of one area — every asset that lists it, not only those it owns for drawing.
 * `''` selects the ones belonging to no area at all.
 */
export function assetsOfArea(site: Site, areaId: string): Asset[] {
  if (!areaId) return site.assets.filter((asset) => asset.areaIds.length === 0);
  return site.assets.filter((asset) => inArea(asset, areaId));
}

// --- connection queries ------------------------------------------------------

/** One asset by id, or `null`. */
export function assetById(site: Site, id: string): Asset | null {
  return site.assets.find((asset) => asset.id === id) ?? null;
}

/** One route by id, or `null`. */
export function routeById(site: Site, id: string): Route | null {
  return site.routes.find((route) => route.id === id) ?? null;
}

/**
 * The drawable path of a connection: its start asset, its shaping vertices, its end asset,
 * as `[lon, lat]` pairs. `null` when either end no longer resolves to an asset — the caller
 * then draws nothing rather than a line to (0, 0).
 *
 * Resolved on every read instead of stored, which is what makes a dragged asset take its
 * lines with it for free.
 */
export function connectionPath(
  site: Site,
  connection: Connection
): [number, number][] | null {
  const start = assetById(site, connection.from);
  const end = assetById(site, connection.to);
  if (!start || !end) return null;
  if (!isValidLatLon(start.lat, start.lon)) return null;
  if (!isValidLatLon(end.lat, end.lon)) return null;
  return [
    [start.lon, start.lat],
    ...connection.via.map(([lon, lat]) => [lon, lat] as [number, number]),
    [end.lon, end.lat]
  ];
}

/** Every connection touching this asset — what has to go when the asset does. */
export function connectionsOfAsset(site: Site, assetId: string): Connection[] {
  return site.connections.filter(
    (connection) => connection.from === assetId || connection.to === assetId
  );
}

/** The connections of one route, in declaration order. `''` selects the standalone ones. */
export function connectionsOfRoute(site: Site, routeId: string): Connection[] {
  if (!routeId)
    return site.connections.filter((connection) => connection.routeId === '');
  return site.connections.filter(
    (connection) => connection.routeId === routeId
  );
}

/** The colour a connection is drawn in: its route's, else the neutral default. */
export function connectionColor(site: Site, connection: Connection): string {
  return routeById(site, connection.routeId)?.color ?? DEFAULT_LINE_COLOR;
}

/** Colour of a connection belonging to no route. */
export const DEFAULT_LINE_COLOR = '#8a93a6';

/**
 * The asset ids of a route in travel order, or `null` when its connections do not form one
 * simple path — a Y-shaped feeder, a gap, a loop.
 *
 * Derived rather than stored: a stored stop list is a second version of the same truth and
 * diverges the first time a segment is inserted. Returning `null` is the honest answer for a
 * branching line, so the UI can list its segments instead of showing an invented sequence.
 */
export function routeOrder(site: Site, routeId: string): string[] | null {
  const segments = connectionsOfRoute(site, routeId);
  if (segments.length === 0) return null;
  const neighbours = new Map<string, string[]>();
  for (const segment of segments) {
    if (segment.from === segment.to) return null;
    neighbours.set(segment.from, [
      ...(neighbours.get(segment.from) ?? []),
      segment.to
    ]);
    neighbours.set(segment.to, [
      ...(neighbours.get(segment.to) ?? []),
      segment.from
    ]);
  }
  // A simple path has exactly two ends (one neighbour each); anything else branches or loops.
  const ends = [...neighbours].filter(([, next]) => next.length === 1);
  if (ends.length !== 2) return null;
  if ([...neighbours].some(([, next]) => next.length > 2)) return null;

  const order: string[] = [(ends[0] as [string, string[]])[0]];
  const seen = new Set(order);
  while (order.length <= segments.length) {
    const current = order.at(-1) as string;
    const next = (neighbours.get(current) ?? []).find((id) => !seen.has(id));
    if (next === undefined) break;
    order.push(next);
    seen.add(next);
  }
  // Every segment walked exactly once ⇒ one connected path, not two disjoint runs.
  return order.length === segments.length + 1 ? order : null;
}

/** A connection with nothing filled in but its ends — what the draw tool produces. */
export function blankConnection(
  id: string,
  from: string,
  to: string,
  kind: ConnectionKind,
  routeId: string
): Connection {
  return {
    id,
    name: '',
    kind,
    from,
    to,
    via: [],
    routeId,
    areaIds: [],
    layerIds: [],
    dp: '',
    readings: [],
    link: '',
    notes: ''
  };
}

/** A blank named line. */
export function blankRoute(
  id: string,
  name: string,
  color: string,
  kind: ConnectionKind
): Route {
  return { id, name, color, kind, link: '' };
}

/**
 * Ray-casting point-in-ring test, used to assign a dropped asset to the area it
 * landed in. Degrees are treated as a plane: over a district-sized ring the
 * error is far below the size of a marker.
 */
export function ringContains(
  ring: readonly (readonly [number, number])[],
  lat: number,
  lon: number
): boolean {
  const MIN_RING = 3;
  if (ring.length < MIN_RING) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as readonly [number, number];
    const [xj, yj] = ring[j] as readonly [number, number];
    const straddles = yi > lat !== yj > lat;
    if (straddles && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** The area a point falls in, `''` when it falls in none (first match wins). */
export function areaAt(site: Site, lat: number, lon: number): string {
  return site.areas.find((area) => ringContains(area.ring, lat, lon))?.id ?? '';
}

/**
 * **Every** area whose ring contains this point, in the site's own area order.
 *
 * Used when an asset is dropped or dragged: overlapping sectors are legitimate, so a point
 * inside two of them joins both rather than silently picking whichever happened to be
 * declared first.
 */
export function areasAt(site: Site, lat: number, lon: number): string[] {
  return site.areas
    .filter((area) => ringContains(area.ring, lat, lon))
    .map((area) => area.id);
}
