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
    expect(body.instances.map((instance) => instance.hostname)).toEqual(['SRV-SCADA-01', 'SRV-SCADA-02', 'SRV-SCADA-03']);
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

  test('logs: each host lists its files, with their .bak and manager', async () => {
    const one = (await call('GET /api/process-monitor/logs', { query: { node: 'System1:ProcessMonitor_Node_SRV_SCADA_01' } })).body;
    const two = (await call('GET /api/process-monitor/logs', { query: { node: 'System1:ProcessMonitor_Node_SRV_SCADA_02' } })).body;
    expect(one.files.map((f) => f.name)).toContain('WCCOActrl1.log');
    expect(two.files.map((f) => f.name)).toEqual(['PVSS_II.log', 'WCCOAmod6.bak', 'WCCOAmod6.log']);
    expect(one.files.find((f) => f.name === 'WCCOActrl1.log')).toMatchObject({ bak: 'WCCOActrl1.bak', manager: { name: 'WCCOActrl', manNum: 1 } });
  });

  test('logs: tail, then an incremental read from the offset, .bak merged on a fresh read', async () => {
    const node = 'System1:ProcessMonitor_Node_SRV_SCADA_01';
    const first = (await call('POST /api/process-monitor/logs/read', { body: { node, files: ['WCCOActrl1.log', 'PVSS_II.log'], maxLines: 100, mergeBak: true } })).body;
    expect(first.ok).toBe(true);
    const ctrl = first.files[0];
    expect(ctrl.text.trimEnd().split('\n')).toHaveLength(100);
    expect(ctrl.bak).toBeUndefined(); // the current file has the 100 lines
    expect(first.files[1].bak.name).toBe('PVSS_II.log.bak');
    const next = (await call('POST /api/process-monitor/logs/read', { body: { node, files: ['WCCOActrl1.log'], fromOffset: { 'WCCOActrl1.log': ctrl.offset }, maxLines: 100 } })).body;
    expect(next.files[0]).toMatchObject({ reset: false });
    expect(next.files[0].offset).toBeGreaterThanOrEqual(ctrl.offset);
  });

  test('logs: a name outside the listing is refused, export sends the whole files', async () => {
    const bad = (await call('POST /api/process-monitor/logs/read', { body: { node: '', files: ['../config/config'], maxLines: 10 } })).body;
    expect(bad).toMatchObject({ ok: false });
    expect((await call('POST /api/process-monitor/logs/read', { body: { files: [] } })).status).toBe(400);
    const exp = (await call('POST /api/process-monitor/logs/export', { body: { node: 'System1:ProcessMonitor_Node_SRV_SCADA_02', files: ['WCCOAmod6.log'], mergeBak: true } })).body;
    expect(exp.files[0]).toMatchObject({ name: 'WCCOAmod6.log', truncated: false, bak: { name: 'WCCOAmod6.bak' } });
  });

  test('the bridge reports itself healthy', async () => {
    expect((await call('GET /api/process-monitor/health')).body).toMatchObject({ ok: true, serviceAvailable: true });
  });

  test('control and deploy are accepted and change nothing', async () => {
    expect((await call('POST /api/process-monitor/manager', { body: { node: '', action: 'stop', index: 4 } })).body.ok).toBe(true);
    expect((await call('POST /api/process-monitor/upload/init', { body: { fileName: 'projet.zip' } })).body).toEqual({ ok: true, uploadId: 'mock-upload' });
    const deploy = await call('POST /api/process-monitor/upload/finalize', { body: { uploadId: 'mock-upload', clearFolders: ['panels'], restart: false, target: 'all' } });
    // The decommissioned node fails on its own, the others are deployed.
    expect(deploy.body.ok).toBe(false);
    expect(deploy.body.results).toHaveLength(3);
    expect(deploy.body.results[0]).toMatchObject({ ok: true, cleared: ['panels'] });
    expect(deploy.body.results[2]).toMatchObject({ hostname: 'SRV-SCADA-03', ok: false });
    expect((await call('GET /api/process-monitor/managers')).body.instances[0].managers[4].state).toBe(2);
  });

  test('instance states: one connected (local), one with an old agent, one whose agent does not answer', async () => {
    const { body } = await call('GET /api/process-monitor/managers');
    const byHost = Object.fromEntries(body.instances.map((instance) => [instance.hostname, instance]));
    expect(byHost['SRV-SCADA-01']).toMatchObject({ local: true, status: { state: 'connected', version: '0.3.0' } });
    expect(byHost['SRV-SCADA-02']).toMatchObject({ local: false, status: { state: 'agent-too-old', version: '' } });
    expect(byHost['SRV-SCADA-03']).toMatchObject({ local: false, status: { state: 'agent-unreachable' } });
    expect(Date.now() - Date.parse(byHost['SRV-SCADA-03'].updated)).toBeGreaterThan(7 * 24 * 3_600_000);
  });

  test('instance delete: refused for the local node and an answering agent, accepted for an unreachable one', async () => {
    const del = (node) => call('POST /api/process-monitor/instance/delete', { body: { node } });
    expect((await del('')).status).toBe(400);
    expect((await del('all')).status).toBe(400);
    expect((await del('System1:ProcessMonitor_Node_SRV_SCADA_01')).body).toMatchObject({ ok: false, code: 'local' });
    expect((await del('System1:ProcessMonitor_Node_SRV_SCADA_02')).body).toMatchObject({ ok: false, code: 'answers' });
    const done = (await del('System1:ProcessMonitor_Node_SRV_SCADA_03')).body;
    expect(done).toMatchObject({ ok: true, hostname: 'SRV-SCADA-03', system: 'System1:', state: 'agent-unreachable' });
    expect(done.lastSeen).toBeTruthy();
    const after = (await call('GET /api/process-monitor/managers')).body.instances.map((instance) => instance.hostname);
    expect(after).toEqual(['SRV-SCADA-01', 'SRV-SCADA-02']);
  });

  test('manager update: the new values come back with the old ones, out-of-bound values are refused', async () => {
    const node = 'System1:ProcessMonitor_Node_SRV_SCADA_01';
    const res = await call('POST /api/process-monitor/manager/update', {
      body: { node, index: 4, name: 'WCCOActrl', startMode: 'manual', secKill: 60, restartCount: 5, resetMin: 10, options: '-num 1 -f other.lst', restart: true }
    });
    expect(res.body).toMatchObject({ ok: true, detail: { before: { startMode: 'once', secKill: 30 }, after: { startMode: 'manual', secKill: 60, options: '-num 1 -f other.lst' }, restarted: true } });
    expect((await call('POST /api/process-monitor/manager/update', { body: { node, index: 0, startMode: 'manual', secKill: 30, restartCount: 3, resetMin: 1 } })).status).toBe(400);
    expect((await call('POST /api/process-monitor/manager/update', { body: { node, index: 4, startMode: 'manual', secKill: 0, restartCount: 3, resetMin: 1 } })).status).toBe(400);
  });

  test('manager delete: a running manager is refused unless it is stopped first', async () => {
    const node = 'System1:ProcessMonitor_Node_SRV_SCADA_01';
    expect((await call('POST /api/process-monitor/manager/remove', { body: { node, index: 6, name: 'WCCOAopcua' } })).body).toMatchObject({ ok: false });
    expect((await call('POST /api/process-monitor/manager/remove', { body: { node, index: 6, name: 'WCCOAopcua', stopFirst: true } })).body).toMatchObject({ ok: true, detail: { stopped: true } });
    expect((await call('POST /api/process-monitor/manager/remove', { body: { node, index: 9, name: 'WCCOAs7plus' } })).body).toMatchObject({ ok: true });
    expect((await call('POST /api/process-monitor/manager/remove', { body: { node, index: 0 } })).status).toBe(400);
  });
});
