// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * gisSim — the network solve: HOW MUCH flows, given who is connected to whom.
 *
 * This is the part that makes the simulation more than 200 independent sine waves. The
 * GIS site already carries a topology (`Connection.from` / `.to` name assets), so the
 * demand of a consumer can be served BY the sources the graph actually connects it to,
 * through the segments that actually join them:
 *
 * - a plant taken out (state 0/3, or `sim:etat=0`) stops feeding, and the cities it fed
 *   are picked up by the plants that remain — every remaining line's flux rises;
 * - a **tripped segment** is removed from the graph, so the flow reroutes if another path
 *   exists and the consumer is under-served if none does (its `couverture` drops and
 *   alarms);
 * - a segment's flux is the sum of what transits it, so it is consistent with both ends
 *   rather than an independent random walk.
 *
 * The allocation is a two-step proportional split, not an AC load flow (this is a
 * supervision demo, not a grid study):
 *
 * 1. every source's capacity is shared between the consumers that can reach it, in
 *    proportion to their demand — so no source is overloaded and no consumer over-served;
 * 2. two rebalancing rounds hand whatever demand is still unserved to whatever capacity is
 *    still spare, proportionally.
 *
 * Routing takes ONE shortest path per (source, consumer) pair and may never transit
 * through another consumer. Meshed networks therefore load one path rather than splitting
 * by impedance — deliberate, and the reason `charge` on a segment is a plausible figure
 * rather than an engineering one.
 *
 * Pure functions over plain objects: no WinCC OA, no timers, so the whole thing is
 * testable and the manager stays about datapoints.
 */
const {
  PROFILE_DAY,
  PROFILE_NIGHT,
  PROFILE_TRANSIT,
  ROLE_SINK,
  ROLE_SOURCE,
  ROLE_STORE,
  ROLE_TRANSIT,
  STATE_FAULT,
  STATE_RUN
} = require('./families.js');

/** Output of a faulted object, as a fraction: degraded, not dead. */
const DERATED = 0.6;
/**
 * Service kept on a **route** that has a section out — the topological coupling of a line.
 *
 * A metro line with one tunnel section closed does not run at 100 % on the sections that are
 * still open: the service is thinned over the whole line and the delays rise everywhere on
 * it. That is what an operator watches for, and the route is what says which sections and
 * which stations are concerned, so it is derived rather than drawn.
 */
const DEGRADED_SERVICE = 0.45;
/** Delays are multiplied by the inverse of the service, capped so they stay believable. */
const MAX_DELAY_FACTOR = 4;
/** Rebalancing rounds after the proportional split (2 is enough to look right). */
const REBALANCE_ROUNDS = 2;
/** A store below this level (%) has nothing left to give downstream. */
const STORE_EMPTY = 3;
/** Level (%) a store tries to hold — its demand is what is missing to reach it. */
const STORE_TARGET = 85;
/** Wander applied to a consumer's demand: slow swell + fast noise, as fractions. */
const DEMAND_SWELL = 0.04;
const DEMAND_NOISE = 0.015;
/** Period (s) of the demand swell — visible on a map watched for a minute. */
const SWELL_PERIOD_S = 90;
/** Free-value wander: share of `span` from the sine, and from the noise. */
const WAVE_SHARE = 0.35;
const NOISE_SHARE = 0.3;
const WAVE_PERIOD_S = 70;
/** Nominal opening / dimming (%) of a running valve or luminaire, before wander. */
const OPENING_NOMINAL = 94;
const OPENING_SPAN = 8;
const PERCENT = 100;
/** √3, for the three-phase current derived from a power and a voltage. */
const SQRT3 = Math.sqrt(3);
const SECONDS_PER_HOUR = 3600;
const MW_TO_W = 1e6;
const KV_TO_V = 1e3;

/**
 * Hourly load factors, midnight → 23 h: the shape of a national daily load curve, with the
 * morning ramp and the evening peak. Interpolated between hours, so nothing steps.
 */
const DAY_CURVE = [
  0.72, 0.68, 0.66, 0.65, 0.66, 0.7, 0.78, 0.88, 0.95, 0.97, 0.96, 0.95, 0.94,
  0.92, 0.9, 0.89, 0.91, 0.95, 0.99, 1, 0.97, 0.92, 0.85, 0.78
];
/** Street lighting: full at night, off in the middle of the day. */
const NIGHT_CURVE = [
  1, 1, 1, 1, 1, 0.9, 0.55, 0.15, 0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.3, 0.65, 0.85,
  0.95, 1, 1, 1
];
/**
 * Ridership and road traffic: two commuting peaks, and almost nothing at night.
 *
 * Distinct from {@link DAY_CURVE} because an electrical load curve never falls below ~65 %
 * of its peak, which on a metro station read as a rush hour at four in the morning.
 */
const TRANSIT_CURVE = [
  0.1, 0.06, 0.06, 0.06, 0.08, 0.2, 0.5, 0.85, 1, 0.85, 0.62, 0.6, 0.65, 0.68,
  0.66, 0.72, 0.82, 0.95, 1, 0.85, 0.62, 0.45, 0.32, 0.2
];

const CURVES = {
  [PROFILE_DAY]: DAY_CURVE,
  [PROFILE_NIGHT]: NIGHT_CURVE,
  [PROFILE_TRANSIT]: TRANSIT_CURVE
};
const MINUTES_PER_HOUR = 60;

/** The daily factor of a profile at this instant, interpolated between the two hours. */
function profileFactor(profile, date) {
  const curve = CURVES[profile];
  if (!curve) return 1;
  const hour = date.getHours();
  const share = date.getMinutes() / MINUTES_PER_HOUR;
  const current = curve[hour];
  const next = curve[(hour + 1) % curve.length];
  return current + (next - current) * share;
}

/** Availability of an object given its state: running, degraded, or out. */
function availability(state) {
  if (state === STATE_RUN) return 1;
  if (state === STATE_FAULT) return DERATED;
  return 0;
}

/**
 * A stable pseudo-random number in [0, 1) derived from a string (FNV-1a).
 *
 * Stable is the point: a plant keeps the same capacity and a consumer the same weight
 * across restarts, so a demo does not change shape between two runs.
 */
function hash01(text) {
  const OFFSET = 0x81_1C_9D_C5;
  const PRIME = 0x01_00_01_93;
  let hash = OFFSET;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, PRIME);
  }
  return ((hash >>> 0) % 100_000) / 100_000;
}

// ---- one pass of the solve -------------------------------------------------

/** Reset the exchanged quantities and compute what each object offers or asks. */
function prepare(net, date) {
  for (const node of net.nodes) {
    const avail = availability(node.state);
    node.capacity = 0;
    node.demand = 0;
    node.flow = 0;
    node.served = 0;
    if (node.role === ROLE_SOURCE || node.role === ROLE_TRANSIT) {
      node.capacity = node.capacityBase * avail;
    }
    if (node.role === ROLE_STORE) {
      node.capacity = node.level > STORE_EMPTY ? node.capacityBase * avail : 0;
      const missing = Math.max(0, (STORE_TARGET - node.level) / STORE_TARGET);
      node.demand = node.capacityBase * avail * missing;
    }
    if (node.role === ROLE_SINK) {
      const swell =
        1 +
        DEMAND_SWELL *
          Math.sin((date.getTime() / 1000 / SWELL_PERIOD_S) * Math.PI * 2 + node.phase);
      const noise = 1 + (Math.random() - 0.5) * 2 * DEMAND_NOISE;
      // A consumer that is out asks for nothing — otherwise a stopped city would keep
      // pulling power and its `couverture` would alarm for the wrong reason.
      node.demand =
        node.demandBase *
        profileFactor(node.family.profile, date) *
        swell *
        noise *
        avail;
    }
  }
  for (const edge of net.edges) {
    edge.capacity = edge.capacityBase * availability(edge.state);
    edge.flow = 0;
  }
  serviceOfRoutes(net);
}

/**
 * The service factor of every segment and every station, from the state of the ROUTES.
 *
 * A segment that is out carries nothing; a segment whose line has a section out runs
 * thinned ({@link DEGRADED_SERVICE}); a station inherits the worst service of the segments
 * that touch it, which is how "the line is interrupted" reaches the platforms.
 */
function serviceOfRoutes(net) {
  const disrupted = new Set();
  for (const edge of net.edges) {
    if (edge.routeId && availability(edge.state) <= 0) disrupted.add(edge.routeId);
  }
  for (const node of net.nodes) node.service = 1;
  for (const edge of net.edges) {
    const lineService = disrupted.has(edge.routeId) ? DEGRADED_SERVICE : 1;
    edge.service = availability(edge.state) <= 0 ? 0 : lineService;
    // The stations at both ends see the LINE's service, not the segment's own: a station
    // beside a closed section is still open, on a line that is running badly.
    edge.from.service = Math.min(edge.from.service, lineService);
    edge.to.service = Math.min(edge.to.service, lineService);
  }
}

/**
 * Adjacency over the segments that are actually in service, both ways.
 *
 * A segment is usable when it is not tripped AND both of its ends are alive: a substation
 * or a pumping station taken out has to block what transited it, not just stop publishing.
 */
function adjacencyOf(net) {
  const links = new Map(net.nodes.map((node) => [node, []]));
  for (const edge of net.edges) {
    if (edge.capacity <= 0) continue;
    if (availability(edge.from.state) <= 0 || availability(edge.to.state) <= 0)
      continue;
    links.get(edge.from)?.push({ edge, other: edge.to });
    links.get(edge.to)?.push({ edge, other: edge.from });
  }
  return links;
}

/**
 * Breadth-first search out of one consumer: which sources it can reach, and by which
 * segment it got to each node (the parent map that reconstructs the path).
 *
 * A path may cross transit nodes, stores and sources, but never another consumer —
 * electricity does not reach Lyon by way of Marseille's meter.
 */
function reachFrom(sink, adjacency) {
  const parent = new Map();
  const seen = new Set([sink]);
  const queue = [sink];
  const sources = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current !== sink && current.role === ROLE_SINK) continue;
    for (const { edge, other } of adjacency.get(current) ?? []) {
      if (seen.has(other)) continue;
      seen.add(other);
      parent.set(other, edge);
      if (other.role === ROLE_SOURCE || other.role === ROLE_STORE)
        sources.push(other);
      queue.push(other);
    }
  }
  return { sources, parent };
}

/** Adjacency over EVERY segment, whatever its state — for sizing, never for flow. */
function structuralAdjacency(net) {
  const links = new Map(net.nodes.map((node) => [node, []]));
  for (const edge of net.edges) {
    links.get(edge.from)?.push({ edge, other: edge.to });
    links.get(edge.to)?.push({ edge, other: edge.from });
  }
  return links;
}

/**
 * The installed capacity each consumer can reach through the topology, ignoring states.
 *
 * A consumer cannot be sized above this: a node wired to one 3 660 MW plant is served by
 * 3 660 MW however big the fleet on the map is, and sizing it beyond that would leave it
 * permanently short — an alarm about the sizing rather than about the plant. Used by
 * `build.js`; the solve itself works on the live adjacency.
 */
function reachableCapacity(net) {
  const adjacency = structuralAdjacency(net);
  const reachable = new Map();
  for (const sink of net.nodes) {
    if (sink.role !== ROLE_SINK) continue;
    const { sources } = reachFrom(sink, adjacency);
    reachable.set(
      sink,
      sources.reduce((total, source) => total + source.capacityBase, 0)
    );
  }
  return reachable;
}

/** The segments between a source and the consumer its plan belongs to. */
function pathEdges(source, plan, net) {
  const edges = [];
  let current = source;
  while (current !== plan.sink) {
    const edge = plan.parent.get(current);
    if (!edge) return edges;
    edges.push(edge);
    current = edge.from === current ? edge.to : edge.from;
    // A malformed parent map must not spin forever.
    if (edges.length > net.edges.length) return edges;
  }
  return edges;
}

/**
 * Step 1: share each source's capacity between the consumers that reach it, in proportion
 * to their demand, then cap each consumer at its own demand. Neither side can be exceeded.
 */
function shareByDemand(plans) {
  const claims = new Map();
  for (const plan of plans) {
    for (const source of plan.sources) {
      claims.set(source, (claims.get(source) ?? 0) + plan.sink.demand);
    }
  }
  for (const plan of plans) {
    let offered = 0;
    for (const source of plan.sources) {
      const claimed = claims.get(source) ?? 0;
      const offer =
        claimed > 0 ? (source.capacity * plan.sink.demand) / claimed : 0;
      plan.alloc.set(source, offer);
      offered += offer;
    }
    const trim = offered > plan.sink.demand ? plan.sink.demand / offered : 1;
    plan.total = 0;
    for (const [source, offer] of plan.alloc) {
      const kept = offer * trim;
      plan.alloc.set(source, kept);
      plan.total += kept;
      source.reserved += kept;
    }
  }
}

/** Steps 2–3: hand the demand still unserved to the capacity still spare. */
function rebalance(plans) {
  for (let round = 0; round < REBALANCE_ROUNDS; round++) {
    for (const plan of plans) {
      const lack = plan.sink.demand - plan.total;
      if (lack <= 0) continue;
      const spare = plan.sources.map((source) =>
        Math.max(0, source.capacity - source.reserved)
      );
      const total = spare.reduce((sum, value) => sum + value, 0);
      if (total <= 0) continue;
      const take = Math.min(lack, total);
      for (const [index, source] of plan.sources.entries()) {
        const add = (take * spare[index]) / total;
        if (add <= 0) continue;
        plan.alloc.set(source, (plan.alloc.get(source) ?? 0) + add);
        source.reserved += add;
        plan.total += add;
      }
    }
  }
}

/** Push the allocations into the objects: source output, consumer served, segment flux. */
function applyFlows(plans, net) {
  for (const plan of plans) {
    for (const [source, amount] of plan.alloc) {
      if (amount <= 0) continue;
      source.flow += amount;
      plan.sink.served += amount;
      for (const edge of pathEdges(source, plan, net)) edge.flow += amount;
    }
  }
  // A transit node carries half the flux of the segments touching it (in = out).
  const touching = new Map();
  for (const edge of net.edges) {
    if (edge.flow <= 0) continue;
    touching.set(edge.from, (touching.get(edge.from) ?? 0) + edge.flow);
    touching.set(edge.to, (touching.get(edge.to) ?? 0) + edge.flow);
  }
  for (const node of net.nodes) {
    if (node.role === ROLE_TRANSIT) node.flow = (touching.get(node) ?? 0) / 2;
    if (node.role === ROLE_SINK) node.flow = node.served;
  }
}

/** Integrate the stores' level and every totaliser, over the elapsed time. */
function integrate(net, dtSeconds) {
  const hours = dtSeconds / SECONDS_PER_HOUR;
  for (const node of net.nodes) {
    if (node.role === ROLE_STORE) {
      const balance = node.served - node.flow;
      node.netflow = balance;
      node.level = Math.min(
        PERCENT,
        Math.max(0, node.level + ((balance * hours) / node.volume) * PERCENT)
      );
    }
    node.total += Math.abs(node.flow) * hours;
  }
  for (const edge of net.edges) edge.total += Math.abs(edge.flow) * hours;
}

/**
 * One solve: what every source produces, every consumer receives and every segment
 * carries, at this instant.
 */
function solve(net, date, dtSeconds) {
  prepare(net, date);
  for (const node of net.nodes) node.reserved = 0;
  const adjacency = adjacencyOf(net);
  const plans = net.nodes
    .filter((node) => node.demand > 0)
    .map((sink) => {
      const found = reachFrom(sink, adjacency);
      return {
        sink,
        // Only what can actually supply right now: a dead source claiming a share of the
        // demand would take it away from the ones still running.
        sources: found.sources.filter((source) => source.capacity > 0),
        parent: found.parent,
        alloc: new Map(),
        total: 0
      };
    });
  shareByDemand(plans);
  rebalance(plans);
  applyFlows(plans, net);
  integrate(net, dtSeconds);
}

// ---- turning an object's state into one datapoint value --------------------

/** Three-phase current (A) equivalent to this power, at the family's voltage. */
function currentOf(object) {
  const kv = object.family.voltageKv ?? 0;
  if (kv <= 0) return 0;
  return (Math.abs(object.flow) * MW_TO_W) / (SQRT3 * kv * KV_TO_V);
}

/**
 * The service multiplier a free value asks for: `route: 'traffic'` falls with the line's
 * service, `route: 'delay'` rises as its inverse (an interrupted line delays everything on
 * it), anything else ignores it.
 */
function serviceMultiplier(object, spec) {
  const service = object.service ?? 1;
  if (spec.route === 'traffic') return service;
  if (spec.route !== 'delay') return 1;
  if (service <= 0) return MAX_DELAY_FACTOR;
  return Math.min(MAX_DELAY_FACTOR, 1 / service);
}

/**
 * A free-running value: its baseline, plus a slow wave and a little noise.
 *
 * The baseline is the object's own when a `sim:<element>=` directive gave it one — that is
 * what tells a busy interchange from a quiet terminus, both of the same family.
 */
function wander(object, spec, date) {
  const seconds = date.getTime() / 1000;
  const base = object.bases?.[spec.el] ?? spec.base;
  // The family states an ABSOLUTE span for its own baseline, so a per-object baseline scales
  // it: the variability that is a property of the family is the RELATIVE one. Left absolute,
  // a station at 800 p/h swung by ±57 % while one at 2 600 swung by ±17 %.
  const span = (spec.span ?? 0) * (spec.base > 0 ? base / spec.base : 1);
  const scale = spec.scale === true ? availability(object.state) : 1;
  const wave =
    Math.sin((seconds / WAVE_PERIOD_S) * Math.PI * 2 + object.phase) *
    span *
    WAVE_SHARE;
  const noise = (Math.random() - 0.5) * 2 * span * NOISE_SHARE;
  // `profile: true` follows the family's curve; a curve NAME follows that one instead, which
  // is how a traffic light's vehicle count can follow the traffic while its power draw
  // follows the electrical day.
  const curve =
    typeof spec.profile === 'string'
      ? spec.profile
      : (object.family.profile ?? PROFILE_DAY);
  const profile = spec.profile ? profileFactor(curve, date) : 1;
  return Math.max(
    0,
    (base * scale + wave + noise) * profile * serviceMultiplier(object, spec)
  );
}

/**
 * Where each derived element takes its number from — the solve has already worked them all
 * out, so this is only a projection. An unknown `from` yields 0 rather than `undefined`,
 * which would reach a datapoint as a NaN.
 */
const DERIVED = {
  flow: (object) => object.flow,
  capacity: (object) => object.capacity,
  demand: (object) => object.demand,
  load: (object) =>
    object.capacityBase > 0
      ? (Math.abs(object.flow) / object.capacityBase) * PERCENT
      : 0,
  coverage: (object) =>
    object.demand > 0 ? (object.served / object.demand) * PERCENT : PERCENT,
  current: (object) => currentOf(object),
  level: (object) => object.level,
  volume: (object) => (object.level / PERCENT) * object.volume,
  netflow: (object) => object.netflow ?? 0,
  // An opening (a valve) or a dimming level (a luminaire): wide open while running.
  opening: (object) =>
    Math.min(
      PERCENT,
      availability(object.state) *
        (OPENING_NOMINAL + (Math.random() - 0.5) * OPENING_SPAN)
    ),
  total: (object) => object.total
};

/** Decimals kept in the datapoint, whatever the reading displays. */
const MAX_STORED_DECIMALS = 3;

/**
 * The value of one element, rounded to what its reading displays.
 *
 * `computed` carries the values already produced for this object **in this tick**, which is
 * what a `ratio` divides — recomputing its operand would give a different figure, since a
 * free value carries noise, and the published percentage would not match the published value
 * it claims to be a percentage of.
 */
function valueOf(object, spec, date, computed = {}) {
  let raw;
  if (spec.from === 'ratio') {
    const of = computed[spec.of] ?? 0;
    raw = object.capacityBase > 0 ? (of / object.capacityBase) * PERCENT : 0;
  } else {
    raw = spec.from
      ? (DERIVED[spec.from]?.(object) ?? 0)
      : wander(object, spec, date);
  }
  const factor = 10 ** Math.min(spec.decimals ?? 1, MAX_STORED_DECIMALS);
  return Math.round(raw * factor) / factor;
}

/** Every value of one object for this tick, in declaration order (a `ratio` needs it). */
function valuesOf(object, date) {
  const computed = {};
  for (const spec of object.family.values) {
    computed[spec.el] = valueOf(object, spec, date, computed);
  }
  return computed;
}

module.exports = {
  DAY_CURVE,
  NIGHT_CURVE,
  STORE_TARGET,
  availability,
  hash01,
  profileFactor,
  reachableCapacity,
  solve,
  valueOf,
  valuesOf
};
