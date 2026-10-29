// Real state of each host instance (issue 39): the Ping outcome mapped to a state, the parallel
// pings with a timeout, and the server-side guard of an instance deletion.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The manager is CommonJS (deployed outside this "type": "module" package): copied to .cjs for the test.
const src = fileURLToPath(new URL('../managers/processMonitor/instance-state.js', import.meta.url));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'instance-state-')), 'instance-state.cjs');
fs.copyFileSync(src, tmp);
const require = createRequire(import.meta.url);
const { STATES, canDeleteInstance, classifyPing, deleteInstance, isUnimplemented, pingNode, pingNodes } = require(tmp);

const UNIMPLEMENTED = 12;
const reply = (pmon = 'reachable') => ({ ok: true, hostname: 'PC2', system: 'System1:', version: '0.3.0', startedAt: '2026-10-29T08:00:00.000Z', pmon });
const node = (host, system = 'System1:') => ({ dp: `${system}ProcessMonitor_Node_${host}`, system, hostname: host });
const LOCAL = node('PC1');
const never = () => new Promise(() => undefined);

describe('classifyPing', () => {
  it('an answer with a reachable pmon is connected, with the agent version and start time', () => {
    expect(classifyPing({ reply: reply() })).toMatchObject({ state: 'connected', version: '0.3.0', startedAt: '2026-10-29T08:00:00.000Z' });
  });

  it('an answer whose pmon does not answer is pmon-unreachable', () => {
    expect(classifyPing({ reply: { ...reply('unreachable'), pmonError: 'Pmon timeout after 1500ms' } })).toMatchObject({
      state: 'pmon-unreachable',
      version: '0.3.0',
      error: 'Pmon timeout after 1500ms'
    });
  });

  it('Unimplemented (status code or text) is agent-too-old, even for another system', () => {
    const byCode = Object.assign(new Error('Ping: function missing'), { statusCode: UNIMPLEMENTED });
    expect(classifyPing({ error: byCode, unimplementedCode: UNIMPLEMENTED }).state).toBe('agent-too-old');
    expect(classifyPing({ error: new Error('Ping: Unimplemented'), foreign: true }).state).toBe('agent-too-old');
    expect(classifyPing({ error: { status: { statusCode: UNIMPLEMENTED, text: 'x' } }, unimplementedCode: UNIMPLEMENTED }).state).toBe('agent-too-old');
  });

  it('a timeout or a missing service is agent-unreachable on this system, not-checkable on another one', () => {
    const timeout = Object.assign(new Error('no answer within 2500 ms'), { timedOut: true });
    expect(classifyPing({ error: timeout })).toMatchObject({ state: 'agent-unreachable', error: 'no answer within 2500 ms' });
    expect(classifyPing({ error: new Error('service "ProcessMonitor_PC9" not found') }).state).toBe('agent-unreachable');
    expect(classifyPing({ error: timeout, foreign: true }).state).toBe('not-checkable');
    expect(classifyPing({ error: new Error('no route to system 2'), foreign: true }).state).toBe('not-checkable');
  });

  it('a service that is not found is not mistaken for an unimplemented function', () => {
    expect(isUnimplemented(new Error('service "ProcessMonitor_PC9" not found'))).toBe(false);
    expect(isUnimplemented(new Error('Ping: unknown function'))).toBe(true);
    expect(isUnimplemented(undefined)).toBe(false);
  });
});

describe('pingNode / pingNodes', () => {
  const opts = (over = {}) => ({
    isLocal: (n) => n.dp === LOCAL.dp,
    isForeign: (n) => n.system !== 'System1:',
    localPing: async () => reply(),
    remotePing: async () => reply(),
    timeoutMs: 50,
    unimplementedCode: UNIMPLEMENTED,
    ...over
  });

  it('the local node is pinged in-process, never through a stub', async () => {
    let remote = 0;
    const status = await pingNode(LOCAL, opts({ remotePing: async () => (remote++, reply()) }));
    expect(status.state).toBe('connected');
    expect(remote).toBe(0);
  });

  it('a node that does not answer in time is agent-unreachable (another system: not-checkable)', async () => {
    expect((await pingNode(node('PC2'), opts({ remotePing: never }))).state).toBe('agent-unreachable');
    expect((await pingNode(node('PC7', 'System2:'), opts({ remotePing: never }))).state).toBe('not-checkable');
  });

  it('pings every node in parallel: the whole list takes one timeout, not one per node', async () => {
    const nodes = [LOCAL, node('PC2'), node('PC3'), node('PC4'), node('PC5')];
    const started = Date.now();
    const statuses = await pingNodes(nodes, opts({ remotePing: never, timeoutMs: 120 }));
    expect(Date.now() - started).toBeLessThan(450);
    expect(statuses.map((s) => s.state)).toEqual(['connected', 'agent-unreachable', 'agent-unreachable', 'agent-unreachable', 'agent-unreachable']);
  });

  it('an older agent answers Unimplemented', async () => {
    const remotePing = async () => {
      throw Object.assign(new Error('Ping: Unimplemented'), { statusCode: UNIMPLEMENTED });
    };
    expect((await pingNode(node('PC2'), opts({ remotePing }))).state).toBe('agent-too-old');
  });
});

describe('canDeleteInstance', () => {
  const at = (state) => ({ ...node('PC2'), status: { state } });

  it('only an instance whose agent does not answer can be deleted', () => {
    expect(canDeleteInstance(at(STATES.AGENT_UNREACHABLE))).toEqual({ ok: true });
    for (const state of ['connected', 'pmon-unreachable', 'agent-too-old']) expect(canDeleteInstance(at(state))).toMatchObject({ ok: false, code: 'answers' });
    expect(canDeleteInstance(at('not-checkable'))).toMatchObject({ ok: false, code: 'not-checkable' });
    expect(canDeleteInstance({ ...node('PC2') })).toMatchObject({ ok: false, code: 'unchecked' });
  });

  it('never the local node, whatever its state', () => {
    expect(canDeleteInstance(at(STATES.AGENT_UNREACHABLE), { local: true })).toMatchObject({ ok: false, code: 'local' });
  });
});

describe('deleteInstance (server side)', () => {
  const deps = (over = {}) => {
    const deleted = [];
    const pings = [];
    return {
      deleted,
      pings,
      isLocal: (n) => n.dp === LOCAL.dp,
      ping: async (n) => (pings.push(n.dp), { state: 'agent-unreachable' }),
      readUpdated: async () => '2026-10-20T08:00:00.000Z',
      dpDelete: async (dp) => deleted.push(dp),
      ...over
    };
  };

  it('pings again, then deletes the node DP of an unreachable agent and reports who it was', async () => {
    const d = deps();
    const res = await deleteInstance(node('PC2'), d);
    expect(res).toEqual({ ok: true, dp: 'System1:ProcessMonitor_Node_PC2', system: 'System1:', hostname: 'PC2', lastSeen: '2026-10-20T08:00:00.000Z', state: 'agent-unreachable' });
    expect(d.pings).toEqual(['System1:ProcessMonitor_Node_PC2']);
    expect(d.deleted).toEqual(['System1:ProcessMonitor_Node_PC2']);
  });

  it('refuses the local node without pinging or deleting', async () => {
    const d = deps();
    expect(await deleteInstance(LOCAL, d)).toMatchObject({ ok: false, code: 'local' });
    expect(d.pings).toEqual([]);
    expect(d.deleted).toEqual([]);
  });

  it('refuses when the agent answers again at the re-check', async () => {
    const d = deps({ ping: async () => ({ state: 'connected' }) });
    expect(await deleteInstance(node('PC2'), d)).toMatchObject({ ok: false, code: 'answers', state: 'connected' });
    expect(d.deleted).toEqual([]);
  });

  it('refuses a node of another system that cannot be checked', async () => {
    const d = deps({ ping: async () => ({ state: 'not-checkable' }) });
    expect(await deleteInstance(node('PC7', 'System2:'), d)).toMatchObject({ ok: false, code: 'not-checkable' });
    expect(d.deleted).toEqual([]);
  });

  it('reports a failed dpDelete', async () => {
    const d = deps({
      dpDelete: async () => {
        throw new Error('DP locked');
      }
    });
    expect(await deleteInstance(node('PC2'), d)).toMatchObject({ ok: false, code: 'dp-delete', error: 'dpDelete failed: DP locked' });
  });
});
