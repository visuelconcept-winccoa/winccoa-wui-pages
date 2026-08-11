// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Decluttering the map: zoomed out, marker discs overlap into an unreadable pile, so
 * the quiet assets are grouped into count badges and only the ones **in alarm** stay
 * drawn individually.
 *
 * Two decisions make this behave predictably.
 *
 * **The grid is anchored in Web Mercator world pixels, not in screen space.** A
 * screen-space grid re-buckets every asset as soon as the map is panned, so badges
 * would jump and their counts flicker while the operator drags. World-pixel cells are
 * fixed to the projection: panning cannot change which cell an asset falls in, and only
 * a zoom change re-groups anything.
 *
 * **There is no "altitude threshold" constant.** The cell is a fixed number of *pixels*,
 * so its geographic size shrinks as the map zooms in until every asset sits alone in its
 * own cell and is therefore drawn individually. Clustering switches itself off by
 * arithmetic instead of by a magic zoom number that would be wrong for a dense city
 * district and for a spread-out water network at the same time.
 */
import {
  areaBounds,
  boundsOf,
  siteBounds,
  type Area,
  type Asset,
  type Bounds,
  type Site
} from '../types.js';

/**
 * Cell size in world pixels.
 *
 * Sized against the count badge (56 px, twice the asset disc), not against the disc:
 * a badge is anchored at its members' mean position rather than at the cell centre, so
 * it can sit near an edge, and the cell has to leave enough room that two neighbouring
 * badges still cannot touch. It also stays comfortably larger than a 28 px disc, so two
 * assets sharing a cell genuinely would have overlapped.
 */
const CELL_PX = 80;
/** Web Mercator tile size, in pixels — the unit MapLibre's zoom levels are built on. */
const TILE_PX = 512;
/** A cell holding one asset is not a cluster; it is just that asset. */
const MIN_CLUSTER = 2;
/** A polygon needs three corners before it has a centroid worth anchoring a badge to. */
const MIN_RING = 3;
/**
 * How far, in world pixels, the nearest other asset must be before a disc counts as
 * "seen on its own" and earns its name plate. The disc is 28 px across plus a 2 px
 * border and, in alarm, a 4 px halo — so anything closer than this is visibly touching
 * it, which is exactly when its label must not be drawn.
 *
 * Measured as a real distance rather than read off the cluster grid: two assets 37 px
 * apart can fall either side of a cell boundary, and a grid answer would have labelled
 * both of them while their discs overlap on screen.
 */
const LABEL_CLEAR_PX = 40;

/**
 * Automatic collapse thresholds.
 *
 * An **area** needs room for its own assets: `members × ASSET_SLOT_PX`, floored at
 * {@link AREA_AUTO_MIN_PX}. Below that its discs cannot be told apart and one badge says
 * more than the pile. Scaling with the asset count is what makes it right for a dense
 * district and for a two-asset sector at the same time.
 *
 * The **site** threshold is then derived FROM the area ones rather than chosen
 * independently: it collapses {@link SITE_SEPARATION_ZOOM} zoom levels below the point
 * where its areas have all collapsed. Independent thresholds do not work — with three
 * areas tiling a site, each area spans about 0.6 of the site, and any fixed pair of pixel
 * thresholds puts both collapses inside the same integer zoom step, so the area rung is
 * never actually seen. Deriving one from the other guarantees a band at least one whole
 * zoom level wide in which areas are grouped and the site is not.
 *
 * `SITE_BADGE_SLOT_PX` is the backstop: however that derivation lands, the site must
 * collapse before its own area badges would overlap each other.
 */
const ASSET_SLOT_PX = 44;
const AREA_AUTO_MIN_PX = 120;
const SITE_SEPARATION_ZOOM = 1.5;
const SITE_BADGE_SLOT_PX = 80;
const SITE_AUTO_MIN_PX = 200;
/**
 * Collapse decisions measure a RAW extent.
 *
 * `boundsOf` pads by default because its other caller is `fitBounds`, which wants slack so
 * an edge marker is not clipped. That slack is ~200 m, which for a district-sized area is a
 * large fraction of its width — it made small areas measure bigger than they are and so
 * collapse a whole zoom level later than they should, leaving their assets to the flat grid.
 */
const NO_PAD = 0;

/** What a count badge stands for — the three rungs of the hierarchy. */
export type ClusterKind = 'cell' | 'area' | 'site';

/** A group of assets, drawn as one count badge. */
export interface Cluster {
  /** Stable id (grid cell, `area:<id>`, or `site`). Keeps markers reused across zooms. */
  id: string;
  kind: ClusterKind;
  /** Area or site name, shown in the badge's tooltip; `''` for a grid cell. */
  label: string;
  /** The area's colour, so an area badge reads as that area; `''` otherwise. */
  color: string;
  /** Where the badge is anchored. */
  lat: number;
  lon: number;
  /** The assets this badge stands for. */
  assets: readonly Asset[];
  /**
   * How many of them are in alarm. Non-zero only on the **site** badge: at every finer
   * rung the alarms escape grouping and are drawn individually, but a fully collapsed
   * site is a dot on which individual markers would be indistinguishable — so there the
   * badge carries the alarm count instead, which is the synthesis an operator wants at
   * that altitude.
   */
  alarms: number;
}

/** One asset drawn as its own marker, and whether it has room for its name plate. */
export interface Single {
  asset: Asset;
  /**
   * True when this asset is the ONLY thing in its grid cell — i.e. its circle really is
   * seen on its own. The name-and-values plate is shown only then: a plate next to a
   * disc that is already touching its neighbours is what turns a busy map into
   * unreadable overlapping text.
   */
  labelled: boolean;
}

/** What the map should draw: some assets individually, the rest as badges. */
export interface Declutter {
  /** Assets to draw as normal markers (every alarm, plus every lone asset). */
  singles: readonly Single[];
  /** Groups to draw as count badges. */
  clusters: readonly Cluster[];
}

/* eslint-disable @typescript-eslint/no-magic-numbers --
   The numbers below are the Web Mercator projection itself (180°, 360°, π/4, the
   2^zoom tile pyramid). Naming them would hide a standard formula behind aliases. */

/**
 * Web Mercator x/y in the 0..1 unit square.
 *
 * Latitude is clamped just inside the poles, where the projection diverges — an asset
 * at ±90° would otherwise produce a non-finite cell index and vanish from the map. The
 * *result* is clamped too: at exactly the Mercator limit the logarithm lands a hair
 * either side of 0, which would otherwise yield a negative cell index for a legitimate
 * position.
 */
export function mercator(lat: number, lon: number): { x: number; y: number } {
  const LIMIT = 85.051_129;
  const clamped = Math.min(Math.max(lat, -LIMIT), LIMIT);
  const radians = (clamped * Math.PI) / 180;
  const HALF = 0.5;
  return {
    x: unit((lon + 180) / 360),
    y: unit(
      HALF - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI)
    )
  };
}

/** Clamp into the unit square, just short of 1 so the far edge stays in-grid. */
function unit(value: number): number {
  const ALMOST_ONE = 0.999_999_999;
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), ALMOST_ONE);
}

/** The grid cell an asset falls in at a given zoom — the cluster's identity. */
export function cellOf(asset: Asset, zoom: number): string {
  const world = TILE_PX * 2 ** zoom;
  const { x, y } = mercator(asset.lat, asset.lon);
  const column = Math.floor((x * world) / CELL_PX);
  const row = Math.floor((y * world) / CELL_PX);
  return `${zoom}/${column}/${row}`;
}

/* eslint-enable @typescript-eslint/no-magic-numbers */

/**
 * Split the assets into what to draw individually and what to summarise.
 *
 * `inAlarm` decides which assets are never grouped: an alarm the operator cannot see
 * because it was folded into a badge would be the one failure this whole feature must
 * not introduce. Everything else groups by cell, and a cell holding a single asset is
 * handed back as a single.
 *
 * `zoom` is floored, so a cluster keeps its identity (and its DOM marker) through the
 * fractional zoom of a pinch or a scroll.
 */
export function declutterAssets(
  assets: readonly Asset[],
  zoom: number,
  inAlarm: (asset: Asset) => boolean,
  options: { group?: boolean } = {}
): Declutter {
  const group = options.group ?? true;
  const level = Math.floor(zoom);
  // Whether a disc is visually alone depends on ALL its neighbours on screen, not on
  // which of them happened to be grouped — so the spacing index covers every asset.
  const alone = buildLabelIndex(assets, level);

  // Grouping off: every asset is its own marker, but the label rule still applies —
  // crowded discs stay unlabelled whether or not their neighbours were collapsed.
  if (!group) {
    return {
      singles: assets.map((asset) => ({ asset, labelled: alone(asset) })),
      clusters: []
    };
  }

  const singles: Single[] = [];
  const quiet = new Map<string, Asset[]>();
  for (const asset of assets) {
    if (inAlarm(asset)) {
      singles.push({ asset, labelled: alone(asset) });
      continue;
    }
    const cell = cellOf(asset, level);
    const bucket = quiet.get(cell);
    if (bucket) bucket.push(asset);
    else quiet.set(cell, [asset]);
  }
  const clusters: Cluster[] = [];
  for (const [id, members] of quiet) {
    if (members.length < MIN_CLUSTER) {
      for (const asset of members)
        singles.push({ asset, labelled: alone(asset) });
      continue;
    }
    clusters.push({
      id,
      kind: 'cell',
      label: '',
      color: '',
      ...meanPosition(members),
      assets: members,
      alarms: 0
    });
  }
  return { singles, clusters };
}

// --- the hierarchy -----------------------------------------------------------

/** Which rung the map is currently drawing. */
export type GroupLevel = 'site' | 'area' | 'asset';

/** Everything the map needs to draw one frame of the hierarchy. */
export interface Grouping {
  level: GroupLevel;
  singles: readonly Single[];
  clusters: readonly Cluster[];
  /**
   * Ids of the areas whose NAME LABEL should be drawn. An area folded into a badge loses
   * its label — the badge already names it in its tooltip, and leaving the label behind
   * would put text on top of the very badge that replaced it.
   */
  labelledAreas: ReadonlySet<string>;
}

/**
 * Extent of a bounding box in the Mercator unit square: the larger of its two sides.
 * Multiplying by `TILE_PX * 2**zoom` turns it into world pixels.
 */
function unitSpan(bounds: Bounds): number {
  const [west, south, east, north] = bounds;
  const topLeft = mercator(north, west);
  const bottomRight = mercator(south, east);
  return Math.max(
    Math.abs(bottomRight.x - topLeft.x),
    Math.abs(bottomRight.y - topLeft.y)
  );
}

/**
 * The (fractional) zoom at which a box of this span is exactly `neededPx` wide. Below it
 * the box is smaller than that, which is what every automatic collapse test asks.
 *
 * Returned as a zoom rather than compared as pixels so the two rungs can be held a fixed
 * number of zoom levels apart — see {@link SITE_SEPARATION_ZOOM}.
 */
function collapseZoom(span: number, neededPx: number): number {
  if (span <= 0) return Number.NEGATIVE_INFINITY;
  return Math.log2(neededPx / (span * TILE_PX));
}

/**
 * Group a site for display: assets, then areas, then the whole site.
 *
 * Read outwards from the finest rung:
 *
 * 1. **asset** — every asset individually, with the flat grid decluttering nearby discs.
 * 2. **area** — an area whose own extent has become too small collapses into one badge
 *    carrying its asset count; its alarms still escape as individual markers, and its
 *    name label is dropped. Areas are independent, so a small district can be collapsed
 *    while a large one beside it is not.
 * 3. **site** — the whole site becomes one badge, alarm count included.
 *
 * Assets belonging to no area are never area-grouped (there is nothing to group them by);
 * they stay on the flat grid, which is also the whole behaviour of a site with no areas.
 */
export function groupSite(
  site: Site | null,
  assets: readonly Asset[],
  zoom: number,
  inAlarm: (asset: Asset) => boolean,
  options: { group?: boolean } = {}
): Grouping {
  const group = options.group ?? true;
  const areas = site?.areas ?? [];
  const allAreaIds = new Set(areas.map((area) => area.id));

  if (!group || assets.length === 0) {
    const flat = declutterAssets(assets, zoom, inAlarm, { group });
    return { level: 'asset', ...flat, labelledAreas: allAreaIds };
  }

  // --- rung 3: the whole site ------------------------------------------------
  if (site && siteCollapsed(site, assets, zoom)) {
    const alarms = assets.filter((asset) => inAlarm(asset)).length;
    return {
      level: 'site',
      singles: [],
      clusters: [
        {
          id: 'site',
          kind: 'site',
          label: site.name,
          color: '',
          ...meanPosition(assets),
          assets,
          alarms
        }
      ],
      labelledAreas: new Set()
    };
  }

  // --- rung 2: per area ------------------------------------------------------
  const byArea = site ? groupByArea(site, assets) : new Map<string, Asset[]>();
  const loose = assets.filter(
    (asset) => !asset.areaId || !allAreaIds.has(asset.areaId)
  );

  const clusters: Cluster[] = [];
  const singles: Single[] = [];
  const labelledAreas = new Set(allAreaIds);
  const ungrouped: Asset[] = [...loose];

  for (const area of areas) {
    const members = byArea.get(area.id) ?? [];
    if (members.length < MIN_CLUSTER || !areaCollapsed(area, members, zoom)) {
      ungrouped.push(...members);
      continue;
    }
    // The area is a dot: its quiet assets become its badge, its alarms stay visible.
    const quiet = members.filter((asset) => !inAlarm(asset));
    const alarmed = members.filter((asset) => inAlarm(asset));
    if (quiet.length < MIN_CLUSTER) {
      ungrouped.push(...members);
      continue;
    }
    labelledAreas.delete(area.id);
    clusters.push({
      id: `area:${area.id}`,
      kind: 'area',
      label: area.name,
      color: area.color,
      ...(areaAnchor(area, quiet) ?? meanPosition(quiet)),
      assets: quiet,
      alarms: 0
    });
    for (const asset of alarmed) singles.push({ asset, labelled: false });
  }

  // --- rung 1: what is left, on the flat grid --------------------------------
  const flat = declutterAssets(ungrouped, zoom, inAlarm, { group: true });
  return {
    level: clusters.length > 0 ? 'area' : 'asset',
    singles: [...singles, ...flat.singles],
    clusters: [...clusters, ...flat.clusters],
    labelledAreas
  };
}

/**
 * The zoom below which an area collapses: its own setting, or derived from its extent and
 * how many assets have to fit inside it.
 */
function areaCollapseZoom(area: Area, members: readonly Asset[]): number {
  if (area.groupZoom > 0) return area.groupZoom;
  // Measured on the ASSETS, not on the ring.
  //
  // The question is "can the operator still tell these markers apart", which depends on
  // where the markers are, not on how big the polygon drawn around them is. Judged by its
  // ring, a wide sector holding tightly packed equipment stayed "expanded" while its assets
  // already overlapped — they then fell through to the flat grid, which grouped SOME of them
  // into an anonymous cell badge and left the rest loose. Measuring the assets is what makes
  // the area collapse as ONE badge holding all of them.
  //
  // The ring is only the fallback for an area with no assets, where nothing is grouped
  // anyway and the answer cannot matter.
  const bounds =
    boundsOf(
      members.map((asset) => ({ lat: asset.lat, lon: asset.lon })),
      NO_PAD
    ) ?? areaBounds(area);
  if (!bounds) return Number.NEGATIVE_INFINITY;
  const needed = Math.max(AREA_AUTO_MIN_PX, members.length * ASSET_SLOT_PX);
  return collapseZoom(unitSpan(bounds), needed);
}

/** Should this area collapse into one badge at this zoom? */
function areaCollapsed(
  area: Area,
  members: readonly Asset[],
  zoom: number
): boolean {
  // An explicit threshold is taken literally: the user has said where the line is.
  if (area.groupZoom > 0) return zoom < area.groupZoom;
  if (zoom < areaCollapseZoom(area, members)) return true;
  // Automatic mode also guarantees the invariant the whole feature exists for: an area is
  // either wholly one badge, or wholly individual markers — never "a few markers plus an
  // anonymous grey badge holding the rest of the same area". So if the flat grid would merge
  // any two of these assets, the area collapses instead and its own named, coloured badge
  // stands for all of them.
  return gridWouldGroup(members, zoom);
}

/**
 * Would the flat grid merge any of these assets at this zoom? True as soon as two of them
 * share a cell, which is exactly the condition that produces an anonymous cell badge.
 */
function gridWouldGroup(members: readonly Asset[], zoom: number): boolean {
  const level = Math.floor(zoom);
  const seen = new Set<string>();
  for (const asset of members) {
    const cell = cellOf(asset, level);
    if (seen.has(cell)) return true;
    seen.add(cell);
  }
  return false;
}

/**
 * The zoom below which the WHOLE site collapses.
 *
 * Automatic: {@link SITE_SEPARATION_ZOOM} levels below the *highest* zoom at which any of
 * its areas is still expanded — so there is always a real band where the map shows one
 * badge per area. Bounded by the zoom at which those badges would start to overlap, which
 * is the point past which the per-area view stops being readable anyway.
 */
function siteCollapseZoom(site: Site, assets: readonly Asset[]): number {
  if (site.groupZoom > 0) return site.groupZoom;
  const bounds =
    siteBounds(site) ??
    boundsOf(
      assets.map((a) => ({ lat: a.lat, lon: a.lon })),
      NO_PAD
    );
  if (!bounds) return Number.NEGATIVE_INFINITY;
  const badges = Math.max(1, site.areas.length);
  const overlapZoom = collapseZoom(
    unitSpan(bounds),
    Math.max(SITE_AUTO_MIN_PX, badges * SITE_BADGE_SLOT_PX)
  );
  if (site.areas.length === 0) return overlapZoom;
  const byArea = groupByArea(site, assets);
  const areaZooms = site.areas.map((area) =>
    areaCollapseZoom(area, byArea.get(area.id) ?? [])
  );
  const lastExpanded = Math.min(...areaZooms);
  if (!Number.isFinite(lastExpanded)) return overlapZoom;
  return Math.min(overlapZoom, lastExpanded - SITE_SEPARATION_ZOOM);
}

/** Should the whole site collapse into one badge at this zoom? */
function siteCollapsed(
  site: Site,
  assets: readonly Asset[],
  zoom: number
): boolean {
  return zoom < siteCollapseZoom(site, assets);
}

/** The assets of each area, keyed by area id (assets outside every area are omitted). */
function groupByArea(
  site: Site,
  assets: readonly Asset[]
): Map<string, Asset[]> {
  const known = new Set(site.areas.map((area) => area.id));
  const byArea = new Map<string, Asset[]>();
  for (const asset of assets) {
    if (!asset.areaId || !known.has(asset.areaId)) continue;
    const bucket = byArea.get(asset.areaId);
    if (bucket) bucket.push(asset);
    else byArea.set(asset.areaId, [asset]);
  }
  return byArea;
}

/**
 * Where an area's badge sits: on the assets it stands for.
 *
 * It used to sit at the ring centroid, on the reasoning that a badge should land where the
 * area's own label was. But a badge whose members are bunched in one corner of a large
 * sector would then be drawn in the middle of the polygon, pointing at nothing — and
 * clicking it would zoom somewhere the badge was not. Anchoring on the members keeps the
 * badge, its count and its click target describing the same thing, and matches how the
 * flat-grid badges are placed.
 *
 * The ring centroid is only the fallback for an area with no assets to average.
 */
function areaAnchor(
  area: Area,
  members: readonly Asset[]
): { lat: number; lon: number } | null {
  if (members.length > 0) return meanPosition(members);
  if (area.ring.length >= MIN_RING) {
    let lon = 0;
    let lat = 0;
    for (const [x, y] of area.ring) {
      lon += x;
      lat += y;
    }
    return { lat: lat / area.ring.length, lon: lon / area.ring.length };
  }
  return null;
}

/**
 * Build the "is this disc visually on its own" test for one zoom level.
 *
 * The exact question is a nearest-neighbour distance, which is O(n²) done naively. The
 * cluster grid is reused as a broad phase instead: an asset within {@link LABEL_CLEAR_PX}
 * cannot be further away than one cell ({@link CELL_PX} is larger), so only the asset's
 * own cell and its eight neighbours have to be examined.
 */
function buildLabelIndex(
  assets: readonly Asset[],
  level: number
): (asset: Asset) => boolean {
  const world = TILE_PX * 2 ** level;
  const grid = new Map<string, { id: string; px: number; py: number }[]>();
  const placed = new Map<
    string,
    { column: number; row: number; px: number; py: number }
  >();
  for (const asset of assets) {
    const { x, y } = mercator(asset.lat, asset.lon);
    const px = x * world;
    const py = y * world;
    const column = Math.floor(px / CELL_PX);
    const row = Math.floor(py / CELL_PX);
    placed.set(asset.id, { column, row, px, py });
    const key = `${column}/${row}`;
    const bucket = grid.get(key);
    const entry = { id: asset.id, px, py };
    if (bucket) bucket.push(entry);
    else grid.set(key, [entry]);
  }
  const limit = LABEL_CLEAR_PX * LABEL_CLEAR_PX;
  return (asset: Asset): boolean => {
    const self = placed.get(asset.id);
    if (!self) return true;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        for (const other of grid.get(`${self.column + dc}/${self.row + dr}`) ??
          []) {
          if (other.id === asset.id) continue;
          const dx = other.px - self.px;
          const dy = other.py - self.py;
          if (dx * dx + dy * dy < limit) return false;
        }
      }
    }
    return true;
  };
}

/**
 * Mean position of a cluster's members. Adequate because a cell is 64 px wide: the
 * badge always lands inside the cluster it describes, which a true centroid would not
 * guarantee any better at this scale.
 */
function meanPosition(assets: readonly Asset[]): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const asset of assets) {
    lat += asset.lat;
    lon += asset.lon;
  }
  return { lat: lat / assets.length, lon: lon / assets.length };
}
