// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Machine simulator (module wui-machine-sim) — drives the Machine Fleet 3D
 * ateliers with simulated production, for demos, training and commissioning.
 * NOT for a production system: it creates datapoints and writes values.
 *
 * Runs as a WinCC OA **JavaScript Manager** (WCCOAjsManager): the patched
 * `require('winccoa-manager')` and `new WinccoaManager()` connect to the running
 * project automatically. `wui build` registers it in `config/progs` as
 *
 *   node | manual | 30 | 2 | 2 |machineSim/index.js
 *
 * (`--auto-map` appended to that line opts into AUTO_MAP, below).
 *
 * What it does, in order:
 *   1. Creates the data model — a `MachineSim` datapoint type (one struct per
 *      machine: state / cause / workOrder / operation / comm + parameters).
 *   2. Creates one `MachineSim_<machineId>` datapoint per machine found in the
 *      atelier configs (DP type `MachineFleet3D_Config`).
 *   3. AUTO_MAP — OFF by default. Opt in with `--auto-map` in the progs options
 *      (or MACHINE_SIM_AUTO_MAP=1 in the manager's environment): it then wires
 *      each atelier machine that has no state binding yet to its MachineSim DP
 *      (and a basculeur's tilt to `.angle`) and saves the atelier back, so the
 *      page shows the simulation with no manual mapping. Off, no atelier is
 *      ever written: bind the machines to `MachineSim_<id>.*` by hand in the
 *      3D page's machine dialog.
 *   4. Simulates production: machine STATE changes ~every 30 s; PARAMETERS
 *      change every 500 ms.
 *
 * After a first run with AUTO_MAP, reload the atelier page (Ctrl+F5) so it
 * picks up the new bindings from the datapoints.
 */
const { WinccoaManager, WinccoaDpTypeNode } = require('winccoa-manager');
const { SIM_TYPE, SYS, ALL_PARAMS, autoMapEnabled, planAtelier } = require('./model.js');

const winccoa = new WinccoaManager();

// ---- configuration ---------------------------------------------------------
const CONFIG_TYPE = 'MachineFleet3D_Config';
const STOPCAUSE_DP = 'MachineFleet3D_StopCauses';
/** Wire the unbound atelier machines to their MachineSim DP and persist — opt-in (see header). */
const AUTO_MAP = autoMapEnabled(process.argv, process.env);
const STATE_INTERVAL_MS = 30_000;
const PARAM_INTERVAL_MS = 500;
/** Probability that a stop emits an erroneous code absent from the catalog. */
const ERRONEOUS_CAUSE_PROB = 0.1;
/** Range used to build a random erroneous code (e.g. "X1234"). */
const ERRONEOUS_CAUSE_RANGE = 9000;
const ERRONEOUS_CAUSE_MIN = 1000;

/** WinccoaElementType enum values (see winccoa-manager dptypenode). */
const ELEM = { Struct: 1, Int: 21, Float: 22, Bool: 23, String: 25 };

/** Machine state codes — match the page's default mapping (0..3). */
const STATE_STOP = 0;
const STATE_OK = 1;
const STATE_WARN = 2;
const STATE_MAINT = 3;
/** Current-operation codes: 4-digit, stepped by 10 (0010, 0020, …). */
const OPERATION_CODES = ['0010', '0020', '0030', '0040', '0050', '0060', '0070', '0080'];
/** Characters used to build an 8-char alphanumeric work-order (OF) number. */
const OF_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const OF_LENGTH = 8;

/** Generators for discrete parameters (program / tool numbers). */
function makeDiscrete(kind) {
  if (kind === 'program') return `O${1000 + Math.floor(Math.random() * 9000)}`;
  return `T${String(1 + Math.floor(Math.random() * 24)).padStart(2, '0')}`;
}

/** Runtime state, one entry per simulated machine. */
let sims = [];
/**
 * Stop-cause codes (verbatim strings from the catalog). Starts EMPTY on purpose:
 * until the real catalog is loaded the simulator emits no cause at all (''), so
 * it never injects bogus numeric codes (the old `['1'..'5']` default polluted
 * the `cause` history with values that match no catalog entry).
 */
let causeCodes = [];
/** Last logged code set, so we only log the catalog when it actually changes. */
let causeCodesKey = '';

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[MachineSim] ${msg}`);
}

function extractString(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 8-character alphanumeric work-order (OF) number. */
function randomWorkOrder() {
  let s = '';
  for (let i = 0; i < OF_LENGTH; i++) s += OF_CHARS[Math.floor(Math.random() * OF_CHARS.length)];
  return s;
}

// ---- 1. data model ---------------------------------------------------------
async function ensureType() {
  const root = new WinccoaDpTypeNode(SIM_TYPE, ELEM.Struct, '', [
    new WinccoaDpTypeNode('state', ELEM.Int),
    // String (not Int) so the simulator can emit any catalog code verbatim
    // (incl. non-numeric / leading-zero codes) and the page matches it exactly.
    new WinccoaDpTypeNode('cause', ELEM.String),
    new WinccoaDpTypeNode('workOrder', ELEM.String),
    new WinccoaDpTypeNode('operation', ELEM.String),
    new WinccoaDpTypeNode('comm', ELEM.Bool),
    // Tilt angle (degrees) for `basculeur` machines (drives the 3D tilt + an angle KPI).
    new WinccoaDpTypeNode('angle', ELEM.Float),
    ...ALL_PARAMS.map((p) => new WinccoaDpTypeNode(p.el, p.discrete ? ELEM.String : ELEM.Float))
  ]);
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${SIM_TYPE}`);
  } catch {
    // Already exists — reconcile in place so an older `cause` (Int) becomes a
    // String. Harmless when the type already matches.
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

// ---- 2/3. discover machines, create DPs, (auto) map ------------------------
/**
 * Refresh the stop-cause codes from the catalog DP. Called before every state
 * tick so the simulation tracks catalog edits without a restart. Codes are kept
 * verbatim (strings) so they match the page's catalog lookup exactly.
 */
async function loadCauses() {
  try {
    const raw = await winccoa.dpGet(`${SYS}${STOPCAUSE_DP}.json`);
    const arr = JSON.parse(extractString(raw));
    // Skip the catalog's default ("isDefault") entry: it is a fallback bucket for
    // unknown codes, not a cause the simulator should actively emit.
    const codes = arr
      .filter((c) => !c.isDefault)
      .map((c) => String(c.code))
      .filter((s) => s !== '' && s !== 'undefined');
    if (codes.length > 0) causeCodes = codes;
  } catch {
    // Catalog not available yet — keep the current (default or last-known) codes.
  }
  const key = causeCodes.join(', ');
  if (key !== causeCodesKey) {
    causeCodesKey = key;
    log(`Catalogue causes d'arrêt : ${key}`);
  }
}

async function setupAteliers() {
  const configDps = winccoa.dpNames('*', CONFIG_TYPE);
  for (const name of configDps) {
    const dpName = name.endsWith('.') ? name.slice(0, -1) : name;
    let atelier;
    try {
      atelier = JSON.parse(extractString(await winccoa.dpGet(`${dpName}.json`)));
    } catch (e) {
      log(`Atelier illisible ${dpName} : ${e}`);
      continue;
    }
    // Every machine simulates ALL parameter families, so any KPI binding
    // (process params of any métier) resolves to live values. AUTO_MAP only
    // wires machines not yet bound — never a machine the user configured.
    const { machines, changed } = planAtelier(atelier, AUTO_MAP);
    for (const { dp, isBasculeur } of machines) {
      // eslint-disable-next-line no-await-in-loop
      await ensureDp(dp);
      sims.push(makeSim(dp, isBasculeur));
    }
    if (changed) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await winccoa.dpSetWait(`${dpName}.json`, JSON.stringify(atelier));
        log(`Atelier mappé : ${atelier.name ?? dpName}`);
      } catch (e) {
        log(`Échec écriture atelier ${dpName} : ${e}`);
      }
    }
  }
  log(`${sims.length} machine(s) simulée(s).`);
}

function makeSim(dp, isBasculeur) {
  const params = ALL_PARAMS;
  return {
    dp,
    params,
    isBasculeur: Boolean(isBasculeur),
    /** Feed-per-rev (mm/rev) so the feed rate tracks the spindle realistically. */
    feedPerRev: 0.15 + Math.random() * 0.15,
    state: STATE_OK,
    workOrder: randomWorkOrder(),
    operation: randomItem(OPERATION_CODES),
    // Per-machine baseline (analog) / current value (discrete) so machines don't
    // move in lockstep. Index-aligned with `params`.
    base: params.map((p) => (p.discrete ? null : p.base + (Math.random() - 0.5) * p.span)),
    discrete: params.map((p) => (p.discrete ? makeDiscrete(p.discrete) : null)),
    phase: Math.random() * Math.PI * 2,
    anglePhase: Math.random() * Math.PI * 2
  };
}

// ---- 4. simulation ---------------------------------------------------------
function nextState() {
  const r = Math.random();
  if (r < 0.6) return STATE_OK;
  if (r < 0.75) return STATE_WARN;
  if (r < 0.9) return STATE_STOP;
  return STATE_MAINT;
}

/** A code guaranteed absent from the catalog (e.g. "X1234"). */
function erroneousCode() {
  let code;
  do {
    code = `X${ERRONEOUS_CAUSE_MIN + Math.floor(Math.random() * ERRONEOUS_CAUSE_RANGE)}`;
  } while (causeCodes.includes(code));
  return code;
}

/**
 * Pick a stop-cause code (verbatim from the catalog). Most of the time it is a
 * valid catalog code; with probability ERRONEOUS_CAUSE_PROB it is an
 * out-of-catalog code, so the page exercises its "unknown code → default cause".
 * Returns '' when the catalog is not loaded yet, so the simulator never emits a
 * fabricated numeric code.
 */
function pickCause() {
  if (causeCodes.length === 0) return '';
  if (Math.random() < ERRONEOUS_CAUSE_PROB) return erroneousCode();
  return randomItem(causeCodes);
}

async function tickState() {
  await loadCauses();
  const dpes = [];
  const values = [];
  for (const sim of sims) {
    sim.state = nextState();
    const cause = sim.state === STATE_OK ? '' : pickCause();
    if (Math.random() < 0.3) sim.workOrder = randomWorkOrder();
    sim.operation = randomItem(OPERATION_CODES);
    const comm = Math.random() < 0.97;
    dpes.push(
      `${SYS}${sim.dp}.state`,
      `${SYS}${sim.dp}.cause`,
      `${SYS}${sim.dp}.workOrder`,
      `${SYS}${sim.dp}.operation`,
      `${SYS}${sim.dp}.comm`
    );
    values.push(sim.state, cause, sim.workOrder, sim.operation, comm);
  }
  if (dpes.length > 0) safeSet(dpes, values);
}

/** Probability a discrete parameter changes per tick while running (tool > program). */
const DISCRETE_CHANGE_PROB = { program: 0.01, tool: 0.05 };
/** Tilt (basculeur): 0→90° in 30 s, back down in 30 s ⇒ 3 °/s, 60 s period. */
const TILT_MAX_DEG = 90;
const TILT_RAMP_S = 30;
const TILT_PERIOD_S = TILT_RAMP_S * 2;
const TILT_SPEED_DPS = TILT_MAX_DEG / TILT_RAMP_S;

function tickParams() {
  const now = Date.now() / 1000;
  const dpes = [];
  const values = [];
  for (const sim of sims) {
    // Running scales the parameters; a stopped/maintenance machine flat-lines.
    const factor = sim.state === STATE_OK ? 1 : sim.state === STATE_WARN ? 0.6 : 0;
    // Tilt: triangle 0↔90° (held when stopped); angular speed = derivative (°/s).
    let tiltSpeed = 0;
    if (factor > 0) {
      const tt = (((now + sim.anglePhase) % TILT_PERIOD_S) + TILT_PERIOD_S) % TILT_PERIOD_S;
      const rising = tt < TILT_RAMP_S;
      sim.angle =
        Math.round((rising ? tt / TILT_RAMP_S : (TILT_PERIOD_S - tt) / TILT_RAMP_S) * TILT_MAX_DEG * 10) /
        10;
      tiltSpeed = rising ? TILT_SPEED_DPS : -TILT_SPEED_DPS;
    }
    let brocheValue = 0;
    for (const [i, p] of sim.params.entries()) {
      dpes.push(`${SYS}${sim.dp}.${p.el}`);
      // Basculeur: its "vitesse" is the tilt angular speed (°/s), not rpm.
      if (sim.isBasculeur && p.el === 'vitesse') {
        values.push(Math.abs(tiltSpeed));
        continue;
      }
      // Feed rate follows the spindle (feed = spindle × feed-per-rev), so it is 0
      // when the spindle is stopped and scales realistically with it.
      if (p.el === 'avance') {
        const noise = (Math.random() - 0.5) * 0.04;
        values.push(Math.round(Math.max(0, brocheValue * (sim.feedPerRev + noise)) * 10) / 10);
        continue;
      }
      if (p.discrete) {
        // Program/tool change only while the machine is actually running.
        if (factor > 0 && Math.random() < (DISCRETE_CHANGE_PROB[p.discrete] ?? 0.02)) {
          sim.discrete[i] = makeDiscrete(p.discrete);
        }
        values.push(sim.discrete[i]);
        continue;
      }
      const wave = Math.sin(now * 0.6 + sim.phase + i) * p.span * 0.15;
      const noise = (Math.random() - 0.5) * p.span * 0.1;
      let value = sim.base[i] * (p.el === 'temperature' ? 1 : factor) + wave + noise;
      if (p.el === 'temperature' && factor === 0) value = sim.base[i] * 0.5 + wave; // cools down
      // No negative values (e.g. cadence in p/h); some params are capped (e.g. %).
      value = Math.max(0, value);
      if (p.max != null) value = Math.min(p.max, value);
      value = Math.round(value * 10) / 10;
      if (p.el === 'broche') brocheValue = value;
      values.push(value);
    }
    dpes.push(`${SYS}${sim.dp}.angle`);
    values.push(sim.angle ?? 0);
  }
  if (dpes.length > 0) safeSet(dpes, values);
}

function safeSet(dpes, values) {
  try {
    winccoa.dpSet(dpes, values);
  } catch (e) {
    log(`dpSet erreur : ${e}`);
  }
}

async function main() {
  log('Démarrage du simulateur Machine Fleet 3D…');
  log(
    AUTO_MAP
      ? 'AUTO_MAP actif : les machines non liées des ateliers sont liées à leur DP MachineSim.'
      : 'AUTO_MAP inactif : aucun atelier n’est modifié (option --auto-map pour l’activer).'
  );
  await ensureType();
  await loadCauses();
  await setupAteliers();
  if (sims.length === 0) {
    log('Aucune machine trouvée dans les ateliers — rien à simuler.');
    return;
  }
  await tickState();
  tickParams();
  setInterval(() => void tickState(), STATE_INTERVAL_MS);
  setInterval(tickParams, PARAM_INTERVAL_MS);
  log(`Simulation active : état ~${STATE_INTERVAL_MS / 1000}s, paramètres ${PARAM_INTERVAL_MS}ms.`);
}

main().catch((e) => log(`Erreur fatale : ${e}`));
