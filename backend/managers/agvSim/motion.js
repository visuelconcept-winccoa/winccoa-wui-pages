// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Motion along the guide-path network.
 *
 * A vehicle is described by the node it last passed plus the remaining node path
 * and how far it has progressed along the current edge. Its position is ALWAYS
 * the interpolation of that one edge — there is no code path that moves a vehicle
 * toward a target in a straight line, which is what guarantees it never crosses
 * the racking.
 */
const { nodes, route } = require('./network.js');

const FULL_CIRCLE_DEG = 360;
const HALF_CIRCLE_DEG = 180;
const DEG_PER_RAD = HALF_CIRCLE_DEG / Math.PI;
/** Distance below which we treat the vehicle as standing on the node, metres. */
const EPSILON_M = 1e-6;

/**
 * Heading in degrees clockwise from north, for a hall where y grows DOWNWARD.
 * Worked cases: +x → 90, −y → 0, +y → 180, −x → 270.
 */
function headingOf(dx, dy) {
  const deg = Math.atan2(dx, -dy) * DEG_PER_RAD;
  return (deg + FULL_CIRCLE_DEG) % FULL_CIRCLE_DEG;
}

/** Fresh motion state parked on a node. */
function spawnAt(nodeId) {
  const node = nodes.get(nodeId);
  if (!node) throw new Error(`spawnAt: unknown node ${nodeId}`);
  return {
    atNode: nodeId,
    path: [nodeId],
    progressM: 0,
    x: node.x,
    y: node.y,
    heading: 0
  };
}

/** True when the vehicle has no edge left to travel. */
function isArrived(motion) {
  return motion.path.length <= 1;
}

/** The node the vehicle is currently heading for, or null when arrived. */
function nextNode(motion) {
  return motion.path.length > 1 ? motion.path[1] : null;
}

/**
 * Plan a route to `destId`. Returns false when the destination is unreachable,
 * in which case the vehicle keeps its current position untouched.
 */
function setDestination(motion, destId) {
  const path = route(motion.atNode, destId);
  if (!path) return false;
  motion.path = path;
  motion.progressM = 0;
  return true;
}

/** Position and heading refreshed from the current edge and progress. */
function project(motion) {
  const from = nodes.get(motion.atNode);
  const toId = nextNode(motion);
  if (!toId) {
    motion.x = from.x;
    motion.y = from.y;
    return;
  }
  const to = nodes.get(toId);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const ratio = length <= EPSILON_M ? 0 : motion.progressM / length;
  motion.x = from.x + dx * ratio;
  motion.y = from.y + dy * ratio;
  motion.heading = headingOf(dx, dy);
}

/**
 * Advance up to `metres` along the planned path and return the distance actually
 * travelled. Leftover distance carries into the following edge, so a long tick
 * may cross several short edges without losing or teleporting distance.
 */
function advance(motion, metres) {
  let budget = Math.max(0, metres);
  let travelled = 0;
  while (budget > EPSILON_M) {
    const toId = nextNode(motion);
    if (!toId) break;
    const from = nodes.get(motion.atNode);
    const to = nodes.get(toId);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const remaining = length - motion.progressM;
    if (budget < remaining) {
      motion.progressM += budget;
      travelled += budget;
      budget = 0;
      break;
    }
    // Reached the next node: consume the edge and continue with what is left.
    travelled += remaining;
    budget -= remaining;
    motion.atNode = toId;
    motion.path.shift();
    motion.progressM = 0;
  }
  project(motion);
  return travelled;
}

/** Remaining path length in metres — used to pace approach speed. */
function remainingDistance(motion) {
  let total = 0;
  for (let i = 0; i + 1 < motion.path.length; i++) {
    const a = nodes.get(motion.path[i]);
    const b = nodes.get(motion.path[i + 1]);
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return Math.max(0, total - motion.progressM);
}

module.exports = {
  headingOf,
  spawnAt,
  isArrived,
  nextNode,
  setDestination,
  advance,
  project,
  remainingDistance
};
