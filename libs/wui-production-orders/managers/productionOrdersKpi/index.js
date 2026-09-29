// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Production Orders — KPI indicator calculator (WinCC OA JavaScript Manager).
 *
 * The Production Orders page (`/production-orders`) shows a strip of indicators
 * at the top (total / à venir / en cours / terminés / en retard). Rather than
 * computing them in the browser, this manager owns them server-side: it reads
 * the single order-list datapoint `ProductionOrders_List.json`, computes the
 * indicators, and writes them to a dedicated `ProductionOrders_Kpi` datapoint
 * that the page binds to live (dpConnect).
 *
 * Polling (not dpConnect) is used so the time-dependent "en retard" count is
 * refreshed even when the list itself does not change — an order silently
 * becomes late as its planned end passes.
 *
 * Register in config/progs:  node | always | 30 | 3 | 5 | productionOrdersKpi/index.js
 * After editing this file, restart the productionOrdersKpi manager.
 */
const { WinccoaManager, WinccoaDpTypeNode } = require('winccoa-manager');

const winccoa = new WinccoaManager();

const LIST_DP = 'ProductionOrders_List';
const KPI_TYPE = 'ProductionOrders_Kpi';
const KPI_DP = 'ProductionOrders_Kpi';
const SYS = 'System1:';
const ELEM = { Struct: 1, Float: 22, String: 25 };

const TICK_MS = 5_000;
const ROUND = 100;

/** The numeric indicator fields written to the KPI datapoint. */
const COUNT_FIELDS = ['total', 'planned', 'running', 'paused', 'done', 'cancelled', 'late', 'avgProgress'];

let lastSignature = '';

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[ProdOrdersKpi] ${msg}`);
}

function extractString(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

function toNumber(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---- data model ------------------------------------------------------------

async function ensureType() {
  const children = COUNT_FIELDS.map((f) => new WinccoaDpTypeNode(f, ELEM.Float));
  children.push(new WinccoaDpTypeNode('updatedAt', ELEM.String));
  const root = new WinccoaDpTypeNode(KPI_TYPE, ELEM.Struct, '', children);
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${KPI_TYPE}`);
  } catch {
    // already exists
  }
}

async function ensureDp() {
  if (winccoa.dpExists(`${KPI_DP}.total`)) return;
  try {
    await winccoa.dpCreate(KPI_DP, KPI_TYPE);
    log(`Datapoint créé : ${KPI_DP}`);
  } catch (e) {
    log(`Échec création DP ${KPI_DP} : ${e}`);
  }
}

// ---- KPI math --------------------------------------------------------------

/** Read + parse the order list; returns [] on any problem. */
async function readOrders() {
  try {
    const json = extractString(await winccoa.dpGet(`${SYS}${LIST_DP}.json`));
    const arr = json ? JSON.parse(json) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    log(`Lecture de la liste impossible : ${e}`);
    return [];
  }
}

function isLate(order, now) {
  if (order.status === 'done' || order.status === 'cancelled') return false;
  if (!order.plannedEnd) return false;
  const end = Date.parse(order.plannedEnd);
  return Number.isFinite(end) && end < now;
}

function computeKpis(orders) {
  const k = { total: orders.length, planned: 0, running: 0, paused: 0, done: 0, cancelled: 0, late: 0, avgProgress: 0 };
  const now = Date.now();
  let progressSum = 0;
  for (const order of orders) {
    if (k[order.status] !== undefined) k[order.status] += 1;
    if (isLate(order, now)) k.late += 1;
    progressSum += toNumber(order.progress);
  }
  k.avgProgress = orders.length > 0 ? Math.round((progressSum / orders.length) * ROUND) / ROUND : 0;
  return k;
}

// ---- orchestration ---------------------------------------------------------

async function tick() {
  const orders = await readOrders();
  const kpis = computeKpis(orders);
  // Skip the write when nothing changed (signature includes time-sensitive late).
  const signature = JSON.stringify(kpis);
  if (signature === lastSignature) return;
  lastSignature = signature;

  const dpes = COUNT_FIELDS.map((f) => `${SYS}${KPI_DP}.${f}`);
  const values = COUNT_FIELDS.map((f) => kpis[f]);
  dpes.push(`${SYS}${KPI_DP}.updatedAt`);
  values.push(new Date().toISOString());
  try {
    await winccoa.dpSet(dpes, values);
    log(`total=${kpis.total} àvenir=${kpis.planned} encours=${kpis.running + kpis.paused} terminés=${kpis.done} retard=${kpis.late}`);
  } catch (e) {
    log(`Échec écriture des indicateurs : ${e}`);
  }
}

async function main() {
  log('Démarrage du calculateur d’indicateurs…');
  await ensureType();
  await ensureDp();
  await tick();
  setInterval(() => void tick(), TICK_MS);
  log(`Actif (tick ${TICK_MS / 1000}s).`);
}

main().catch((e) => log(`Erreur fatale : ${e}`));
