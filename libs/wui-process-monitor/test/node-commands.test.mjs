// Commands and managers lists of the hosts over vRPC (issues 52, 53): Control routed to the
// target host, the .cmd fallback of an agent older than 0.4.0, the lists read now, and a
// manager that restarts itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// The manager is CommonJS (deployed outside this "type": "module" package): copied to .cjs,
// with instance-state.js beside it (node-commands requires it).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-commands-'));
for (const name of ['node-commands', 'instance-state']) {
  const src = fileURLToPath(new URL(`../managers/processMonitor/${name}.js`, import.meta.url));
  fs.writeFileSync(path.join(dir, `${name}.cjs`), fs.readFileSync(src, 'utf8').replaceAll("require('./instance-state.js')", "require('./instance-state.cjs')"));
}
const require = createRequire(import.meta.url);
const { collectManagers, routeCommand, selfCommandPlan, selfTarget } = require(path.join(dir, 'node-commands.cjs'));

const UNIMPLEMENTED = 12;
const node = (host) => ({ dp: `System1:ProcessMonitor_Node_${host}`, system: 'System1:', hostname: host });
const LOCAL = node('PC1');
const isLocal = (n) => n.dp === LOCAL.dp;
const unimplemented = () => Object.assign(new Error('Control: Unimplemented'), { statusCode: UNIMPLEMENTED });

function deps(over = {}) {
  return {
    isLocal,
    execLocal: vi.fn(async () => ({ warning: '' })),
    call: vi.fn(async () => ({ ok: true })),
    legacyCommand: vi.fn(async () => ({ ok: true })),
    timeoutMs: 1000,
    unimplementedCode: UNIMPLEMENTED,
    ...over
  };
}

describe('routeCommand', () => {
  it('runs a command of the own node on the local pmon, without any call', async () => {
    const d = deps();
    const res = await routeCommand(LOCAL, { action: 'start', index: 3 }, d);
    expect(res).toMatchObject({ ok: true });
    expect(d.execLocal).toHaveBeenCalledWith({ action: 'start', index: 3 });
    expect(d.call).not.toHaveBeenCalled();
  });

  it('calls Control on the target host and relays its answer', async () => {
    const d = deps({ call: vi.fn(async () => ({ ok: true, warning: 'config/progs', detail: { restarted: true } })) });
    const res = await routeCommand(node('PC2'), { action: 'update', index: 4 }, d);
    expect(d.call).toHaveBeenCalledWith(node('PC2'), 'Control', { cmd: { action: 'update', index: 4 } });
    expect(res).toEqual({ ok: true, error: '', warning: 'config/progs', detail: { restarted: true } });
    expect(d.legacyCommand).not.toHaveBeenCalled();
  });

  it('falls back to the .cmd DP for an agent older than 0.4.0 (Unimplemented), and says so', async () => {
    const d = deps({ call: vi.fn(async () => Promise.reject(unimplemented())) });
    const res = await routeCommand(node('PC2'), { action: 'stop', index: 2 }, d);
    expect(d.legacyCommand).toHaveBeenCalledWith(node('PC2'), { action: 'stop', index: 2 });
    expect(res).toMatchObject({ ok: true, legacy: true });
  });

  it('reports any other failure without the DP path', async () => {
    const d = deps({ call: vi.fn(async () => Promise.reject(new Error('Service is not available'))) });
    expect(await routeCommand(node('PC2'), { action: 'stop', index: 2 }, d)).toEqual({ ok: false, error: 'Service is not available' });
    expect(d.legacyCommand).not.toHaveBeenCalled();
  });

  it('reports a refusal of the host and an error of the local pmon as ok: false', async () => {
    const remote = deps({ call: vi.fn(async () => ({ ok: false, error: 'index invalide' })) });
    expect(await routeCommand(node('PC2'), { action: 'remove', index: 0 }, remote)).toMatchObject({ ok: false, error: 'index invalide' });
    const local = deps({ execLocal: vi.fn(async () => Promise.reject(new Error('Pmon timeout'))) });
    expect(await routeCommand(LOCAL, { action: 'start', index: 1 }, local)).toEqual({ ok: false, error: 'Pmon timeout' });
  });
});

describe('collectManagers', () => {
  const list = (name) => [{ index: 1, name, pid: 10 }];

  it('reads every host now: the local pmon, ListLocal of the others, the .pmon of an agent < 0.4.0', async () => {
    const instances = [
      { ...LOCAL, status: { state: 'connected' } },
      { ...node('PC2'), status: { state: 'connected' } },
      { ...node('PC3'), status: { state: 'agent-too-old' } }
    ];
    const memory = new Map();
    await collectManagers(instances, {
      isLocal,
      listLocal: async () => list('local'),
      call: async (n, method) => (method === 'ListLocal' ? { ok: true, managers: list(n.hostname), at: '2026-11-01T10:00:00.000Z' } : null),
      legacySnapshot: async () => ({ managers: list('old'), at: '2026-11-01T09:59:58.000Z' }),
      memory,
      timeoutMs: 1000,
      now: () => new Date('2026-11-01T10:00:01.000Z')
    });
    expect(instances.map((i) => i.managers[0].name)).toEqual(['local', 'PC2', 'old']);
    expect(instances.map((i) => i.updated)).toEqual(['2026-11-01T10:00:01.000Z', '2026-11-01T10:00:00.000Z', '2026-11-01T09:59:58.000Z']);
    expect(memory.size).toBe(3);
  });

  it('keeps the last list read from a host that stops answering, with its age; none after a restart', async () => {
    const memory = new Map([[node('PC2').dp, { managers: list('before'), at: '2026-11-01T08:00:00.000Z' }]]);
    const instances = [
      { ...node('PC2'), status: { state: 'agent-unreachable' } },
      { ...node('PC4'), updated: '2026-10-30T12:00:00.000Z', status: { state: 'agent-unreachable' } }
    ];
    const call = vi.fn();
    await collectManagers(instances, { isLocal, listLocal: async () => [], call, legacySnapshot: async () => null, memory, timeoutMs: 1000 });
    expect(call).not.toHaveBeenCalled();
    expect(instances[0]).toMatchObject({ managers: list('before'), updated: '2026-11-01T08:00:00.000Z' });
    expect(instances[1]).toMatchObject({ managers: [], updated: '2026-10-30T12:00:00.000Z' });
  });

  it('keeps the last list when ListLocal fails or does not answer in time', async () => {
    const memory = new Map([[node('PC2').dp, { managers: list('before'), at: 'T0' }]]);
    const instances = [{ ...node('PC2'), status: { state: 'connected' } }];
    await collectManagers(instances, { isLocal, listLocal: async () => [], call: () => new Promise(() => undefined), legacySnapshot: async () => null, memory, timeoutMs: 20 });
    expect(instances[0]).toMatchObject({ managers: list('before'), updated: 'T0' });
  });
});

describe('a command aimed at the processMonitor agent itself', () => {
  const managers = [
    { index: 7, name: 'WCCOAjavascript', pid: 4452, startModeCfg: 'always' },
    { index: 8, name: 'WCCOActrl', pid: 5000, startModeCfg: 'always' }
  ];

  it('is recognised by its pid, only for stop and restart', () => {
    expect(selfTarget({ action: 'restart', index: 7 }, managers, 4452)).toMatchObject({ index: 7 });
    expect(selfTarget({ action: 'restart', index: 8 }, managers, 4452)).toBeNull();
    expect(selfTarget({ action: 'start', index: 7 }, managers, 4452)).toBeNull();
  });

  it('is a restart only in start mode always — a stop of itself is refused', () => {
    expect(selfCommandPlan({ action: 'restart' }, managers[0])).toEqual({ allowed: true });
    expect(selfCommandPlan({ action: 'restart' }, { ...managers[0], startModeCfg: 'manual' })).toMatchObject({ allowed: false, reason: expect.stringMatching(/always/) });
    expect(selfCommandPlan({ action: 'stop' }, managers[0])).toMatchObject({ allowed: false });
  });
});
