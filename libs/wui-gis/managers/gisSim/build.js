// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * gisSim — turning GIS sites into the graph the solve runs on.
 *
 * Sizing lives here, and it is what makes a site nobody tuned look right:
 *
 * - **capacity / demand** come from the object's `notes` (`sim:capacite=`, `sim:demande=`)
 *   when they are stated, else from the family default spread by a stable hash of the id, so
 *   two plants of the same family are not clones;
 * - a **segment** is sized from its ends — just above the smaller of what the two can
 *   exchange, because a 2 600 MW plant feeding a 15 000 MW city needs a 2 600 MW line;
 * - the consumers nobody sized are then **scaled to the production available in their
 *   domain**, so the sources sit near {@link BALANCE_TARGET} of their capacity instead of at
 *   5 % of it, which reads as a broken simulation rather than a quiet plant.
 *
 * Free of any WinCC OA dependency, like `families.js` and `network.js`: the manager does the
 * datapoints, this does the model.
 */
const fam = require('./families.js');
const { STORE_TARGET, hash01, reachableCapacity } = require('./network.js');

/** A segment is sized just above what its ends can exchange. */
const EDGE_MARGIN = 1.25;
/** Spread applied to a family's default capacity/demand, from the object's own hash. */
const SPREAD_MIN = 0.6;
const SPREAD_RANGE = 0.8;
/** Share of the available production the unsized consumers are scaled to ask for. */
const BALANCE_TARGET = 0.78;

function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

/** One simulated asset. `kept` is its state from before a refresh, when it survived one. */
function makeNode(asset, connections, stem, kept) {
  const resolved = fam.familyOfAsset(asset, connections);
  const family = fam.ASSET_FAMILIES[resolved.name];
  const hints = fam.directives(asset.notes);
  const { bases, unknown } = fam.baselinesOf(hints, family);
  const spread = SPREAD_MIN + SPREAD_RANGE * hash01(stem);
  const statedDemand = fam.numberOf(hints['demande']);
  const forced = fam.numberOf(hints['etat']);
  return {
    stem,
    label: asset.name || asset.id,
    isEdge: false,
    famName: resolved.name,
    reason: resolved.reason,
    family,
    role: family.role,
    bases,
    unknownHints: unknown,
    capacityBase: round(
      fam.numberOf(hints['capacite']) ?? (family.capacity ?? 0) * spread
    ),
    demandBase: round(statedDemand ?? (family.demand ?? 0) * spread),
    statedDemand: statedDemand !== null,
    volume: fam.numberOf(hints['volume']) ?? family.volume ?? 1,
    forcedState: forced,
    state: forced ?? kept?.state ?? fam.STATE_RUN,
    level: kept?.level ?? STORE_TARGET,
    total: kept?.total ?? 0,
    phase: hash01(stem) * Math.PI * 2,
    capacity: 0,
    demand: 0,
    flow: 0,
    served: 0,
    reserved: 0,
    netflow: 0
  };
}

/** One simulated segment; its capacity is sized from its ends by {@link sizeEdges}. */
function makeEdge(link, stem, from, to, kept) {
  const resolved = fam.familyOfLink(link);
  const family = fam.LINK_FAMILIES[resolved.name];
  const hints = fam.directives(link.notes);
  const { bases, unknown } = fam.baselinesOf(hints, family);
  const stated = fam.numberOf(hints['capacite']);
  const forced = fam.numberOf(hints['etat']);
  return {
    stem,
    label: link.name || link.id,
    isEdge: true,
    famName: resolved.name,
    reason: resolved.reason,
    family,
    from,
    to,
    bases,
    unknownHints: unknown,
    // The line this segment belongs to: what makes an interruption anywhere on it degrade
    // the service of every other section and of the stations along it (see `network.js`).
    routeId: typeof link.routeId === 'string' ? link.routeId : '',
    capacityBase: stated ?? family.capacity,
    statedCapacity: stated !== null,
    forcedState: forced,
    state: forced ?? kept?.state ?? fam.STATE_RUN,
    total: kept?.total ?? 0,
    phase: hash01(stem) * Math.PI * 2,
    capacity: 0,
    flow: 0
  };
}

/** What an end of a segment can exchange: a consumer's demand, anything else's capacity. */
function exchangeBase(node) {
  return node.role === fam.ROLE_SINK ? node.demandBase : node.capacityBase;
}

function sizeEdges(edges) {
  for (const edge of edges) {
    if (edge.statedCapacity) continue;
    const ends = [exchangeBase(edge.from), exchangeBase(edge.to)].filter(
      (value) => value > 0
    );
    const reference = ends.length > 0 ? Math.min(...ends) : edge.family.capacity;
    edge.capacityBase = round(reference * EDGE_MARGIN);
  }
}

/**
 * Scale the consumers whose demand is not stated, so the sources of their domain run at a
 * believable load factor. Domains are handled separately: a water network and an electrical
 * one on the same map have nothing to balance against each other.
 *
 * Then cap each of them at what the topology can actually bring it — see
 * {@link reachableCapacity}. Without that cap a domain-wide scaling oversizes the consumers
 * of a thinly-fed branch, and they stay permanently short: an alarm about the sizing instead
 * of one about the plant.
 *
 * A **stated** demand is never touched, only reported when its sources cannot follow: the
 * author said what they meant, and an under-served consumer may well be the point.
 */
function balanceDemand(net, log) {
  const { nodes } = net;
  for (const domain of new Set(nodes.map((node) => node.family.domain))) {
    if (!domain) continue;
    const local = nodes.filter((node) => node.family.domain === domain);
    const supply = sum(
      local
        .filter(
          (node) =>
            node.role === fam.ROLE_SOURCE || node.role === fam.ROLE_STORE
        )
        .map((node) => node.capacityBase)
    );
    const sinks = local.filter((node) => node.role === fam.ROLE_SINK);
    const scalable = sinks.filter((node) => !node.statedDemand);
    const current = sum(scalable.map((node) => node.demandBase));
    const stated = sum(
      sinks.filter((node) => node.statedDemand).map((node) => node.demandBase)
    );
    const target = supply * BALANCE_TARGET - stated;
    if (supply <= 0 || current <= 0 || target <= 0) continue;
    const factor = target / current;
    for (const node of scalable) node.demandBase = round(node.demandBase * factor);
    log?.(
      `Domaine ${domain} : ${scalable.length} consommateur(s) mis à l'échelle ` +
        `×${round(factor, 2)} (production ${round(supply)}, cible ${round(supply * BALANCE_TARGET)}).`
    );
  }
  const reachable = reachableCapacity(net);
  const short = [];
  for (const [node, capacity] of reachable) {
    const feasible = round(capacity * BALANCE_TARGET);
    if (node.statedDemand) {
      if (node.demandBase > capacity && capacity >= 0) {
        short.push(`${node.label} (${node.demandBase} > ${round(capacity)})`);
      }
      continue;
    }
    if (node.demandBase > feasible) node.demandBase = feasible;
  }
  if (short.length > 0) {
    log?.(
      `⚠ ${short.length} consommateur(s) demandent plus que les sources raccordées ne ` +
        `peuvent fournir — ils resteront en sous-alimentation : ${short.join(', ')}`
    );
  }
}

/**
 * The whole simulation, from every site in the project.
 *
 * `previous` carries the runtime state (state, level, totalisers) of the objects that were
 * already simulated, keyed by datapoint stem, so a refresh does not reset the world.
 *
 * Ids are unique **within** a site, so the same id in two sites would claim the same
 * datapoints: the second is skipped and reported rather than driven from two places.
 */
function buildNetwork(sites, { previous = new Map(), log } = {}) {
  const nodes = [];
  const edges = [];
  const stems = new Set();
  const collisions = [];
  for (const site of sites) {
    const assets = Array.isArray(site.assets) ? site.assets : [];
    const connections = Array.isArray(site.connections) ? site.connections : [];
    const byId = new Map();
    for (const asset of assets) {
      if (!asset?.id) continue;
      const stem = fam.assetStem(asset.id);
      if (stems.has(stem)) {
        collisions.push(stem);
        continue;
      }
      stems.add(stem);
      const node = makeNode(asset, connections, stem, previous.get(stem));
      nodes.push(node);
      byId.set(asset.id, node);
    }
    for (const link of connections) {
      if (!link?.id) continue;
      const from = byId.get(link.from);
      const to = byId.get(link.to);
      // A dangling or self connection is not drawn on the map either (normalize.ts).
      if (!from || !to || from === to) continue;
      const stem = fam.linkStem(link.id);
      if (stems.has(stem)) {
        collisions.push(stem);
        continue;
      }
      stems.add(stem);
      edges.push(makeEdge(link, stem, from, to, previous.get(stem)));
    }
  }
  const net = { nodes, edges, collisions };
  // Sizing needs the topology (a consumer cannot be sized above what reaches it), and the
  // segments are then sized from the consumers' final demand — hence this order.
  balanceDemand(net, log);
  sizeEdges(edges);
  // A `sim:` key that names nothing is silent otherwise, and silence here costs an afternoon.
  const strays = [...nodes, ...edges].flatMap((object) =>
    object.unknownHints.map((key) => `${object.label}/sim:${key}`)
  );
  if (strays.length > 0) {
    log?.(
      `⚠ ${strays.length} directive(s) sim: ignorée(s) — clé inconnue de la famille de ` +
        `l'objet : ${strays.join(', ')}`
    );
  }
  return net;
}

module.exports = {
  BALANCE_TARGET,
  buildNetwork,
  exchangeBase,
  makeEdge,
  makeNode,
  sizeEdges
};
