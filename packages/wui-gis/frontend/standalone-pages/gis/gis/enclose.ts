// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Drawing an area's outline **around the assets it holds** — what the *Fit around the
 * assets* button produces.
 *
 * Three decisions, each taken against a specific way the outline looked wrong:
 *
 * **The outline is concave, not the convex hull.** A convex hull round a network is a
 * connect-the-outer-assets shape closed by a long chord across empty ground — read on the
 * map as "it joined the last asset back to the first instead of wrapping them". A water
 * network follows mains, a district follows streets; both are concave, and the outline has
 * to go in and out with them. This digs the hull inwards (a *chi-shape*): the longest
 * boundary edge is replaced by two shorter ones through the nearest asset that has not been
 * used yet, repeatedly, while that keeps the polygon simple.
 *
 * **The margin is proportional to the group, not a fixed distance.** 150 m is most of a
 * pumping station and a rounding error on a 12 km sector. The outline sits at 8 % of the
 * group's diagonal, floored and capped, so both look deliberately drawn.
 *
 * **Corners are rounded and the outline never touches a marker.** The ring is the offset of
 * the dug polygon: each side pushed outwards, each convex corner turned into a short arc,
 * each reflex corner mitred. A single asset therefore becomes a disc and a straight run of
 * valves a capsule, rather than a polygon with no area that a fill cannot show.
 *
 * Everything is computed in a **local metric plane** (metres from the group's centre), not
 * in degrees: a margin and an edge length are distances, and a degree of longitude is not a
 * degree of latitude. Only the input and the result are geographic.
 */
import { isValidLatLon, type LatLon } from './types.js';

/** How the outline is drawn; both have defaults chosen to need no tuning. */
export interface EncloseOptions {
  /**
   * How closely the outline follows the assets: `0` leaves it convex, `1` digs into every
   * gap it can. The default is deliberately not 1 — a maximally tight outline threads
   * between assets that a human would have enclosed together.
   */
  tightness?: number;
  /** Outward margin in metres. Omitted ⇒ proportional to the group's extent. */
  marginM?: number;
}

/**
 * A closed ring (`[lon, lat]` pairs, no repeated first point) enclosing every one of these
 * points, or `null` when none of them is usable.
 *
 * Always a **simple** polygon — the offset is validated, retried tighter, and falls back to
 * the convex outline rather than ever handing back a self-crossing ring that MapLibre would
 * fill inside out.
 */
export function encloseAssets(
  points: readonly LatLon[],
  options: EncloseOptions = {}
): [number, number][] | null {
  const usable = points.filter((point) => isValidLatLon(point.lat, point.lon));
  if (usable.length === 0) return null;
  const centre = meanOf(usable);
  const plane = planeAt(centre.lat);
  const projected = dedupe(
    usable.map((point) => project(point, centre, plane))
  );
  const margin = options.marginM ?? autoMargin(projected);
  const ring = outline(
    projected,
    margin,
    options.tightness ?? DEFAULT_TIGHTNESS
  );
  return ring.map((point) => unproject(point, centre, plane));
}

/** A point in the local metric plane: metres east and north of the group's centre. */
interface Pt {
  x: number;
  y: number;
}

/** Metres per degree of latitude (WGS 84 mean) — enough for an outline. */
const METERS_PER_DEGREE_LAT = 111_320;
/** Longitude scale floor, so a group near a pole cannot divide by ~0. */
const MIN_LON_SCALE = 0.01;
/** Points closer than this count as one; a duplicate breaks the hull's ordering. */
const COINCIDENT_M = 1;
/** Below three distinct points there is no polygon to dig — a capsule is drawn instead. */
const MIN_HULL = 3;

/** Margin as a fraction of the group's diagonal, and the bounds it is held between. */
const MARGIN_FRACTION = 0.08;
const MARGIN_MIN_M = 50;
const MARGIN_MAX_M = 500;

/**
 * Default tightness, and how it becomes a length.
 *
 * Digging stops once no boundary edge is longer than `factor × the mean distance between
 * neighbouring assets`. Expressing the threshold in those terms is what makes one default
 * work for a city district and for a 15 km main: both are measured against their own
 * spacing — a boundary edge spanning several asset-gaps is bridging a hole, whatever the
 * scale.
 *
 * The band is narrow, and it was measured rather than guessed. A clearly C-shaped layout has
 * a mouth only about **two** spacings wide — the gap between the two arm tips is two asset
 * gaps, no more — so any factor above 2 leaves the bay filled, which is exactly what the
 * first attempt did. `1.2` follows every gap; `3` only unmistakable ones. Tightness `0` is
 * special-cased to no digging at all, so "convex" stays exactly convex.
 *
 * Aggressive values are safer than they look: digging can only ever insert an asset that is
 * **not** on the hull, so a sparse layout has nothing to reach for and stays convex whatever
 * the factor.
 */
const DEFAULT_TIGHTNESS = 0.7;
const DIG_FACTOR_TIGHT = 1.2;
const DIG_FACTOR_LOOSE = 3;
/**
 * How many candidate assets are considered per edge, nearest first. A cap rather than the
 * whole set: an area may hold a thousand assets, and the digging is otherwise cubic.
 */
const DIG_CANDIDATES = 12;
/**
 * How far the two new edges may total, as a multiple of the edge they replace. Bounds how
 * far the outline is willing to reach inwards to pick a corner up; past this the detour is
 * no longer following a shape, it is threading between assets.
 */
const DETOUR_MAX = 2.2;

/**
 * Corner budget. The sanitiser keeps 64 ring points (`MAX_RING_POINTS` in
 * `data/normalize.ts`), so a richer ring would be silently truncated on the next
 * save-and-reload — and a truncated ring is a *different shape*. The corners are capped
 * here and the arc detail is then fitted into what is left.
 */
const MAX_CORNERS = 20;
const RING_BUDGET = 64;
const ARC_MIN_STEPS = 1;
const ARC_MAX_STEPS = 3;
/** Points a rounded corner costs beyond its arc steps: the two side offsets. */
const CORNER_OVERHEAD = 2;
/** How much of the margin a corner may stand off its chord and still be dropped. */
const DROP_FRACTION = 0.5;
/** Segments a full circle or a capsule end is drawn with. */
const CIRCLE_STEPS = 16;
const CAP_STEPS = 8;
/**
 * How far a reflex corner's mitre may reach, in margins. Past that the corner is nearly
 * a spike and its exact mitre shoots off to infinity, so the two side offsets are used.
 */
const MITER_CAP = 4;
/** Tighter offsets tried before giving up on the concave outline. */
const OFFSET_RETRIES = 3;

const HALF = 0.5;
const QUARTER_TURN = Math.PI / 2;
const FULL_TURN = Math.PI * 2;

// --- geographic <-> local metric plane ---------------------------------------

/** Metres per degree of longitude at this latitude, alongside the latitude scale. */
function planeAt(lat: number): { lon: number; lat: number } {
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), MIN_LON_SCALE);
  return { lon: METERS_PER_DEGREE_LAT * cos, lat: METERS_PER_DEGREE_LAT };
}

function meanOf(points: readonly LatLon[]): LatLon {
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lon: points.reduce((sum, p) => sum + p.lon, 0) / points.length
  };
}

function project(
  point: LatLon,
  centre: LatLon,
  plane: { lon: number; lat: number }
): Pt {
  return {
    x: (point.lon - centre.lon) * plane.lon,
    y: (point.lat - centre.lat) * plane.lat
  };
}

function unproject(
  point: Pt,
  centre: LatLon,
  plane: { lon: number; lat: number }
): [number, number] {
  return [centre.lon + point.x / plane.lon, centre.lat + point.y / plane.lat];
}

// --- vector helpers ----------------------------------------------------------

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function cross(a: Pt, b: Pt): number {
  return a.x * b.y - a.y * b.x;
}

function length(a: Pt): number {
  return Math.hypot(a.x, a.y);
}

function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Unit outward normal of an edge `a -> b` on a counter-clockwise ring. */
function outwardNormal(a: Pt, b: Pt): Pt {
  const d = sub(b, a);
  const len = length(d) || 1;
  return { x: d.y / len, y: -d.x / len };
}

function atCircle(centre: Pt, radius: number, angle: number): Pt {
  return {
    x: centre.x + Math.cos(angle) * radius,
    y: centre.y + Math.sin(angle) * radius
  };
}

/** Drop points within {@link COINCIDENT_M} of one already kept. */
function dedupe(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const point of points) {
    if (out.every((kept) => distance(kept, point) > COINCIDENT_M))
      out.push(point);
  }
  return out;
}

// --- the outline -------------------------------------------------------------

/** Diagonal of the group's bounding box, in metres. */
function diagonal(points: readonly Pt[]): number {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys)
  );
}

function autoMargin(points: readonly Pt[]): number {
  const span = diagonal(points) * MARGIN_FRACTION;
  return Math.min(Math.max(span, MARGIN_MIN_M), MARGIN_MAX_M);
}

/**
 * The ring, in the metric plane: a capsule when there is no polygon to speak of, else the
 * offset of the dug hull — falling back tighter, then convex, so the result is always a
 * simple polygon.
 */
function outline(
  points: readonly Pt[],
  margin: number,
  tightness: number
): Pt[] {
  const hull = decimate(convexHull(points), margin);
  if (hull.length < MIN_HULL) return capsule(hull, points, margin);
  // A hull still over budget after decimation is a genuinely round blob: two dozen corners
  // each bulging further out than the margin could hide. There is no ring under 64 points
  // that follows it, so it is enclosed rather than approximated badly.
  if (hull.length > MAX_CORNERS) return enclosingCircle(points, margin);

  const dug = dig(hull, points, digThreshold(points, tightness));
  for (let attempt = 0; attempt <= OFFSET_RETRIES; attempt++) {
    const candidate = offsetRing(dug, margin / 2 ** attempt);
    if (isSimple(candidate)) return candidate;
  }
  // The dug shape has a notch too narrow for any usable margin. The convex outline is
  // always offsettable, so it is what the operator gets rather than a crossed ring.
  return offsetRing(hull, margin);
}

/**
 * Drop corners that the margin will hide anyway, until the ring fits the corner budget.
 *
 * A convex hull has as many corners as there are assets on its boundary — a hundred-asset
 * district can easily present thirty — and the ring has to stay inside the 64 points the
 * sanitiser keeps. A corner is only dropped when it stands less than half a margin off the
 * chord that would replace it: the offset then still leaves every asset inside, and the
 * outline loses a bulge nobody could have seen.
 */
function decimate(ring: readonly Pt[], margin: number): Pt[] {
  const out = [...ring];
  const allowance = margin * DROP_FRACTION;
  while (out.length > MAX_CORNERS && out.length > MIN_HULL) {
    let flattest = -1;
    let flattestSagitta = allowance;
    for (const [index, corner] of out.entries()) {
      const before = out[(index - 1 + out.length) % out.length] as Pt;
      const after = out[(index + 1) % out.length] as Pt;
      const sagitta = offLine(corner, before, after);
      if (sagitta < flattestSagitta) {
        flattest = index;
        flattestSagitta = sagitta;
      }
    }
    if (flattest < 0) break;
    out.splice(flattest, 1);
  }
  return out;
}

/** Perpendicular distance from `point` to the line through `a` and `b`. */
function offLine(point: Pt, a: Pt, b: Pt): number {
  const span = distance(a, b);
  if (span === 0) return distance(point, a);
  return Math.abs(cross(sub(b, a), sub(point, a))) / span;
}

/** The disc that holds everything: the last resort, and always storable and simple. */
function enclosingCircle(points: readonly Pt[], margin: number): Pt[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const centre = {
    x: (Math.min(...xs) + Math.max(...xs)) * HALF,
    y: (Math.min(...ys) + Math.max(...ys)) * HALF
  };
  const radius = Math.max(...points.map((p) => distance(centre, p))) + margin;
  return arc(centre, radius, 0, FULL_TURN, CIRCLE_STEPS);
}

/** A disc round one point, or a capsule round two — what a degenerate hull deserves. */
function capsule(
  hull: readonly Pt[],
  points: readonly Pt[],
  margin: number
): Pt[] {
  const first = hull[0] ?? points[0] ?? { x: 0, y: 0 };
  const second = hull[1];
  if (!second) {
    return arc(first, margin, 0, FULL_TURN, CIRCLE_STEPS);
  }
  const axis = Math.atan2(second.y - first.y, second.x - first.x);
  return [
    ...arc(second, margin, axis - QUARTER_TURN, axis + QUARTER_TURN, CAP_STEPS),
    ...arc(
      first,
      margin,
      axis + QUARTER_TURN,
      axis + QUARTER_TURN + Math.PI,
      CAP_STEPS
    )
  ];
}

/** Points along an arc, `from` included and `to` excluded, counter-clockwise. */
function arc(
  centre: Pt,
  radius: number,
  from: number,
  to: number,
  steps: number
): Pt[] {
  const out: Pt[] = [];
  for (let step = 0; step < steps; step++) {
    out.push(atCircle(centre, radius, from + ((to - from) * step) / steps));
  }
  return out;
}

/**
 * Convex hull by Andrew's monotone chain, counter-clockwise, without repeating the first
 * point. Collinear points are dropped (`<= 0`), so a straight run of assets comes back as
 * its two ends — which is what turns it into a capsule rather than a zero-area sliver.
 */
function convexHull(points: readonly Pt[]): Pt[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < MIN_HULL) return sorted;
  const half = (input: readonly Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const point of input) {
      while (
        out.length >= 2 &&
        cross(
          sub(out.at(-1) as Pt, out.at(-2) as Pt),
          sub(point, out.at(-1) as Pt)
        ) <= 0
      ) {
        out.pop();
      }
      out.push(point);
    }
    return out;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Mean distance from each asset to its nearest neighbour — the group's own spacing. */
function meanSpacing(points: readonly Pt[]): number {
  let total = 0;
  for (const point of points) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of points) {
      if (other === point) continue;
      nearest = Math.min(nearest, distance(point, other));
    }
    if (Number.isFinite(nearest)) total += nearest;
  }
  return total / points.length;
}

function digThreshold(points: readonly Pt[], tightness: number): number {
  const clamped = Math.min(Math.max(tightness, 0), 1);
  if (clamped === 0) return Number.POSITIVE_INFINITY;
  const factor =
    DIG_FACTOR_TIGHT + (1 - clamped) * (DIG_FACTOR_LOOSE - DIG_FACTOR_TIGHT);
  return meanSpacing(points) * factor;
}

/**
 * Dig the hull inwards into a concave outline.
 *
 * Each pass takes the longest boundary edge still over the threshold and replaces it with
 * two edges through the nearest unused asset — accepted when the detour stays within
 * {@link DETOUR_MAX} and neither new edge crosses the boundary. It terminates because every
 * pass either consumes an asset from the pool for good or abandons an edge for good.
 */
function dig(
  hull: readonly Pt[],
  points: readonly Pt[],
  maxEdge: number
): Pt[] {
  const ring = [...hull];
  const pool = points.filter((point) => !hull.includes(point));
  const abandoned = new Set<Pt>();

  while (pool.length > 0 && ring.length < MAX_CORNERS) {
    const index = longestOpenEdge(ring, maxEdge, abandoned);
    if (index < 0) break;
    const a = ring[index] as Pt;
    const b = ring[(index + 1) % ring.length] as Pt;
    const pick = bestInsertion(a, b, pool, ring, index);
    if (pick < 0) {
      abandoned.add(a);
      continue;
    }
    ring.splice(index + 1, 0, pool[pick] as Pt);
    pool.splice(pick, 1);
  }
  return ring;
}

/**
 * Index of the longest boundary edge over `maxEdge` whose start has not been abandoned,
 * or `-1`. An edge is keyed by its *start* point, which is stable: inserting into the ring
 * never changes which point an edge starts at, it only shortens that edge.
 */
function longestOpenEdge(
  ring: readonly Pt[],
  maxEdge: number,
  abandoned: ReadonlySet<Pt>
): number {
  let best = -1;
  let bestLength = maxEdge;
  for (const [index, point] of ring.entries()) {
    if (abandoned.has(point)) continue;
    const next = ring[(index + 1) % ring.length] as Pt;
    const span = distance(point, next);
    if (span > bestLength) {
      best = index;
      bestLength = span;
    }
  }
  return best;
}

/**
 * Which pooled asset to insert into edge `a → b`, or `-1` for none.
 *
 * Nearest candidates first, so a thousand-asset area stays affordable; the chosen one
 * minimises the detour `|ac| + |cb|`.
 */
function bestInsertion(
  a: Pt,
  b: Pt,
  pool: readonly Pt[],
  ring: readonly Pt[],
  edgeIndex: number
): number {
  const span = distance(a, b);
  const middle = { x: (a.x + b.x) * HALF, y: (a.y + b.y) * HALF };
  const nearest = pool
    .map((point, index) => ({ index, near: distance(point, middle) }))
    .sort((left, right) => left.near - right.near)
    .slice(0, DIG_CANDIDATES);

  let best = -1;
  let bestDetour = Number.POSITIVE_INFINITY;
  for (const { index } of nearest) {
    const c = pool[index] as Pt;
    const detour = distance(a, c) + distance(c, b);
    // The detour is bounded, not required to be shorter than the edge it replaces. Demanding
    // two shorter edges is the textbook rule, and it cannot carve a square bay: reaching the
    // inner corner of an L-shaped arm always costs one edge longer than the chord across the
    // mouth, so the bay stayed filled. What bounds the work is the pool, not the geometry —
    // every insertion consumes an asset for good, and a refused edge is abandoned for good.
    if (detour > span * DETOUR_MAX) continue;
    if (detour >= bestDetour) continue;
    if (!insertionKeepsItSimple(a, b, c, ring, edgeIndex)) continue;
    best = index;
    bestDetour = detour;
  }
  return best;
}

/** True when neither new edge crosses a boundary edge it does not share a corner with. */
function insertionKeepsItSimple(
  a: Pt,
  b: Pt,
  c: Pt,
  ring: readonly Pt[],
  edgeIndex: number
): boolean {
  for (const [index, from] of ring.entries()) {
    if (index === edgeIndex) continue;
    const to = ring[(index + 1) % ring.length] as Pt;
    if (from === a || to === a || from === b || to === b) continue;
    if (segmentsCross(a, c, from, to) || segmentsCross(c, b, from, to))
      return false;
  }
  return true;
}

/**
 * Push a counter-clockwise ring outwards by `margin`: every side offset along its outward
 * normal, every convex corner rounded into an arc, every reflex corner mitred.
 *
 * The arc budget is what is left of {@link RING_BUDGET} after the corners, so a rich
 * outline loses roundness rather than being truncated by the sanitiser later.
 */
function offsetRing(ring: readonly Pt[], margin: number): Pt[] {
  const steps = Math.min(
    ARC_MAX_STEPS,
    Math.max(
      ARC_MIN_STEPS,
      Math.floor(RING_BUDGET / ring.length) - CORNER_OVERHEAD
    )
  );
  const out: Pt[] = [];
  for (const [index, corner] of ring.entries()) {
    const previous = ring[(index - 1 + ring.length) % ring.length] as Pt;
    const next = ring[(index + 1) % ring.length] as Pt;
    const incoming = outwardNormal(previous, corner);
    const outgoing = outwardNormal(corner, next);
    const turn = cross(sub(corner, previous), sub(next, corner));
    if (turn > 0) {
      out.push(...cornerArc(corner, incoming, outgoing, margin, steps));
      continue;
    }
    const mitre = mitred(corner, incoming, outgoing, margin);
    out.push(
      ...(mitre
        ? [mitre]
        : [
            offsetBy(corner, incoming, margin),
            offsetBy(corner, outgoing, margin)
          ])
    );
  }
  return out;
}

function offsetBy(point: Pt, normal: Pt, margin: number): Pt {
  return { x: point.x + normal.x * margin, y: point.y + normal.y * margin };
}

/** The rounded outside of a convex corner, from one side's offset to the other's. */
function cornerArc(
  corner: Pt,
  incoming: Pt,
  outgoing: Pt,
  margin: number,
  steps: number
): Pt[] {
  const from = Math.atan2(incoming.y, incoming.x);
  let to = Math.atan2(outgoing.y, outgoing.x);
  while (to < from) to += FULL_TURN;
  return [
    ...arc(corner, margin, from, to, steps + 1),
    offsetBy(corner, outgoing, margin)
  ];
}

/**
 * A reflex corner's exact offset: where the two offset sides meet. `null` when the corner
 * is so sharp that the meeting point runs away past {@link MITER_CAP}.
 */
function mitred(
  corner: Pt,
  incoming: Pt,
  outgoing: Pt,
  margin: number
): Pt | null {
  const bisector = { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y };
  const len = length(bisector);
  if (len === 0) return null;
  const unit = { x: bisector.x / len, y: bisector.y / len };
  // half the angle between the two normals, from their unit sum: |n1+n2| = 2 cos(θ/2)
  const reach = margin / (len / 2);
  if (reach > margin * MITER_CAP) return null;
  return offsetBy(corner, unit, reach);
}

/** True when no two non-adjacent edges of the ring cross. */
function isSimple(ring: readonly Pt[]): boolean {
  const total = ring.length;
  for (let i = 0; i < total; i++) {
    for (let j = i + 1; j < total; j++) {
      if (j === i + 1 || (i === 0 && j === total - 1)) continue;
      const crossing = segmentsCross(
        ring[i] as Pt,
        ring[(i + 1) % total] as Pt,
        ring[j] as Pt,
        ring[(j + 1) % total] as Pt
      );
      if (crossing) return false;
    }
  }
  return true;
}

/** Proper crossing only: segments that merely touch or lie along each other do not count. */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const ab = sub(b, a);
  const cd = sub(d, c);
  const d1 = cross(ab, sub(c, a));
  const d2 = cross(ab, sub(d, a));
  const d3 = cross(cd, sub(a, c));
  const d4 = cross(cd, sub(b, c));
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}
