'use strict';
/**
 * Process Monitor — WinCC OA JavaScript Manager hosting an MSA (Manager Service
 * API) vRPC service for the "Process Monitor" WebUI page.
 *
 * Distributed, multi-server model (faithful to the legacy `winccoa_projectmanager`
 * which aggregated `dpNames("*", PROJECT_DOWNLOAD)`): this manager runs on EVERY
 * connected system and plays two roles —
 *
 *   - AGENT (every system): maintains its own node datapoint `ProcessMonitor_Node`
 *     (distributed → visible system-wide as `<System>:ProcessMonitor_Node`),
 *     periodically publishing its LOCAL pmon snapshot into `.pmon`, and reacting
 *     to control (`.cmd`) and deploy (`.deployCmd`/`.deployData`) commands
 *     targeted at it by executing them against its local pmon / project.
 *
 *   - AGGREGATOR (the system serving the customer-webserver): the vRPC service
 *     methods read every node DP via `dpNames("*", ProcessMonitor_Node)` →
 *     one instance per server → the page renders one tab per server. Control /
 *     restart-all are routed to a target system's `.cmd`; project deploy can be
 *     propagated to ALL connected servers (file shipped via `.deployData`).
 *
 * Project deployment: optionally purge selected folders (allow-list), extract an
 * uploaded ZIP (7-Zip) into the project — NEVER into protected folders
 * (logs/log/db/config/images/bin) — run config.env.bat, optionally restart all.
 * DPL import is intentionally NOT handled (done elsewhere).
 *
 * Register in config/progs:
 *   node | always | 30 | 3 | 5 |processMonitor/index.js
 *
 * vRPC methods (each: Variant<string JSON> -> Variant<string JSON>):
 *   ListManagers()                          -> { ok, instances: [{system,hostname,updated,managers,dp}] }
 *   ControlManager({systemName,action,index}) -> { ok, action, index, system, error? }
 *   RestartAll({systemName})                -> { ok, system, error? }
 *   Deploy({zipPath,clearFolders,restart,target}) -> { ok, results:[{system,hostname,ok,cleared,skipped,error}] }
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
const { PmonClient } = require('./pmon-client.js');

const winccoa = new WinccoaManager();
const pmonClient = new PmonClient();

const SERVICE_NAME = 'ProcessMonitor';
const ELEM = { Struct: 1, String: 25 };
/** Distributed node DP type/name: one per system, aggregated by dpNames("*", type). */
const NODE_TYPE = 'ProcessMonitor_Node';
const NODE_DP = 'ProcessMonitor_Node';
const PUBLISH_MS = 3000;

// <PROJ>/javascript/processMonitor/index.js -> project root is two levels up.
const PROJ_PATH = path.resolve(__dirname, '..', '..');
// Folders whose CONTENTS may be purged before a deploy (allow-list).
const PURGEABLE_FOLDERS = new Set(['data/dashboard-wc', 'scripts', 'panels', 'pictures']);
// Top-level project folders a ZIP may NEVER be extracted into (protected).
const DENY_EXTRACT_FOLDERS = new Set(['logs', 'log', 'db', 'config', 'images', 'bin']);

let OWN_SYSTEM = ''; // e.g. "System1:" — filled at startup
const HOSTNAME = os.hostname();

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[ProcessMonitor] ${msg}`);
}

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

/** True when a discovered node refers to THIS system (local pmon/project). */
function isLocal(node) {
  return node.system === OWN_SYSTEM || node.dp === NODE_DP || !node.dp.includes(':');
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
  const stage = path.join(os.tmpdir(), `pm-stage-${crypto.randomUUID()}`);
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

/** Deploy a ZIP into the LOCAL project (purge → extract → config.env → restart). */
async function doLocalDeploy({ zipPath, clearFolders, restart }) {
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
    pmonClient.restartAll().catch((e) => log(`restartAll after deploy failed: ${e.message}`));
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
    new WinccoaDpTypeNode('cmdResult', ELEM.String),
    new WinccoaDpTypeNode('deployCmd', ELEM.String),
    new WinccoaDpTypeNode('deployData', ELEM.String),
    new WinccoaDpTypeNode('deployResult', ELEM.String)
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

async function publishOnce() {
  try {
    const managers = await pmonClient.listManagers();
    await winccoa.dpSet([`${NODE_DP}.pmon`, `${NODE_DP}.updated`], [JSON.stringify(managers), new Date().toISOString()]);
  } catch (e) {
    log(`publish failed: ${e.message}`);
  }
}

/** Track last handled command ids so reconnect / repeat values are ignored. */
let lastCmdId = '';
let lastDeployId = '';

async function onCmd(cmd) {
  if (!cmd || !cmd.reqId || cmd.reqId === lastCmdId) return;
  lastCmdId = cmd.reqId;
  let ok = false;
  let error = '';
  try {
    if (cmd.action === 'start') await pmonClient.startManager(cmd.index);
    else if (cmd.action === 'stop') await pmonClient.stopManager(cmd.index);
    else if (cmd.action === 'restart') await pmonClient.restartManager(cmd.index);
    else if (cmd.action === 'restart-all') await pmonClient.restartAll();
    else throw new Error(`action invalide: ${cmd.action}`);
    ok = true;
  } catch (e) {
    error = e.message;
  }
  await winccoa.dpSet(`${NODE_DP}.cmdResult`, JSON.stringify({ reqId: cmd.reqId, ok, error, ts: new Date().toISOString() }));
  await publishOnce();
}

async function onDeployCmd(cmd) {
  if (!cmd || !cmd.reqId || cmd.reqId === lastDeployId) return;
  lastDeployId = cmd.reqId;
  const tmp = path.join(os.tmpdir(), `pm-deploy-${cmd.reqId}.zip`);
  let result;
  try {
    const b64 = asStr((await winccoa.dpGet([`${NODE_DP}.deployData`]))[0]);
    fs.writeFileSync(tmp, Buffer.from(b64 || '', 'base64'));
    result = await doLocalDeploy({ zipPath: tmp, clearFolders: cmd.clearFolders || [], restart: cmd.restart === true });
  } catch (e) {
    result = { ok: false, error: e.message };
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
  await winccoa.dpSet(`${NODE_DP}.deployResult`, JSON.stringify({ reqId: cmd.reqId, ...result, ts: new Date().toISOString() }));
}

function startAgent() {
  // React to commands targeted at THIS system (answer=false → skip initial value).
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
  winccoa.dpConnect(
    (_names, values) => {
      try {
        const v = asStr(values[0]);
        if (v) void onDeployCmd(JSON.parse(v));
      } catch (e) {
        log(`deployCmd parse error: ${e.message}`);
      }
    },
    [`${NODE_DP}.deployCmd`],
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
    try {
      const vals = await winccoa.dpGet([`${dp}.system`, `${dp}.hostname`]);
      out.push({ dp, system: asStr(vals[0]) || sysPrefix(dp), hostname: asStr(vals[1]) });
    } catch {
      out.push({ dp, system: sysPrefix(dp), hostname: '' });
    }
  }
  return out;
}

/** Poll a result DPE until a record with `reqId` appears (or timeout). */
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

/** Resolve the target node(s) for a system name ('' / 'all' → all, else match). */
async function resolveTargets(systemName) {
  const nodes = await discoverNodes();
  if (!systemName || systemName === 'all') return nodes;
  const match = nodes.filter((n) => n.system === systemName || n.dp === systemName || n.dp === `${systemName}${NODE_DP}`);
  return match.length > 0 ? match : nodes.filter((n) => n.system.replace(':', '') === String(systemName).replace(':', ''));
}

class ProcessMonitorService extends Vrpc.ServiceBase {
  constructor() {
    super(SERVICE_NAME);
    this.registerFunction('ListManagers', (ctx, req) => this.listManagers(ctx, req));
    this.registerFunction('ControlManager', (ctx, req) => this.controlManager(ctx, req));
    this.registerFunction('RestartAll', (ctx, req) => this.restartAll(ctx, req));
    this.registerFunction('Deploy', (ctx, req) => this.deploy(ctx, req));
  }

  async listManagers(ctx) {
    ctx.cancelSignal.throwIfAborted();
    try {
      const nodes = winccoa.dpNames('*', NODE_TYPE) || [];
      const instances = [];
      for (const raw of nodes) {
        const dp = raw.endsWith('.') ? raw.slice(0, -1) : raw;
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
      const localInst = instances.find((i) => i.system === OWN_SYSTEM) ?? instances[0];
      return reply({ ok: true, instances, managers: localInst?.managers ?? [] });
    } catch (e) {
      return reply({ ok: false, error: e.message, instances: [], managers: [] });
    }
  }

  async controlManager(ctx, request) {
    ctx.cancelSignal.throwIfAborted();
    const { systemName, action, index } = parseReq(request);
    if (typeof index !== 'number' || index < 0) throw vrpcError('InvalidArgument', 'index (pmon, 0-based) requis');
    if (!['start', 'stop', 'restart'].includes(action)) throw vrpcError('InvalidArgument', 'action invalide');
    return reply(await this.routeCommand(systemName, { action, index }));
  }

  async restartAll(ctx, request) {
    ctx.cancelSignal.throwIfAborted();
    const { systemName } = parseReq(request);
    return reply(await this.routeCommand(systemName, { action: 'restart-all', index: -1 }));
  }

  /** Send a control command to a target system's node DP and await its result. */
  async routeCommand(systemName, cmd) {
    const targets = await resolveTargets(systemName);
    const target = targets[0];
    if (!target) {
      // No node DP at all → act on the local pmon directly.
      try {
        if (cmd.action === 'restart-all') await pmonClient.restartAll();
        else if (cmd.action === 'start') await pmonClient.startManager(cmd.index);
        else if (cmd.action === 'stop') await pmonClient.stopManager(cmd.index);
        else await pmonClient.restartManager(cmd.index);
        return { ok: true, ...cmd, system: OWN_SYSTEM };
      } catch (e) {
        return { ok: false, error: e.message, ...cmd, system: OWN_SYSTEM };
      }
    }
    const reqId = crypto.randomUUID();
    await winccoa.dpSetWait(`${target.dp}.cmd`, JSON.stringify({ reqId, ...cmd }));
    const res = await pollResult(`${target.dp}.cmdResult`, reqId, 12000);
    return { ok: res.ok === true, error: res.error || '', ...cmd, system: target.system };
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

    let b64 = null; // ZIP base64, read once, only when a remote target needs it
    const results = [];
    // Deploy to the LOCAL system last: a `restart` recycles this manager/webserver,
    // which would otherwise abort the remaining (remote) deployments and the reply.
    const ordered = [...targets].sort((a, b) => Number(isLocal(a)) - Number(isLocal(b)));
    for (const node of ordered) {
      if (isLocal(node)) {
        const r = await doLocalDeploy({ zipPath, clearFolders, restart });
        results.push({ system: node.system, hostname: node.hostname || HOSTNAME, ...r });
      } else {
        if (b64 === null) b64 = fs.readFileSync(zipPath).toString('base64');
        results.push(await this.remoteDeploy(node, { b64, clearFolders, restart, fileName: path.basename(zipPath) }));
      }
    }
    const ok = results.length > 0 && results.every((r) => r.ok);
    return reply({ ok, results });
  }

  /** Ship a ZIP to a remote system's node DP and await its deploy result. */
  async remoteDeploy(node, { b64, clearFolders, restart, fileName }) {
    const reqId = crypto.randomUUID();
    try {
      await winccoa.dpSetWait(`${node.dp}.deployData`, b64);
      await winccoa.dpSetWait(`${node.dp}.deployCmd`, JSON.stringify({ reqId, fileName, clearFolders, restart }));
    } catch (e) {
      return { system: node.system, hostname: node.hostname, ok: false, error: `dispatch failed: ${e.message}` };
    }
    const res = await pollResult(`${node.dp}.deployResult`, reqId, 120000);
    return {
      system: node.system,
      hostname: node.hostname,
      ok: res.ok === true,
      cleared: res.cleared || [],
      skipped: res.skipped || [],
      error: res.error || ''
    };
  }
}

function vrpcError(code, message) {
  return new Vrpc.Error(new Vrpc.Status(Vrpc.StatusCode[code], message));
}

async function run_() {
  log('Démarrage du service Process Monitor (MSA vRPC)…');
  log(`Project path: ${PROJ_PATH}`);
  try {
    OWN_SYSTEM = winccoa.getSystemName();
  } catch {
    OWN_SYSTEM = '';
  }
  log(`System: ${OWN_SYSTEM || '(standalone)'} · host: ${HOSTNAME}`);
  try {
    await ensureNodeDp();
    startAgent();
  } catch (e) {
    log(`Agent init failed (continuing as aggregator only): ${e.message}`);
  }
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
