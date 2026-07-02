// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Energisation of a single-line network — derived, never stored.
 *
 * The network is treated as an undirected conduction graph whose vertices are
 * **ports** (`nodeId#port`) plus one virtual **center** per node (`nodeId#*`):
 *  - every wire ({@link Edge}) links its two endpoint ports (wires always conduct);
 *  - a node links all of its ports to its center **only when it conducts** —
 *    always for non-switch symbols, and for switchgear only when its live
 *    position is *closed* (a bound datapoint value equal to the node's
 *    `closedValue`; treated as closed when unbound / no live value yet, so a
 *    freshly drawn diagram lights up during design);
 *  - source symbols (`grid-source`, `generator`, `feeder-in`) and any node with
 *    `source = true` seed the search.
 *
 * A breadth-first search from the seeds yields every energised port; a wire is
 * energised when either endpoint is reached, a symbol when any of its ports is.
 * Opening a breaker/disconnector removes its internal link, so everything only
 * reachable through it goes dark — the live wire animation.
 */
import { SYMBOLS } from './symbols/catalog.js';
import type { Network, Node } from './types.js';

/** Port-graph vertex key for a named port of a node. */
export function portKey(nodeId: string, port: string): string {
  return `${nodeId}#${port}`;
}

/** Virtual "internal" vertex linking all conducting ports of a node. */
function centerKey(nodeId: string): string {
  return `${nodeId}#*`;
}

/** Whether a node conducts between its ports given the live closed-state map. */
function conducts(node: Node, closed: Map<string, boolean>): boolean {
  if (SYMBOLS[node.symbol].role !== 'switch') return true;
  // Unbound / no live value yet ⇒ assume closed so the design view is lit.
  return closed.get(node.id) ?? true;
}

/** Whether a node seeds energisation (a supply point). */
function isSource(node: Node): boolean {
  return node.source || SYMBOLS[node.symbol].role === 'source';
}

/** Result of an energisation pass — cheap membership queries for the canvas. */
export interface EnergyState {
  /** True when the wire carries energy. */
  edge(edgeId: string): boolean;
  /** True when any port of the symbol carries energy. */
  node(nodeId: string): boolean;
}

/**
 * Compute the energisation of `network` given the live closed-state of its
 * switchgear (keyed by node id; absent ⇒ assumed closed).
 */
export function computeEnergy(network: Network, closed: Map<string, boolean>): EnergyState {
  const byId = new Map(network.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };

  // Internal links: all ports of a conducting node join through its center.
  for (const node of network.nodes) {
    if (!conducts(node, closed)) continue;
    const center = centerKey(node.id);
    for (const port of Object.keys(SYMBOLS[node.symbol].ports)) {
      link(center, portKey(node.id, port));
    }
  }
  // Wire links: a conductor joins its two endpoint ports.
  for (const edge of network.edges) {
    if (byId.has(edge.from.nodeId) && byId.has(edge.to.nodeId)) {
      link(portKey(edge.from.nodeId, edge.from.port), portKey(edge.to.nodeId, edge.to.port));
    }
  }

  // BFS from every source's ports — a source only seeds when its live
  // supply-state says "powered" (bound DP equal to closedValue; unbound or no
  // value yet ⇒ powered, mirroring the switchgear "assume closed" rule).
  const energised = new Set<string>();
  const queue: string[] = [];
  for (const node of network.nodes) {
    if (!isSource(node)) continue;
    if (!(closed.get(node.id) ?? true)) continue;
    for (const port of Object.keys(SYMBOLS[node.symbol].ports)) {
      const key = portKey(node.id, port);
      if (!energised.has(key)) {
        energised.add(key);
        queue.push(key);
      }
    }
  }
  while (queue.length > 0) {
    const key = queue.shift()!;
    for (const next of adj.get(key) ?? []) {
      if (!energised.has(next)) {
        energised.add(next);
        queue.push(next);
      }
    }
  }

  return {
    edge(edgeId: string): boolean {
      const edge = network.edges.find((e) => e.id === edgeId);
      if (!edge) return false;
      return energised.has(portKey(edge.from.nodeId, edge.from.port)) || energised.has(portKey(edge.to.nodeId, edge.to.port));
    },
    node(nodeId: string): boolean {
      const node = byId.get(nodeId);
      if (!node) return false;
      return Object.keys(SYMBOLS[node.symbol].ports).some((p) => energised.has(portKey(nodeId, p)));
    }
  };
}
