// Deploy ZIP streamed to the other nodes over vRPC (issue 32): the sender and the agent's
// receiver, joined by a fake vRPC stub.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The manager is CommonJS (deployed outside this "type": "module" package): copied to .cjs for the test.
const src = fileURLToPath(new URL('../managers/processMonitor/deploy-transfer.js', import.meta.url));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-transfer-')), 'deploy-transfer.cjs');
fs.copyFileSync(src, tmp);
const require = createRequire(import.meta.url);
const { TransferReceiver, deployToNodes, sendZip } = require(tmp);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let dir;
let zipPath;
let zip;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-transfer-'));
  zip = crypto.randomBytes(100_000);
  zipPath = path.join(dir, 'project.zip');
  fs.writeFileSync(zipPath, zip);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** An agent whose deploy records the ZIP it got, and a fake stub calling its receiver. */
function agent({ deployResult = { ok: true, cleared: ['panels'], skipped: ['config'] } } = {}) {
  const received = [];
  const receiver = new TransferReceiver({
    dir: path.join(dir, 'agent-temp'),
    deploy: async ({ zipPath: file, clearFolders, restart }) => {
      received.push({ bytes: fs.readFileSync(file), clearFolders, restart });
      return deployResult;
    }
  });
  const calls = [];
  const methods = {
    ReceiveBegin: (r) => receiver.begin(r),
    ReceiveChunk: (r) => receiver.chunk(r),
    ReceiveCommit: (r) => receiver.commit(r),
    DeployStatus: (r) => receiver.status(r),
    ReceiveAbort: (r) => receiver.abort(r)
  };
  const call = async (method, request) => {
    calls.push({ method, request });
    if (!methods[method]) throw new Error(`${method}: Unimplemented`);
    return methods[method](request);
  };
  return { receiver, received, calls, call };
}

describe('sendZip → TransferReceiver', () => {
  it('reassembles the chunks, checks the hash and deploys', async () => {
    const a = agent();
    const r = await sendZip(a.call, { zipPath, clearFolders: ['panels'], restart: false, host: 'SRV-02', chunkBytes: 16 * 1024, pollMs: 1 });
    expect(r).toEqual({ ok: true, cleared: ['panels'], skipped: ['config'], error: '' });
    expect(a.received).toHaveLength(1);
    expect(sha(a.received[0].bytes)).toBe(sha(zip));
    expect(a.calls.filter((c) => c.method === 'ReceiveChunk')).toHaveLength(Math.ceil(zip.length / (16 * 1024)));
    // No chunk is bigger than one chunk's base64.
    for (const c of a.calls.filter((x) => x.method === 'ReceiveChunk')) expect(c.request.data.length).toBeLessThanOrEqual(Math.ceil((16 * 1024) / 3) * 4);
    // The temp file is gone once deployed.
    await new Promise((res) => setTimeout(res, 20));
    expect(fs.readdirSync(path.join(dir, 'agent-temp'))).toEqual([]);
  });

  it('reports a failed deploy of the agent', async () => {
    const a = agent({ deployResult: { ok: false, error: '7-Zip extraction failed', cleared: [], skipped: [] } });
    const r = await sendZip(a.call, { zipPath, chunkBytes: 32 * 1024, pollMs: 1 });
    expect(r).toMatchObject({ ok: false, error: '7-Zip extraction failed' });
  });

  it('an agent without the new methods reports "too old"', async () => {
    const call = async (method) => {
      throw new Error(`${method}: Unimplemented`);
    };
    const r = await sendZip(call, { zipPath, host: 'SRV-OLD', pollMs: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^agent too old or not reachable over vRPC — update\/restart the processMonitor manager on SRV-OLD/);
  });

  it('a chunk lost once is retried at the same offset', async () => {
    const a = agent();
    let dropped = false;
    const flaky = async (method, request) => {
      if (method === 'ReceiveChunk' && request.offset > 0 && !dropped) {
        dropped = true;
        await a.call(method, request); // the agent got it, the reply was lost
        throw new Error('ReceiveChunk: Unavailable');
      }
      return a.call(method, request);
    };
    const r = await sendZip(flaky, { zipPath, chunkBytes: 16 * 1024, pollMs: 1 });
    expect(r.ok).toBe(true);
    expect(sha(a.received[0].bytes)).toBe(sha(zip));
  });
});

describe('TransferReceiver', () => {
  const begin = async (receiver, buf = zip) => (await receiver.begin({ fileName: 'p.zip', size: buf.length, sha256: sha(buf) })).transferId;
  const chunk = (receiver, transferId, offset, piece, over = {}) =>
    receiver.chunk({ transferId, offset, data: piece.toString('base64'), chunkSha256: sha(piece), ...over });

  it('accepts a retried chunk at the same offset', async () => {
    const receiver = new TransferReceiver({ dir, deploy: async () => ({ ok: true }) });
    const id = await begin(receiver);
    const first = zip.subarray(0, 50_000);
    expect(await chunk(receiver, id, 0, first)).toEqual({ ok: true, received: 50_000 });
    expect(await chunk(receiver, id, 0, first)).toEqual({ ok: true, received: 50_000 });
    expect(await chunk(receiver, id, 50_000, zip.subarray(50_000))).toEqual({ ok: true, received: 100_000 });
    expect((await receiver.commit({ transferId: id, sha256: sha(zip) })).ok).toBe(true);
  });

  it('refuses a corrupt chunk, a gap and a chunk past the size', async () => {
    const receiver = new TransferReceiver({ dir, deploy: async () => ({ ok: true }) });
    const id = await begin(receiver);
    const piece = zip.subarray(0, 1000);
    const corrupt = await chunk(receiver, id, 0, piece, { chunkSha256: sha(Buffer.from('other')) });
    expect(corrupt).toMatchObject({ ok: false, received: 0 });
    expect(corrupt.error).toMatch(/corrupt chunk/);
    expect(await chunk(receiver, id, 5000, piece)).toMatchObject({ ok: false, received: 0 });
    expect(await chunk(receiver, id, 0, Buffer.concat([zip, Buffer.from('x')]))).toMatchObject({ ok: false });
  });

  it('refuses a commit whose file does not match the hash, and deletes it', async () => {
    const receiver = new TransferReceiver({ dir, deploy: async () => ({ ok: true }) });
    const other = Buffer.from(zip);
    other[10] ^= 0xff;
    const id = (await receiver.begin({ size: zip.length, sha256: sha(zip) })).transferId;
    // Chunk hashes match the (wrong) data: only the whole-file check can catch it.
    await chunk(receiver, id, 0, other);
    const r = await receiver.commit({ transferId: id });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/corrupt file/);
    expect(fs.existsSync(receiver.fileOf(id))).toBe(false);
  });

  it('refuses an incomplete file', async () => {
    const receiver = new TransferReceiver({ dir, deploy: async () => ({ ok: true }) });
    const id = await begin(receiver);
    await chunk(receiver, id, 0, zip.subarray(0, 1000));
    expect((await receiver.commit({ transferId: id })).error).toMatch(/incomplete file/);
  });

  it('an abort cleans up, and a restart cleans the leftovers of the previous run', async () => {
    const receiver = new TransferReceiver({ dir, deploy: async () => ({ ok: true }) });
    const id = await begin(receiver);
    await chunk(receiver, id, 0, zip.subarray(0, 1000));
    expect(fs.existsSync(receiver.fileOf(id))).toBe(true);
    expect(await receiver.abort({ transferId: id })).toEqual({ ok: true });
    expect(fs.existsSync(receiver.fileOf(id))).toBe(false);
    expect((await chunk(receiver, id, 1000, zip.subarray(1000, 2000))).ok).toBe(false);

    fs.writeFileSync(path.join(dir, 'pm-deploy-left-over.zip'), 'x');
    await new TransferReceiver({ dir, deploy: async () => ({ ok: true }) }).cleanupStale({ all: true });
    expect(fs.readdirSync(dir)).toEqual(['project.zip']);
  });

  it('reports a running deploy, then its outcome', async () => {
    let finish;
    const receiver = new TransferReceiver({ dir, deploy: () => new Promise((res) => (finish = res)) });
    const id = await begin(receiver);
    await chunk(receiver, id, 0, zip);
    const { deployId } = await receiver.commit({ transferId: id, clearFolders: ['scripts'], restart: true });
    expect(receiver.status({ deployId })).toMatchObject({ ok: true, state: 'running' });
    finish({ ok: true, cleared: ['scripts'], skipped: [] });
    await new Promise((res) => setTimeout(res, 10));
    expect(receiver.status({ deployId })).toEqual({ ok: true, state: 'done', cleared: ['scripts'], skipped: [], error: '' });
    expect(receiver.status({ deployId: 'nope' })).toMatchObject({ ok: false, state: 'unknown' });
  });
});

describe('deployToNodes', () => {
  it('deploys the local node last, whatever the discovery order', async () => {
    const nodes = [{ dp: 'ProcessMonitor_Node_LOCAL' }, { dp: 'ProcessMonitor_Node_A' }, { dp: 'ProcessMonitor_Node_B' }];
    const order = [];
    const results = await deployToNodes(nodes, {
      isLocal: (n) => n.dp.endsWith('LOCAL'),
      localDeploy: async (n) => (order.push(n.dp), { hostname: n.dp, ok: true }),
      remoteDeploy: async (n) => (order.push(n.dp), { hostname: n.dp, ok: n.dp.endsWith('A') })
    });
    expect(order).toEqual(['ProcessMonitor_Node_A', 'ProcessMonitor_Node_B', 'ProcessMonitor_Node_LOCAL']);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
  });
});
