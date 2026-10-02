// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * AGV Fleet — mission simulator.
 *
 * Runs as a WinCC OA **JavaScript Manager** (WCCOAjsManager): the patched
 * `require('winccoa-manager')` and `new WinccoaManager()` connect to the running
 * project automatically. Register it in `config/progs`, e.g.:
 *
 *   node | manual | 30 | 2 | 2 |agvSim/index.js
 *
 * What it does:
 *   1. Ensures the `AGV_Vehicle` datapoint type and `AGV_01..AGV_08` exist.
 *   2. Places every vehicle on the guide-path network (see network.js) — the
 *      seeded demo positions were free-floating, several of them off any aisle.
 *   3. Dispatches real transport orders (dock → rack putaway, rack → pick
 *      station → dock retrieval, internal replenishment) and battery-driven
 *      charging trips.
 *   4. Drives each vehicle ALONG THE AISLES only: routing is a shortest path over
 *      the graph and motion is interpolation along one edge, so a vehicle can
 *      never cross the racking. `assertRackSafe()` proves the network itself is
 *      clean at startup and the manager refuses to start otherwise.
 *   5. Writes the changed datapoint elements once per tick.
 *
 * The page (`/agv-fleet`) is a pure read-only supervision view — it follows these
 * datapoints through dpConnect and contains no simulation code.
 */
const { WinccoaManager, WinccoaDpTypeNode } = require('winccoa-manager');

const net = require('./network.js');
const motion = require('./motion.js');
const missions = require('./missions.js');
const book = require('./book.js');

const winccoa = new WinccoaManager();

// ---- configuration ---------------------------------------------------------
const SIM_TYPE = 'AGV_Vehicle';
const FLEET_SIZE = 8;
/** Simulation + write cadence. 2 Hz reads as fluid once the map interpolates. */
const TICK_MS = 500;
/** Slow-moving values are written less often to keep the write rate down. */
const SLOW_EVERY_TICKS = 8;
/** Mission-book publication cadence (ticks) — the board does not need 2 Hz. */
const BOOK_EVERY_TICKS = 2;

/** Single datapoint carrying the full mission book as JSON (see book.js). */
const BOOK_TYPE = 'AGV_MissionBook';
const BOOK_DP = 'AGV_MissionBook';
/** Single datapoint the page writes operator commands to. */
const COMMAND_TYPE = 'AGV_Command';
const COMMAND_DP = 'AGV_Command';

/** WinccoaElementType enum values (see winccoa-manager dptypenode). */
const ELEM = { Struct: 1, Int: 21, Float: 22, Bool: 23, String: 25 };

/** `state` element encoding — the INDEX must match AGV_STATES in the page's types.ts. */
const STATE = { idle: 0, moving: 1, charging: 2, loading: 3, error: 4, offline: 5 };

/** Battery thresholds, percent — mirror BATTERY_LOW_PCT / BATTERY_CRITICAL_PCT. */
const BATTERY_LOW_PCT = 35;
const BATTERY_FULL_PCT = 100;
/** Drain per second while driving / while dwelling, and recharge per second. */
const DRAIN_DRIVING_PCT_S = 0.05;
const DRAIN_IDLE_PCT_S = 0.008;
const CHARGE_PCT_S = 0.55;

/** Travel speed, m/s, and the approach speed used near a destination. */
const CRUISE_SPEED_MS = 1.35;
const APPROACH_SPEED_MS = 0.45;
const APPROACH_DISTANCE_M = 2.5;
const METRES_PER_KM = 1000;

/**
 * Fleet roster. Two vehicles are deliberately parked out of service so the page's
 * KPI bar and "needs attention" filter keep demonstrating something: AGV_04 holds
 * a fault and AGV_07 is offline in maintenance. The rest run missions.
 */
const ROSTER = [
  { id: 'AGV_01', name: 'AGV-01 Atlas', model: 'Tugger T200', home: 'SP_8.5', odometer: 1284.6, missions: 37 },
  { id: 'AGV_02', name: 'AGV-02 Boreas', model: 'Tugger T200', home: 'C1A', odometer: 2044.9, missions: 21, start: 'charging' },
  { id: 'AGV_03', name: 'AGV-03 Cyclops', model: 'Forklift F450', home: 'A1_26', odometer: 3711.2, missions: 29 },
  { id: 'AGV_04', name: 'AGV-04 Dorado', model: 'Forklift F450', home: 'A3_20', odometer: 2890.4, missions: 14, start: 'error', errorText: 'E-312 Obstacle detected — path blocked' },
  { id: 'AGV_05', name: 'AGV-05 Echo', model: 'Tugger T200', home: 'Z0', odometer: 954.3, missions: 8 },
  { id: 'AGV_06', name: 'AGV-06 Fenrir', model: 'Tunnel U150', home: 'RS_25.5', odometer: 1620.8, missions: 33 },
  { id: 'AGV_07', name: 'AGV-07 Gale', model: 'Tunnel U150', home: 'M1', odometer: 4102.5, missions: 0, start: 'offline', errorText: 'Offline — scheduled maintenance (drive wheel)' },
  { id: 'AGV_08', name: 'AGV-08 Hyperion', model: 'Forklift F450', home: 'A0_20', odometer: 2260.1, missions: 26 }
];

/** Runtime state, one entry per vehicle. */
let sims = [];
let tickCount = 0;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[AgvSim] ${msg}`);
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---- 1. data model ---------------------------------------------------------
async function ensureType() {
  const root = new WinccoaDpTypeNode(SIM_TYPE, ELEM.Struct, '', [
    new WinccoaDpTypeNode('name', ELEM.String),
    new WinccoaDpTypeNode('model', ELEM.String),
    new WinccoaDpTypeNode('state', ELEM.Int),
    new WinccoaDpTypeNode('battery', ELEM.Float),
    new WinccoaDpTypeNode('speed', ELEM.Float),
    new WinccoaDpTypeNode('posX', ELEM.Float),
    new WinccoaDpTypeNode('posY', ELEM.Float),
    new WinccoaDpTypeNode('heading', ELEM.Float),
    new WinccoaDpTypeNode('zone', ELEM.String),
    new WinccoaDpTypeNode('mission', ELEM.String),
    new WinccoaDpTypeNode('payload', ELEM.String),
    new WinccoaDpTypeNode('errorText', ELEM.String),
    new WinccoaDpTypeNode('odometer', ELEM.Float),
    new WinccoaDpTypeNode('missionsToday', ELEM.Int)
  ]);
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${SIM_TYPE}`);
  } catch {
    log(`Type de données déjà présent : ${SIM_TYPE}`);
  }
}

async function ensureDps() {
  for (const vehicle of ROSTER) {
    if (winccoa.dpExists(`${vehicle.id}.state`)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop -- a handful of datapoints, once
      await winccoa.dpCreate(vehicle.id, SIM_TYPE);
      log(`DP créé : ${vehicle.id}`);
    } catch (e) {
      log(`Échec création DP ${vehicle.id} : ${e}`);
    }
  }
}

/** A one-element `{ json: String }` type, used for the book and the command queue. */
async function ensureJsonDp(typeName, dpName) {
  const root = new WinccoaDpTypeNode(typeName, ELEM.Struct, '', [
    new WinccoaDpTypeNode('json', ELEM.String)
  ]);
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${typeName}`);
  } catch {
    // Already exists.
  }
  if (winccoa.dpExists(`${dpName}.json`)) return;
  try {
    await winccoa.dpCreate(dpName, typeName);
    log(`DP créé : ${dpName}`);
  } catch (e) {
    log(`Échec création DP ${dpName} : ${e}`);
  }
}

// ---- 2. seed ---------------------------------------------------------------
function seed() {
  sims = ROSTER.map((vehicle) => {
    const start = vehicle.start || 'idle';
    return {
      ...vehicle,
      motion: motion.spawnAt(vehicle.home),
      state: start,
      battery: start === 'charging' ? 34.1 : 55 + Math.random() * 40,
      speed: 0,
      mission: null,
      zone: net.stationLabel(vehicle.home),
      payload: '',
      errorText: vehicle.errorText || '',
      odometerM: vehicle.odometer * METRES_PER_KM,
      missionsToday: vehicle.missions,
      /** Out-of-service vehicles never get dispatched. */
      parked: start === 'error' || start === 'offline',
      written: new Map()
    };
  });
  log(`Flotte initialisée : ${sims.length} véhicules sur le réseau de guidage`);
}

// ---- 3. simulation ---------------------------------------------------------
/** Give an idle vehicle something to do. */
function dispatch(sim) {
  if (sim.parked) return;
  if (sim.battery < BATTERY_LOW_PCT) {
    sim.mission = missions.createChargeMission(sim.id);
    if (sim.mission) return;
  }
  sim.mission = missions.createMission(sim.id) || missions.createParkMission(sim.id);
}

/** Move toward the current leg's node; returns metres travelled this tick. */
function drive(sim, dtSeconds) {
  const leg = missions.currentLeg(sim.mission);
  if (!leg) return 0;
  if (motion.isArrived(sim.motion) && sim.motion.atNode !== leg.node) {
    if (!motion.setDestination(sim.motion, leg.node)) {
      // Unreachable (should not happen on a connected network) — drop the mission.
      missions.releaseAll(sim.id);
      sim.mission = null;
      return 0;
    }
  }
  const remaining = motion.remainingDistance(sim.motion);
  const speed = remaining < APPROACH_DISTANCE_M ? APPROACH_SPEED_MS : CRUISE_SPEED_MS;
  const travelled = motion.advance(sim.motion, speed * dtSeconds);
  sim.speed = travelled / dtSeconds;
  return travelled;
}

/** Serve the current leg once the vehicle has reached it. */
function serveLeg(sim, dtMs) {
  const leg = missions.currentLeg(sim.mission);
  if (!leg) return;
  if (leg.action === 'charge') {
    sim.state = 'charging';
    sim.battery = Math.min(BATTERY_FULL_PCT, sim.battery + CHARGE_PCT_S * (dtMs / 1000));
    if (sim.battery >= missions.CHARGE_TARGET_PCT) finishLeg(sim);
    return;
  }
  if (leg.action === 'park') {
    sim.state = 'idle';
    finishLeg(sim);
    return;
  }
  sim.state = 'loading';
  sim.mission.dwellRemainingMs -= dtMs;
  if (sim.mission.dwellRemainingMs <= 0) finishLeg(sim);
}

function finishLeg(sim) {
  sim.mission.legIndex += 1;
  const next = missions.currentLeg(sim.mission);
  if (next) {
    sim.mission.dwellRemainingMs = next.dwellMs;
    return;
  }
  // Mission complete.
  if (sim.mission.kind !== 'charge' && sim.mission.kind !== 'park') {
    sim.missionsToday += 1;
  }
  missions.releaseAll(sim.id);
  sim.mission = null;
  sim.state = 'idle';
  sim.speed = 0;
}

function tick() {
  tickCount += 1;
  const dtSeconds = TICK_MS / 1000;
  for (const sim of sims) {
    if (sim.parked) {
      sim.speed = 0;
      continue;
    }
    if (missions.isComplete(sim.mission)) dispatch(sim);
    const leg = missions.currentLeg(sim.mission);
    if (!leg) {
      sim.state = 'idle';
      sim.speed = 0;
      sim.battery = Math.max(0, sim.battery - DRAIN_IDLE_PCT_S * dtSeconds);
      continue;
    }
    if (sim.motion.atNode === leg.node && motion.isArrived(sim.motion)) {
      if (sim.mission.dwellRemainingMs <= 0 && leg.action !== 'charge' && leg.action !== 'park') {
        sim.mission.dwellRemainingMs = leg.dwellMs;
      }
      sim.speed = 0;
      serveLeg(sim, TICK_MS);
      sim.battery = Math.max(0, sim.battery - DRAIN_IDLE_PCT_S * dtSeconds);
    } else {
      sim.state = 'moving';
      const travelled = drive(sim, dtSeconds);
      sim.odometerM += travelled;
      sim.battery = Math.max(0, sim.battery - DRAIN_DRIVING_PCT_S * dtSeconds);
    }
    sim.zone = net.stationLabel(sim.motion.atNode);
    sim.payload = missions.payloadOf(sim.mission);
  }
  writeFleet();
  if (tickCount % BOOK_EVERY_TICKS === 0) publishBook();
}

// ---- operator command channel ----------------------------------------------
/**
 * Drain `AGV_Command.json`, apply each command and clear the queue. Read before
 * every simulation step so an operator action takes effect on the next tick.
 * The channel is untrusted input: `applyCommand` validates action and vehicle.
 */
function drainCommands() {
  let json = '';
  try {
    const raw = winccoa.dpGet(`${COMMAND_DP}.json`);
    json = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
  } catch {
    return;
  }
  if (!json || json === '""') return;
  const list = book.parseCommands(json);
  // Clear first, so a command that throws cannot be replayed in a loop.
  safeSet([`${COMMAND_DP}.json`], ['']);
  for (const command of list) book.applyCommand(sims, command, { log });
  if (list.length > 0) publishBook();
}

function publishBook() {
  safeSet([`${BOOK_DP}.json`], [JSON.stringify(book.serialize(sims))]);
}

// ---- 4. datapoint writes ---------------------------------------------------
/** Element values for one vehicle; `slow` adds the low-frequency ones. */
function elementsOf(sim, slow) {
  const values = {
    state: STATE[sim.state],
    posX: round(sim.motion.x, 2),
    posY: round(sim.motion.y, 2),
    heading: round(sim.motion.heading, 1),
    speed: round(sim.speed, 2),
    zone: sim.zone,
    mission: missions.missionText(sim.mission),
    payload: sim.payload
  };
  if (slow) {
    values.battery = round(sim.battery, 1);
    values.odometer = round(sim.odometerM / METRES_PER_KM, 1);
    values.missionsToday = sim.missionsToday;
  }
  return values;
}

/**
 * Write only what CHANGED, batched into a single dpSet for the whole fleet.
 * Worst case is 8 vehicles x 11 elements = 88 values, but a steady state moves
 * only the driving vehicles' position/heading/speed — roughly 20-30 values per
 * tick, i.e. one dpSet call every 500 ms.
 */
function writeFleet() {
  const slow = tickCount % SLOW_EVERY_TICKS === 0;
  const dpes = [];
  const values = [];
  for (const sim of sims) {
    const next = elementsOf(sim, slow);
    for (const [element, value] of Object.entries(next)) {
      if (sim.written.get(element) === value) continue;
      sim.written.set(element, value);
      dpes.push(`${sim.id}.${element}`);
      values.push(value);
    }
  }
  safeSet(dpes, values);
}

/** Write the identity/static elements once at startup. */
function writeIdentity() {
  const dpes = [];
  const values = [];
  for (const sim of sims) {
    dpes.push(`${sim.id}.name`, `${sim.id}.model`, `${sim.id}.errorText`);
    values.push(sim.name, sim.model, sim.errorText);
    dpes.push(`${sim.id}.battery`, `${sim.id}.odometer`, `${sim.id}.missionsToday`);
    values.push(round(sim.battery, 1), round(sim.odometerM / METRES_PER_KM, 1), sim.missionsToday);
  }
  safeSet(dpes, values);
}

function safeSet(dpes, values) {
  if (dpes.length === 0) return;
  try {
    winccoa.dpSet(dpes, values);
  } catch (e) {
    log(`dpSet erreur : ${e}`);
  }
}

// ---- main -------------------------------------------------------------------
async function main() {
  log('Démarrage du simulateur AGV…');
  // Fail fast if the layout was edited into an unsafe state.
  const shape = net.assertRackSafe();
  log(`Réseau de guidage vérifié : ${shape.nodes} nœuds, ${shape.edges} segments, aucun ne traverse un rack`);
  await ensureType();
  await ensureDps();
  await ensureJsonDp(BOOK_TYPE, BOOK_DP);
  await ensureJsonDp(COMMAND_TYPE, COMMAND_DP);
  seed();
  writeIdentity();
  safeSet([`${COMMAND_DP}.json`], ['']);
  tick();
  setInterval(() => {
    drainCommands();
    tick();
  }, TICK_MS);
  log(
    `Simulation active : ${FLEET_SIZE} AGV, missions réelles (quai → rack, rack → poste de prélèvement → quai), ` +
      `cadence ${TICK_MS} ms, carnet de missions sur ${BOOK_DP}.json, commandes sur ${COMMAND_DP}.json`
  );
}

main().catch((e) => log(`Erreur fatale : ${e}`));
