// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domain model for the Ampère page.
 *
 * An *Ampère network* is a single-line (mono-filaire) electrical distribution
 * diagram: a graph of positioned {@link Node}s (electrical symbols — busbars,
 * disconnectors, circuit breakers, transformers…) wired together by
 * {@link Edge}s (the conductors), plus free or symbol-anchored {@link Measurement}
 * labels showing a live datapoint value anywhere in the circuit.
 *
 * Geometry is expressed in **canvas logical units** (the SVG viewBox space, see
 * {@link CANVAS_W}/{@link CANVAS_H}); every placement snaps to {@link GRID}. This
 * keeps symbols aligned and wires orthogonal without depending on the pixel size
 * of the rendered canvas (which zoom/scroll change).
 *
 * Live behaviour is NOT stored: only the *binding* is (each switchgear node keeps
 * the name of the datapoint element giving its open/closed position, chosen
 * freely by the user). The wire *energisation* is derived at runtime by
 * {@link ./topology.ts} from those live positions — never persisted.
 *
 * Each network is persisted as one WinCC OA datapoint of type `Ampere_Network`
 * (a Struct with String elements `name` + `json`) — see {@link ./data/ampere-store.ts}.
 */
import { SYMBOLS, type SymbolId } from './symbols/catalog.js';

export type { SymbolId } from './symbols/catalog.js';

/** A point in canvas units. */
export interface Point {
  x: number;
  y: number;
}

/** Quarter-turn rotation applied to a placed symbol. */
export type Rotation = 0 | 90 | 180 | 270;

/** A reference to one named connection port of a placed node. */
export interface PortRef {
  /** {@link Node.id} of the target symbol. */
  nodeId: string;
  /** Port key as declared by the symbol definition (see the symbol catalog). */
  port: string;
}

/**
 * A live measurement label (e.g. `12.4 A`, `398 V`). Bound to one datapoint
 * element; shown either free-floating on the canvas (`nodeId` empty) or anchored
 * to a symbol (`nodeId` set — the label then follows the symbol, offset by x/y).
 */
export interface Measurement {
  /** Stable id, unique within the network. */
  id: string;
  /** Datapoint element read live (e.g. `System1:Feeder1.value`). */
  dp: string;
  /** Optional caption shown before the value (e.g. `I`, `U`, `P`). */
  label: string;
  /** Unit suffix appended after the value (e.g. `A`, `V`, `kW`). */
  unit: string;
  /** Decimal places used when formatting a numeric value (0–6). */
  decimals: number;
  /** Anchor symbol id; empty ⇒ free-floating at absolute (x, y). */
  nodeId: string;
  /** Position: absolute canvas units when free, offset from the node when anchored. */
  x: number;
  y: number;
}

/** One placed electrical symbol. */
export interface Node {
  /** Stable id, unique within the network (also used as the wiring port owner). */
  id: string;
  /** Which catalog symbol this node draws. */
  symbol: SymbolId;
  /** User label shown under the symbol (e.g. `Q1`, `TGBT-A`). */
  label: string;
  /** Top-left position of the symbol box, in canvas units (grid-snapped). */
  x: number;
  y: number;
  /** Quarter-turn rotation of the symbol. */
  rotation: Rotation;
  /**
   * Datapoint element giving this device's live open/closed position — chosen
   * freely per symbol (empty ⇒ unbound). Only meaningful for switchgear symbols.
   */
  dp: string;
  /** Live value that means the device is CLOSED (conducting). Default 1. */
  closedValue: number;
  /**
   * Force this node to be treated as an energy source (seeds energisation). Auto
   * for grid-source/generator symbols; user-settable for a transformer secondary.
   */
  source: boolean;
}

/** One conductor (wire) between two symbol ports. */
export interface Edge {
  /** Stable id, unique within the network. */
  id: string;
  /** First endpoint. */
  from: PortRef;
  /** Second endpoint. */
  to: PortRef;
}

/** A complete single-line network diagram. */
export interface Network {
  /** Stable identifier (slug); used as the route param and DP suffix. */
  id: string;
  /** Full backing DP name (e.g. `System1:Ampere_x`); absent until persisted. */
  dp?: string;
  /** Display name. */
  name: string;
  /** Free-text description / notes. */
  description: string;
  /** Placed symbols. */
  nodes: Node[];
  /** Conductors between symbol ports. */
  edges: Edge[];
  /** Live measurement labels. */
  measurements: Measurement[];
  /** ISO-ish local timestamp of the last save (empty = never). */
  updatedAt: string;
}

/** SVG viewBox logical size of the drawing surface. */
export const CANVAS_W = 2400;
export const CANVAS_H = 1400;
/** Placement grid step, in canvas units (symbols and ports land on multiples). */
export const GRID = 20;

/** Snap a canvas-unit value to the nearest grid line. */
export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/** Clamp a value into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** A blank measurement with sensible defaults. */
export function blankMeasurement(): Measurement {
  return { id: '', dp: '', label: '', unit: 'A', decimals: 1, nodeId: '', x: 0, y: 0 };
}

/** A blank network with no content. */
export function blankNetwork(): Network {
  return { id: '', name: '', description: '', nodes: [], edges: [], measurements: [], updatedAt: '' };
}

// --- geometry ----------------------------------------------------------------

/** Rotate a local point around a center by a quarter-turn (exact, no float drift). */
export function rotatePoint(p: Point, center: Point, deg: Rotation): Point {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  switch (deg) {
    case 90: {
      return { x: center.x - dy, y: center.y + dx };
    }
    case 180: {
      return { x: center.x - dx, y: center.y - dy };
    }
    case 270: {
      return { x: center.x + dy, y: center.y - dx };
    }
    default: {
      return { x: p.x, y: p.y };
    }
  }
}

/** World position of a symbol's local box center (invariant under rotation). */
export function nodeCenter(node: Node): Point {
  const def = SYMBOLS[node.symbol];
  return { x: node.x + def.w / 2, y: node.y + def.h / 2 };
}

/** World position of one named port of a placed node (undefined if unknown). */
export function portWorld(node: Node, portKey: string): Point | undefined {
  const def = SYMBOLS[node.symbol];
  const port = def.ports[portKey];
  if (!port) return undefined;
  const center = { x: def.w / 2, y: def.h / 2 };
  const r = rotatePoint(port, center, node.rotation);
  return { x: node.x + r.x, y: node.y + r.y };
}

/** World endpoints of an edge (undefined if either port cannot be resolved). */
export function edgeEnds(edge: Edge, byId: Map<string, Node>): [Point, Point] | undefined {
  const from = byId.get(edge.from.nodeId);
  const to = byId.get(edge.to.nodeId);
  if (!from || !to) return undefined;
  const a = portWorld(from, edge.from.port);
  const b = portWorld(to, edge.to.port);
  return a && b ? [a, b] : undefined;
}

/**
 * Orthogonal (elbow) wire path between two points: a Z-route that goes to the
 * vertical midpoint, across, then down — the natural single-line look for
 * top/bottom device ports. Aligned points collapse to a straight segment.
 */
export function orthPath(a: Point, b: Point): string {
  if (a.x === b.x || a.y === b.y) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const midY = snap((a.y + b.y) / 2);
  return `M ${a.x} ${a.y} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${b.y}`;
}

/** World position of a measurement label (anchored to its node, or absolute). */
export function measurementPos(m: Measurement, byId: Map<string, Node>): Point {
  if (m.nodeId) {
    const node = byId.get(m.nodeId);
    if (node) {
      const c = nodeCenter(node);
      return { x: c.x + m.x, y: c.y + m.y };
    }
  }
  return { x: m.x, y: m.y };
}
