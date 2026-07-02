// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Hades — road-tunnel plant simulator.
 *
 * Runs as a WinCC OA **JavaScript Manager** (WCCOAjsManager): the patched
 * `require('winccoa-manager')` and `new WinccoaManager()` connect to the
 * running project automatically. Register it in `config/progs`, e.g.:
 *
 *   node | manual | 30 | 2 | 2 |hadesSim/index.js
 *
 * What it does, in order:
 *   1. Creates the data model — a `HadesSim` datapoint type (one struct per
 *      equipment: state + the command/measure elements of every catalog kind).
 *   2. Creates one `HadesSim_<equipmentId>` datapoint per equipment found in
 *      the tunnel configs (DP type `Hades_Tunnel`).
 *   3. (AUTO_MAP) Wires each unbound equipment's bindings to its HadesSim DP
 *      and saves the tunnel back, so the page shows the simulation with no
 *      manual mapping. Set AUTO_MAP = false to only create the DPs.
 *   4. Simulates the plant every second: jet fans / lighting / pumps follow
 *      their command elements (written by the page's confirmed dpSets), air
 *      quality drifts (CO / NO₂ / opacity, air speed pulled by the running
 *      fans), and random SOS calls / AID incidents liven the tunnel up.
 *
 * State codes shared with the page: 0 = off, 1 = run, 2 = warning, 3 = fault.
 */
const { WinccoaManager, WinccoaDpTypeNode } = require('winccoa-manager');

const winccoa = new WinccoaManager();

// ---- configuration ---------------------------------------------------------
const SIM_TYPE = 'HadesSim';
const TUNNEL_TYPE = 'Hades_Tunnel';
const SYS = 'System1:';
/** Wire each unbound equipment to its HadesSim DP and persist (recommended). */
const AUTO_MAP = true;
const TICK_MS = 1000;
/** Rescan the tunnel configs (new/renamed equipment) every N ticks. */
const RESCAN_TICKS = 30;

const STATE_OFF = 0;
const STATE_RUN = 1;
const STATE_WARNING = 2;
const STATE_FAULT = 3;

/** WinccoaElementType enum values (see winccoa-manager dptypenode). */
const ELEM = { Struct: 1, Int: 21, Float: 22, Bool: 23, String: 25 };

/** Sim struct elements (superset of every catalog kind's points). */
const SIM_ELEMENTS = [
  { el: 'state', type: ELEM.Int },
  { el: 'cmd', type: ELEM.Int },
  { el: 'speed', type: ELEM.Float },
  { el: 'value', type: ELEM.Float },
  { el: 'level', type: ELEM.Int },
  { el: 'luminance', type: ELEM.Float },
  { el: 'page', type: ELEM.Int },
  { el: 'aspect', type: ELEM.Int },
  { el: 'callActive', type: ELEM.Bool },
  { el: 'doorOpen', type: ELEM.Bool },
  { el: 'incident', type: ELEM.Bool },
  { el: 'alarmPk', type: ELEM.Float },
  { el: 'load', type: ELEM.Float },
  { el: 'pressure', type: ELEM.Float }
];

/** Extra points (besides `state`) auto-mapped per equipment kind (mirrors catalog.ts). */
const KIND_POINTS = {
  'jet-fan': ['cmd', 'speed'],
  lighting: ['level', 'luminance'],
  'sos-niche': ['callActive'],
  'emergency-exit': ['doorOpen'],
  camera: ['incident'],
  'co-sensor': ['value'],
  'no2-sensor': ['value'],
  'opacity-sensor': ['value'],
  anemometer: ['value'],
  'fire-detection': ['alarmPk'],
  vms: ['page'],
  'lane-signal': ['aspect'],
  barrier: ['cmd'],
  pump: ['cmd', 'level'],
  power: ['load'],
  radio: [],
  hydrant: ['pressure']
};

/** Analog baselines per sensor kind: base ± span random walk. */
const SENSOR_BASE = {
  'co-sensor': { base: 25, span: 18, warn: 70 },
  'no2-sensor': { base: 0.3, span: 0.25, warn: 1 },
  'opacity-sensor': { base: 2, span: 1.5, warn: 7 },
  anemometer: { base: 1.2, span: 0.6, warn: 8 }
};

/** Probability per tick of a transient event (SOS call / AID incident). */
const EVENT_PROB = 0.002;
/** Duration of a transient event, in ticks. */
const EVENT_TICKS = 45;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[HadesSim] ${msg}`);
}

function sanitize(id) {
  return String(id).replace(/[^A-Za-z0-9_]/g, '_');
}

function extractString(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

function toNumber(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Random walk around a base value, clamped to [0, base + 3·span]. */
function walk(current, base, span) {
  const drift = (Math.random() - 0.5) * span * 0.4 + (base - current) * 0.05;
  return Math.max(0, Math.min(base + 3 * span, current + drift));
}

// ---- 1. data model ---------------------------------------------------------
async function ensureType() {
  const root = new WinccoaDpTypeNode(
    SIM_TYPE,
    ELEM.Struct,
    '',
    SIM_ELEMENTS.map((e) => new WinccoaDpTypeNode(e.el, e.type))
  );
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${SIM_TYPE}`);
  } catch {
    try {
      await winccoa.dpTypeChange(root);
      log(`Type de données mis à jour : ${SIM_TYPE}`);
    } catch (e) {
      log(`Type de données déjà présent : ${SIM_TYPE} (mise à jour ignorée : ${e})`);
    }
  }
}

async function ensureDp(dpName) {
  if (winccoa.dpExists(`${dpName}.state`)) return;
  try {
    await winccoa.dpCreate(dpName, SIM_TYPE);
    log(`DP créé : ${dpName}`);
  } catch (e) {
    log(`Échec création DP ${dpName} : ${e}`);
  }
}

// ---- 2/3. discover the tunnels, create DPs, (auto) map ----------------------
/** Runtime state, one entry per simulated equipment. */
let sims = [];

function makeSim(dp, equipment) {
  const base = SENSOR_BASE[equipment.kind];
  return {
    dp,
    kind: equipment.kind,
    value: base ? base.base : 0,
    speed: 0,
    level: 45,
    load: 50,
    pressure: 6,
    eventTicks: 0
  };
}

async function setupTunnels() {
  const found = [];
  const tunnelDps = winccoa.dpNames('*', TUNNEL_TYPE);
  for (const name of tunnelDps) {
    const dpName = name.endsWith('.') ? name.slice(0, -1) : name;
    let tunnel;
    try {
      // eslint-disable-next-line no-await-in-loop
      tunnel = JSON.parse(extractString(await winccoa.dpGet(`${dpName}.json`)));
    } catch (e) {
      log(`Tunnel illisible ${dpName} : ${e}`);
      continue;
    }
    const equipmentList = Array.isArray(tunnel.equipment) ? tunnel.equipment : [];
    let mapped = false;
    for (const equipment of equipmentList) {
      const dp = `${SIM_TYPE}_${sanitize(equipment.id)}`;
      // eslint-disable-next-line no-await-in-loop
      await ensureDp(dp);
      found.push(makeSim(dp, equipment));
      // AUTO_MAP only wires equipment not yet bound — never overwrite an
      // equipment the user has already pointed at the real plant.
      const bindings = equipment.bindings || {};
      if (AUTO_MAP && !bindings.state) {
        bindings.state = `${SYS}${dp}.state`;
        for (const point of KIND_POINTS[equipment.kind] || []) {
          bindings[point] = `${SYS}${dp}.${point}`;
        }
        equipment.bindings = bindings;
        mapped = true;
      }
    }
    if (mapped) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await winccoa.dpSetWait(`${dpName}.json`, JSON.stringify(tunnel));
        log(`Tunnel câblé sur la simulation : ${dpName}`);
      } catch (e) {
        log(`Échec écriture tunnel ${dpName} : ${e}`);
      }
    }
  }
  sims = found;
  log(`${sims.length} équipement(s) simulé(s).`);
}

// ---- 4. simulation ----------------------------------------------------------
/** Count of jet fans currently running (pulls the simulated air speed up). */
let runningFans = 0;

/** One equipment tick → { dpes: [], values: [] } to merge into the batch write. */
function tickEquipment(sim, commands) {
  const dpes = [];
  const values = [];
  const set = (el, v) => {
    dpes.push(`${sim.dp}.${el}`);
    values.push(v);
  };

  switch (sim.kind) {
    case 'jet-fan': {
      const cmd = commands.get(`${sim.dp}.cmd`) ?? 0;
      const running = cmd > 0;
      sim.speed = walk(sim.speed, running ? 1450 : 0, 120);
      if (running) runningFans += 1;
      set('speed', Math.round(sim.speed));
      set('state', running ? STATE_RUN : STATE_OFF);
      break;
    }
    case 'lighting': {
      const level = commands.get(`${sim.dp}.level`) ?? 0;
      set('luminance', Math.round(level * 0.06 * 10) / 10);
      set('state', level > 0 ? STATE_RUN : STATE_OFF);
      break;
    }
    case 'sos-niche':
    case 'emergency-exit':
    case 'camera': {
      if (sim.eventTicks > 0) sim.eventTicks -= 1;
      else if (Math.random() < EVENT_PROB) sim.eventTicks = EVENT_TICKS;
      const active = sim.eventTicks > 0;
      const flag = sim.kind === 'sos-niche' ? 'callActive' : sim.kind === 'emergency-exit' ? 'doorOpen' : 'incident';
      set(flag, active);
      set('state', active ? STATE_WARNING : STATE_RUN);
      break;
    }
    case 'co-sensor':
    case 'no2-sensor':
    case 'opacity-sensor':
    case 'anemometer': {
      const cfg = SENSOR_BASE[sim.kind];
      // The running fans push the longitudinal air speed up and dilute CO/opacity.
      const ventilation = sim.kind === 'anemometer' ? runningFans * 0.8 : -runningFans * 1.5;
      sim.value = walk(sim.value, Math.max(0, cfg.base + ventilation), cfg.span);
      set('value', Math.round(sim.value * 100) / 100);
      set('state', sim.value > cfg.warn ? STATE_WARNING : STATE_RUN);
      break;
    }
    case 'fire-detection': {
      set('alarmPk', 0);
      set('state', STATE_RUN);
      break;
    }
    case 'barrier': {
      const cmd = commands.get(`${sim.dp}.cmd`) ?? 0;
      set('state', cmd === 1 ? STATE_WARNING : STATE_RUN);
      break;
    }
    case 'pump': {
      const cmd = commands.get(`${sim.dp}.cmd`) ?? 0;
      const running = cmd > 0 || sim.level > 85;
      sim.level = Math.max(5, Math.min(100, sim.level + (running ? -2.5 : Math.random() * 1.6)));
      set('level', Math.round(sim.level));
      set('state', running ? STATE_RUN : STATE_OFF);
      break;
    }
    case 'power': {
      sim.load = walk(sim.load, 45, 20);
      set('load', Math.round(sim.load));
      set('state', sim.load > 95 ? STATE_WARNING : STATE_RUN);
      break;
    }
    case 'hydrant': {
      sim.pressure = walk(sim.pressure, 6, 0.8);
      set('pressure', Math.round(sim.pressure * 10) / 10);
      set('state', sim.pressure < 4 ? STATE_FAULT : STATE_RUN);
      break;
    }
    default: {
      set('state', STATE_RUN);
      break;
    }
  }
  return { dpes, values };
}

/** Read every command element the tick depends on, in one batched dpGet. */
async function readCommands() {
  const dpes = [];
  for (const sim of sims) {
    if (sim.kind === 'jet-fan' || sim.kind === 'barrier' || sim.kind === 'pump') dpes.push(`${sim.dp}.cmd`);
    if (sim.kind === 'lighting') dpes.push(`${sim.dp}.level`);
  }
  const commands = new Map();
  if (dpes.length === 0) return commands;
  try {
    const raw = await winccoa.dpGet(dpes);
    const values = Array.isArray(raw) ? raw : [raw];
    for (const [i, dpe] of dpes.entries()) commands.set(dpe, toNumber(values[i]));
  } catch (e) {
    log(`dpGet commandes erreur : ${e}`);
  }
  return commands;
}

async function tick() {
  const commands = await readCommands();
  runningFans = 0;
  const dpes = [];
  const values = [];
  for (const sim of sims) {
    const out = tickEquipment(sim, commands);
    dpes.push(...out.dpes);
    values.push(...out.values);
  }
  if (dpes.length === 0) return;
  try {
    winccoa.dpSet(dpes, values);
  } catch (e) {
    log(`dpSet erreur : ${e}`);
  }
}

// ---- main --------------------------------------------------------------------
async function main() {
  await ensureType();
  await setupTunnels();
  let ticks = 0;
  setInterval(() => {
    ticks += 1;
    if (ticks % RESCAN_TICKS === 0) void setupTunnels();
    void tick();
  }, TICK_MS);
  log('Simulation démarrée.');
}

main().catch((e) => {
  log(`Erreur fatale : ${e}`);
  process.exit(1);
});
