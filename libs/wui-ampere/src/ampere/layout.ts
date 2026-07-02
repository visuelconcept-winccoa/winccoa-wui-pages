// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Automatic CAD-style arrangement for single-line diagrams.
 *
 * Electrical drawing convention: the energy flows **top → bottom** — sources
 * (grid supply, generators, incoming feeders) on the first row, then each
 * device on the row matching its electrical distance, loads at the bottom —
 * and parallel branches spread **left → right** in columns. Within a row the
 * order follows the barycenter of the parents' columns so branches stay under
 * their feeder; disconnected sub-networks are laid out side by side.
 *
 * Only the symbol POSITIONS change: wiring, bindings, label offsets and free
 * measurements are preserved (anchored measurements follow their symbol).
 * Decorative frames without ports (e.g. the switchboard outline) are left
 * untouched. The orthogonal wire routing (`orthPath`) then renders clean
 * vertical runs between the rows.
 */
import { SYMBOLS } from './symbols/catalog.js';
import { CANVAS_H, CANVAS_W, clamp, snap, type Network, type Node } from './types.js';

const MARGIN_X = 80;
const MARGIN_Y = 40;
const COL_W = 160;
const ROW_GAP = 60;
const COMPONENT_GAP = 1; // spare columns between disconnected sub-networks

interface Placed {
  node: Node;
  rank: number;
  col: number;
}

/** Re-place every wired symbol of `network` following the top→bottom / left→right flow. */
export function autoLayout(network: Network): Network {
  const placeable = network.nodes.filter((n) => Object.keys(SYMBOLS[n.symbol].ports).length > 0);
  if (placeable.length === 0) return network;

  const adj = buildAdjacency(network, placeable);
  const components = splitComponents(placeable, adj);

  const placed: Placed[] = [];
  let baseCol = 0;
  for (const component of components) {
    const ranks = rankComponent(component, adj);
    const cols = orderColumns(component, ranks, adj);
    let width = 0;
    for (const node of component) {
      placed.push({ node, rank: ranks.get(node.id) ?? 0, col: baseCol + (cols.get(node.id) ?? 0) });
      width = Math.max(width, (cols.get(node.id) ?? 0) + 1);
    }
    baseCol += width + COMPONENT_GAP;
  }

  const nodes = applyPositions(network, placed, adj);
  return { ...network, nodes };
}

/** Node-level undirected adjacency (via the wires), restricted to placeable nodes. */
function buildAdjacency(network: Network, placeable: Node[]): Map<string, string[]> {
  const ids = new Set(placeable.map((n) => n.id));
  const adj = new Map<string, string[]>(placeable.map((n) => [n.id, []]));
  for (const e of network.edges) {
    if (!ids.has(e.from.nodeId) || !ids.has(e.to.nodeId) || e.from.nodeId === e.to.nodeId) continue;
    adj.get(e.from.nodeId)!.push(e.to.nodeId);
    adj.get(e.to.nodeId)!.push(e.from.nodeId);
  }
  return adj;
}

/** Connected components, each ordered source-first (stable left→right by current x). */
function splitComponents(placeable: Node[], adj: Map<string, string[]>): Node[][] {
  const byId = new Map(placeable.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const components: Node[][] = [];
  const ordered = [...placeable].sort((a, b) => a.x - b.x || a.y - b.y);
  for (const start of ordered) {
    if (seen.has(start.id)) continue;
    const component: Node[] = [];
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      component.push(byId.get(id)!);
      for (const next of adj.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Whether a node seeds the flow (same rule as the energisation). */
function isSource(node: Node): boolean {
  return node.source || SYMBOLS[node.symbol].role === 'source';
}

/** Rank = electrical distance from the component's sources (top row = 0). */
function rankComponent(component: Node[], adj: Map<string, string[]>): Map<string, number> {
  const sources = component.filter((n) => isSource(n));
  const seeds = (sources.length > 0 ? sources : [component[0]]).map((n) => n.id);
  const rank = new Map<string, number>(seeds.map((id) => [id, 0]));
  const queue = [...seeds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const r = rank.get(id)!;
    for (const next of adj.get(id) ?? []) {
      if (!rank.has(next)) {
        rank.set(next, r + 1);
        queue.push(next);
      }
    }
  }
  // Wired but unreached (shouldn't happen inside a component) → after the last row.
  const max = Math.max(...rank.values(), 0);
  for (const n of component) if (!rank.has(n.id)) rank.set(n.id, max + 1);
  return rank;
}

/**
 * Column per node: row 0 keeps the user's left→right order; each next row is
 * ordered by the barycenter of its neighbours' columns in the row above, so a
 * branch stays under the device that feeds it.
 */
function orderColumns(component: Node[], ranks: Map<string, number>, adj: Map<string, string[]>): Map<string, number> {
  const cols = new Map<string, number>();
  const maxRank = Math.max(...component.map((n) => ranks.get(n.id) ?? 0));
  for (let r = 0; r <= maxRank; r++) {
    const row = component.filter((n) => ranks.get(n.id) === r);
    const bary = (n: Node): number => {
      const parents = (adj.get(n.id) ?? []).filter((id) => (ranks.get(id) ?? 0) === r - 1 && cols.has(id));
      if (parents.length === 0) return n.x / COL_W;
      return parents.reduce((sum, id) => sum + cols.get(id)!, 0) / parents.length;
    };
    const ordered = row.map((n) => ({ n, b: bary(n) })).sort((a, b) => a.b - b.b || a.n.x - b.n.x);
    for (const [i, { n }] of ordered.entries()) cols.set(n.id, i);
  }
  return cols;
}

/** Horizontal center of a layout column, in canvas units. */
function colCenter(col: number): number {
  return MARGIN_X + col * COL_W + COL_W / 2;
}

/** Turn (rank, col) into snapped canvas coordinates; wide symbols center on their branches. */
function applyPositions(network: Network, placed: Placed[], adj: Map<string, string[]>): Node[] {
  // Row heights: each row is as tall as its tallest symbol.
  const rowHeight = new Map<number, number>();
  for (const p of placed) {
    const def = SYMBOLS[p.node.symbol];
    rowHeight.set(p.rank, Math.max(rowHeight.get(p.rank) ?? 0, def.h));
  }
  const rowY = new Map<number, number>();
  let y = MARGIN_Y;
  for (const r of [...rowHeight.keys()].sort((a, b) => a - b)) {
    rowY.set(r, y);
    y += (rowHeight.get(r) ?? 0) + ROW_GAP;
  }

  const byId = new Map(placed.map((p) => [p.node.id, p]));
  const pos = new Map<string, { x: number; y: number }>();
  for (const p of placed) {
    const def = SYMBOLS[p.node.symbol];
    let center = colCenter(p.col);
    if (def.w > COL_W) {
      // Wide symbol (busbar): center it over the columns it actually feeds.
      const neighbours = (adj.get(p.node.id) ?? []).map((id) => byId.get(id)).filter((q): q is Placed => q != null);
      if (neighbours.length > 0) {
        center = neighbours.reduce((sum, q) => sum + colCenter(q.col), 0) / neighbours.length;
      }
    }
    pos.set(p.node.id, {
      x: clamp(snap(center - def.w / 2), 0, CANVAS_W - def.w),
      y: clamp(snap(rowY.get(p.rank) ?? MARGIN_Y), 0, CANVAS_H - def.h)
    });
  }
  return network.nodes.map((n) => (pos.has(n.id) ? { ...n, ...pos.get(n.id)! } : n));
}
