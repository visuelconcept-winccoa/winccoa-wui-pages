// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';
/**
 * Process Monitor — WinCC OA JavaScript Manager hosting an MSA (Manager Service
 * API) vRPC service for the "Process Monitor" WebUI page.
 *
 * Multi-node model (faithful to the legacy `winccoa_projectmanager` which
 * aggregated `dpNames("*", PROJECT_DOWNLOAD)`): this manager runs on EVERY pmon
 * node — i.e. on every COMPUTER that runs a pmon, whether they belong to one
 * WinCC OA system whose managers are split across computers, or to several
 * distributed systems. It plays two roles —
 *
 *   - AGENT (every computer): on startup it creates/maintains its OWN node
 *     datapoint named after the host — `ProcessMonitor_Node_<hostname>` — and
 *     periodically publishes its LOCAL pmon snapshot into `.pmon`, reacting to
 *     control commands (`.cmd`) targeted at it by executing them against its local
 *     pmon. It also receives deploy ZIPs streamed to its own vRPC service
 *     (ReceiveBegin/Chunk/Commit, DeployStatus — see deploy-transfer.js).
 *
 *   - AGGREGATOR (the computer serving the customer-webserver): the vRPC methods
 *     read every node DP via `dpNames("*", ProcessMonitor_Node)` → one instance
 *     per computer → the page renders one tab per computer. Control / restart-all
 *     are routed to a target NODE's `.cmd` (the agent on that computer runs it);
 *     project deploy can be propagated to ALL nodes: the ZIP is streamed in chunks
 *     to each node's own `ProcessMonitor_<hostname>` service over vRPC (issue 32).
 *
 * Project deployment: optionally purge selected folders (allow-list), extract an
 * uploaded ZIP (7-Zip) into the project — NEVER into protected folders
 * (logs/log/db/config/images/bin) — run config.env.bat, optionally restart all.
 * DPL import is intentionally NOT handled (done elsewhere).
 *
 * Register in config/progs:
 *   node | always | 30 | 3 | 5 |processMonitor/index.js
 *
 * MSA service name: `ProcessMonitor_<hostname>` — one registered interface per
 * computer, so the manager can run on every pmon node at the same time.
 *
 * vRPC methods (each: Variant<string JSON> -> Variant<string JSON>):
 *   ListManagers()                          -> { ok, instances: [{system,hostname,updated,managers,dp}] }
 *     managers[]: { index, name, options, startModeCfg, secKill, restartCount, resetMin,   (MGRLIST:LIST)
 *                   state, stateLabel, pid, startMode, startTime, manNum }               (MGRLIST:STATI)
 *     startTime is ISO 8601 (pmon's local time, read on pmon's own host), pmon's raw text
 *     when it cannot be read, '' when pmon gives none (pmon-client.js parsePmonTime).
 *   ControlManager({systemName,action,index}) -> { ok, action, index, system, error? }
 *   AddManager({node,manager:{name,startMode,secKill,restartCount,resetMin,options},index?})
 *                                           -> { ok, system, error? }   (INS into config/progs; append when index omitted)
 *   RemoveManager({node,index})             -> { ok, index, system, error? }   (DEL a stopped manager, index ≥ 1)
 *   RestartAll({systemName})                -> { ok, system, error? }
 *   Deploy({zipPath,clearFolders,restart,target}) -> { ok, results:[{system,hostname,ok,cleared,skipped,error}] }
 *
 * Node-to-node deploy transfer (called by the aggregator on the TARGET node's service;
 * deploy-transfer.js has the contract): ReceiveBegin, ReceiveChunk, ReceiveCommit,
 * DeployStatus, ReceiveAbort. A node whose agent predates them (Unimplemented / not
 * found) or whose service cannot be reached fails with "agent too old or not reachable
 * over vRPC — update/restart the processMonitor manager on <host>"; there is no DPE
 * fallback. Reaching the service of a node of ANOTHER system of a distributed project
 * depends on the MSA addressing and is not verified.
 *
 * After editing this file, restart the processMonitor manager.
 */
const { WinccoaManager, WinccoaDpTypeNode, Vrpc } = require('winccoa-manager');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { PmonClient, parseProgs, progsMatches } = require('./pmon-client.js');
const { DEFAULT_CHUNK_BYTES, TransferReceiver, deployToNodes, sendZip, tooOldMessage } = require('./deploy-transfer.js');

const winccoa = new WinccoaManager();

// MSA vRPC service name — PER HOST. This manager runs on EVERY pmon node, and a
// vRPC service name is unique across the system: a fixed shared name makes the
// second node's registration fail ("service ProcessMonitor already running"), so
// only one computer would ever be reachable. Suffixing the sanitized hostname
// gives one registered interface per computer. The webserver targets the service
// of its OWN host (see processMonitorController), which is also the aggregator:
// it reads every node DP and routes control/deploy to the other nodes' agents.
const SERVICE_NAME = `ProcessMonitor_${dpHost(os.hostname())}`;
const ELEM = { Struct: 1, String: 25 };
/** Node DP type — ONE datapoint per pmon node (per computer), aggregated by dpNames. */
const NODE_TYPE = 'ProcessMonitor_Node';
/** Node DP name prefix; the actual DP is `<prefix>_<hostname>` (one per computer). */
const NODE_DP_PREFIX = 'ProcessMonitor_Node';
/** Legacy single-node DP name (pre per-host); pruned/ignored at startup if present. */
const LEGACY_NODE_DP = 'ProcessMonitor_Node';
/** THIS node's DP — `ProcessMonitor_Node_<hostname>`, set at startup from the host. */
let NODE_DP = '';
const PUBLISH_MS = 3000;

// <PROJ>/javascript/processMonitor/index.js -> project root is two levels up.
const PROJ_PATH = path.resolve(__dirname, '..', '..');
// Folders whose CONTENTS may be purged before a deploy (allow-list).
// NOTE: `javascript` hosts THIS manager and the customer-webserver. Purging it
// mid-deploy removes the running code — only safe when the ZIP restores a working
// `javascript/` and the project is restarted afterwards (esp. for remote nodes).
const PURGEABLE_FOLDERS = new Set(['data/dashboard-wc', 'scripts', 'javascript', 'panels', 'pictures']);
// Top-level project folders a ZIP may NEVER be extracted into (protected).
const DENY_EXTRACT_FOLDERS = new Set(['logs', 'log', 'db', 'config', 'images', 'bin']);

// Scratch area for uploaded ZIPs + extraction staging, kept UNDER the project
// (created on demand). WinCC OA may run under a service account (e.g. a GMSA)
// that has no user profile — os.tmpdir() then resolves to a missing/unwritable
// path — whereas the service account always has write access to its own project
// tree. `temp` is neither a protected nor a purgeable folder.
const TEMP_DIR = path.join(PROJ_PATH, 'temp');
function ensureTempDir() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  return TEMP_DIR;
}

let OWN_SYSTEM = ''; // e.g. "System1:" — filled at startup
const HOSTNAME = os.hostname();

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[ProcessMonitor] ${msg}`);
}

/**
 * Resolve the pmon TCP port. pmon listens on the port set by `[general] pmonPort`
 * in <PROJ>/config/config (a project may override the WinCC OA default 4999, e.g.
 * 8999), so the hard-coded PmonClient default would connect to the wrong port and
 * fail with "Pmon connection error". Priority: env override → config/config → 4999.
 */
function readPmonPort() {
  const env = Number.parseInt(process.env.WINCCOA_PMON_PORT || '', 10);
  if (Number.isInteger(env) && env > 0) return env;
  try {
    const text = fs.readFileSync(path.join(PROJ_PATH, 'config', 'config'), 'utf8');
    let section = '';
    let found = 0;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith('#') || line === '') continue;
      const sec = line.match(/^\[(.+)\]$/);
      if (sec) { section = sec[1].toLowerCase(); continue; }
      // single-value key → a later definition overrides an earlier one (WinCC OA semantics)
      const m = section === 'general' && line.match(/^pmonPort\s*=\s*(\d+)/i);
      if (m) found = Number.parseInt(m[1], 10);
    }
    if (found > 0) return found;
  } catch (e) {
    log(`could not read pmonPort from config/config (${e.message}); using default`);
  }
  return 4999;
}

const PMON_PORT = readPmonPort();
const pmonClient = new PmonClient({ port: PMON_PORT });

function parseReq(request) {
  if (!request.isString() || request.isNull()) return {};
  try {
    return JSON.parse(request.getString()) || {};
  } catch {
    return {};
  }
}

function reply(obj) {
  return Vrpc.Variant.createString(JSON.stringify(obj));
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Coerce a (possibly `{value}`-wrapped) dpGet result to a plain string. */
function asStr(v) {
  if (v && typeof v === 'object' && 'value' in v) return String(v.value ?? '');
  return v == null ? '' : String(v);
}

/** The "System:" prefix of a (possibly prefixed) dp name, or the own system. */
function sysPrefix(dp) {
  const i = dp.indexOf(':');
  return i >= 0 ? dp.slice(0, i + 1) : OWN_SYSTEM;
}

/** The bare dp name (drops a `System:` prefix). */
function bareDp(dp) {
  const i = dp.indexOf(':');
  return i >= 0 ? dp.slice(i + 1) : dp;
}

/** Sanitize a hostname into a valid WinCC OA DP-name fragment ([A-Za-z0-9_]). */
function dpHost(host) {
  return String(host || 'unknown').replace(/[^A-Za-z0-9_]/g, '_');
}

/** A real per-host node DP is `ProcessMonitor_Node_<host>` (excludes the legacy bare DP). */
function isValidNodeName(dp) {
  return bareDp(dp).startsWith(`${NODE_DP_PREFIX}_`);
}

/** True when a discovered node is THIS computer's own node (own pmon/project). */
function isLocal(node) {
  return bareDp(node.dp) === NODE_DP;
}

// ---- 7-Zip extraction (deny-listed, staged) --------------------------------

function sevenZipExe() {
  return process.env.SEVENZIP_PATH || '7z';
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') });
    });
  });
}

/** Extract a ZIP into `dest` using 7-Zip (tries common install paths). */
async function extract7z(zipPath, dest) {
  const candidates = [sevenZipExe()];
  if (!process.env.SEVENZIP_PATH) candidates.push('C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe');
  let last = { ok: false, stderr: '7-Zip not found' };
  for (const exe of candidates) {
    last = await run(exe, ['x', zipPath, `-o${dest}`, '-y'], dest);
    if (last.ok) return { ok: true };
    if (!/ENOENT|not found|introuvable/i.test(last.stderr)) break; // a real 7z error, not "exe missing"
  }
  return { ok: false, error: `7-Zip extraction failed: ${last.stderr.slice(0, 400)}` };
}

/**
 * Extract a ZIP into the project. The ZIP is first extracted into a temp stage;
 * any TOP-LEVEL protected folder (logs/log/db/config/images/bin) is pruned from
 * the stage and reported as `skipped`; the remainder is merged into the project
 * root. This guarantees a ZIP can never overwrite a protected folder.
 */
async function extractZip(zipPath) {
  const stage = path.join(ensureTempDir(), `pm-stage-${crypto.randomUUID()}`);
  await fsp.mkdir(stage, { recursive: true });
  try {
    const ex = await extract7z(zipPath, stage);
    if (!ex.ok) return { ok: false, error: ex.error, skipped: [] };
    const skipped = [];
    for (const entry of await fsp.readdir(stage)) {
      if (DENY_EXTRACT_FOLDERS.has(entry.toLowerCase())) {
        await fsp.rm(path.join(stage, entry), { recursive: true, force: true });
        skipped.push(entry);
      }
    }
    await fsp.cp(stage, PROJ_PATH, { recursive: true, force: true });
    if (skipped.length > 0) log(`Deploy: skipped protected folders [${skipped.join(', ')}]`);
    return { ok: true, skipped };
  } catch (e) {
    return { ok: false, error: e.message, skipped: [] };
  } finally {
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Delete the CONTENTS of one allow-listed project folder (keeps the folder itself). */
async function purgeFolder(rel) {
  if (!PURGEABLE_FOLDERS.has(rel)) throw new Error(`folder not purgeable: ${rel}`);
  const abs = path.join(PROJ_PATH, rel);
  if (!fs.existsSync(abs)) return;
  for (const entry of await fsp.readdir(abs)) {
    await fsp.rm(path.join(abs, entry), { recursive: true, force: true });
  }
}

function runConfigEnv() {
  const bat = path.join(PROJ_PATH, 'config', 'config.env.bat');
  if (!fs.existsSync(bat)) return Promise.resolve({ ok: true, skipped: true });
  return run(bat, [], PROJ_PATH);
}

/**
 * Deploy a ZIP into the LOCAL project (purge → extract → config.env → restart).
 * `restartDelayMs` delays the restart for a deploy received from the aggregator, so
 * its `DeployStatus` poll sees "done" before this manager is recycled.
 */
async function doLocalDeploy({ zipPath, clearFolders, restart, restartDelayMs = 0 }) {
  if (!zipPath || !fs.existsSync(zipPath)) return { ok: false, error: `ZIP introuvable : ${zipPath}` };
  const cleared = [];
  try {
    for (const folder of clearFolders) {
      await purgeFolder(folder);
      cleared.push(folder);
    }
  } catch (e) {
    return { ok: false, error: `Purge échouée : ${e.message}`, cleared, skipped: [] };
  }
  log(`Deploy: extracting ${zipPath} into ${PROJ_PATH} (cleared=[${cleared.join(', ')}])`);
  const ex = await extractZip(zipPath);
  if (!ex.ok) return { ok: false, error: ex.error, cleared, skipped: ex.skipped };
  await runConfigEnv();
  if (restart) {
    // Fire the restart, then return — pmon RESTART_ALL recycles managers (incl.
    // the webserver) shortly after this reply is sent.
    const fire = () => pmonClient.restartAll().catch((e) => log(`restartAll after deploy failed: ${e.message}`));
    if (restartDelayMs > 0) setTimeout(fire, restartDelayMs);
    else fire();
  }
  return { ok: true, cleared, skipped: ex.skipped, extracted: true, restarted: restart };
}

// ---- node DP (agent role) --------------------------------------------------

async function ensureNodeType() {
  const root = new WinccoaDpTypeNode(NODE_TYPE, ELEM.Struct, '', [
    new WinccoaDpTypeNode('hostname', ELEM.String),
    new WinccoaDpTypeNode('system', ELEM.String),
    new WinccoaDpTypeNode('pmon', ELEM.String),
    new WinccoaDpTypeNode('updated', ELEM.String),
    new WinccoaDpTypeNode('cmd', ELEM.String),
    new WinccoaDpTypeNode('cmdResult', ELEM.String)
  ]);
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${NODE_TYPE}`);
  } catch {
    // already exists
  }
}

async function ensureNodeDp() {
  await ensureNodeType();
  if (!winccoa.dpExists(NODE_DP)) {
    await winccoa.dpCreate(NODE_DP, NODE_TYPE);
    log(`DP node créé : ${NODE_DP}`);
  }
  await winccoa.dpSetWait([`${NODE_DP}.hostname`, `${NODE_DP}.system`], [HOSTNAME, OWN_SYSTEM]);
}

/**
 * Up to 0.1.x the ZIP was shipped base64 in `.deployData` and stayed there. A node DP
 * created by such a version still has the element (the type is not changed on an
 * existing project): empty it, so no old ZIP is kept. Absent element → nothing to do.
 */
async function clearLegacyDeployData() {
  const dpe = `${NODE_DP}.deployData`;
  try {
    if (!winccoa.dpExists(dpe)) return;
    await winccoa.dpSetWait(dpe, '');
    log(`${dpe} vidé (ancien transfert de ZIP par DPE)`);
  } catch (e) {
    log(`could not clear ${dpe}: ${e.message}`);
  }
}

/** Remove the legacy single-node DP (`ProcessMonitor_Node`, no host suffix). */
async function cleanupLegacyDp() {
  try {
    if (LEGACY_NODE_DP !== NODE_DP && winccoa.dpExists(LEGACY_NODE_DP)) {
      await winccoa.dpDelete(LEGACY_NODE_DP);
      log(`DP legacy supprimé : ${LEGACY_NODE_DP}`);
    }
  } catch (e) {
    log(`could not delete legacy DP ${LEGACY_NODE_DP}: ${e.message}`);
  }
}

async function publishOnce() {
  try {
    const managers = await pmonClient.listManagers();
    await winccoa.dpSet([`${NODE_DP}.pmon`, `${NODE_DP}.updated`], [JSON.stringify(managers), new Date().toISOString()]);
  } catch (e) {
    log(`publish failed: ${e.message}`);
  }
}

/**
 * Validate + normalize an AddManager spec — the values end up on one pmon TCP
 * protocol line, so the name is restricted to safe characters and line breaks
 * are stripped from the options.
 */
function normalizeManagerSpec(spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const name = String(s.name || '').trim().replace(/\.exe$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`nom de manager invalide : "${name}"`);
  const startMode = ['manual', 'once', 'always'].includes(s.startMode) ? s.startMode : 'always';
  const num = (v, def, min, max) => {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n >= min && n <= max ? n : def;
  };
  return {
    name,
    startMode,
    secKill: num(s.secKill, 30, 1, 3600),
    restartCount: num(s.restartCount, 3, 1, 100),
    resetMin: num(s.resetMin, 1, 1, 1440),
    options: String(s.options || '').replace(/[\r\n]+/g, ' ').trim()
  };
}

/** pmon writes `config/progs` after acknowledging an INS / DEL: wait for it, a few times. */
const PROGS_CHECK_DELAYS_MS = [300, 700, 1500];

/**
 * After an INS / DEL that pmon applied (checked by pmon-client against MGRLIST:LIST): is the
 * change written to `<project>/config/progs`, i.e. kept at the next project restart? Returns a
 * warning text when it is not (or when the file cannot be read), '' otherwise (issue 35).
 */
async function progsWarning() {
  const file = path.join(PROJ_PATH, 'config', 'progs');
  let list = [];
  let progs = [];
  for (const wait of PROGS_CHECK_DELAYS_MS) {
    await new Promise((r) => setTimeout(r, wait));
    try {
      list = await pmonClient.listManagers();
      progs = parseProgs(await fsp.readFile(file, 'utf8'));
    } catch (e) {
      return `config/progs illisible (${e.message}) : l'enregistrement du changement n'a pas pu être vérifié.`;
    }
    if (progsMatches(progs, list)) return '';
  }
  log(`config/progs (${progs.length} entrées) ne reflète pas pmon (${list.length} entrées) après INS/DEL`);
  return "Appliqué dans pmon, mais pas écrit dans config/progs : le changement sera perdu au prochain redémarrage du projet.";
}

/**
 * Execute one control / config action against the LOCAL pmon (shared by the
 * agent's `.cmd` handler and the aggregator's own-node shortcut). Resolves with
 * `{ warning }` for an INS / DEL not persisted to config/progs.
 */
async function execPmonCmd(cmd) {
  if (cmd.action === 'start') return pmonClient.startManager(cmd.index);
  if (cmd.action === 'stop') return pmonClient.stopManager(cmd.index);
  if (cmd.action === 'restart') return pmonClient.restartManager(cmd.index);
  if (cmd.action === 'restart-all') return pmonClient.restartAll();
  if (cmd.action === 'add') {
    const spec = normalizeManagerSpec(cmd.manager);
    // Default (index omitted / out of range): append at the end of the LOCAL
    // list — always a legal INS slot (index 0 is pmon itself).
    const list = await pmonClient.listManagers();
    const index = Number.isInteger(cmd.index) && cmd.index >= 1 && cmd.index <= list.length ? cmd.index : list.length;
    await pmonClient.addManager({ index, ...spec });
    return { warning: await progsWarning() };
  }
  if (cmd.action === 'remove') {
    if (!Number.isInteger(cmd.index) || cmd.index < 1) throw new Error('index invalide (≥ 1 requis — 0 est pmon)');
    await pmonClient.removeManager(cmd.index);
    return { warning: await progsWarning() };
  }
  throw new Error(`action invalide: ${cmd.action}`);
}

/** Track the last handled command id so reconnect / repeat values are ignored. */
let lastCmdId = '';

async function onCmd(cmd) {
  if (!cmd || !cmd.reqId || cmd.reqId === lastCmdId) return;
  lastCmdId = cmd.reqId;
  let ok = false;
  let error = '';
  let warning = '';
  try {
    warning = (await execPmonCmd(cmd))?.warning || '';
    ok = true;
  } catch (e) {
    error = e.message;
  }
  await winccoa.dpSet(`${NODE_DP}.cmdResult`, JSON.stringify({ reqId: cmd.reqId, ok, error, warning, ts: new Date().toISOString() }));
  await publishOnce();
}

function startAgent() {
  // React to commands targeted at THIS computer's node (answer=false → skip initial).
  winccoa.dpConnect(
    (_names, values) => {
      try {
        const v = asStr(values[0]);
        if (v) void onCmd(JSON.parse(v));
      } catch (e) {
        log(`cmd parse error: ${e.message}`);
      }
    },
    [`${NODE_DP}.cmd`],
    false
  );
  void publishOnce();
  setInterval(() => void publishOnce(), PUBLISH_MS);
}

// ---- aggregation + routing (aggregator role) -------------------------------

/** All node DPs across connected systems → [{dp, system, hostname}]. */
async function discoverNodes() {
  let names = [];
  try {
    names = winccoa.dpNames('*', NODE_TYPE) || [];
  } catch {
    names = [];
  }
  const out = [];
  for (const raw of names) {
    const dp = raw.endsWith('.') ? raw.slice(0, -1) : raw;
    if (!isValidNodeName(dp)) continue; // skip the legacy bare ProcessMonitor_Node DP
    try {
      const vals = await winccoa.dpGet([`${dp}.system`, `${dp}.hostname`]);
      out.push({ dp, system: asStr(vals[0]) || sysPrefix(dp), hostname: asStr(vals[1]) });
    } catch {
      out.push({ dp, system: sysPrefix(dp), hostname: '' });
    }
  }
  return out;
}

/** Poll a result DPE until a record with `reqId` appears (or timeout) — control commands only. */
async function pollResult(dpeName, reqId, timeoutMs, stepMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = asStr((await winccoa.dpGet([dpeName]))[0]);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.reqId === reqId) return o;
      }
    } catch {
      // keep polling
    }
    await delay(stepMs);
  }
  return { reqId, ok: false, error: 'timeout' };
}

/**
 * Resolve target node(s). `target` is a node DP name (per-host), '' / 'all' for
 * every node. A bare or `System:`-prefixed dp both match. Falls back to matching
 * a plain hostname (e.g. "PC1" → ProcessMonitor_Node_PC1) for convenience.
 */
async function resolveTargets(target) {
  const nodes = await discoverNodes();
  if (!target || target === 'all') return nodes;
  const t = String(target);
  const byDp = nodes.filter((n) => n.dp === t || bareDp(n.dp) === bareDp(t));
  if (byDp.length > 0) return byDp;
  return nodes.filter((n) => bareDp(n.dp) === `${NODE_DP_PREFIX}_${dpHost(t)}` || n.hostname === t);
}

// ---- node-to-node deploy transfer over vRPC (issue 32) ---------------------

/** Agent side: deploy ZIPs streamed by the aggregator into `<project>/temp`. */
const receiver = new TransferReceiver({
  dir: TEMP_DIR,
  // Restart deferred: the aggregator's DeployStatus poll must see "done" first.
  deploy: (req) => doLocalDeploy({ ...req, restartDelayMs: 5000 }),
  log
});

/** Raw bytes per transfer chunk (a ~1 MiB base64 string); `PM_DEPLOY_CHUNK_BYTES` overrides it. */
const CHUNK_BYTES = (() => {
  const n = Number.parseInt(process.env.PM_DEPLOY_CHUNK_BYTES || '', 10);
  return Number.isInteger(n) && n >= 16 * 1024 ? n : DEFAULT_CHUNK_BYTES;
})();

/** The vRPC service name of a node: `ProcessMonitor_<hostname>`, from its node DP name. */
function nodeServiceName(node) {
  const bare = bareDp(node.dp);
  const prefix = `${NODE_DP_PREFIX}_`;
  return `ProcessMonitor_${bare.startsWith(prefix) ? bare.slice(prefix.length) : dpHost(node.hostname)}`;
}

/** Human-readable reason from an MSA error (its status text) or a plain error. */
function vrpcErrorText(error) {
  const status = error && error.status;
  return (status && (status.text || status.message)) || (error instanceof Error ? error.message : String(error));
}

/**
 * `call(method, request)` on another node's service — the same `Vrpc.Stub` client the
 * webserver bridge uses for this manager. Rejects when the stub cannot be created (no
 * such service) or the call does not answer OK (e.g. Unimplemented on an older agent).
 */
async function nodeCaller(node) {
  const stub = await Vrpc.Stub.createAndInitialize(nodeServiceName(node), new Vrpc.StubOptions());
  return async (method, request) => {
    let resp;
    try {
      resp = await stub.callFunction(method, Vrpc.Variant.createString(JSON.stringify(request)), new Vrpc.ClientContext());
    } catch (e) {
      throw new Error(`${method}: ${vrpcErrorText(e)}`);
    }
    if (resp.status.statusCode !== Vrpc.StatusCode.OK) throw new Error(`${method}: ${String(resp.status.text ?? resp.status.statusCode)}`);
    return JSON.parse(String(resp.response.value ?? '{}'));
  };
}

/** Wrap a receiver method as a vRPC handler (JSON in, JSON out). */
function jsonHandler(fn) {
  return async (ctx, request) => {
    ctx.cancelSignal.throwIfAborted();
    try {
      return reply(await fn(parseReq(request)));
    } catch (e) {
      return reply({ ok: false, error: e.message });
    }
  };
}

class ProcessMonitorService extends Vrpc.ServiceBase {
  constructor() {
    super(SERVICE_NAME);
    this.registerFunction('ListManagers', (ctx, req) => this.listManagers(ctx, req));
    this.registerFunction('ControlManager', (ctx, req) => this.controlManager(ctx, req));
    this.registerFunction('AddManager', (ctx, req) => this.addManager(ctx, req));
    this.registerFunction('RemoveManager', (ctx, req) => this.removeManager(ctx, req));
    this.registerFunction('RestartAll', (ctx, req) => this.restartAll(ctx, req));
    this.registerFunction('Deploy', (ctx, req) => this.deploy(ctx, req));
    this.registerFunction('ReceiveBegin', jsonHandler((r) => receiver.begin(r)));
    this.registerFunction('ReceiveChunk', jsonHandler((r) => receiver.chunk(r)));
    this.registerFunction('ReceiveCommit', jsonHandler((r) => receiver.commit(r)));
    this.registerFunction('DeployStatus', jsonHandler((r) => receiver.status(r)));
    this.registerFunction('ReceiveAbort', jsonHandler((r) => receiver.abort(r)));
  }

  async listManagers(ctx) {
    ctx.cancelSignal.throwIfAborted();
    try {
      const nodes = winccoa.dpNames('*', NODE_TYPE) || [];
      const instances = [];
      for (const raw of nodes) {
        const dp = raw.endsWith('.') ? raw.slice(0, -1) : raw;
        if (!isValidNodeName(dp)) continue; // skip the legacy bare ProcessMonitor_Node DP
        const vals = await winccoa.dpGet([`${dp}.system`, `${dp}.hostname`, `${dp}.pmon`, `${dp}.updated`]);
        let managers = [];
        try {
          managers = JSON.parse(asStr(vals[2]) || '[]');
        } catch {
          managers = [];
        }
        instances.push({ system: asStr(vals[0]) || sysPrefix(dp), hostname: asStr(vals[1]), updated: asStr(vals[3]), managers, dp });
      }
      if (instances.length === 0) {
        // Node DP not provisioned yet — fall back to the local pmon as one instance.
        instances.push({ system: OWN_SYSTEM, hostname: HOSTNAME, updated: new Date().toISOString(), managers: await pmonClient.listManagers(), dp: NODE_DP });
      }
      // Also expose a flat `managers` list (the local/first server) for backward
      // compatibility: a still-cached pre-multi-server page bundle reads `managers`,
      // the current one reads `instances` — returning both avoids an empty list
      // until the service worker serves the new bundle.
      const localInst = instances.find(isLocal) ?? instances.find((i) => i.system === OWN_SYSTEM) ?? instances[0];
      return reply({ ok: true, instances, managers: localInst?.managers ?? [] });
    } catch (e) {
      return reply({ ok: false, error: e.message, instances: [], managers: [] });
    }
  }

  async controlManager(ctx, request) {
    ctx.cancelSignal.throwIfAborted();
    const { node, systemName, action, index } = parseReq(request);
    if (typeof index !== 'number' || index < 0) throw vrpcError('InvalidArgument', 'index (pmon, 0-based) requis');
    if (!['start', 'stop', 'restart'].includes(action)) throw vrpcError('InvalidArgument', 'action invalide');
    return reply(await this.routeCommand(node ?? systemName ?? '', { action, index }));
  }

  /** Insert a manager into a target node's pmon configuration (append by default). */
  async addManager(ctx, request) {
    ctx.cancelSignal.throwIfAborted();
    const { node, systemName, manager, index } = parseReq(request);
    normalizeManagerSpec(manager); // fail fast on an invalid spec (re-validated at execution)
    const at = Number.isInteger(index) && index >= 1 ? index : -1; // -1 → append on the target node
    return reply(await this.routeCommand(node ?? systemName ?? '', { action: 'add', index: at, manager }));
  }

  /** Remove a (stopped) manager from a target node's pmon configuration. */
  async removeManager(ctx, request) {
    ctx.cancelSignal.throwIfAborted();
    const { node, systemName, index } = parseReq(request);
    if (!Number.isInteger(index) || index < 1) throw vrpcError('InvalidArgument', 'index (pmon, ≥ 1) requis — 0 est pmon');
    return reply(await this.routeCommand(node ?? systemName ?? '', { action: 'remove', index }));
  }

  async restartAll(ctx, request) {
    ctx.cancelSignal.throwIfAborted();
    const { node, systemName } = parseReq(request);
    return reply(await this.routeCommand(node ?? systemName ?? '', { action: 'restart-all', index: -1 }));
  }

  /** Execute a control command on the LOCAL pmon (this computer). */
  async localPmon(cmd, system) {
    try {
      const r = await execPmonCmd(cmd);
      return { ok: true, ...cmd, system: system || OWN_SYSTEM, warning: r?.warning || '' };
    } catch (e) {
      return { ok: false, error: e.message, ...cmd, system: system || OWN_SYSTEM };
    }
  }

  /**
   * Route a control command to a target node. The target node's OWN agent (the
   * processMonitor manager running on that computer) executes it against its
   * local pmon via the node DP's `.cmd`/`.cmdResult`. This computer's own node is
   * handled directly (no DP round-trip).
   */
  async routeCommand(target, cmd) {
    const targets = await resolveTargets(target);
    const node = targets[0];
    if (!node) {
      // No matching node DP (fresh start / unknown target) → local pmon.
      return this.localPmon(cmd, OWN_SYSTEM);
    }
    if (isLocal(node)) return this.localPmon(cmd, node.system);
    const reqId = crypto.randomUUID();
    await winccoa.dpSetWait(`${node.dp}.cmd`, JSON.stringify({ reqId, ...cmd }));
    const res = await pollResult(`${node.dp}.cmdResult`, reqId, 12000);
    return { ok: res.ok === true, error: res.error || '', warning: res.warning || '', ...cmd, system: node.system };
  }

  async deploy(ctx, request) {
    ctx.cancelSignal.throwIfAborted();
    const req = parseReq(request);
    const zipPath = String(req.zipPath || '');
    const clearFolders = Array.isArray(req.clearFolders) ? req.clearFolders : [];
    const restart = req.restart === true;
    const target = req.target || 'all';
    if (!zipPath || !fs.existsSync(zipPath)) return reply({ ok: false, error: `ZIP introuvable : ${zipPath}`, results: [] });

    const targets = await resolveTargets(target);
    if (targets.length === 0) {
      const r = await doLocalDeploy({ zipPath, clearFolders, restart });
      return reply({ ok: r.ok, results: [{ system: OWN_SYSTEM, hostname: HOSTNAME, ...r }] });
    }

    const results = await deployToNodes(targets, {
      isLocal,
      localDeploy: async (node) => ({ system: node.system, hostname: node.hostname || HOSTNAME, ...(await doLocalDeploy({ zipPath, clearFolders, restart })) }),
      remoteDeploy: (node) => this.remoteDeploy(node, { zipPath, clearFolders, restart })
    });
    const ok = results.length > 0 && results.every((r) => r.ok);
    return reply({ ok, results });
  }

  /** Stream the ZIP to a remote node's own service and await its deploy (issue 32). */
  async remoteDeploy(node, { zipPath, clearFolders, restart }) {
    const host = node.hostname || bareDp(node.dp);
    const head = { system: node.system, hostname: node.hostname };
    let call;
    try {
      call = await nodeCaller(node);
    } catch (e) {
      return { ...head, ok: false, cleared: [], skipped: [], error: tooOldMessage(host, vrpcErrorText(e)) };
    }
    const r = await sendZip(call, { zipPath, clearFolders, restart, host, chunkBytes: CHUNK_BYTES });
    if (!r.ok) log(`Deploy on ${host} failed: ${r.error}`);
    return { ...head, ok: r.ok, cleared: r.cleared, skipped: r.skipped, error: r.error };
  }
}

function vrpcError(code, message) {
  return new Vrpc.Error(new Vrpc.Status(Vrpc.StatusCode[code], message));
}

async function run_() {
  log('Démarrage du service Process Monitor (MSA vRPC)…');
  log(`Project path: ${PROJ_PATH}`);
  log(`Pmon: ${pmonClient.host}:${PMON_PORT}`);
  try {
    OWN_SYSTEM = winccoa.getSystemName();
  } catch {
    OWN_SYSTEM = '';
  }
  // One node DP per pmon node, named after THIS computer — so a single WinCC OA
  // system whose managers/pmon are spread over several computers shows one node
  // (one tab) per computer.
  NODE_DP = `${NODE_DP_PREFIX}_${dpHost(HOSTNAME)}`;
  log(`System: ${OWN_SYSTEM || '(standalone)'} · host: ${HOSTNAME} · node DP: ${NODE_DP}`);
  try {
    await ensureNodeDp();
    await clearLegacyDeployData();
    await cleanupLegacyDp();
    startAgent();
  } catch (e) {
    log(`Agent init failed (continuing as aggregator only): ${e.message}`);
  }
  // Transfers a previous run left in <project>/temp (manager restarted mid-transfer).
  await receiver.cleanupStale({ all: true }).catch((e) => log(`transfer cleanup failed: ${e.message}`));
  setInterval(() => void receiver.cleanupStale().catch(() => undefined), 5 * 60 * 1000);
  const container = new Vrpc.ServiceContainer();
  container.registerService(new ProcessMonitorService(), new Vrpc.ServiceOptions());
  try {
    await container.startAllServices();
    log(`Service "${SERVICE_NAME}" démarré.`);
  } catch (e) {
    log(`Échec du démarrage du service : ${e}`);
  }
}

run_().catch((e) => log(`Erreur fatale : ${e}`));
