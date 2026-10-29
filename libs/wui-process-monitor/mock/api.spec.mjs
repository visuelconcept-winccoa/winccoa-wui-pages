import { describe, expect, test } from 'vitest';
import routes from './api.mjs';

const call = async (route, request) => {
  try {
    return { status: 200, body: await routes[route]({ query: {}, params: {}, ...request }) };
  } catch (error) {
    return { status: error.status ?? 500, body: { error: error.message } };
  }
};

describe('the /api/process-monitor mock', () => {
  test('lists one instance per pmon node, with the manager fields the console reads', async () => {
    const { status, body } = await call('GET /api/process-monitor/managers');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.instances.map((instance) => instance.hostname)).toEqual(['SRV-SCADA-01', 'SRV-SCADA-02']);
    for (const instance of body.instances) {
      expect(instance.dp).toMatch(/ProcessMonitor_Node_/);
      expect(instance.managers[0]).toMatchObject({ index: 0, name: 'WCCILpmon', state: 2, stateLabel: 'running' });
    }
    expect(body.managers).toEqual(body.instances[0].managers);
  });

  test('a stopped manager has no pid, like pmon reports it', async () => {
    const { body } = await call('GET /api/process-monitor/managers');
    const stopped = body.instances.flatMap((instance) => instance.managers).filter((manager) => manager.state === 0);
    expect(stopped.length).toBeGreaterThan(0);
    for (const manager of stopped) expect(manager).toMatchObject({ pid: -1, stateLabel: 'stopped', startTime: '' });
  });

  test('every manager carries the pmon fields of the table: start time, number, start mode, restart settings', async () => {
    const { body } = await call('GET /api/process-monitor/managers');
    const all = body.instances.flatMap((instance) => instance.managers);
    for (const manager of all) {
      expect(manager).toEqual(expect.objectContaining({ startModeCfg: expect.any(String), secKill: expect.any(Number), restartCount: expect.any(Number), resetMin: expect.any(Number), manNum: expect.any(Number) }));
      if (manager.state !== 0) expect(Number.isNaN(Date.parse(manager.startTime))).toBe(false);
    }
    // One manager restarted a few minutes ago, the rest days earlier.
    const recent = all.filter((manager) => manager.state !== 0 && Date.now() - Date.parse(manager.startTime) < 10 * 60_000);
    expect(recent.map((manager) => manager.name)).toContain('WCCOAopcua');
  });

  test('the bridge reports itself healthy', async () => {
    expect((await call('GET /api/process-monitor/health')).body).toMatchObject({ ok: true, serviceAvailable: true });
  });

  test('control and deploy are accepted and change nothing', async () => {
    expect((await call('POST /api/process-monitor/manager', { body: { node: '', action: 'stop', index: 4 } })).body.ok).toBe(true);
    expect((await call('POST /api/process-monitor/upload/init', { body: { fileName: 'projet.zip' } })).body).toEqual({ ok: true, uploadId: 'mock-upload' });
    const deploy = await call('POST /api/process-monitor/upload/finalize', { body: { uploadId: 'mock-upload', clearFolders: ['panels'], restart: false, target: 'all' } });
    expect(deploy.body.ok).toBe(true);
    expect(deploy.body.results).toHaveLength(2);
    expect(deploy.body.results[0]).toMatchObject({ ok: true, cleared: ['panels'] });
    expect((await call('GET /api/process-monitor/managers')).body.instances[0].managers[4].state).toBe(2);
  });
});
