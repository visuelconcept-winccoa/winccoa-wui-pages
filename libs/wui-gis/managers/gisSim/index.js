// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * GIS — network simulator for the `/gis` pages.
 *
 * Runs as a WinCC OA **JavaScript Manager** (WCCOAjsManager): the patched
 * `require('winccoa-manager')` and `new WinccoaManager()` connect to the running project
 * automatically. Register it in `config/progs`, e.g.:
 *
 *   node | manual | 30 | 2 | 2 |gisSim/index.js
 *
 * What it does, in order:
 *   1. Creates the data model — three FLAT datapoint types (`GisSimFloat` / `GisSimInt` /
 *      `GisSimBool`), one datapoint per simulated value.
 *   2. Reads every `GIS_Site` datapoint and works out, for each asset and each connection,
 *      its **family** — from its kind crossed with the kind of its links (`families.js`).
 *   3. Creates the datapoints that family needs (`GisSim_<assetId>_<element>`,
 *      `GisLink_<connectionId>_<element>`) and, on the ones it has just created, the
 *      **alert configuration** so the map's markers and lines actually colour in alarm.
 *   4. Simulates the NETWORK, not isolated values (`network.js`): consumers ask, sources
 *      supply what the topology connects them to, and each segment carries the sum of what
 *      transits it. Take a plant out and the others pick up its cities; trip a segment and
 *      the flow reroutes, or the consumer is under-served and says so.
 *
 * It **never writes to a site**: the bindings are the page's business, not the simulator's.
 * The naming rule above is the contract — `bind-site.js` writes exactly those names into an
 * exported site, and `examples/` holds one ready to import. An asset left unbound is still
 * simulated; only nothing on the map reads it yet.
 *
 * Two consequences worth knowing:
 *   • Asset and connection ids are unique **within a site**, so two sites that both hold an
 *     asset `paris` would claim the same datapoints. The second one is skipped and named in
 *     the log rather than silently driven from two places.
 *   • Capacities and demands are plausible defaults derived from a stable hash of the id.
 *     Real figures go in the object's `notes` as `sim:capacite=5460` / `sim:demande=15000`
 *     / `sim:volume=` / `sim:etat=0` (see `directives` in `families.js`).
 */
const { WinccoaManager, WinccoaDpTypeNode } = require('winccoa-manager');

const { buildNetwork } = require('./build.js');
const fam = require('./families.js');
const { hash01, solve, valuesOf } = require('./network.js');

const winccoa = new WinccoaManager();

// ---- configuration ---------------------------------------------------------
/** The page's own datapoint type, one per site (`libs/wui-gis/src/gis/data/gis-store.ts`). */
const SITE_TYPE = 'GIS_Site';
/** Flat datapoint types, one per data type — see the module header for why flat. */
const TYPE_FLOAT = 'GisSimFloat';
const TYPE_INT = 'GisSimInt';
const TYPE_BOOL = 'GisSimBool';
/** Create the alert configs on freshly created datapoints (never on existing ones). */
const CREATE_ALERTS = true;
/** How often states change, values are written, and the sites are re-read. */
const STATE_INTERVAL_MS = 30_000;
const VALUE_INTERVAL_MS = 1000;
const REFRESH_INTERVAL_MS = 60_000;

/** WinccoaElementType enum values (see winccoa-manager dptypenode). */
const ELEM = { Struct: 1, Int: 21, Float: 22, Bool: 23, String: 25 };

/**
 * Alert-config constants (WinCC OA `DpConfigType` / `DpAlertRangeType`) and the standard
 * alarm classes. A binary alert on the `defaut` element is what colours a marker; the
 * analog ones are the thresholds the families declare.
 */
const ALERT_BINARY = 12;
const ALERT_ANALOG = 13;
const RANGE_MINMAX = 4;
const CLASS_ALERT = 'alert.';
const CLASS_WARNING = 'warning.';
/** The FLOAT domain, for the open ends of the first and last alarm range. */
const FLOAT_MIN = -3.4e38;
const FLOAT_MAX = 3.4e38;

/** Per state tick, the chance a running object leaves service, and comes back. */
const P_FAULT = 0.03;
const P_STOP = 0.02;
const P_MAINTENANCE = 0.02;
const P_RECOVER = 0.4;
/** A segment is more reliable than a machine, and a trip is usually a clean opening. */
const P_TRIP = 0.02;
const P_SEGMENT_FAULT = 0.01;
const P_SEGMENT_RECOVER = 0.5;

/** Objects named in the startup log before it is summarised instead. */
const LOG_SAMPLE = 6;

/** The whole simulation: nodes (assets) and edges (connections), across every site. */
let net = { nodes: [], edges: [] };
/** Digest of the sites as last read, so a refresh that changed nothing costs nothing. */
let sitesDigest = '';
/** Timestamp of the last value tick, for the integrators. */
let lastTickMs = Date.now();

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[GisSim] ${msg}`);
}

/** A datapoint element name as WinCC OA wants it: a flat DP's element is a trailing dot. */
function dpe(name) {
  return `${fam.SYSTEM}${name}.`;
}

/** Strip a system prefix and a trailing dot, so names compare. */
function bare(name) {
  const colon = String(name).indexOf(':');
  const withoutSystem = colon === -1 ? String(name) : String(name).slice(colon + 1);
  return withoutSystem.endsWith('.')
    ? withoutSystem.slice(0, -1)
    : withoutSystem;
}

function extractString(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value == null ? '' : String(value);
}

/** Every simulated object, assets and segments alike. */
function objects() {
  return [...net.nodes, ...net.edges];
}

// ---- 1. data model ---------------------------------------------------------

/**
 * The three flat datapoint types. A flat type is a ROOT node of the leaf's own type with no
 * children — the shape WinCC OA's own `ExampleDP_Float` has.
 */
async function ensureTypes() {
  const wanted = [
    [TYPE_FLOAT, ELEM.Float],
    [TYPE_INT, ELEM.Int],
    [TYPE_BOOL, ELEM.Bool]
  ];
  const existing = new Set(winccoa.dpTypes('GisSim*'));
  for (const [name, type] of wanted) {
    if (existing.has(name)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await winccoa.dpTypeCreate(new WinccoaDpTypeNode(name, type));
      log(`Type de données créé : ${name}`);
    } catch (error) {
      log(`Type de données ${name} non créé : ${error}`);
    }
  }
}

// ---- 2. discover the sites and build the network ---------------------------

/** Every site in the project, as `{ dp, raw, site }`. Unreadable ones are named and skipped. */
async function readSites() {
  const sites = [];
  for (const found of winccoa.dpNames('*', SITE_TYPE)) {
    const dp = bare(found);
    let raw = '';
    try {
      // eslint-disable-next-line no-await-in-loop
      raw = extractString(await winccoa.dpGet(`${dp}.json`));
      sites.push({ dp, raw, site: JSON.parse(raw) });
    } catch (error) {
      log(`Site illisible ${dp} : ${error}`);
    }
  }
  return sites;
}

// ---- 3. datapoints and alert configs --------------------------------------

/** The datapoints one object needs: its state, its fault flag, and one per family value. */
function datapointsOf(object) {
  const wanted = [
    { name: `${object.stem}_${fam.EL_STATE}`, type: TYPE_INT },
    { name: `${object.stem}_${fam.EL_FAULT}`, type: TYPE_BOOL, binary: true }
  ];
  for (const spec of object.family.values) {
    wanted.push({
      name: `${object.stem}_${spec.el}`,
      type: TYPE_FLOAT,
      alert: spec.alert
    });
  }
  return wanted;
}

/** Every datapoint this simulator already owns in the project. */
function existingDatapoints() {
  const found = new Set();
  for (const pattern of [`${fam.ASSET_PREFIX}*`, `${fam.LINK_PREFIX}*`]) {
    for (const name of winccoa.dpNames(pattern)) found.add(bare(name));
  }
  return found;
}

/**
 * Alarm class of one range. The OK range carries none: the first one when high is bad, the
 * last one when low is bad. Mirrors what the project's own `alarm-set` tool writes.
 */
function classOfRange(ascending, index, thresholds) {
  const LAST_WARNING_INDEX = 2;
  if (ascending) {
    if (index === 1) return '';
    if (thresholds === 1) return CLASS_ALERT;
    return index === LAST_WARNING_INDEX ? CLASS_WARNING : CLASS_ALERT;
  }
  if (index > thresholds) return '';
  if (thresholds === 1 || index === 1) return CLASS_ALERT;
  return CLASS_WARNING;
}

/** Binary alert on a Bool: in alarm while it is TRUE. */
function binaryAlert(name) {
  return winccoa.dpSetWait(
    [
      `${dpe(name)}:_alert_hdl.._type`,
      `${dpe(name)}:_alert_hdl.._class`,
      `${dpe(name)}:_alert_hdl.._ok_range`,
      `${dpe(name)}:_alert_hdl.._active`
    ],
    [ALERT_BINARY, CLASS_ALERT, false, true]
  );
}

/** Analog alert on a Float: 1 or 2 thresholds, ascending (high is bad) or descending. */
async function analogAlert(name, alert) {
  const thresholds = [...alert.thresholds].sort((left, right) => left - right);
  const ascending = alert.direction === 'ASC';
  const element = dpe(name);
  await winccoa.dpSetWait(
    [`${element}:_alert_hdl.._type`, `${element}:_alert_hdl.._orig_hdl`],
    [ALERT_ANALOG, false]
  );
  const names = [];
  const values = [];
  // n thresholds make n+1 ranges, the outer two open onto the type's domain.
  for (let index = 1; index <= thresholds.length + 1; index++) {
    const prefix = `${element}:_alert_hdl.${index}.`;
    names.push(`${prefix}_type`, `${prefix}_l_limit`, `${prefix}_u_limit`);
    values.push(
      RANGE_MINMAX,
      index === 1 ? FLOAT_MIN : thresholds[index - 2],
      index > thresholds.length ? FLOAT_MAX : thresholds[index - 1]
    );
    names.push(`${prefix}_l_incl`, `${prefix}_u_incl`);
    values.push(
      ascending ? true : index === 1,
      ascending ? index > thresholds.length : true
    );
    const alarmClass = classOfRange(ascending, index, thresholds.length);
    if (alarmClass) {
      names.push(`${prefix}_class`);
      values.push(alarmClass);
    }
  }
  await winccoa.dpSetWait(names, values);
  await winccoa.dpSetWait(`${element}:_alert_hdl.._active`, true);
}

/**
 * Configure the alerts of the datapoints just created. Best effort by design: a project
 * without the standard alarm classes, or a right the manager lacks, must cost the values
 * nothing — it only costs the highlighting.
 */
async function configureAlerts(created) {
  let done = 0;
  const failures = [];
  for (const target of created) {
    if (!target.binary && !target.alert) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await (target.binary
        ? binaryAlert(target.name)
        : analogAlert(target.name, target.alert));
      done++;
    } catch (error) {
      failures.push(`${target.name} (${error})`);
    }
  }
  if (done > 0) log(`${done} configuration(s) d'alarme créée(s).`);
  if (failures.length > 0) {
    log(
      `⚠ ${failures.length} configuration(s) d'alarme refusée(s) — les valeurs restent ` +
        `simulées, sans mise en alarme : ${failures.slice(0, LOG_SAMPLE).join(' ; ')}`
    );
  }
}

/** Create every missing datapoint, then the alerts on those (and only those). */
async function ensureDatapoints() {
  const existing = existingDatapoints();
  const created = [];
  for (const object of objects()) {
    for (const wanted of datapointsOf(object)) {
      if (existing.has(wanted.name)) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await winccoa.dpCreate(wanted.name, wanted.type);
        created.push(wanted);
      } catch (error) {
        log(`Échec création DP ${wanted.name} : ${error}`);
      }
    }
  }
  if (created.length > 0) log(`${created.length} datapoint(s) créé(s).`);
  if (CREATE_ALERTS && created.length > 0) await configureAlerts(created);
}

/**
 * Name the bindings that point at a simulator datapoint this run does not drive — the
 * symptom of a typo, or of a site imported with a different naming rule.
 */
function reportOrphanBindings(sites) {
  const owned = new Set(
    objects().flatMap((object) =>
      datapointsOf(object).map((wanted) => wanted.name)
    )
  );
  const orphans = new Set();
  for (const { site } of sites) {
    const bound = [...(site.assets ?? []), ...(site.connections ?? [])].flatMap(
      (item) => [item.dp, ...(item.readings ?? []).map((r) => r.dp)]
    );
    for (const binding of bound) {
      const name = bare(String(binding ?? '').trim());
      if (!name) continue;
      const mine =
        name.startsWith(fam.ASSET_PREFIX) || name.startsWith(fam.LINK_PREFIX);
      if (mine && !owned.has(name)) orphans.add(name);
    }
  }
  if (orphans.size > 0) {
    log(
      `⚠ ${orphans.size} liaison(s) vers un DP que ce simulateur ne pilote pas : ` +
        `${[...orphans].slice(0, LOG_SAMPLE).join(', ')}`
    );
  }
}

/** What was built, in one readable block — the first thing to check in the log. */
function logNetwork() {
  const perFamily = new Map();
  for (const object of objects()) {
    perFamily.set(object.famName, (perFamily.get(object.famName) ?? 0) + 1);
  }
  log(
    `${net.nodes.length} asset(s) et ${net.edges.length} liaison(s) simulé(s) : ` +
      [...perFamily].map(([name, count]) => `${count}×${name}`).join(', ')
  );
  for (const node of net.nodes.slice(0, LOG_SAMPLE)) {
    const sizing =
      node.role === fam.ROLE_SINK
        ? `demande ${node.demandBase}`
        : `capacité ${node.capacityBase}`;
    log(`  · ${node.label} → ${node.famName} (${node.reason}), ${sizing}`);
  }
  if (net.nodes.length > LOG_SAMPLE) {
    log(`  · … ${net.nodes.length - LOG_SAMPLE} autre(s)`);
  }
}

/** Re-read the sites; rebuild only when their content actually changed. */
async function refresh(force = false) {
  const sites = await readSites();
  const joined = sites.map((entry) => entry.raw).join(' ');
  const digest = `${joined.length}:${hash01(joined)}`;
  if (!force && digest === sitesDigest) return false;
  sitesDigest = digest;
  // Keep what the objects have lived through: a refresh re-reads the CONFIGURATION, it
  // does not restart the plant.
  const previous = new Map(objects().map((object) => [object.stem, object]));
  net = buildNetwork(
    sites.map((entry) => entry.site),
    { previous, log }
  );
  if (net.collisions.length > 0) {
    log(
      `⚠ ${net.collisions.length} identifiant(s) en double entre sites, non simulé(s) : ` +
        `${net.collisions.slice(0, LOG_SAMPLE).join(', ')}`
    );
  }
  logNetwork();
  await ensureDatapoints();
  reportOrphanBindings(sites);
  // Publish a state and a value straight away, so a datapoint just created is never left at
  // its initial 0 until the next tick — and so a site imported while this manager runs comes
  // to life on the map within the refresh period.
  tickState();
  tickValues();
  return true;
}

// ---- 4. simulation ---------------------------------------------------------

/**
 * The next state of an object. A forced state (`sim:etat=`) never moves — that is how a
 * plant shut down for good stays shut down.
 *
 * A segment fails differently from a machine: it opens (out of service, so the flow has to
 * find another path) far more often than it runs degraded.
 */
function nextState(object) {
  if (object.forcedState !== null) return object.forcedState;
  if (object.state !== fam.STATE_RUN) {
    const recover = object.isEdge ? P_SEGMENT_RECOVER : P_RECOVER;
    return Math.random() < recover ? fam.STATE_RUN : object.state;
  }
  const draw = Math.random();
  if (object.isEdge) {
    if (draw < P_TRIP) return fam.STATE_OFF;
    if (draw < P_TRIP + P_SEGMENT_FAULT) return fam.STATE_FAULT;
    return fam.STATE_RUN;
  }
  if (draw < P_FAULT) return fam.STATE_FAULT;
  if (draw < P_FAULT + P_STOP) return fam.STATE_OFF;
  if (draw < P_FAULT + P_STOP + P_MAINTENANCE) return fam.STATE_MAINTENANCE;
  return fam.STATE_RUN;
}

/**
 * Is this object in alarm? An asset only when it is faulted — a planned stop or a
 * maintenance is not an alarm. A segment whenever it is not carrying, because a line out is
 * exactly what an operator has to see on the map.
 */
function isFault(object) {
  return object.isEdge
    ? object.state !== fam.STATE_RUN
    : object.state === fam.STATE_FAULT;
}

function tickState() {
  const names = [];
  const values = [];
  for (const object of objects()) {
    object.state = nextState(object);
    names.push(
      dpe(`${object.stem}_${fam.EL_STATE}`),
      dpe(`${object.stem}_${fam.EL_FAULT}`)
    );
    values.push(object.state, isFault(object));
  }
  safeSet(names, values);
}

function tickValues() {
  const now = new Date();
  const elapsed = (now.getTime() - lastTickMs) / 1000;
  lastTickMs = now.getTime();
  solve(net, now, Math.max(0, elapsed));
  const names = [];
  const values = [];
  for (const object of objects()) {
    // The whole object at once: an element expressed as a ratio of another one has to divide
    // the figure actually published this tick, not a freshly drawn one.
    for (const [element, value] of Object.entries(valuesOf(object, now))) {
      names.push(dpe(`${object.stem}_${element}`));
      values.push(value);
    }
  }
  safeSet(names, values);
}

function safeSet(names, values) {
  if (names.length === 0) return;
  try {
    winccoa.dpSet(names, values);
  } catch (error) {
    log(`dpSet erreur : ${error}`);
  }
}

async function main() {
  log('Démarrage du simulateur GIS…');
  await ensureTypes();
  await refresh(true);
  // Nothing to simulate is a WAITING state, not a reason to stop: a site created or imported
  // from /gis afterwards is picked up by the next refresh, with no restart.
  if (net.nodes.length === 0) {
    log(
      `Aucun asset dans les datapoints ${SITE_TYPE} — rien à simuler pour l'instant. ` +
        `Créez ou importez un site depuis la page /gis : il sera pris en compte à la ` +
        `prochaine relecture (${REFRESH_INTERVAL_MS / 1000}s).`
    );
  }
  setInterval(tickState, STATE_INTERVAL_MS);
  setInterval(tickValues, VALUE_INTERVAL_MS);
  setInterval(() => void refresh().catch((error) => log(`Refresh : ${error}`)), REFRESH_INTERVAL_MS);
  log(
    `Simulation active : états ~${STATE_INTERVAL_MS / 1000}s, valeurs ${VALUE_INTERVAL_MS}ms, ` +
      `relecture des sites ${REFRESH_INTERVAL_MS / 1000}s.`
  );
}

main().catch((error) => log(`Erreur fatale : ${error}`));
