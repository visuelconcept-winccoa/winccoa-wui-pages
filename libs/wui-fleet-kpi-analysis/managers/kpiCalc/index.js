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
 *      (+ `cause`) history every `refreshMin` minutes and writes `.value`.
 *
 * Formulas (sliding window W, no closures applied server-side yet):
 *   - production = W − non-production time; non-production = state ≠ ok.
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

const winccoa = new WinccoaManager();

const KPI_TYPE = 'MachineFleet3D_Kpi';
const KPI_PREFIX = 'MachineFleet3D_Kpi_';
const CONFIG_TYPE = 'MachineFleet3D_Config';
const STOPCAUSE_DP = 'MachineFleet3D_StopCauses';
const CLOSURES_DP = 'MachineFleet3D_Closures';
const SYS = 'System1:';
const ELEM = { Struct: 1, Float: 22, String: 25 };

const BASE_TICK_MS = 15_000;
const RELOAD_MS = 60_000;
const MS_PER_MINUTE = 60_000;
const ROUND = 100;
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
/** code → classification ('planned'|'unplanned'|'production'); plus __default. */
let causeClass = {};
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

async function loadCauseClassification() {
  try {
    const arr = JSON.parse(extractString(await winccoa.dpGet(`${SYS}${STOPCAUSE_DP}.json`)));
    const map = {};
    let def = 'unplanned';
    for (const c of arr) {
      if (c && c.code) map[String(c.code)] = c.classification || 'unplanned';
      if (c && c.isDefault) def = c.classification || 'unplanned';
    }
    map.__default = def;
    causeClass = map;
  } catch {
    causeClass = { __default: 'unplanned' };
  }
}

async function loadClosures() {
  try {
    const cfg = JSON.parse(extractString(await winccoa.dpGet(`${SYS}${CLOSURES_DP}.json`)));
    closures = {
      ateliers: cfg && cfg.ateliers ? cfg.ateliers : {},
      machines: cfg && cfg.machines ? cfg.machines : {}
    };
  } catch {
    closures = { ateliers: {}, machines: {} };
  }
}

/** Classify a cause code: 'planned' subtracts from required; else "failure". */
function classify(code) {
  if (code === '' || code == null) return 'unplanned';
  return causeClass[String(code)] || causeClass.__default || 'unplanned';
}

/** Closed (non-worked) intervals for a machine, clipped+merged to [start,end]. */
function closedIntervals(atelierId, machineId, start, end) {
  const ranges = [...(closures.ateliers[atelierId] || []), ...(closures.machines[machineId] || [])];
  const raw = [];
  for (const r of ranges) {
    const s = Date.parse(r && r.start);
    const e = Date.parse(r && r.end);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) raw.push({ s: Math.max(s, start), e: Math.min(e, end) });
  }
  return clipMerge(raw);
}

/** Sort + merge overlapping {s,e} intervals (already clipped). */
function clipMerge(list) {
  const valid = list.filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  const out = [];
  for (const i of valid) {
    const last = out.at(-1);
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e);
    else out.push({ s: i.s, e: i.e });
  }
  return out;
}

/** Parts of [s,e) not covered by the (sorted, merged) `closed` intervals. */
function subtract(s, e, closed) {
  const parts = [];
  let cur = s;
  for (const c of closed) {
    if (c.e <= cur || c.s >= e) continue;
    if (c.s > cur) parts.push({ s: cur, e: Math.min(c.s, e) });
    cur = Math.max(cur, c.e);
    if (cur >= e) break;
  }
  if (cur < e) parts.push({ s: cur, e });
  return parts;
}

function sumLength(list) {
  return list.reduce((acc, i) => acc + (i.e - i.s), 0);
}

/** Raw cause spans within a stop (codes may be empty). */
function causeBoundaries(stop, causeSamples) {
  const spans = [];
  let cursor = stop.s;
  let active = codeAt(causeSamples, stop.s);
  for (const sample of causeSamples) {
    if (sample.t <= stop.s || sample.t >= stop.e) continue;
    if (sample.t > cursor) spans.push({ start: cursor, end: sample.t, code: active });
    cursor = sample.t;
    active = sample.v == null ? '' : String(sample.v).trim();
  }
  if (cursor < stop.e) spans.push({ start: cursor, end: stop.e, code: active });
  return spans;
}

/**
 * Partition a stop into contiguous (code) sub-segments. A leading span with no
 * cause is back-filled to the first assigned cause of the stop ("la cause est
 * prise en compte depuis le début de l'arrêt"); empty spans afterwards carry the
 * previous cause forward. A stop with no cause at all stays empty → unplanned.
 */
function partitionByCause(stop, causeSamples) {
  const boundaries = causeBoundaries(stop, causeSamples);
  const firstNonEmpty = (boundaries.find((b) => b.code !== '') || {}).code || '';
  let carried = firstNonEmpty;
  const out = [];
  for (const seg of boundaries) {
    const code = seg.code === '' ? carried : seg.code;
    carried = code;
    const last = out.at(-1);
    if (last && last.code === code) last.end = seg.end;
    else out.push({ start: seg.start, end: seg.end, code });
  }
  return out;
}

// ---- KPI math --------------------------------------------------------------

function resolveStateOk(mapping, value) {
  // Returns true when the machine is producing (state 'ok').
  if (!mapping || !Array.isArray(mapping.rules)) return value === 1;
  for (const rule of mapping.rules) {
    const okMin = rule.min == null || value >= rule.min;
    const okMax = rule.max == null || value <= rule.max;
    if (okMin && okMax) return rule.state === 'ok';
  }
  return mapping.fallback === 'ok';
}

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

function codeAt(samples, t) {
  let code = '';
  for (const s of samples) {
    if (s.t > t) break;
    code = s.v == null ? '' : String(s.v).trim();
  }
  return code;
}

/** Merged non-production intervals within [start,end] from state history. */
function nonProductionIntervals(samples, mapping, start, end) {
  if (samples.length === 0) return [];
  const intervals = [];
  for (let i = 0; i < samples.length; i++) {
    const segStart = Math.max(samples[i].t, start);
    const segEnd = Math.min(samples[i + 1] ? samples[i + 1].t : end, end);
    if (segEnd <= segStart) continue;
    if (resolveStateOk(mapping, Math.round(toNumber(samples[i].v)))) continue;
    const last = intervals.at(-1);
    if (last && last.e >= segStart) last.e = Math.max(last.e, segEnd);
    else intervals.push({ s: segStart, e: segEnd });
  }
  return intervals;
}

function computeValue(type, stateSamples, causeSamples, mapping, closed, start, end) {
  const windowMs = end - start;
  // Opening time = window minus non-worked (closure) periods.
  const openingMs = Math.max(0, windowMs - sumLength(closed));
  const stops = nonProductionIntervals(stateSamples, mapping, start, end);
  let plannedMs = 0;
  let unplannedMs = 0;
  let failures = 0;
  for (const stop of stops) {
    let stopUnplanned = 0;
    // Partition the whole stop by cause (cause back-filled to the stop start),
    // then count only the worked portions (closures excluded).
    for (const seg of partitionByCause(stop, causeSamples)) {
      const planned = classify(seg.code) === 'planned';
      for (const w of subtract(seg.start, seg.end, closed)) {
        const dur = w.e - w.s;
        if (planned) plannedMs += dur;
        else {
          unplannedMs += dur;
          stopUnplanned += dur;
        }
      }
    }
    if (stopUnplanned > 0) failures += 1;
  }
  const requiredMs = Math.max(0, openingMs - plannedMs);
  // MTBF/MTTR consider ONLY unplanned stops: planned downtime is treated as
  // operating time (it does not reduce the mean-time metrics). MTBF = uptime
  // (opening minus unplanned repair) per failure; MTTR = unplanned per failure.
  const upBetweenFailuresMs = Math.max(0, openingMs - unplannedMs);
  let value = 0;
  if (type === 'TRS') {
    value = requiredMs > 0 ? Math.max(0, (requiredMs - unplannedMs) / requiredMs) * ROUND : ROUND;
  } else if (type === 'MTBF') {
    value = upBetweenFailuresMs / Math.max(failures, 1) / MS_PER_MINUTE;
  } else {
    value = failures > 0 ? unplannedMs / failures / MS_PER_MINUTE : 0;
  }
  return Math.round(value * ROUND) / ROUND;
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
        if (!m.stateDp) continue;
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
  const stateSamples = await queryHistory(machine.stateDp, start - windowMs, end);
  const causeSamples = machine.stopCauseDp
    ? await queryHistory(machine.stopCauseDp, start - windowMs, end)
    : [];
  const closed = closedIntervals(atelierId, machine.id, start, end);
  const value = computeValue(kpi.type, stateSamples, causeSamples, mapping, closed, start, end);
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
