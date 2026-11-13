// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Machine Fleet — real-time KPI calculator (WinCC OA JavaScript Manager).
 *
 * For every KPI configured on a machine (atelier config `kpiCalcs[]`: type
 * TRS/MTBF/MTTR, sliding `window`, `refreshMin`), this manager:
 *   1. ensures a `MachineFleet3D_Kpi` datapoint exists (one per KPI),
 *   2. NGA-archives its `.value` element (so trends/curves can be drawn),
 *   3. recomputes the KPI over its sliding window from the archived `state`
 *      (+ `cause`) history every `refreshMin` minutes and writes `.value`. That history
 *      is the one Machine Fleet's state manager records (fleetState, winccoa-fra-msp-stma#339):
 *      `MachineFleet3D_State_<machine>.state` (state keys of the machine's mapping) and `.cause`.
 *
 * Formulas (sliding window W):
 *   - opening = W − closures − time in states their mapping marks `outsideOpening`.
 *   - production = opening − non-production time; non-production = state ≠ ok.
 *   - each non-production interval is classified by the cause active at its
 *     start: catalog classification `planned` ⇒ planned downtime; anything else
 *     (unplanned / unknown / no cause) ⇒ unplanned downtime ("failure").
 *   - TRS  = (required − unplanned) / required × 100   (required = W − planned)
 *   - MTBF = production / max(#failures,1)              (minutes)
 *   - MTTR = unplanned / #failures                      (minutes, 0 if none)
 *
 * Register in config/progs:  node | always | 30 | 2 | 2 |kpiCalc/index.js
 * After editing this file, restart the kpiCalc manager.
 */
const { WinccoaManager, WinccoaDpTypeNode } = require('winccoa-manager');
const { clipMerge, stateRecordDp, recordsState, computeValue } = require('./kpi-math.js');

const winccoa = new WinccoaManager();

const KPI_TYPE = 'MachineFleet3D_Kpi';
const KPI_PREFIX = 'MachineFleet3D_Kpi_';
const CONFIG_TYPE = 'MachineFleet3D_Config';
/**
 * Stop-cause catalogues (#74 of winccoa-wui-pages), one DP each of this type: the default one is
 * `MachineFleet3D_StopCauses`, the single catalogue of before; any other `MachineFleet3D_StopCauses_<id>`.
 */
const STOPCAUSE_TYPE = 'MachineFleet3D_StopCauses';
const STOPCAUSE_DP = 'MachineFleet3D_StopCauses';
const CLOSURES_DP = 'MachineFleet3D_Closures';
const SYS = 'System1:';
const ELEM = { Struct: 1, Float: 22, String: 25 };

const BASE_TICK_MS = 15_000;
const RELOAD_MS = 60_000;
const MS_PER_MINUTE = 60_000;
const BOUNDARY_COUNT = 2; // extra samples before/after window for dpGetPeriod

/** WinCC OA NGA archive-config constants (DPCONFIG/DPATTR). */
const ARCHIVE_INFO = 45;
const ARCH_PROC_VALARCH = 15;

const WINDOW_MS = {
  '1h': 3_600_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '24h': 86_400_000,
  '1w': 604_800_000,
  '1mo': 2_592_000_000
};

let archiveGroup = '';
/** kpiKey → next epoch ms at which the KPI must be recomputed. */
const nextDue = new Map();
/** DPEs whose archiving has already been ensured this process. */
const archived = new Set();
/**
 * Per stop-cause catalogue id: code → classification ('planned'|'unplanned'|'production'), plus __default
 * (the class of the catalogue's default entry). 'default': the catalogue of a machine naming none.
 */
let causeClasses = {};
/** Closures config { ateliers:{id:[{start,end}]}, machines:{id:[...]} }. */
let closures = { ateliers: {}, machines: {} };

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[KpiCalc] ${msg}`);
}

function sanitize(id) {
  return String(id).replace(/[^A-Za-z0-9_]/g, '_');
}

function extractString(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

function toNumber(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toMs(t) {
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  return new Date(String(t)).getTime();
}

// ---- data model ------------------------------------------------------------

async function ensureType() {
  const root = new WinccoaDpTypeNode(KPI_TYPE, ELEM.Struct, '', [
    new WinccoaDpTypeNode('value', ELEM.Float),
    new WinccoaDpTypeNode('kpiType', ELEM.String),
    new WinccoaDpTypeNode('machineId', ELEM.String),
    new WinccoaDpTypeNode('machineName', ELEM.String),
    new WinccoaDpTypeNode('window', ELEM.String),
    new WinccoaDpTypeNode('unit', ELEM.String),
    new WinccoaDpTypeNode('updatedAt', ELEM.String)
  ]);
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${KPI_TYPE}`);
  } catch {
    // already exists
  }
}

/** Discover an NGA archive group to assign computed values to. */
function findArchiveGroup() {
  try {
    const names = winccoa.dpNames('*', '_NGA_Group') || [];
    for (const n of names) {
      const bare = n.includes(':') ? n.slice(n.indexOf(':') + 1) : n;
      const clean = bare.endsWith('.') ? bare.slice(0, -1) : bare;
      if (clean && !clean.endsWith('_2')) return clean;
    }
  } catch (e) {
    log(`Groupes d'archive introuvables : ${e}`);
  }
  return '';
}

async function ensureArchived(valueDpe, group) {
  if (!group) return;
  const key = `${valueDpe}|${group}`;
  if (archived.has(key)) return;
  try {
    await winccoa.dpSetWait(`${valueDpe}:_archive.._type`, ARCHIVE_INFO);
    await winccoa.dpSetWait(`${valueDpe}:_archive.1._type`, ARCH_PROC_VALARCH);
    await winccoa.dpSetWait(`${valueDpe}:_archive.1._class`, group);
    await winccoa.dpSetWait(`${valueDpe}:_archive.._archive`, true);
    // Reset the cache for this DPE: drop any prior group/off marker, keep this one.
    for (const k of [...archived]) if (k.startsWith(`${valueDpe}|`)) archived.delete(k);
    archived.add(key);
  } catch (e) {
    log(`Échec activation archivage ${valueDpe} : ${e}`);
  }
}

/** Turn archiving OFF for a value DPE (when the KPI's archive flag is cleared). */
async function disableArchived(valueDpe) {
  const key = `${valueDpe}|off`;
  if (archived.has(key)) return;
  try {
    await winccoa.dpSetWait(`${valueDpe}:_archive.._archive`, false);
    for (const k of [...archived]) if (k.startsWith(`${valueDpe}|`)) archived.delete(k);
    archived.add(key);
  } catch (e) {
    log(`Échec désactivation archivage ${valueDpe} : ${e}`);
  }
}

/** code → classification of one list of causes, plus __default. */
function classesOf(causes) {
  const map = {};
  let def = 'unplanned';
  for (const c of Array.isArray(causes) ? causes : []) {
    if (c && c.code) map[String(c.code)] = c.classification || 'unplanned';
    if (c && c.isDefault) def = c.classification || 'unplanned';
  }
  map.__default = def;
  return map;
}

/** The catalogue id of a catalogue DP name ('default' for MachineFleet3D_StopCauses), '' for another DP. */
function catalogIdOfDp(name) {
  const dp = String(name).replace(/^[^:]*:/, '').replace(/\.$/, '');
  if (dp === STOPCAUSE_DP) return 'default';
  return dp.startsWith(`${STOPCAUSE_DP}_`) ? dp.slice(STOPCAUSE_DP.length + 1) : '';
}

/** The classification of every stop-cause catalogue (#74), one DP each; the default one is 'default'. */
async function loadCauseClassification() {
  const read = async (dp) => {
    try {
      return JSON.parse(extractString(await winccoa.dpGet(`${SYS}${dp}.json`)));
    } catch {
      return null;
    }
  };
  let names = [];
  try {
    names = winccoa.dpNames(`${STOPCAUSE_DP}*`, STOPCAUSE_TYPE) || [];
  } catch {
    names = []; // no catalogue type yet
  }
  causeClasses = {};
  for (const name of names) {
    const id = catalogIdOfDp(name);
    if (id) causeClasses[id] = classesOf(await read(id === 'default' ? STOPCAUSE_DP : `${STOPCAUSE_DP}_${id}`));
  }
  if (!causeClasses.default) causeClasses.default = classesOf(null);
}

async function loadClosures() {
  try {
    const cfg = JSON.parse(extractString(await winccoa.dpGet(`${SYS}${CLOSURES_DP}.json`)));
    closures = {
      global: cfg && Array.isArray(cfg.global) ? cfg.global : [],
      ateliers: cfg && cfg.ateliers ? cfg.ateliers : {},
      machines: cfg && cfg.machines ? cfg.machines : {}
    };
  } catch {
    closures = { global: [], ateliers: {}, machines: {} };
  }
}

/** Classify a cause code in a machine's catalogue: 'planned' subtracts from required; else "failure". */
function classify(code, catalogId) {
  if (code === '' || code == null) return 'unplanned';
  const map = causeClasses[catalogId] || causeClasses.default || {};
  return map[String(code)] || map.__default || 'unplanned';
}

/** Closed (non-worked) intervals for a machine, clipped+merged to [start,end]. */
function closedIntervals(atelierId, machineId, start, end) {
  const ranges = [
    ...(closures.global || []),
    ...(closures.ateliers[atelierId] || []),
    ...(closures.machines[machineId] || [])
  ];
  const raw = [];
  for (const r of ranges) {
    const s = Date.parse(r && r.start);
    const e = Date.parse(r && r.end);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) raw.push({ s: Math.max(s, start), e: Math.min(e, end) });
  }
  return clipMerge(raw);
}






// ---- KPI math --------------------------------------------------------------







/** Parse one dpGetPeriod DPE result into time-sorted {t,v} samples. */
function toSamples(res) {
  const r = Array.isArray(res) ? res[0] : res;
  if (!r) return [];
  let values;
  let times;
  if (Array.isArray(r) && r.length >= 2) {
    [values, times] = r;
  } else if (r.values && r.timestamps) {
    values = r.values;
    times = r.timestamps;
  } else if (r.values && r.times) {
    values = r.values;
    times = r.times;
  } else {
    return [];
  }
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const t = toMs(times[i]);
    if (Number.isFinite(t)) out.push({ t, v: values[i] });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

async function queryHistory(dpe, start, end) {
  try {
    const res = await winccoa.dpGetPeriod(new Date(start), new Date(end), [dpe], BOUNDARY_COUNT);
    return toSamples(res);
  } catch {
    return [];
  }
}





// ---- orchestration ---------------------------------------------------------

/** List every configured KPI across all ateliers. */
function loadKpis() {
  const kpis = [];
  let configDps = [];
  try {
    configDps = winccoa.dpNames('*', CONFIG_TYPE) || [];
  } catch (e) {
    log(`Lecture des ateliers impossible : ${e}`);
    return kpis;
  }
  return Promise.all(
    configDps.map(async (name) => {
      const dp = name.endsWith('.') ? name.slice(0, -1) : name;
      let atelier;
      try {
        atelier = JSON.parse(extractString(await winccoa.dpGet(`${dp}.json`)));
      } catch {
        return;
      }
      const mappings = Array.isArray(atelier.mappings) ? atelier.mappings : [];
      const atelierId = atelier.id || (dp.includes('_') ? dp.slice(dp.indexOf('_') + 1) : dp);
      for (const m of atelier.machines || []) {
        if (!Array.isArray(m.kpiCalcs) || m.kpiCalcs.length === 0) continue;
        if (!recordsState(m)) continue;
        const mapping = mappings.find((mp) => mp.id === m.stateMappingId) || mappings[0];
        for (const k of m.kpiCalcs) {
          kpis.push({ kpi: k, machine: m, mapping, atelierId });
        }
      }
    })
  ).then(() => kpis);
}

async function refreshKpi(entry) {
  const { kpi, machine, mapping, atelierId } = entry;
  const dpName = `${KPI_PREFIX}${sanitize(machine.id)}_${sanitize(kpi.id)}`;
  const valueDpe = `${SYS}${dpName}.value`;
  if (!winccoa.dpExists(`${dpName}.value`)) {
    try {
      await winccoa.dpCreate(dpName, KPI_TYPE);
    } catch (e) {
      log(`Échec création DP ${dpName} : ${e}`);
      return;
    }
  }
  if (kpi.archive === false) {
    await disableArchived(valueDpe);
  } else {
    await ensureArchived(valueDpe, kpi.archiveGroup || archiveGroup);
  }

  const end = Date.now();
  const windowMs = WINDOW_MS[kpi.window] || WINDOW_MS['24h'];
  const start = end - windowMs;
  // The history fleetState records: the state its mapping gave, and the cause in progress.
  const record = `${SYS}${stateRecordDp(machine.id)}`;
  const stateSamples = await queryHistory(`${record}.state`, start - windowMs, end);
  const causeSamples = await queryHistory(`${record}.cause`, start - windowMs, end);
  const closed = closedIntervals(atelierId, machine.id, start, end);
  const minStopMs = (Number(machine.minStopSec) || 0) * 1000;
  const value = computeValue(kpi.type, stateSamples, causeSamples, mapping, closed, start, end, minStopMs, machine.stopCatalogId || '', classify);
  const unit = kpi.type === 'TRS' ? '%' : 'min';
  try {
    await winccoa.dpSet([
      `${SYS}${dpName}.value`,
      `${SYS}${dpName}.kpiType`,
      `${SYS}${dpName}.machineId`,
      `${SYS}${dpName}.machineName`,
      `${SYS}${dpName}.window`,
      `${SYS}${dpName}.unit`,
      `${SYS}${dpName}.updatedAt`
    ], [value, kpi.type, machine.id, machine.name || machine.id, kpi.window, unit, new Date().toISOString()]);
    log(`${dpName} = ${value} ${unit} (${kpi.type}, ${kpi.window})`);
  } catch (e) {
    log(`Échec écriture ${dpName} : ${e}`);
  }
}

let kpiEntries = [];
let lastReload = 0;

async function tick() {
  const now = Date.now();
  if (now - lastReload >= RELOAD_MS || kpiEntries.length === 0) {
    lastReload = now;
    await loadCauseClassification();
    await loadClosures();
    kpiEntries = await loadKpis();
  }
  for (const entry of kpiEntries) {
    const key = `${entry.machine.id}/${entry.kpi.id}`;
    const due = nextDue.get(key) ?? 0;
    if (now < due) continue;
    const period = Math.max(1, toNumber(entry.kpi.refreshMin) || 5) * MS_PER_MINUTE;
    nextDue.set(key, now + period);
    // eslint-disable-next-line no-await-in-loop
    await refreshKpi(entry);
  }
}

async function main() {
  log('Démarrage du calculateur de KPI…');
  await ensureType();
  archiveGroup = findArchiveGroup();
  log(`Groupe d'archive : ${archiveGroup || '(aucun — archivage désactivé)'}`);
  await tick();
  setInterval(() => void tick(), BASE_TICK_MS);
  log(`Actif (tick ${BASE_TICK_MS / 1000}s).`);
}

main().catch((e) => log(`Erreur fatale : ${e}`));
