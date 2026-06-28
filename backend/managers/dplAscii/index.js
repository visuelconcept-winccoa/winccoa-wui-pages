// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * DPL ASCII — WinCC OA JavaScript Manager hosting an MSA (Manager Service API)
 * vRPC service that exports/imports datapoints and datapoint types as WinCC OA
 * ASCII (.dpl) files by driving the project's ASCII manager (WCCOAasciiSQLite).
 *
 * Architecture (mirrors the AiAssistant feature):
 *   WebUI (browser) ──HTTP /api/para/dpl/*──▶ dashboard webserver (vRPC stub)
 *                                                 │  MSA vRPC
 *                                                 ▼
 *                                       this manager: service "DplAscii"
 *                                                 │  child_process.execFile
 *                                                 ▼
 *                                       WCCOAasciiSQLite -currentproj -in|-out …
 *
 * The browser cannot speak vRPC and the dashboard webserver should not shell out
 * to OA binaries itself, so this dedicated manager runs the ASCII manager in the
 * project context (it inherits WINCCOA_PROJ / PATH from pmon). The `-currentproj`
 * switch and the WCCOAasciiSQLite binary mirror the proven import command used by
 * the reference projectdownload.ctl manager.
 *
 * Register in config/progs, e.g.:
 *   node | always | 30 | 2 | 2 |dplAscii/index.js
 *
 * The service exposes two unary methods (each takes/returns a JSON string Variant):
 *   Export({ dps:[], dpts:[] }) -> { ok, fileName, contentBase64, count, warnings }
 *   Import({ fileName, contentBase64 }) -> { ok, message, fileName, bytes }
 *
 * After editing this file, restart the dplAscii manager.
 */
const { Vrpc } = require('winccoa-manager');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVICE_NAME = 'DplAscii';
/** ASCII manager binary (SQLite variant — matches the reference import command). */
const ASCII_MANAGER = 'WCCOAasciiSQLite';
/** Max time (ms) to wait for one ASCII-manager run. */
const RUN_TIMEOUT_MS = 120000;
/** Cap on captured stdout/stderr. */
const RUN_MAX_BUFFER = 8 * 1024 * 1024;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[DplAscii] ${msg}`);
}

function vrpcError(code, message) {
  return new Vrpc.Error(new Vrpc.Status(Vrpc.StatusCode[code], message));
}

/**
 * Normalize a DP name for `-filterDp`: trim whitespace and a trailing dot. The
 * system prefix is KEPT (so DPs on a remote system still match); WCCOAasciiSQLite
 * accepts the name with or without the `System:` prefix.
 */
function filterDpName(name) {
  return String(name).trim().replace(/\.$/, '');
}

/** Keep only a safe base file name (no path traversal), ensuring a .dpl suffix. */
function safeDplName(name) {
  let base = path.basename(String(name || 'import.dpl')).replace(/[^A-Za-z0-9._-]/g, '_');
  if (!base.toLowerCase().endsWith('.dpl')) base += '.dpl';
  return base;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15); // YYYYMMDD_HHMMSS-ish
}

/** Run the ASCII manager once; resolve { code, stdout, stderr }. */
function runAscii(args) {
  return new Promise((resolve) => {
    execFile(
      ASCII_MANAGER,
      args,
      { timeout: RUN_TIMEOUT_MS, maxBuffer: RUN_MAX_BUFFER, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || ''), failed: Boolean(error) });
      }
    );
  });
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ---- export -----------------------------------------------------------------

async function exportDpl(req) {
  const dps = Array.isArray(req.dps) ? req.dps : [];
  const dpts = Array.isArray(req.dpts) ? req.dpts : [];
  if (dps.length === 0 && dpts.length === 0) {
    return { ok: false, error: 'Sélection vide : aucun DP ni DPT à exporter.' };
  }

  // Optional record-kind filter (a subset of WCCOAasciiSQLite's TDACOPH letters):
  //   T types · D datapoints · A aliases&comments · C cns · O original values ·
  //   P parametrization/configs (incl. _common) · H config timestamps (modifies P).
  // Empty -> the ASCII manager's default (full export).
  const filter = typeof req.filter === 'string' ? req.filter.replace(/[^TDACOPH]/gi, '').toUpperCase() : '';

  const dir = tmpDir('dpl-export-');
  const outFile = path.join(dir, `export_${timestamp()}.dpl`);
  try {
    // Selection is expressed with WCCOAasciiSQLite's own object filters
    // (verified against 3.21 `-help` + live run):
    //   -filter <TDACOPH>  : which record KINDS to emit (omitted -> all).
    //   -filterDpType <T>  : the type DEFINITION + ALL its datapoints (works
    //                        even for a type with no instance) — "def + instances".
    //   -filterDp <dp>     : restricts the datapoint output to that DP. The full
    //                        type list is still emitted (standard ASCII dump), so
    //                        the .dpl stays self-contained/importable.
    // The object filters repeat and combine (union).
    const args = ['-currentproj', '-out', outFile];
    if (filter) {
      args.push('-filter', filter);
    }
    for (const dpt of dpts) {
      args.push('-filterDpType', String(dpt).trim());
    }
    for (const dp of dps) {
      args.push('-filterDp', filterDpName(dp));
    }
    const run = await runAscii(args);
    if (run.failed || !fs.existsSync(outFile)) {
      log(`Export échec (code ${run.code}): ${run.stderr || run.stdout}`);
      return { ok: false, error: `WCCOAasciiSQLite a échoué (code ${run.code}). ${run.stderr || run.stdout}`.trim() };
    }
    const content = fs.readFileSync(outFile);
    return {
      ok: true,
      fileName: path.basename(outFile),
      contentBase64: content.toString('base64'),
      count: dps.length + dpts.length
    };
  } finally {
    cleanup(dir);
  }
}

// ---- import -----------------------------------------------------------------

async function importDpl(req) {
  const contentBase64 = String(req.contentBase64 || '');
  if (contentBase64 === '') {
    return { ok: false, error: 'Fichier DPL vide' };
  }
  const fileName = safeDplName(req.fileName);
  const dir = tmpDir('dpl-import-');
  const filePath = path.join(dir, fileName);
  try {
    const buf = Buffer.from(contentBase64, 'base64');
    fs.writeFileSync(filePath, buf);
    const run = await runAscii(['-currentproj', '-in', filePath]);
    if (run.failed) {
      log(`Import échec (code ${run.code}): ${run.stderr || run.stdout}`);
      return { ok: false, error: `WCCOAasciiSQLite a échoué (code ${run.code}). ${run.stderr || run.stdout}`.trim() };
    }
    return { ok: true, message: `Import de '${fileName}' exécuté.`, fileName, bytes: buf.length };
  } finally {
    cleanup(dir);
  }
}

// ---- MSA vRPC service -------------------------------------------------------

class DplAsciiService extends Vrpc.ServiceBase {
  constructor() {
    super(SERVICE_NAME);
    this.registerFunction('Export', (ctx, request) => this.handle(ctx, request, exportDpl));
    this.registerFunction('Import', (ctx, request) => this.handle(ctx, request, importDpl));
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

async function run() {
  log('Démarrage du service DPL ASCII (MSA vRPC)…');
  const container = new Vrpc.ServiceContainer();
  container.registerService(new DplAsciiService(), new Vrpc.ServiceOptions());
  try {
    await container.startAllServices();
    log(`Service "${SERVICE_NAME}" démarré.`);
  } catch (e) {
    log(`Échec du démarrage du service : ${e}`);
  }
}

run().catch((e) => log(`Erreur fatale : ${e}`));
