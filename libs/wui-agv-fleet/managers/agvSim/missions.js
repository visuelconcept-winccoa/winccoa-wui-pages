// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Transport orders and the dispatcher.
 *
 * A mission is an ordered list of legs; each leg names a network node to reach
 * and the action performed on arrival. The kinds are real warehouse flows that
 * go INTO the warehouse rather than wandering:
 *
 *   putaway     inbound dock  → rack location            (receive and store)
 *   retrieval   rack location → pick station → dock      (order picking, outbound)
 *   replenish   rack location → rack location            (internal move)
 *   charge      charger bay                              (battery driven)
 *
 * Destinations are RESERVED while a mission holds them, so two vehicles never
 * target the same charger, dock or pick station.
 */
const { RACK_LOCATIONS, nodesOfKind, stationLabel } = require('./network.js');

/** Dwell times, ms — how long a vehicle sits at a station performing its action. */
const DWELL_LOAD_MS = 9000;
const DWELL_UNLOAD_MS = 7000;
const DWELL_HANDOVER_MS = 11_000;
/** Charge until this state of charge, percent. */
const CHARGE_TARGET_PCT = 92;

const ORDER_PREFIX = 'MO-';
const PALLET_PREFIX = 'PL-';
const CART_PREFIX = 'CT-';
const ORDER_SEQ_START = 4475;
const PALLET_SEQ_START = 2211;

let orderSeq = ORDER_SEQ_START;
let palletSeq = PALLET_SEQ_START;

/** Nodes currently promised to a vehicle (station id → vehicle id). */
const reservations = new Map();

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function nextOrderId() {
  orderSeq += 1;
  return `${ORDER_PREFIX}${orderSeq}`;
}

function nextLoadId(kind) {
  palletSeq += 1;
  const prefix = kind === 'replenish' ? CART_PREFIX : PALLET_PREFIX;
  return `${prefix}${palletSeq}`;
}

function isFree(nodeId, vehicleId) {
  const holder = reservations.get(nodeId);
  return holder === undefined || holder === vehicleId;
}

function reserve(nodeId, vehicleId) {
  reservations.set(nodeId, vehicleId);
}

/** Drop every reservation held by a vehicle (mission finished or abandoned). */
function releaseAll(vehicleId) {
  for (const [nodeId, holder] of reservations) {
    if (holder === vehicleId) reservations.delete(nodeId);
  }
}

/** Free station nodes of a kind, honouring reservations. */
function freeNodes(kind, vehicleId) {
  return nodesOfKind(kind).filter((node) => isFree(node.id, vehicleId));
}

/** Free rack locations, honouring reservations. */
function freeRackLocations(vehicleId) {
  return RACK_LOCATIONS.filter((location) => isFree(location.node, vehicleId));
}

function leg(node, action, dwellMs) {
  return { node, action, dwellMs, label: stationLabel(node) };
}

/**
 * Build a mission for `vehicleId`, or null when nothing can be dispatched right
 * now (every candidate destination reserved). Callers retry on the next tick.
 */
function createMission(vehicleId) {
  const kind = pick(['putaway', 'retrieval', 'retrieval', 'replenish']);
  const racks = freeRackLocations(vehicleId);
  if (racks.length < 2) return null;

  if (kind === 'putaway') {
    const dock = pick(freeNodes('dock', vehicleId));
    if (!dock) return null;
    const target = pick(racks);
    return finalize(vehicleId, kind, [
      leg(dock.id, 'load', DWELL_LOAD_MS),
      leg(target.node, 'unload', DWELL_UNLOAD_MS)
    ]);
  }

  if (kind === 'retrieval') {
    const station = pick(freeNodes('pick', vehicleId));
    const dock = pick(freeNodes('dock', vehicleId));
    if (!station || !dock) return null;
    const source = pick(racks);
    return finalize(vehicleId, kind, [
      leg(source.node, 'load', DWELL_LOAD_MS),
      leg(station.id, 'handover', DWELL_HANDOVER_MS),
      leg(dock.id, 'unload', DWELL_UNLOAD_MS)
    ]);
  }

  const source = racks[0];
  const target = racks.find((location) => location.node !== source.node);
  if (!target) return null;
  return finalize(vehicleId, kind, [
    leg(source.node, 'load', DWELL_LOAD_MS),
    leg(target.node, 'unload', DWELL_UNLOAD_MS)
  ]);
}

/** A trip to a free charger, or null when every bay is taken. */
function createChargeMission(vehicleId) {
  const charger = pick(freeNodes('charger', vehicleId));
  if (!charger) return null;
  return finalize(vehicleId, 'charge', [leg(charger.id, 'charge', 0)]);
}

/** A trip back to the parking bay, used when there is nothing to do. */
function createParkMission(vehicleId) {
  const bay = pick(freeNodes('park', vehicleId));
  if (!bay) return null;
  return finalize(vehicleId, 'park', [leg(bay.id, 'park', 0)]);
}

function finalize(vehicleId, kind, legs) {
  for (const item of legs) reserve(item.node, vehicleId);
  return {
    id: nextOrderId(),
    kind,
    legs,
    legIndex: 0,
    load: kind === 'charge' || kind === 'park' ? '' : nextLoadId(kind),
    dwellRemainingMs: 0
  };
}

/** The leg being executed, or null when the mission is complete. */
function currentLeg(mission) {
  return mission && mission.legIndex < mission.legs.length ? mission.legs[mission.legIndex] : null;
}

function isComplete(mission) {
  return !mission || mission.legIndex >= mission.legs.length;
}

/** Human-readable mission text for the page: "MO-4476 → Rack R22". */
function missionText(mission) {
  const active = currentLeg(mission);
  if (!active) return '';
  if (mission.kind === 'charge') return `${mission.id} → ${active.label}`;
  return `${mission.id} → ${active.label}`;
}

/**
 * The payload the vehicle is carrying at this point of the mission: it picks the
 * load up on the first `load` and drops it on the final `unload`.
 */
function payloadOf(mission) {
  if (!mission || mission.kind === 'charge' || mission.kind === 'park') return '';
  const done = mission.legIndex;
  const firstLoad = mission.legs.findIndex((item) => item.action === 'load');
  const lastUnload = mission.legs.length - 1;
  if (firstLoad === -1) return '';
  // Carrying once the load leg has been served, until the final unload is served.
  return done > firstLoad && done <= lastUnload ? mission.load : '';
}

module.exports = {
  CHARGE_TARGET_PCT,
  createMission,
  createChargeMission,
  createParkMission,
  currentLeg,
  isComplete,
  missionText,
  payloadOf,
  releaseAll,
  reservations
};
