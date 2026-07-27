// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Middleware-Script sandbox worker — executes ONE user script run, isolated in
 * a worker thread, and posts `{ ok, outputs, logs, error? }` back to the parent
 * (backend/managers/middlewareScript/index.js).
 *
 * Containment model (see the manager header for the honest limits):
 *  - the script runs in a `node:vm` context created from a NULL prototype with
 *    an explicit allowlist of globals (Math, JSON, Number, … — no require, no
 *    process, no network, no winccoa API);
 *  - `codeGeneration: strings=false` blocks eval/new Function inside the context;
 *  - writes happen ONLY through `output(alias, value)` on the DECLARED output
 *    aliases — the parent maps aliases to DPEs, the script never sees a DP name
 *    it did not declare;
 *  - `vm` timeout aborts synchronous run-away code; the parent additionally
 *    `worker.terminate()`s as a hard backstop.
 */
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');

const MAX_LOGS = 200;

const { script, inputs, outputAliases, timeoutMs, params } = workerData;

const outputs = {};
const logs = [];
const allowed = new Set(Array.isArray(outputAliases) ? outputAliases.map(String) : []);

function output(alias, value) {
  const key = String(alias);
  if (!allowed.has(key)) {
    throw new Error(`output('${key}') : alias de sortie non déclaré`);
  }
  outputs[key] = value;
}

function log(...args) {
  if (logs.length >= MAX_LOGS) return;
  logs.push(
    args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ')
  );
}

function run() {
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false }
  });
  // Explicit allowlist — everything else (require, process, globalThis of the
  // host, timers, fetch…) simply does not exist inside the context.
  context.inputs = Object.freeze({ ...(inputs || {}) });
  context.output = output;
  context.log = log;
  context.params = Object.freeze({ ...(params || {}) });
  context.Math = Math;
  context.JSON = JSON;
  context.Number = Number;
  context.String = String;
  context.Boolean = Boolean;
  context.Array = Array;
  context.Object = Object;
  context.Date = Date;
  context.RegExp = RegExp;
  context.Error = Error;
  context.isNaN = isNaN;
  context.isFinite = isFinite;
  context.parseFloat = parseFloat;
  context.parseInt = parseInt;

  vm.runInContext(
    `'use strict';\n(function (inputs, output, log, params) {\n${String(script)}\n})(inputs, output, log, params);`,
    context,
    { timeout: Math.max(50, Number(timeoutMs) || 1000), displayErrors: true }
  );
}

try {
  run();
  parentPort.postMessage({ ok: true, outputs, logs });
} catch (error) {
  parentPort.postMessage({ ok: false, error: String((error && error.message) || error), outputs, logs });
}
