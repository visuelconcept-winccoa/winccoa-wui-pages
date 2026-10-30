// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Machine simulator — the pure part: the simulated parameters, the AUTO_MAP
 * opt-in, and what AUTO_MAP does to an atelier. No WinCC OA access here, so it
 * is unit-tested (`libs/wui-machine-sim/test/`) without a running project.
 */

const SIM_TYPE = 'MachineSim';
const SYS = 'System1:';

/**
 * Domain parameters per process family (KPI bindings). Analog params have
 * `base`/`span` (+ optional `max`); discrete params have `discrete` (a generator
 * kind) and are stored as String (e.g. a program/tool number).
 */
const GENERIC_PARAMS = [
  { el: 'cadence', label: 'Cadence', unit: 'p/h', base: 60, span: 15 },
  { el: 'temperature', label: 'Température', unit: '°C', base: 70, span: 25 },
  { el: 'vitesse', label: 'Vitesse', unit: 'tr/min', base: 1500, span: 400 },
  { el: 'charge', label: 'Charge', unit: '%', base: 55, span: 30, max: 100 }
];
const USINAGE_PARAMS = [
  { el: 'programme', label: '# Programme', unit: '', discrete: 'program' },
  { el: 'outil', label: '# Outil', unit: '', discrete: 'tool' },
  { el: 'broche', label: 'Vitesse broche', unit: 'tr/min', base: 3500, span: 2500 },
  { el: 'avance', label: "Vitesse d'avance", unit: 'mm/min', base: 900, span: 600 }
];
const SOUDAGE_PARAMS = [
  { el: 'tension', label: 'Tension', unit: 'V', base: 24, span: 8 },
  { el: 'intensite', label: 'Intensité', unit: 'A', base: 180, span: 80 },
  { el: 'vitesseSoudage', label: 'Vitesse de soudage', unit: 'cm/min', base: 40, span: 20 }
];
const PARAM_SETS = {
  generic: GENERIC_PARAMS,
  usinage: USINAGE_PARAMS,
  soudage: SOUDAGE_PARAMS
};
/** Union of every parameter element (drives the DP type). Deduped by `el`. */
const ALL_PARAMS = [...GENERIC_PARAMS, ...USINAGE_PARAMS, ...SOUDAGE_PARAMS].filter(
  (p, i, arr) => arr.findIndex((q) => q.el === p.el) === i
);
/** Machine types that default to the `usinage` family (mirrors wui-fleet-core types.ts). */
const USINAGE_TYPES = new Set(['tour', 'fraiseuse', 'brocheuse', 'scie']);
const SOUDAGE_KEYS = new Set(['tension', 'intensite', 'vitesseSoudage']);
const USINAGE_KEYS = new Set(['programme', 'outil', 'broche', 'avance', 'vitesseBroche', 'vitesseAvance']);

/** The state mapping AUTO_MAP adds to an atelier that has none with this id. */
const DEFAULT_MAPPING = {
  id: 'default',
  name: 'Standard (0=arrêt, 1=ok, 2=défaut, 3=maint)',
  fallback: 'stop',
  rules: [
    { state: 'stop', min: 0, max: 0 },
    { state: 'ok', min: 1, max: 1 },
    { state: 'warn', min: 2, max: 2 },
    { state: 'maint', min: 3, max: 3 }
  ]
};

const TRUE_WORDS = new Set(['1', 'true', 'yes', 'on']);

/**
 * AUTO_MAP is OFF unless asked for: `--auto-map` among the manager's options
 * (its `config/progs` line), or `MACHINE_SIM_AUTO_MAP=1` (`true`, `yes`, `on`)
 * in its environment. Off, the simulator only creates and drives its own
 * `MachineSim_*` datapoints and never writes an atelier.
 *
 * @param {string[]} argv the manager's arguments (`process.argv`)
 * @param {Record<string, string | undefined>} env its environment (`process.env`)
 * @returns {boolean}
 */
function autoMapEnabled(argv, env) {
  if (argv.includes('--auto-map')) return true;
  return TRUE_WORDS.has(String(env.MACHINE_SIM_AUTO_MAP ?? '').trim().toLowerCase());
}

function sanitize(id) {
  return String(id).replace(/[^A-Za-z0-9_]/g, '_');
}

/** The simulated datapoint of a machine: `MachineSim_<sanitized id>`. */
function simDpName(machineId) {
  return `${SIM_TYPE}_${sanitize(machineId)}`;
}

/** Process family for AUTO_MAP: explicit `process`, else machine type, else
 * inferred from any existing KPI bindings, else generic. */
function resolveFamily(machine) {
  if (machine.process === 'usinage' || machine.process === 'soudage' || machine.process === 'generic') {
    return machine.process;
  }
  if (USINAGE_TYPES.has(machine.type)) return 'usinage';
  const keys = (machine.kpis || []).map((k) => k.key);
  if (keys.some((k) => SOUDAGE_KEYS.has(k))) return 'soudage';
  if (keys.some((k) => USINAGE_KEYS.has(k))) return 'usinage';
  return 'generic';
}

function mapMachine(machine, dp, family) {
  machine.stateDp = `${SYS}${dp}.state`;
  machine.stateMappingId = 'default';
  machine.stopCauseDp = `${SYS}${dp}.cause`;
  machine.workOrderDp = `${SYS}${dp}.workOrder`;
  machine.operationDp = `${SYS}${dp}.operation`;
  machine.commDp = `${SYS}${dp}.comm`;
  machine.kpis = (PARAM_SETS[family] || GENERIC_PARAMS).map((p, i) => ({
    key: p.el,
    label: p.label,
    unit: p.unit,
    dp: `${SYS}${dp}.${p.el}`,
    showInCard: true,
    showInBubble: i === 0
  }));
}

/** A basculeur's tilt follows the simulated `.angle`, even on a machine already mapped. */
function mapBasculeur(machine, dp) {
  let changed = false;
  const angleDp = `${SYS}${dp}.angle`;
  if (machine.tiltDp !== angleDp) {
    machine.tiltDp = angleDp;
    changed = true;
  }
  for (const k of machine.kpis || []) {
    if ((k.key === 'angle' || /angle/i.test(k.label || '')) && k.dp !== angleDp) {
      k.dp = angleDp;
      changed = true;
    }
    // The basculeur's "vitesse" is the tilt angular speed in °/s.
    if (k.key === 'vitesse' && k.unit !== '°/s') {
      k.unit = '°/s';
      changed = true;
    }
  }
  return changed;
}

/**
 * The machines of one atelier the simulator drives and, with AUTO_MAP, the
 * atelier wired to them. Mutates `atelier` only when `autoMap` is true; then
 * only machines without a `stateDp` are wired (a machine the user configured
 * keeps its bindings), except a basculeur's tilt, pointed at its `.angle`.
 *
 * @returns {{ machines: { dp: string, isBasculeur: boolean }[], changed: boolean }}
 *   `changed`: the atelier was modified and must be written back.
 */
function planAtelier(atelier, autoMap) {
  const list = Array.isArray(atelier.machines) ? atelier.machines : [];
  const machines = [];
  let changed = false;
  for (const m of list) {
    const dp = simDpName(m.id);
    machines.push({ dp, isBasculeur: m.type === 'basculeur' });
    if (!autoMap) continue;
    if (!m.stateDp) {
      mapMachine(m, dp, resolveFamily(m));
      changed = true;
    }
    if (m.type === 'basculeur' && mapBasculeur(m, dp)) changed = true;
  }
  if (changed) {
    if (!Array.isArray(atelier.mappings)) atelier.mappings = [];
    if (!atelier.mappings.some((mp) => mp.id === 'default')) atelier.mappings.push({ ...DEFAULT_MAPPING });
  }
  return { machines, changed };
}

module.exports = {
  SIM_TYPE,
  SYS,
  PARAM_SETS,
  ALL_PARAMS,
  DEFAULT_MAPPING,
  autoMapEnabled,
  sanitize,
  simDpName,
  resolveFamily,
  planAtelier
};
