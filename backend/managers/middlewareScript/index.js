// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Middleware Script — WinCC OA JavaScript Manager executing the sandboxed
 * datapoint-logic tasks authored on the /middleware-script WebUI page.
 *
 * Tasks persist as `MiddlewareScript_Task_<id>` DPs (type ensured here with
 * THREE String elements): `.json` = config written by the PAGE, `.status` =
 * execution state written ONLY by THIS manager (two writers, two elements — no
 * contention). Every RELOAD_MS the task list is re-read and diffed, so a saved
 * task is picked up without restarting the manager (hot reload).
 *
 * Reusable models: `MiddlewareScript_Model_<id>` DPs carry a script + declared
 * alias contract + parameter defaults. A task with `modelId` INSTANTIATES a
 * model: its script/params are resolved at reload time (the diff key includes
 * the resolution, so saving a model hot-reloads every instance). Scripts see
 * the resolved constants as `params.<name>`.
 *
 * Per enabled task:
 *   - trigger `dpe`    → dpConnect on the DECLARED input DPEs (+ debounce);
 *   - trigger `cyclic` → setInterval(intervalS).
 * A run reads the declared inputs (dpGet), executes the script in a
 * worker-thread sandbox (see sandbox-worker.js), then dpSets ONLY the outputs
 * the script wrote via `output(alias, value)` — an alias must be declared, the
 * script has no arbitrary dpSet. Overlapping triggers are coalesced (a run in
 * progress marks the task; a trigger during the run schedules one re-run).
 *
 * Honest containment note: `node:vm` + worker_threads is a robust guard against
 * accidents (loops, typos, global pollution) and removes all ambient authority
 * (no require/process/network/DP API in the context), but it is NOT a hardened
 * boundary against a determined attacker — WHO may edit scripts is the real
 * control (Application-Security role `middleware-script.edit`).
 *
 * The manager also hosts the MSA vRPC service "MiddlewareScript" used by the
 * webserver bridge (/api/middleware-script/test):
 *   Test({ task, inputValues? }) → { ok, outputs, logs, durationMs, error? }
 * A dry-run executes in the SAME sandbox but never writes any output DP;
 * missing inputValues are read live.
 *
 * Register in config/progs:  node | always | 30 | 2 | 2 |middlewareScript/index.js
 * After editing this file, restart the middlewareScript manager.
 */
const { WinccoaManager, WinccoaDpTypeNode, Vrpc } = require('winccoa-manager');
const path = require('path');
const { Worker } = require('worker_threads');

const winccoa = new WinccoaManager();

const SERVICE_NAME = 'MiddlewareScript';
const TASK_TYPE = 'MiddlewareScript_Task';
const TASK_PATTERN = 'MiddlewareScript_Task_*';
const MODEL_TYPE = 'MiddlewareScript_Model';
const MODEL_PATTERN = 'MiddlewareScript_Model_*';
const MODEL_PREFIX = 'MiddlewareScript_Model_';
const ELEM = { Struct: 1, String: 25 };

const RELOAD_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_DEBOUNCE_MS = 200;
const MIN_INTERVAL_MS = 1000;
/** Last-run `log(…)` lines persisted into `.status` (Journal tab). */
const MAX_STATUS_LOGS = 30;
const MAX_STATUS_LOG_CHARS = 300;
/** Extra delay before the parent hard-terminates a worker past the vm timeout. */
const KILL_GRACE_MS = 250;

const WORKER_FILE = path.join(__dirname, 'sandbox-worker.js');

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[MiddlewareScript] ${msg}`);
}

function vrpcError(code, message) {
  return new Vrpc.Error(new Vrpc.Status(Vrpc.StatusCode[code], message));
}

function extractString(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

// ---- data model ---------------------------------------------------------------

/** Ensure the task type exists WITH the `.status` element (the page's kit store
 *  may have created a 2-element name/json variant first — change it in place). */
async function ensureType() {
  const root = new WinccoaDpTypeNode(TASK_TYPE, ELEM.Struct, '', [
    new WinccoaDpTypeNode('name', ELEM.String),
    new WinccoaDpTypeNode('json', ELEM.String),
    new WinccoaDpTypeNode('status', ELEM.String)
  ]);
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${TASK_TYPE}`);
  } catch {
    try {
      await winccoa.dpTypeChange(root);
    } catch {
      // Type already conform (or busy) — the .status probe below will tell.
    }
  }
}

/** Ensure the model type exists (2 Strings — the page's kit store creates the
 *  same shape; whoever runs first wins, both tolerate "already exists"). */
async function ensureModelType() {
  const root = new WinccoaDpTypeNode(MODEL_TYPE, ELEM.Struct, '', [
    new WinccoaDpTypeNode('name', ELEM.String),
    new WinccoaDpTypeNode('json', ELEM.String)
  ]);
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${MODEL_TYPE}`);
  } catch {
    // already exists
  }
}

/** Parse one model DP; null when the JSON is absent/invalid. */
async function readModel(dp) {
  try {
    const json = extractString(await winccoa.dpGet(`${dp}.json`));
    if (!json.startsWith('{')) return null;
    const model = JSON.parse(json);
    if (!model || typeof model !== 'object' || typeof model.script !== 'string') return null;
    model.params = Array.isArray(model.params) ? model.params : [];
    return model;
  } catch (e) {
    log(`Modèle illisible (${dp}) : ${e}`);
    return null;
  }
}

/** Read every model, keyed by id (task.modelId matches the DP suffix). */
async function readModels() {
  const models = new Map();
  let dps = [];
  try {
    dps = winccoa.dpNames(MODEL_PATTERN, MODEL_TYPE) || [];
  } catch {
    return models; // type not created yet — no model exists
  }
  for (const dp of dps) {
    const model = await readModel(dp);
    if (model == null) continue;
    const bare = dp.includes(':') ? dp.slice(dp.indexOf(':') + 1) : dp;
    const id = bare.startsWith(MODEL_PREFIX) ? bare.slice(MODEL_PREFIX.length) : bare;
    models.set(id, model);
  }
  return models;
}

/**
 * Effective script/params of a task: its own, or its model's script with the
 * declared parameter defaults overlaid by the instance values. `script` is
 * null when the referenced model is missing.
 */
function resolveTask(task, models) {
  const params = {};
  if (task.modelId == null || task.modelId === '') {
    Object.assign(params, task.params && typeof task.params === 'object' ? task.params : {});
    return { script: String(task.script || ''), params };
  }
  const model = models.get(String(task.modelId));
  if (model == null) {
    return { script: null, params, error: `Modèle introuvable : ${task.modelId}` };
  }
  for (const decl of model.params) {
    if (decl && typeof decl.name === 'string') params[decl.name] = decl.defaultValue;
  }
  Object.assign(params, task.params && typeof task.params === 'object' ? task.params : {});
  return { script: model.script, params };
}

/** Parse one task DP; null when the config JSON is absent/invalid. */
async function readTask(dp) {
  try {
    const json = extractString(await winccoa.dpGet(`${dp}.json`));
    if (!json.startsWith('{')) return null;
    const task = JSON.parse(json);
    if (!task || typeof task !== 'object') return null;
    task.dp = dp;
    task.inputs = Array.isArray(task.inputs) ? task.inputs.filter((b) => b && b.alias && b.dpe) : [];
    task.outputs = Array.isArray(task.outputs) ? task.outputs.filter((b) => b && b.alias && b.dpe) : [];
    task.timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(50, Number(task.timeoutMs) || DEFAULT_TIMEOUT_MS));
    return task;
  } catch (e) {
    log(`Tâche illisible (${dp}) : ${e}`);
    return null;
  }
}

async function writeStatus(dp, status) {
  try {
    await winccoa.dpSetWait(`${dp}.status`, JSON.stringify(status));
  } catch (e) {
    log(`Écriture du statut impossible (${dp}) : ${e}`);
  }
}

// ---- sandbox ---------------------------------------------------------------------

/**
 * Run one script in the worker sandbox. Resolves
 * `{ ok, outputs, logs, durationMs, error? }` — never rejects. The worker is
 * terminated in every path; a run-away script dies with it.
 */
function runSandbox({ script, inputs, params, outputAliases, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let worker;
    try {
      worker = new Worker(WORKER_FILE, { workerData: { script, inputs, params, outputAliases, timeoutMs } });
    } catch (e) {
      resolve({ ok: false, error: `Sandbox indisponible : ${e}`, outputs: {}, logs: [], durationMs: 0 });
      return;
    }
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      resolve({ outputs: {}, logs: [], ...result, durationMs: Date.now() - started });
      worker.terminate().catch(() => {});
    };
    const killer = setTimeout(
      () => settle({ ok: false, error: `Timeout du script (${timeoutMs} ms)` }),
      timeoutMs + KILL_GRACE_MS
    );
    worker.once('message', (msg) => settle(msg));
    worker.once('error', (e) => settle({ ok: false, error: String(e) }));
    worker.once('exit', (code) => {
      if (code !== 0) settle({ ok: false, error: `Sandbox terminée (code ${code})` });
    });
  });
}

/** Read the declared inputs as an alias→value object (one dpGet). */
async function readInputs(task) {
  if (task.inputs.length === 0) return {};
  const values = await winccoa.dpGet(task.inputs.map((b) => b.dpe));
  const list = Array.isArray(values) && task.inputs.length > 1 ? values : [values].flat();
  const out = {};
  for (const [index, binding] of task.inputs.entries()) {
    out[binding.alias] = list[index];
  }
  return out;
}

// ---- task runtime ----------------------------------------------------------------

/**
 * Runtime entry per task DP:
 * { gen, config, script, params, json, timer, connId, debounce, running, rerun, runCount }
 * `script`/`params` are RESOLVED (model instantiation applied at reload time).
 */
const running = new Map();

async function runTask(entry) {
  const task = entry.config;
  if (entry.running) {
    entry.rerun = true; // coalesce: one re-run after the current one
    return;
  }
  entry.running = true;
  await writeStatus(task.dp, { state: 'running', lastRunAt: new Date().toISOString(), runCount: entry.runCount });
  let result;
  try {
    const inputs = await readInputs(task);
    result = await runSandbox({
      script: entry.script,
      inputs,
      params: entry.params,
      outputAliases: task.outputs.map((b) => b.alias),
      timeoutMs: task.timeoutMs
    });
    if (result.ok) {
      const dpes = [];
      const values = [];
      for (const binding of task.outputs) {
        if (Object.hasOwn(result.outputs, binding.alias)) {
          dpes.push(binding.dpe);
          values.push(result.outputs[binding.alias]);
        }
      }
      if (dpes.length > 0) {
        await winccoa.dpSet(dpes, values);
      }
    }
  } catch (e) {
    result = { ok: false, error: String(e), durationMs: 0 };
  }
  entry.runCount += 1;
  entry.running = false;
  await writeStatus(task.dp, {
    state: result.ok ? 'idle' : 'error',
    lastRunAt: new Date().toISOString(),
    lastDurationMs: result.durationMs,
    lastError: result.ok ? undefined : result.error,
    runCount: entry.runCount,
    // Persist the run's log(…) lines (capped) so the page's Journal tab can
    // show them live — also on error: the lines before the throw are the clue.
    lastLogs: Array.isArray(result.logs)
      ? result.logs.slice(-MAX_STATUS_LOGS).map((line) => String(line).slice(0, MAX_STATUS_LOG_CHARS))
      : []
  });
  if (entry.rerun && running.get(task.dp) === entry) {
    entry.rerun = false;
    void runTask(entry);
  }
}

/** Wire the trigger of one (enabled) task entry. */
function wire(entry) {
  const task = entry.config;
  if (task.trigger && task.trigger.kind === 'cyclic') {
    const period = Math.max(MIN_INTERVAL_MS, (Number(task.trigger.intervalS) || 60) * 1000);
    entry.timer = setInterval(() => void runTask(entry), period);
    return;
  }
  // dpe trigger: any declared-input change (answer=false → no initial burst),
  // debounced so a burst of changes runs once.
  const dpes = task.inputs.map((b) => b.dpe);
  if (dpes.length === 0) {
    void writeStatus(task.dp, { state: 'error', lastError: 'Déclencheur DP sans entrée déclarée', runCount: entry.runCount });
    return;
  }
  const debounceMs = Math.max(0, Number(task.trigger && task.trigger.debounceMs) || DEFAULT_DEBOUNCE_MS);
  const myGen = entry.gen;
  try {
    entry.connId = winccoa.dpConnect(
      () => {
        // Stale-generation guard: a rewired/deleted task ignores late callbacks.
        if (running.get(task.dp) !== entry || entry.gen !== myGen) return;
        clearTimeout(entry.debounce);
        entry.debounce = setTimeout(() => void runTask(entry), debounceMs);
      },
      dpes,
      false
    );
  } catch (e) {
    void writeStatus(task.dp, { state: 'error', lastError: `dpConnect impossible : ${e}`, runCount: entry.runCount });
  }
}

/** Tear a task entry down (timers + best-effort dpDisconnect). */
function unwire(entry) {
  entry.gen += 1;
  clearInterval(entry.timer);
  clearTimeout(entry.debounce);
  if (entry.connId != null && typeof winccoa.dpDisconnect === 'function') {
    try {
      winccoa.dpDisconnect(entry.connId);
    } catch {
      // stale-generation guard keeps a leaked connection harmless
    }
  }
  entry.connId = null;
}

/** Reload models + tasks, diff against the running map, (re)wire what changed.
 *  The diff key includes the RESOLVED script/params, so editing a model
 *  hot-reloads every task that instantiates it. */
async function reload() {
  let dps = [];
  try {
    dps = winccoa.dpNames(TASK_PATTERN, TASK_TYPE) || [];
  } catch (e) {
    log(`dpNames a échoué : ${e}`);
    return;
  }
  const models = await readModels();
  const seen = new Set();
  for (const dp of dps) {
    seen.add(dp);
    const task = await readTask(dp);
    if (task == null) continue;
    const resolved = resolveTask(task, models);
    const json = JSON.stringify({ task, script: resolved.script, params: resolved.params });
    const existing = running.get(dp);
    if (existing && existing.json === json) continue; // unchanged (task AND model)
    if (existing) unwire(existing);
    const entry = { gen: (existing ? existing.gen : 0) + 1, config: task, script: resolved.script, params: resolved.params, json, timer: null, connId: null, debounce: null, running: false, rerun: false, runCount: existing ? existing.runCount : 0 };
    running.set(dp, entry);
    if (resolved.error) {
      log(`Tâche ${dp} : ${resolved.error}`);
      await writeStatus(dp, { state: 'error', lastError: resolved.error, runCount: entry.runCount });
    } else if (task.enabled) {
      log(`Tâche (re)câblée : ${dp} (${task.trigger && task.trigger.kind === 'cyclic' ? 'cyclique' : 'sur changement de DP'}${task.modelId ? `, modèle ${task.modelId}` : ''})`);
      wire(entry);
      await writeStatus(dp, { state: 'idle', runCount: entry.runCount });
    } else {
      await writeStatus(dp, { state: 'disabled', runCount: entry.runCount });
    }
  }
  // Deleted tasks: tear down and forget.
  for (const [dp, entry] of running) {
    if (!seen.has(dp)) {
      unwire(entry);
      running.delete(dp);
      log(`Tâche retirée : ${dp}`);
    }
  }
}

// ---- MSA vRPC service (dry-run tests) ---------------------------------------------

/** Test({ task, inputValues? }) — sandbox run WITHOUT writing any output DP.
 *  A model-based task (`modelId` set, empty script) is resolved against the
 *  live model DP, exactly like the runtime path. */
async function testTask(req) {
  const task = req && typeof req.task === 'object' && req.task != null ? req.task : null;
  if (task == null || typeof task.script !== 'string') {
    return { ok: false, error: 'Requête invalide : tâche/script manquant' };
  }
  let script = task.script;
  let params = task.params && typeof task.params === 'object' ? { ...task.params } : {};
  if (task.modelId != null && task.modelId !== '' && script.trim() === '') {
    const model = await readModel(`${MODEL_PREFIX}${task.modelId}`);
    if (model == null) {
      return { ok: false, error: `Modèle introuvable : ${task.modelId}` };
    }
    script = model.script;
    const defaults = {};
    for (const decl of model.params) {
      if (decl && typeof decl.name === 'string') defaults[decl.name] = decl.defaultValue;
    }
    params = { ...defaults, ...params };
  }
  const inputsDecl = Array.isArray(task.inputs) ? task.inputs.filter((b) => b && b.alias && b.dpe) : [];
  const outputsDecl = Array.isArray(task.outputs) ? task.outputs.filter((b) => b && b.alias) : [];
  const provided = req.inputValues && typeof req.inputValues === 'object' ? req.inputValues : {};
  const inputs = {};
  for (const binding of inputsDecl) {
    if (Object.hasOwn(provided, binding.alias)) {
      inputs[binding.alias] = provided[binding.alias];
    } else {
      try {
        const raw = await winccoa.dpGet(binding.dpe);
        inputs[binding.alias] = Array.isArray(raw) ? raw[0] : raw;
      } catch {
        inputs[binding.alias] = null;
      }
    }
  }
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(50, Number(task.timeoutMs) || DEFAULT_TIMEOUT_MS));
  return runSandbox({
    script,
    inputs,
    params,
    outputAliases: outputsDecl.map((b) => b.alias),
    timeoutMs
  });
}

class MiddlewareScriptService extends Vrpc.ServiceBase {
  constructor() {
    super(SERVICE_NAME);
    this.registerFunction('Test', (ctx, request) => this.handle(ctx, request, testTask));
  }

  async handle(serverContext, request, fn) {
    serverContext.cancelSignal.throwIfAborted();
    if (!request.isString() || request.isNull()) {
      throw vrpcError('InvalidArgument', 'La requête doit être une chaîne JSON');
    }
    let req;
    try {
      req = JSON.parse(request.getString());
    } catch {
      throw vrpcError('InvalidArgument', 'JSON de requête invalide');
    }
    const result = await fn(req);
    return Vrpc.Variant.createString(JSON.stringify(result));
  }
}

// ---- main -------------------------------------------------------------------------

async function run() {
  log('Démarrage du manager Middleware Script…');
  await ensureType();
  await ensureModelType();
  await reload();
  setInterval(() => void reload(), RELOAD_MS);

  const container = new Vrpc.ServiceContainer();
  container.registerService(new MiddlewareScriptService(), new Vrpc.ServiceOptions());
  try {
    await container.startAllServices();
    log(`Service "${SERVICE_NAME}" démarré (tests sandbox).`);
  } catch (e) {
    log(`Échec du démarrage du service vRPC (les tests UI seront indisponibles) : ${e}`);
  }
}

run().catch((e) => log(`Erreur fatale : ${e}`));
