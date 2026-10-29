// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Deploy ZIP transfer between processMonitor managers over MSA vRPC (issue 32).
 *
 * The aggregator (the manager next to the webserver) streams the uploaded ZIP to the
 * `ProcessMonitor_<hostname>` service of each OTHER node in chunks, and that node's agent
 * reassembles it in `<project>/temp`, checks it and deploys it — no datapoint in between.
 *
 *   ReceiveBegin  {fileName, size, sha256}                      -> {ok, transferId}
 *   ReceiveChunk  {transferId, offset, data(base64), chunkSha256} -> {ok, received}
 *   ReceiveCommit {transferId, sha256, clearFolders, restart}   -> {ok, deployId}
 *   DeployStatus  {deployId}                                     -> {ok, state: running|done|failed, cleared, skipped, error}
 *   ReceiveAbort  {transferId}                                   -> {ok}
 *
 * - `data` is a base64 string of ONE chunk (the vRPC Variant is used as a JSON string, like
 *   every other method of the service), never the whole file. The sender streams the ZIP
 *   with `fs.createReadStream`, so it is never held in memory as a whole either.
 * - `offset` makes a retried chunk idempotent: the bytes are written at that position, and a
 *   chunk the agent already has is simply written again. A chunk past the received end (a
 *   gap) or past the announced size is refused, as is a chunk whose `chunkSha256` does not
 *   match its data.
 * - The commit checks the size and the SHA-256 of the whole file before deploying; the
 *   deploy then runs asynchronously and `DeployStatus` reports it. The sender polls it with
 *   no fixed cap: an agent that answers is alive.
 *
 * Pure Node (no winccoa-manager): `index.js` wires it to the vRPC service and to the stubs
 * of the other nodes; the unit tests drive it with a fake stub.
 */
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

/** Raw bytes per chunk: 768 KiB, i.e. a 1 MiB base64 string on the wire. */
const DEFAULT_CHUNK_BYTES = 768 * 1024;
/** Prefix of the temp files of a transfer (`<prefix><transferId>.zip`). */
const TRANSFER_PREFIX = 'pm-deploy-';
/** A transfer left idle this long is aborted (sender gone). */
const STALE_TRANSFER_MS = 30 * 60 * 1000;
/** Finished deploy statuses are kept this long for `DeployStatus`. */
const STATUS_TTL_MS = 60 * 60 * 1000;

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isSha256 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);

/** SHA-256 of a file, streamed. */
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Agent side: receives transfers into `dir` and runs `deploy({zipPath, clearFolders, restart})`
 * (the manager's `doLocalDeploy`) once a transfer is committed and checked.
 */
class TransferReceiver {
  constructor({ dir, deploy, now = () => Date.now(), log = () => undefined }) {
    this.dir = dir;
    this.deployFn = deploy;
    this.now = now;
    this.log = log;
    /** transferId -> { file, size, sha256, received, touched } */
    this.transfers = new Map();
    /** deployId -> { state, cleared, skipped, error, ended } */
    this.deploys = new Map();
  }

  fileOf(transferId) {
    return path.join(this.dir, `${TRANSFER_PREFIX}${transferId}.zip`);
  }

  /** Delete the temp files a previous run left behind (startup), and abort idle transfers. */
  async cleanupStale({ all = false } = {}) {
    const now = this.now();
    for (const [id, t] of this.transfers) {
      if (all || now - t.touched > STALE_TRANSFER_MS) await this.abort({ transferId: id });
    }
    for (const [id, d] of this.deploys) {
      if (d.ended && now - d.ended > STATUS_TTL_MS) this.deploys.delete(id);
    }
    if (!all) return;
    let names = [];
    try {
      names = await fsp.readdir(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(TRANSFER_PREFIX) && name.endsWith('.zip')) {
        await fsp.rm(path.join(this.dir, name), { force: true }).catch(() => undefined);
      }
    }
  }

  async begin({ fileName, size, sha256 } = {}) {
    if (!Number.isInteger(size) || size < 0) return { ok: false, error: 'size (bytes) required' };
    if (!isSha256(sha256)) return { ok: false, error: 'sha256 (hex) required' };
    await fsp.mkdir(this.dir, { recursive: true });
    const transferId = crypto.randomUUID();
    const file = this.fileOf(transferId);
    await fsp.writeFile(file, Buffer.alloc(0));
    this.transfers.set(transferId, { file, fileName: String(fileName || ''), size, sha256: sha256.toLowerCase(), received: 0, touched: this.now() });
    return { ok: true, transferId };
  }

  async chunk({ transferId, offset, data, chunkSha256 } = {}) {
    const t = this.transfers.get(transferId);
    if (!t) return { ok: false, error: `unknown transfer: ${transferId}` };
    t.touched = this.now();
    if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: 'offset required', received: t.received };
    if (typeof data !== 'string') return { ok: false, error: 'data (base64) required', received: t.received };
    const buf = Buffer.from(data, 'base64');
    if (chunkSha256 !== undefined && sha256Hex(buf) !== String(chunkSha256).toLowerCase()) {
      return { ok: false, error: `corrupt chunk at offset ${offset} (hash mismatch)`, received: t.received };
    }
    if (offset > t.received) return { ok: false, error: `gap: chunk at ${offset}, received ${t.received}`, received: t.received };
    if (offset + buf.length > t.size) return { ok: false, error: `chunk past the announced size (${t.size} bytes)`, received: t.received };
    const handle = await fsp.open(t.file, 'r+');
    try {
      await handle.write(buf, 0, buf.length, offset);
    } finally {
      await handle.close();
    }
    t.received = Math.max(t.received, offset + buf.length);
    return { ok: true, received: t.received };
  }

  async commit({ transferId, sha256, clearFolders, restart } = {}) {
    const t = this.transfers.get(transferId);
    if (!t) return { ok: false, error: `unknown transfer: ${transferId}` };
    this.transfers.delete(transferId);
    const fail = async (error) => {
      await fsp.rm(t.file, { force: true }).catch(() => undefined);
      return { ok: false, error };
    };
    if (sha256 !== undefined && String(sha256).toLowerCase() !== t.sha256) return fail('sha256 differs from the one announced at ReceiveBegin');
    const size = (await fsp.stat(t.file)).size;
    if (size !== t.size || t.received !== t.size) return fail(`incomplete file: ${size} of ${t.size} bytes`);
    const actual = await hashFile(t.file);
    if (actual !== t.sha256) return fail(`corrupt file: sha256 ${actual} instead of ${t.sha256}`);

    const deployId = transferId;
    const status = { state: 'running', cleared: [], skipped: [], error: '', ended: 0 };
    this.deploys.set(deployId, status);
    // Asynchronous: the commit answers at once, DeployStatus reports the outcome.
    void (async () => {
      try {
        const r = await this.deployFn({ zipPath: t.file, clearFolders: Array.isArray(clearFolders) ? clearFolders : [], restart: restart === true });
        Object.assign(status, { state: r?.ok ? 'done' : 'failed', cleared: r?.cleared || [], skipped: r?.skipped || [], error: r?.error || '' });
      } catch (e) {
        Object.assign(status, { state: 'failed', error: e?.message || String(e) });
      } finally {
        status.ended = this.now();
        await fsp.rm(t.file, { force: true }).catch(() => undefined);
      }
    })();
    return { ok: true, deployId };
  }

  status({ deployId } = {}) {
    const d = this.deploys.get(deployId);
    if (!d) return { ok: false, state: 'unknown', error: `unknown deploy: ${deployId}` };
    return { ok: true, state: d.state, cleared: d.cleared, skipped: d.skipped, error: d.error };
  }

  async abort({ transferId } = {}) {
    const t = this.transfers.get(transferId);
    this.transfers.delete(transferId);
    if (t) await fsp.rm(t.file, { force: true }).catch(() => undefined);
    return { ok: true };
  }
}

/** The message of a node whose agent cannot take a vRPC transfer (old version, or unreachable). */
function tooOldMessage(host, detail) {
  const base = `agent too old or not reachable over vRPC — update/restart the processMonitor manager on ${host || 'the node'}`;
  return detail ? `${base} (${detail})` : base;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sender side: stream `zipPath` to one node through `call(method, request) -> Promise<reply>`
 * (a vRPC call on that node's service; it throws when the call itself fails) and wait for
 * its deploy. Resolves with `{ ok, cleared, skipped, error }`, never throws.
 */
async function sendZip(call, { zipPath, clearFolders = [], restart = false, host = '', chunkBytes = DEFAULT_CHUNK_BYTES, pollMs = 1000, chunkRetries = 3, maxPollFailures = 10 }) {
  const size = (await fsp.stat(zipPath)).size;
  const sha256 = await hashFile(zipPath);

  let begin;
  try {
    begin = await call('ReceiveBegin', { fileName: path.basename(zipPath), size, sha256 });
  } catch (e) {
    // Unimplemented / not found (an agent from before this transfer) or no service at all.
    return { ok: false, cleared: [], skipped: [], error: tooOldMessage(host, e?.message || String(e)) };
  }
  if (!begin?.ok || !begin.transferId) return { ok: false, cleared: [], skipped: [], error: `ReceiveBegin refused: ${begin?.error || 'no transferId'}` };
  const { transferId } = begin;
  const abort = (error) =>
    call('ReceiveAbort', { transferId })
      .catch(() => undefined)
      .then(() => ({ ok: false, cleared: [], skipped: [], error }));

  let offset = 0;
  try {
    for await (const piece of fs.createReadStream(zipPath, { highWaterMark: chunkBytes })) {
      const request = { transferId, offset, data: piece.toString('base64'), chunkSha256: sha256Hex(piece) };
      let reply = null;
      let lastError = '';
      // Same offset on a retry: the agent rewrites the same bytes (idempotent).
      for (let attempt = 0; attempt < chunkRetries && !reply?.ok; attempt++) {
        try {
          reply = await call('ReceiveChunk', request);
          if (!reply?.ok) lastError = reply?.error || 'refused';
        } catch (e) {
          lastError = e?.message || String(e);
        }
      }
      if (!reply?.ok) return abort(`chunk at offset ${offset} not accepted: ${lastError}`);
      offset += piece.length;
    }
  } catch (e) {
    return abort(`reading the ZIP failed: ${e?.message || e}`);
  }

  let commit;
  try {
    commit = await call('ReceiveCommit', { transferId, sha256, clearFolders, restart });
  } catch (e) {
    return abort(`ReceiveCommit failed: ${e?.message || e}`);
  }
  if (!commit?.ok || !commit.deployId) return { ok: false, cleared: [], skipped: [], error: commit?.error || 'ReceiveCommit refused' };

  // No fixed cap: the agent answering means it is alive and still deploying.
  let failures = 0;
  for (;;) {
    await delay(pollMs);
    let st;
    try {
      st = await call('DeployStatus', { deployId: commit.deployId });
      failures = 0;
    } catch (e) {
      failures += 1;
      if (failures < maxPollFailures) continue;
      const why = restart ? ' (with restart, the project may already be restarting)' : '';
      return { ok: false, cleared: [], skipped: [], error: `agent stopped answering during the deploy${why}: ${e?.message || e} — check ${host || 'the node'}` };
    }
    if (st?.state === 'done' || st?.state === 'failed') {
      return { ok: st.state === 'done', cleared: st.cleared || [], skipped: st.skipped || [], error: st.error || '' };
    }
    if (st?.state !== 'running') return { ok: false, cleared: [], skipped: [], error: st?.error || `unexpected deploy state: ${st?.state}` };
  }
}

/**
 * Deploy on every target, the LOCAL node last: its `restart` recycles this manager and the
 * webserver, which would abort the remaining deploys and the reply.
 */
async function deployToNodes(nodes, { isLocal, localDeploy, remoteDeploy }) {
  const ordered = [...nodes].sort((a, b) => Number(isLocal(a)) - Number(isLocal(b)));
  const results = [];
  for (const node of ordered) results.push(isLocal(node) ? await localDeploy(node) : await remoteDeploy(node));
  return results;
}

module.exports = { DEFAULT_CHUNK_BYTES, TRANSFER_PREFIX, TransferReceiver, deployToNodes, hashFile, sendZip, tooOldMessage };
