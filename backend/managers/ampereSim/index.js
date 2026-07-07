// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Ampère — electrical & railway showcase simulator.
 *
 * Runs as a WinCC OA **JavaScript Manager** (WCCOAjsManager): the patched
 * `require('winccoa-manager')` and `new WinccoaManager()` connect to the running
 * project automatically. Register it in `config/progs`, e.g.:
 *
 *   node | manual | 30 | 2 | 2 |ampereSim/index.js
 *
 * What it does:
 *   1. Creates the data model — a single `AmpereSim` datapoint type (Struct) with
 *      one Bool element per switchgear position, one Bool per source-availability
 *      flag, and one Float per analog measurement.
 *   2. Creates the single shared datapoint `AmpereSim_Demo`.
 *   3. Simulates live behaviour: switchgear positions roll open/closed over time
 *      (with recovery, so the network mostly stays energised), and the analog
 *      measurements wander around their nominal values.
 *
 * ALL Ampère showcases (`libs/wui-ampere/src/ampere/data/demo.ts`) bind their
 * switchgear / sources / measurements to elements of THIS datapoint — so one
 * simulator animates every demo, and the element names here are the contract
 * with the demos (keep the two in sync). No system prefix is used: the DP is
 * created and driven on the manager's own (local) system, and the page's
 * `normDp` normalises any system prefix away when matching.
 */
const { WinccoaManager, WinccoaDpTypeNode } = require('winccoa-manager');

const winccoa = new WinccoaManager();

// ---- configuration ---------------------------------------------------------
const SIM_TYPE = 'AmpereSim';
const SIM_DP = 'AmpereSim_Demo';
const STATE_INTERVAL_MS = 6_000;
const PARAM_INTERVAL_MS = 1_000;

/** WinccoaElementType enum values (see winccoa-manager dptypenode). */
const ELEM = { Struct: 1, Float: 22, Bool: 23 };

/**
 * Switchgear positions (Bool, true = closed/conducting). Must match the element
 * names bound by the demos in demo.ts. Positions that are *normally open* start
 * open (see INITIALLY_OPEN).
 */
const POSITIONS = [
  'incomerDisc1',
  'incomerDisc2',
  'incomerBreaker1',
  'incomerBreaker2',
  'trafoBreaker1',
  'trafoBreaker2',
  'busCoupler',
  'mainBreaker',
  'feeder1',
  'feeder2',
  'feeder3',
  'feeder4',
  'loopSwitch1',
  'loopSwitch2',
  'changeoverNormal',
  'changeoverBackup',
  'disconnector',
  'tractionBreaker',
  'sectioning',
  'paralleling'
];
/** Positions that begin OPEN (normally-open tie devices). */
const INITIALLY_OPEN = new Set(['busCoupler', 'paralleling']);

/** Source-availability flags (Bool, true = powered/available). */
const SOURCES = ['gridAvailable', 'line1', 'line2', 'gensetRunning'];

/** Analog measurements (Float): base value + wander span (units are the demo's). */
const ANALOG = [
  { el: 'voltageMv', base: 20, span: 0.3 },
  { el: 'voltageLv', base: 400, span: 5 },
  { el: 'voltageDc', base: 1500, span: 20 },
  { el: 'voltageAc', base: 25, span: 0.3 },
  { el: 'currentIncomer1', base: 180, span: 60 },
  { el: 'currentIncomer2', base: 170, span: 60 },
  { el: 'currentMain', base: 220, span: 90 },
  { el: 'currentTraction', base: 900, span: 350 },
  { el: 'currentTrack1', base: 600, span: 260 },
  { el: 'currentTrack2', base: 560, span: 260 }
];

/** Per-tick probability a source flag flips (kept low; grid/lines never black out). */
const SOURCE_FLIP_PROB = 0.06;
const SOURCE_FLIPPABLE = new Set(['gensetRunning']);

// ---- runtime state ----------------------------------------------------------
/** Live position states, keyed by element (true = closed). */
const positionState = new Map();
/** Live source states, keyed by element (true = available). */
const sourceState = new Map();
/** Per-analog phase so measurements do not move in lockstep. */
const analogPhase = new Map();

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[AmpereSim] ${msg}`);
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- 1. data model ----------------------------------------------------------
function buildType() {
  const children = [
    ...POSITIONS.map((el) => new WinccoaDpTypeNode(el, ELEM.Bool)),
    ...SOURCES.map((el) => new WinccoaDpTypeNode(el, ELEM.Bool)),
    ...ANALOG.map((a) => new WinccoaDpTypeNode(a.el, ELEM.Float))
  ];
  return new WinccoaDpTypeNode(SIM_TYPE, ELEM.Struct, '', children);
}

async function ensureType() {
  const root = buildType();
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${SIM_TYPE}`);
  } catch {
    // Already exists — reconcile in place (adds any new element) then continue.
    try {
      await winccoa.dpTypeChange(root);
      log(`Type de données mis à jour : ${SIM_TYPE}`);
    } catch (e) {
      log(`Type de données déjà présent : ${SIM_TYPE} (mise à jour ignorée : ${e})`);
    }
  }
}

async function ensureDp() {
  if (winccoa.dpExists(`${SIM_DP}.${POSITIONS[0]}`)) return;
  try {
    await winccoa.dpCreate(SIM_DP, SIM_TYPE);
    log(`DP créé : ${SIM_DP}`);
  } catch (e) {
    log(`Échec création DP ${SIM_DP} : ${e}`);
  }
}

// ---- 2. initial values ------------------------------------------------------
function seedState() {
  for (const el of POSITIONS) positionState.set(el, !INITIALLY_OPEN.has(el));
  for (const el of SOURCES) sourceState.set(el, true);
  for (const a of ANALOG) analogPhase.set(a.el, Math.random() * Math.PI * 2);
}

function writeAllStates() {
  const dpes = [];
  const values = [];
  for (const [el, v] of positionState) {
    dpes.push(`${SIM_DP}.${el}`);
    values.push(v);
  }
  for (const [el, v] of sourceState) {
    dpes.push(`${SIM_DP}.${el}`);
    values.push(v);
  }
  safeSet(dpes, values);
}

// ---- 3. simulation ----------------------------------------------------------
/**
 * Roll the switchgear: invert one random position (a new event), then — half the
 * time — re-close one currently-open position (recovery), so the network keeps
 * cycling through faults without drifting fully open. Sources rarely flip
 * (genset only); the grid/lines never black out.
 */
function tickState() {
  const dpes = [];
  const values = [];

  const toggled = randomItem(POSITIONS);
  positionState.set(toggled, !positionState.get(toggled));
  dpes.push(`${SIM_DP}.${toggled}`);
  values.push(positionState.get(toggled));

  if (Math.random() < 0.5) {
    const open = POSITIONS.filter((el) => !positionState.get(el) && el !== toggled);
    if (open.length > 0) {
      const recover = randomItem(open);
      positionState.set(recover, true);
      dpes.push(`${SIM_DP}.${recover}`);
      values.push(true);
    }
  }

  for (const el of SOURCES) {
    if (SOURCE_FLIPPABLE.has(el) && Math.random() < SOURCE_FLIP_PROB) {
      sourceState.set(el, !sourceState.get(el));
      dpes.push(`${SIM_DP}.${el}`);
      values.push(sourceState.get(el));
    }
  }

  safeSet(dpes, values);
}

/** Wander every analog measurement around its nominal value (sine + noise). */
function tickParams() {
  const now = Date.now() / 1000;
  const dpes = [];
  const values = [];
  for (const a of ANALOG) {
    const wave = Math.sin(now * 0.3 + analogPhase.get(a.el)) * a.span * 0.5;
    const noise = (Math.random() - 0.5) * a.span * 0.4;
    const value = Math.max(0, Math.round((a.base + wave + noise) * 10) / 10);
    dpes.push(`${SIM_DP}.${a.el}`);
    values.push(value);
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
  log('Démarrage du simulateur Ampère…');
  await ensureType();
  await ensureDp();
  seedState();
  writeAllStates();
  tickParams();
  setInterval(tickState, STATE_INTERVAL_MS);
  setInterval(tickParams, PARAM_INTERVAL_MS);
  log(
    `Simulation active sur ${SIM_DP} : ${POSITIONS.length} organes, ${SOURCES.length} sources, ` +
      `${ANALOG.length} mesures (état ${STATE_INTERVAL_MS / 1000}s, mesures ${PARAM_INTERVAL_MS}ms).`
  );
}

main().catch((e) => log(`Erreur fatale : ${e}`));
