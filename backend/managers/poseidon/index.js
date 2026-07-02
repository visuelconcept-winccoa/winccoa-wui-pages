// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Poseidon — wastewater-treatment-plant (WWTP) simulator.
 *
 * Runs as a WinCC OA **JavaScript Manager** (WCCOAjsManager): the patched
 * `require('winccoa-manager')` and `new WinccoaManager()` connect to the running
 * project automatically. Register it in `config/progs`, e.g.:
 *
 *   node | manual | 30 | 2 | 2 |poseidon/index.js
 *
 * Models a conventional activated-sludge plant (water line: screening →
 * lift station → aeration/biology → clarifier → UV disinfection → outfall;
 * sludge line: RAS recirculation, WAS extraction, dewatering). It:
 *   1. Creates the data model — a `Poseidon_Station` DP type (nested structs
 *      for the inlet / biology / clarifier / outlet / sludge / energy sensors)
 *      and a `Poseidon_Equipment` DP type (one per motorised device).
 *   2. Creates the single `Poseidon_Station` DP and one
 *      `Poseidon_Equipment_<id>` DP per device (see EQUIPMENT below).
 *   3. Simulates the process: sensors on a diurnal inflow pattern (every
 *      SENSOR_INTERVAL_MS), coupled to equipment (aeration drives dissolved
 *      oxygen, which drives effluent quality), and equipment run/mode/fault
 *      states (every EQUIP_INTERVAL_MS).
 *   4. **Reacts to operator commands**: each tick it reads every equipment's
 *      `.mode` (0 manual / 1 auto) and `.cmd` (0 stop / 1 start) — written by
 *      the Poseidon page through `/api/poseidon/control`. In manual mode `cmd`
 *      drives the running state; in auto the simulator schedules the device
 *      from the process need. Faults are injected occasionally and auto-clear.
 *
 * The page reads all of this live over the dashboard WebSocket (dpConnect) and
 * derives KPIs / alarms client-side; the `/api/poseidon` backend route reads
 * the same DPs server-side for KPI and regulatory-balance summaries.
 */
const { WinccoaManager, WinccoaDpTypeNode } = require('winccoa-manager');

const winccoa = new WinccoaManager();

// ---- configuration ---------------------------------------------------------
const SYS = 'System1:';
const STATION_TYPE = 'Poseidon_Station';
const STATION_DP = 'Poseidon_Station';
const EQUIP_TYPE = 'Poseidon_Equipment';
const EQUIP_PREFIX = 'Poseidon_Equipment_';

const SENSOR_INTERVAL_MS = 2000;
const EQUIP_INTERVAL_MS = 3000;

/** WinccoaElementType enum values (see winccoa-manager dptypenode). */
const ELEM = { Struct: 1, Int: 21, Float: 22, Bool: 23, String: 25 };

/** Equipment run states (shared with the page). */
const EQ_STOPPED = 0;
const EQ_RUNNING = 1;
const EQ_FAULT = 2;
/** Equipment control modes. */
const MODE_MANUAL = 0;
const MODE_AUTO = 1;

/**
 * The plant's motorised devices. `nominalKw` feeds the energy meter; `duty` is
 * the auto-mode running fraction for intermittent devices (undefined ⇒ the
 * device is scheduled from a process rule in `autoRunning`).
 */
const EQUIPMENT = [
  { id: 'liftPump1', line: 'water', nominalKw: 15 },
  { id: 'liftPump2', line: 'water', nominalKw: 15 },
  { id: 'liftPump3', line: 'water', nominalKw: 15 },
  { id: 'blower1', line: 'water', nominalKw: 45 },
  { id: 'blower2', line: 'water', nominalKw: 45 },
  { id: 'mixer1', line: 'water', nominalKw: 7.5 },
  { id: 'mixer2', line: 'water', nominalKw: 7.5 },
  { id: 'rasPump', line: 'sludge', nominalKw: 11 },
  { id: 'wasPump', line: 'sludge', nominalKw: 5.5, duty: 0.3 },
  { id: 'scraper', line: 'water', nominalKw: 1.5 },
  { id: 'uvReactor', line: 'water', nominalKw: 20 },
  { id: 'centrifuge', line: 'sludge', nominalKw: 30, duty: 0.4 }
];

/** Per-tick probability a running device faults, and a fault clearing. */
const FAULT_PROB = 0.01;
const FAULT_CLEAR_PROB = 0.25;

// ---- runtime state ---------------------------------------------------------
/** Latest simulated sensor values (integrated tick-to-tick). */
const plant = {
  inlet: { flow: 300, ph: 7.4, temperature: 16, cod: 520, bod: 260, tss: 300, nh4: 45 },
  bio: { do: 2.0, redox: 120, mlss: 3800, level: 62, temperature: 15.5 },
  clarifier: { level: 55, sludgeBlanket: 0.6, turbidity: 4 },
  outlet: { flow: 296, ph: 7.2, tss: 12, turbidity: 3, nh4: 2.5, no3: 8, cod: 45 },
  sludge: { flow: 12, dryness: 22 },
  energy: { power: 0, energyToday: 0 }
};
/** Per-equipment runtime, keyed by id: { state, mode, cmd, feedback, current, runningHours, faultTicks }. */
const eq = {};

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[Poseidon] ${msg}`);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Nudge `value` toward `target` by `rate` (0..1), with additive noise. */
function approach(value, target, rate, noise) {
  return value + (target - value) * rate + (Math.random() - 0.5) * noise;
}

function round(v, dp) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

// ---- 1. data model ----------------------------------------------------------
function stationTypeNode() {
  const f = (el, type) => new WinccoaDpTypeNode(el, type);
  const group = (name, children) => new WinccoaDpTypeNode(name, ELEM.Struct, '', children);
  return new WinccoaDpTypeNode(STATION_TYPE, ELEM.Struct, '', [
    group('inlet', [
      f('flow', ELEM.Float), f('ph', ELEM.Float), f('temperature', ELEM.Float),
      f('cod', ELEM.Float), f('bod', ELEM.Float), f('tss', ELEM.Float), f('nh4', ELEM.Float)
    ]),
    group('bio', [
      f('do', ELEM.Float), f('redox', ELEM.Float), f('mlss', ELEM.Float),
      f('level', ELEM.Float), f('temperature', ELEM.Float)
    ]),
    group('clarifier', [f('level', ELEM.Float), f('sludgeBlanket', ELEM.Float), f('turbidity', ELEM.Float)]),
    group('outlet', [
      f('flow', ELEM.Float), f('ph', ELEM.Float), f('tss', ELEM.Float),
      f('turbidity', ELEM.Float), f('nh4', ELEM.Float), f('no3', ELEM.Float), f('cod', ELEM.Float)
    ]),
    group('sludge', [f('flow', ELEM.Float), f('dryness', ELEM.Float)]),
    group('energy', [f('power', ELEM.Float), f('energyToday', ELEM.Float)])
  ]);
}

function equipTypeNode() {
  return new WinccoaDpTypeNode(EQUIP_TYPE, ELEM.Struct, '', [
    new WinccoaDpTypeNode('state', ELEM.Int), // 0 stopped, 1 running, 2 fault
    new WinccoaDpTypeNode('mode', ELEM.Int), // 0 manual, 1 auto
    new WinccoaDpTypeNode('cmd', ELEM.Int), // operator command: 0 stop, 1 start
    new WinccoaDpTypeNode('setpoint', ELEM.Float), // % (e.g. blower airflow / pump speed)
    new WinccoaDpTypeNode('feedback', ELEM.Float), // actual % speed / load
    new WinccoaDpTypeNode('current', ELEM.Float), // motor current (A)
    new WinccoaDpTypeNode('runningHours', ELEM.Float)
  ]);
}

async function ensureType(node, name) {
  try {
    await winccoa.dpTypeCreate(node);
    log(`Type de données créé : ${name}`);
  } catch {
    try {
      await winccoa.dpTypeChange(node);
      log(`Type de données mis à jour : ${name}`);
    } catch (e) {
      log(`Type de données déjà présent : ${name} (mise à jour ignorée : ${e})`);
    }
  }
}

async function ensureDp(dpName, type, probe) {
  if (winccoa.dpExists(`${dpName}.${probe}`)) return;
  try {
    await winccoa.dpCreate(dpName, type);
    log(`DP créé : ${dpName}`);
  } catch (e) {
    log(`Échec création DP ${dpName} : ${e}`);
  }
}

async function setupModel() {
  await ensureType(stationTypeNode(), STATION_TYPE);
  await ensureType(equipTypeNode(), EQUIP_TYPE);
  await ensureDp(STATION_DP, STATION_TYPE, 'inlet.flow');
  for (const e of EQUIPMENT) {
    // eslint-disable-next-line no-await-in-loop
    await ensureDp(`${EQUIP_PREFIX}${e.id}`, EQUIP_TYPE, 'state');
    eq[e.id] = { state: EQ_RUNNING, mode: MODE_AUTO, cmd: 1, feedback: 0, current: 0, runningHours: 0, faultTicks: 0 };
  }
  // Seed persistent operator fields (mode/cmd) once, without clobbering values a
  // returning operator has already set.
  await seedControlFields();
  log(`${EQUIPMENT.length} équipement(s) simulé(s).`);
}

/** Initialise mode/cmd to AUTO/START only where the DB has no value yet. */
async function seedControlFields() {
  const dpes = [];
  const values = [];
  for (const e of EQUIPMENT) {
    const base = `${SYS}${EQUIP_PREFIX}${e.id}`;
    dpes.push(`${base}.mode`, `${base}.cmd`);
    values.push(MODE_AUTO, 1);
  }
  try {
    const current = await winccoa.dpGet(dpes);
    const arr = Array.isArray(current) ? current : [current];
    // If every field already reads a finite number, assume it was set before.
    const seeded = arr.every((v) => Number.isFinite(Number(Array.isArray(v) ? v[0] : v)));
    if (!seeded) safeSet(dpes, values);
  } catch {
    safeSet(dpes, values);
  }
}

// ---- 2. command feedback ----------------------------------------------------
/** Read operator mode/cmd for every device into the runtime cache. */
async function readCommands() {
  const dpes = [];
  for (const e of EQUIPMENT) {
    const base = `${SYS}${EQUIP_PREFIX}${e.id}`;
    dpes.push(`${base}.mode`, `${base}.cmd`);
  }
  try {
    const raw = await winccoa.dpGet(dpes);
    const arr = Array.isArray(raw) ? raw : [raw];
    for (const [i, e] of EQUIPMENT.entries()) {
      const mode = Number(numAt(arr, i * 2));
      const cmd = Number(numAt(arr, i * 2 + 1));
      if (Number.isFinite(mode)) eq[e.id].mode = mode === MODE_AUTO ? MODE_AUTO : MODE_MANUAL;
      if (Number.isFinite(cmd)) eq[e.id].cmd = cmd ? 1 : 0;
    }
  } catch {
    // WebSocket / DB hiccup — keep the last-known commands.
  }
}

function numAt(arr, i) {
  const v = arr[i];
  return Array.isArray(v) ? v[0] : v;
}

// ---- 3. process simulation --------------------------------------------------
/** Number of lift pumps that auto-mode wants running for the current inflow. */
function liftPumpsNeeded(flow) {
  if (flow > 400) return 3;
  if (flow > 220) return 2;
  return 1;
}

/** Whether an auto-mode device should be running this tick. */
function autoRunning(id) {
  const def = EQUIPMENT.find((e) => e.id === id);
  if (def && def.duty != null) return Math.random() < def.duty; // intermittent (WAS, centrifuge)
  if (id.startsWith('liftPump')) {
    const rank = Number(id.slice('liftPump'.length));
    return rank <= liftPumpsNeeded(plant.inlet.flow);
  }
  if (id === 'blower1') return true; // lead blower always on in auto
  if (id === 'blower2') return plant.bio.do < 1.6 || plant.inlet.flow > 380; // lag blower on demand
  return true; // mixers, RAS, scraper, UV run continuously in auto
}

/** Resolve every device's run state from mode + cmd + faults, then set feedback. */
function tickEquipment() {
  const dpes = [];
  const values = [];
  for (const e of EQUIPMENT) {
    const s = eq[e.id];
    // Fault lifecycle first: a faulted device stays down until it clears.
    if (s.state === EQ_FAULT) {
      if (Math.random() < FAULT_CLEAR_PROB) s.state = EQ_STOPPED;
    }
    if (s.state !== EQ_FAULT) {
      const wantRun = s.mode === MODE_AUTO ? autoRunning(e.id) : s.cmd === 1;
      s.state = wantRun ? EQ_RUNNING : EQ_STOPPED;
      if (s.state === EQ_RUNNING && Math.random() < FAULT_PROB) s.state = EQ_FAULT;
    }
    const running = s.state === EQ_RUNNING;
    // Feedback (% load) ramps toward 100 when running, 0 otherwise; current tracks it.
    const target = running ? (e.id.startsWith('blower') ? blowerLoadTarget() : 100) : 0;
    s.feedback = round(clamp(approach(s.feedback, target, 0.4, 3), 0, 105), 1);
    s.current = round(running ? (e.nominalKw * 1.9) * (s.feedback / 100) + (Math.random() - 0.5) : 0, 1);
    if (running) s.runningHours = round(s.runningHours + EQUIP_INTERVAL_MS / 3_600_000, 3);

    const base = `${SYS}${EQUIP_PREFIX}${e.id}`;
    dpes.push(`${base}.state`, `${base}.feedback`, `${base}.current`, `${base}.runningHours`, `${base}.setpoint`);
    values.push(s.state, s.feedback, s.current, s.runningHours, round(target, 0));
  }
  if (dpes.length > 0) safeSet(dpes, values);
}

/** Blower % load modulated to hold the dissolved-oxygen setpoint (~2 mg/L). */
function blowerLoadTarget() {
  return clamp(60 + (2.0 - plant.bio.do) * 40, 25, 100);
}

function runningCount(prefix) {
  return EQUIPMENT.filter((e) => e.id.startsWith(prefix) && eq[e.id].state === EQ_RUNNING).length;
}

/** Diurnal inflow multiplier: low at night, twin morning/evening peaks. */
function diurnalFactor() {
  const hourOfDay = (Date.now() / 3_600_000) % 24;
  const morning = Math.exp(-(((hourOfDay - 9) / 2.2) ** 2));
  const evening = Math.exp(-(((hourOfDay - 20) / 2.6) ** 2));
  return 0.55 + 0.7 * Math.max(morning, evening);
}

function tickSensors() {
  const blowersOn = runningCount('blower');
  const aeration = blowersOn > 0;

  // --- inlet: diurnal load ---
  plant.inlet.flow = round(clamp(approach(plant.inlet.flow, 300 * diurnalFactor(), 0.15, 8), 40, 700), 1);
  plant.inlet.ph = round(clamp(approach(plant.inlet.ph, 7.4, 0.1, 0.05), 6, 9), 2);
  plant.inlet.temperature = round(clamp(approach(plant.inlet.temperature, 16, 0.05, 0.15), 8, 26), 1);
  plant.inlet.cod = round(clamp(approach(plant.inlet.cod, 520, 0.1, 25), 250, 900), 0);
  plant.inlet.bod = round(clamp(plant.inlet.cod * 0.5 + (Math.random() - 0.5) * 15, 120, 500), 0);
  plant.inlet.tss = round(clamp(approach(plant.inlet.tss, 300, 0.1, 20), 120, 600), 0);
  plant.inlet.nh4 = round(clamp(approach(plant.inlet.nh4, 45, 0.1, 3), 20, 80), 1);

  // --- biology: aeration drives dissolved oxygen; DO drives nitrification ---
  const doTarget = aeration ? 1.4 + blowersOn * 0.6 : 0.15;
  plant.bio.do = round(clamp(approach(plant.bio.do, doTarget, 0.25, 0.08), 0, 6), 2);
  plant.bio.redox = round(clamp(approach(plant.bio.redox, aeration ? 140 : -180, 0.2, 8), -350, 300), 0);
  plant.bio.mlss = round(clamp(approach(plant.bio.mlss, 3800, 0.05, 60), 1500, 6000), 0);
  plant.bio.level = round(clamp(approach(plant.bio.level, 55 + plant.inlet.flow / 20, 0.1, 1.5), 20, 100), 1);
  plant.bio.temperature = round(clamp(approach(plant.bio.temperature, plant.inlet.temperature - 0.5, 0.1, 0.1), 8, 26), 1);

  // --- clarifier: separation quality depends on RAS + scraper being on ---
  const separationOk = runningCount('rasPump') > 0 && eq.scraper.state === EQ_RUNNING;
  plant.clarifier.level = round(clamp(approach(plant.clarifier.level, 45 + plant.inlet.flow / 25, 0.1, 1.2), 20, 100), 1);
  plant.clarifier.sludgeBlanket = round(clamp(approach(plant.clarifier.sludgeBlanket, separationOk ? 0.6 : 1.8, 0.08, 0.05), 0.1, 3.2), 2);
  plant.clarifier.turbidity = round(clamp(approach(plant.clarifier.turbidity, separationOk ? 3 : 18, 0.1, 0.6), 0.5, 40), 1);

  // --- outlet: effluent quality = f(aeration quality, separation) ---
  // 1.0 when DO healthy (~2 mg/L) and separation OK; degrades otherwise.
  const doHealth = clamp(1 - Math.abs(plant.bio.do - 2) / 2, 0, 1);
  const quality = clamp((separationOk ? 0.6 : 0.15) + 0.4 * doHealth, 0.1, 1);
  plant.outlet.flow = round(clamp(approach(plant.outlet.flow, plant.inlet.flow - plant.sludge.flow, 0.2, 5), 20, 700), 1);
  plant.outlet.ph = round(clamp(approach(plant.outlet.ph, 7.2, 0.1, 0.04), 6, 9), 2);
  plant.outlet.tss = round(clamp(approach(plant.outlet.tss, 6 + (1 - quality) * 60, 0.15, 1.5), 2, 120), 1);
  plant.outlet.turbidity = round(clamp(approach(plant.outlet.turbidity, 1.5 + (1 - quality) * 25, 0.15, 0.8), 0.3, 60), 1);
  plant.outlet.nh4 = round(clamp(approach(plant.outlet.nh4, 0.5 + (1 - doHealth) * 18, 0.15, 0.4), 0, 40), 2);
  plant.outlet.no3 = round(clamp(approach(plant.outlet.no3, 6 + doHealth * 6, 0.12, 0.6), 1, 30), 1);
  plant.outlet.cod = round(clamp(approach(plant.outlet.cod, 30 + (1 - quality) * 130, 0.15, 4), 15, 250), 0);

  // --- sludge line ---
  const wasOn = eq.wasPump.state === EQ_RUNNING;
  const dewatering = eq.centrifuge.state === EQ_RUNNING;
  plant.sludge.flow = round(clamp(approach(plant.sludge.flow, wasOn ? 18 : 4, 0.2, 1), 1, 30), 1);
  plant.sludge.dryness = round(clamp(approach(plant.sludge.dryness, dewatering ? 24 : 3, 0.15, 0.5), 1, 32), 1);

  // --- energy: sum of running-device draw, plus a running daily total ---
  const power = EQUIPMENT.reduce((sum, e) => sum + (eq[e.id].state === EQ_RUNNING ? e.nominalKw * (eq[e.id].feedback / 100) : 0), 0);
  plant.energy.power = round(power, 1);
  plant.energy.energyToday = round(plant.energy.energyToday + power * (SENSOR_INTERVAL_MS / 3_600_000), 1);

  publishSensors();
}

function publishSensors() {
  const dpes = [];
  const values = [];
  for (const [group, fields] of Object.entries(plant)) {
    for (const [field, value] of Object.entries(fields)) {
      dpes.push(`${SYS}${STATION_DP}.${group}.${field}`);
      values.push(value);
    }
  }
  safeSet(dpes, values);
}

function safeSet(dpes, values) {
  try {
    winccoa.dpSet(dpes, values);
  } catch (e) {
    log(`dpSet erreur : ${e}`);
  }
}

// ---- main -------------------------------------------------------------------
async function main() {
  log('Démarrage du simulateur de station d’épuration…');
  await setupModel();
  await readCommands();
  tickEquipment();
  tickSensors();
  setInterval(async () => {
    await readCommands();
    tickEquipment();
  }, EQUIP_INTERVAL_MS);
  setInterval(tickSensors, SENSOR_INTERVAL_MS);
  log(`Simulation active : capteurs ${SENSOR_INTERVAL_MS}ms, équipements ${EQUIP_INTERVAL_MS}ms.`);
}

main().catch((e) => log(`Erreur fatale : ${e}`));
