// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * AGV guide-path network — the ONLY geometry a simulated vehicle may occupy.
 *
 * The hall is 36 x 32 m, x grows right and y grows DOWN (same convention as the
 * page's SVG, whose user space *is* the hall in metres). Vehicles travel along
 * graph EDGES and turn only at NODES, so a position is always an interpolation
 * of one declared aisle segment — that is what makes "never cross the warehouse"
 * a structural property rather than a runtime check.
 *
 * The layout mirrors `af-map.ts` AREAS exactly:
 *   racking   (12,11,19,2) (12,16,19,2) (12,21,19,2)   BLOCKED
 *   charge C1 (0.8,19,5.2,5.5)     maint M1 (0.8,25,5.2,5.5)
 *   park Z0   (3,2,6,4)
 *   docks     D1 (20,30,5,1.5)     D2 (27,30,5,1.5)
 *   picks     P1 (9.2,11,2,2)  P2 (9.2,16,2,2)  P3 (9.2,21,2,2)
 *
 * Aisles run BETWEEN the rack rows (y 8.5 / 14.5 / 19.5 / 25.5 against racks at
 * y 11-13 / 16-18 / 21-23), plus a main spine at x=8, a right spine at x=33.5, a
 * bottom aisle at y=29 and a service aisle at x=6.8 serving the charge bay and
 * maintenance. {@link assertRackSafe} proves numerically that no edge clips a
 * rack; index.js calls it at startup and refuses to run if it ever fails.
 */

const HALL_WIDTH_M = 36;
const HALL_HEIGHT_M = 32;

/** Racking — a vehicle may NEVER enter these rectangles. */
const RACKS = [
  { id: 'R10-R19', x: 12, y: 11, w: 19, h: 2 },
  { id: 'R20-R29', x: 12, y: 16, w: 19, h: 2 },
  { id: 'R30-R39', x: 12, y: 21, w: 19, h: 2 }
];

/** Aisle skeleton, metres. */
const SPINE_X = 8;
const SERVICE_X = 6.8;
const RIGHT_X = 33.5;
/** Cross aisles, north to south. Index i is the aisle ABOVE rack row i. */
const AISLE_Y = [8.5, 14.5, 19.5, 25.5];
const BOTTOM_Y = 29;
/** x of the rack-face access points along each cross aisle (one per bay group). */
const RACK_ACCESS_X = [14, 20, 26, 30];
/** Spine junctions that exist only to serve a pick station. */
const PICK_SPINE_Y = [12, 17, 22];
const PARK_SPINE_Y = 4;

const nodes = new Map();
const edges = [];
const adjacency = new Map();

function addNode(id, x, y, kind) {
  const node = { id, x, y, kind };
  nodes.set(id, node);
  adjacency.set(id, []);
  return node;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function link(idA, idB) {
  const a = nodes.get(idA);
  const b = nodes.get(idB);
  if (!a || !b) throw new Error(`link: unknown node ${idA} / ${idB}`);
  const length = distance(a, b);
  edges.push({ a: idA, b: idB, length });
  adjacency.get(idA).push({ to: idB, length });
  adjacency.get(idB).push({ to: idA, length });
}

/** Connect consecutive ids into a chain. */
function chain(ids) {
  for (let i = 0; i + 1 < ids.length; i++) link(ids[i], ids[i + 1]);
}

const spineId = (y) => `SP_${y}`;
const serviceId = (y) => `SV_${y}`;
const aisleId = (index, x) => `A${index}_${x}`;
const rightId = (y) => `RS_${y}`;
const bottomId = (x) => `BT_${x}`;

// --- 1. main spine at x = 8 --------------------------------------------------
const SPINE_Y = [PARK_SPINE_Y, ...AISLE_Y, ...PICK_SPINE_Y, BOTTOM_Y].sort((p, q) => p - q);
for (const y of SPINE_Y) addNode(spineId(y), SPINE_X, y, 'junction');
chain(SPINE_Y.map((y) => spineId(y)));

// --- 2. service aisle at x = 6.8 (charge bay + maintenance) ------------------
const SERVICE_Y = [19.5, 21, 23, 27, 29];
for (const y of SERVICE_Y) addNode(serviceId(y), SERVICE_X, y, 'junction');
chain(SERVICE_Y.map((y) => serviceId(y)));
// Tie the service aisle into the spine at both ends.
link(serviceId(19.5), spineId(19.5));
link(serviceId(29), spineId(BOTTOM_Y));

// --- 3. cross aisles, each from the spine out to the right spine -------------
for (const [index, y] of AISLE_Y.entries()) {
  const ids = [spineId(y)];
  for (const x of RACK_ACCESS_X) {
    const id = aisleId(index, x);
    addNode(id, x, y, 'rack-access');
    ids.push(id);
  }
  addNode(rightId(y), RIGHT_X, y, 'junction');
  ids.push(rightId(y));
  chain(ids);
}

// --- 4. right spine at x = 33.5 and the bottom aisle at y = 29 ---------------
addNode(rightId(BOTTOM_Y), RIGHT_X, BOTTOM_Y, 'junction');
chain([...AISLE_Y, BOTTOM_Y].map((y) => rightId(y)));

const DOCK_ACCESS_X = { D1: 22.5, D2: 29.5 };
const bottomIds = [spineId(BOTTOM_Y)];
for (const x of Object.values(DOCK_ACCESS_X)) {
  const id = bottomId(x);
  addNode(id, x, BOTTOM_Y, 'junction');
  bottomIds.push(id);
}
bottomIds.push(rightId(BOTTOM_Y));
chain(bottomIds);

// --- 5. station spurs -------------------------------------------------------
/**
 * A station sits OFF the aisle, so it hangs off its nearest junction by one
 * short spur. The spur is itself an edge, so a vehicle serving a station is
 * still on the network.
 */
const STATIONS = [
  { id: 'P1', x: 10.2, y: 12, kind: 'pick', from: spineId(12), label: 'Pick station P1' },
  { id: 'P2', x: 10.2, y: 17, kind: 'pick', from: spineId(17), label: 'Pick station P2' },
  { id: 'P3', x: 10.2, y: 22, kind: 'pick', from: spineId(22), label: 'Pick station P3' },
  { id: 'C1A', x: 4, y: 21, kind: 'charger', from: serviceId(21), label: 'Charging bay C1' },
  { id: 'C1B', x: 4, y: 23, kind: 'charger', from: serviceId(23), label: 'Charging bay C1' },
  { id: 'M1', x: 4, y: 27, kind: 'maint', from: serviceId(27), label: 'Maintenance M1' },
  { id: 'Z0', x: 5.5, y: PARK_SPINE_Y, kind: 'park', from: spineId(PARK_SPINE_Y), label: 'Parking Z0' },
  { id: 'D1', x: DOCK_ACCESS_X.D1, y: 30.7, kind: 'dock', from: bottomId(DOCK_ACCESS_X.D1), label: 'Dock D1' },
  { id: 'D2', x: DOCK_ACCESS_X.D2, y: 30.7, kind: 'dock', from: bottomId(DOCK_ACCESS_X.D2), label: 'Dock D2' }
];
for (const station of STATIONS) {
  addNode(station.id, station.x, station.y, station.kind);
  link(station.from, station.id);
}

// --- 6. rack storage locations ----------------------------------------------
/**
 * A storage location is served from the aisle ALONGSIDE its rack, never from
 * inside it: row `r` is reached from cross aisle `r` (north face) or `r + 1`
 * (south face). The id is cosmetic (R10, R11, … R33) and matches the rack
 * labels drawn on the plan.
 */
const RACK_LOCATIONS = [];
for (const [row, rack] of RACKS.entries()) {
  for (const [bay, x] of RACK_ACCESS_X.entries()) {
    const base = (row + 1) * 10 + bay * 2;
    RACK_LOCATIONS.push({ id: `R${base}`, node: aisleId(row, x), rack: rack.id, face: 'north' });
    RACK_LOCATIONS.push({ id: `R${base + 1}`, node: aisleId(row + 1, x), rack: rack.id, face: 'south' });
  }
}

// --- geometry proof ---------------------------------------------------------
/**
 * Segment vs axis-aligned rectangle, by slab clipping. Returns true when the
 * segment enters the rectangle's interior (touching an edge is allowed — an
 * aisle may run flush along a rack face).
 */
function segmentHitsRect(ax, ay, bx, by, rect) {
  const dx = bx - ax;
  const dy = by - ay;
  const minX = rect.x;
  const maxX = rect.x + rect.w;
  const minY = rect.y;
  const maxY = rect.y + rect.h;
  let t0 = 0;
  let t1 = 1;
  const slab = (p, q) => {
    // p * t <= q for the near/far plane; returns false when fully outside.
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!slab(-dx, ax - minX)) return false;
  if (!slab(dx, maxX - ax)) return false;
  if (!slab(-dy, ay - minY)) return false;
  if (!slab(dy, maxY - ay)) return false;
  // A grazing contact collapses to a zero-length overlap; require real interior.
  return t1 - t0 > 1e-9;
}

function insideRect(x, y, rect) {
  return x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h;
}

/** True when (x, y) lies inside any racking — the invariant the sim must never break. */
function insideRacking(x, y) {
  return RACKS.some((rack) => insideRect(x, y, rack));
}

/**
 * Verify every node and every edge against the racking and the hall bounds.
 * Throws with the offending element, so a bad layout edit fails loudly at
 * startup instead of producing vehicles that drive through the shelves.
 */
function assertRackSafe() {
  for (const node of nodes.values()) {
    if (node.x < 0 || node.x > HALL_WIDTH_M || node.y < 0 || node.y > HALL_HEIGHT_M) {
      throw new Error(`node ${node.id} (${node.x}, ${node.y}) is outside the hall`);
    }
    if (insideRacking(node.x, node.y)) {
      throw new Error(`node ${node.id} (${node.x}, ${node.y}) is inside racking`);
    }
  }
  for (const edge of edges) {
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    for (const rack of RACKS) {
      if (segmentHitsRect(a.x, a.y, b.x, b.y, rack)) {
        throw new Error(`edge ${edge.a} -> ${edge.b} crosses racking ${rack.id}`);
      }
    }
  }
  return { nodes: nodes.size, edges: edges.length };
}

// --- routing ----------------------------------------------------------------
/**
 * Shortest path by Dijkstra over the adjacency map. The graph is a few dozen
 * nodes, so a linear scan for the next-nearest is cheaper than a heap and keeps
 * the code obvious. Neighbours are visited in insertion order and ties are
 * broken by node id, so the same request always yields the same route — routes
 * must not oscillate between ticks.
 */
function route(fromId, toId) {
  if (fromId === toId) return [fromId];
  if (!nodes.has(fromId) || !nodes.has(toId)) return null;
  const dist = new Map([[fromId, 0]]);
  const previous = new Map();
  const settled = new Set();
  for (;;) {
    let current = null;
    let best = Number.POSITIVE_INFINITY;
    for (const [id, d] of dist) {
      if (settled.has(id)) continue;
      if (d < best || (d === best && current !== null && id < current)) {
        best = d;
        current = id;
      }
    }
    if (current === null) return null;
    if (current === toId) break;
    settled.add(current);
    for (const { to, length } of adjacency.get(current)) {
      if (settled.has(to)) continue;
      const candidate = best + length;
      const known = dist.get(to);
      if (known === undefined || candidate < known) {
        dist.set(to, candidate);
        previous.set(to, current);
      }
    }
  }
  const path = [toId];
  let step = toId;
  while (step !== fromId) {
    step = previous.get(step);
    if (step === undefined) return null;
    path.unshift(step);
  }
  return path;
}

/** Nodes of a kind, e.g. every charger. */
function nodesOfKind(kind) {
  return [...nodes.values()].filter((node) => node.kind === kind);
}

function stationLabel(nodeId) {
  const station = STATIONS.find((s) => s.id === nodeId);
  if (station) return station.label;
  const location = RACK_LOCATIONS.find((l) => l.node === nodeId);
  return location ? `Rack ${location.id}` : `Aisle ${nodeId}`;
}

/** The polylines the page should draw — derived from the edges, never hardcoded. */
function guidePaths() {
  return edges.map((edge) => {
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    return `${a.x},${a.y} ${b.x},${b.y}`;
  });
}

module.exports = {
  HALL_WIDTH_M,
  HALL_HEIGHT_M,
  RACKS,
  STATIONS,
  RACK_LOCATIONS,
  nodes,
  edges,
  adjacency,
  assertRackSafe,
  insideRacking,
  route,
  nodesOfKind,
  stationLabel,
  guidePaths,
  distance
};
