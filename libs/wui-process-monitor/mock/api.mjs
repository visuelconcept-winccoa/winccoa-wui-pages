// `wui dev`: the /api/process-monitor backend, mocked (wui-toolkit ≥ 0.20). Two pmon nodes of a
// demo project, with the manager list the processMonitor manager publishes (`ListManagers`:
// pmon-client.js `listManagers`, one instance per node DP). Control, pmon configuration edits and
// the ZIP upload/deploy are accepted and change nothing.

const UPDATED = '2026-10-17T08:30:00.000Z';

/** One pmon entry, as `pmon-client.js` merges MGRLIST:LIST and MGRLIST:STATI. */
const manager = (index, name, options, { state = 2, pid = 0, startModeCfg = 'always', manNum = 0 } = {}) => ({
  index,
  name,
  options,
  startModeCfg,
  state,
  stateLabel: { 0: 'stopped', 1: 'init', 2: 'running', 3: 'blocked' }[state],
  pid: state === 0 ? -1 : pid,
  startMode: { manual: 0, once: 1, always: 2 }[startModeCfg],
  startTime: state === 0 ? '' : '2026.10.17 06:02:14.512',
  manNum
});

const INSTANCES = [
  {
    system: 'System1:',
    hostname: 'SRV-SCADA-01',
    updated: UPDATED,
    dp: 'System1:ProcessMonitor_Node_SRV_SCADA_01',
    managers: [
      manager(0, 'WCCILpmon', '', { pid: 4120, startModeCfg: 'manual' }),
      manager(1, 'WCCILdata', '', { pid: 4188, manNum: 0 }),
      manager(2, 'WCCOAvalarch', '-num 0', { pid: 4204 }),
      manager(3, 'WCCILevent', '', { pid: 4236 }),
      manager(4, 'WCCOActrl', '-f pvss_scripts.lst', { pid: 4302, startModeCfg: 'once', manNum: 1 }),
      manager(5, 'WCCILsim', '', { pid: 4318 }),
      manager(6, 'WCCOAopcua', '-num 2', { pid: 4377, manNum: 2 }),
      manager(7, 'WCCOAjavascript', '-num 3 webui/webui.js', { pid: 4410, manNum: 3 }),
      manager(8, 'WCCOAjavascript', '-num 5 processMonitor/index.js', { pid: 4452, manNum: 5 }),
      manager(9, 'WCCOAs7plus', '-num 4', { state: 0, startModeCfg: 'manual', manNum: 4 })
    ]
  },
  {
    system: 'System1:',
    hostname: 'SRV-SCADA-02',
    updated: UPDATED,
    dp: 'System1:ProcessMonitor_Node_SRV_SCADA_02',
    managers: [
      manager(0, 'WCCILpmon', '', { pid: 2860, startModeCfg: 'manual' }),
      manager(1, 'WCCOAui', '-m gedi', { state: 0, startModeCfg: 'manual' }),
      manager(2, 'WCCOAjavascript', '-num 5 processMonitor/index.js', { pid: 2944, manNum: 5 }),
      manager(3, 'WCCOAmod', '-num 6', { state: 1, pid: 2971, manNum: 6 })
    ]
  }
];

const ok = { ok: true, mock: true };

export default {
  'GET /api/process-monitor/health': () => ({
    ok: true,
    service: 'process-monitor',
    vrpc: true,
    serviceName: 'ProcessMonitor_SRV_SCADA_01',
    serviceAvailable: true,
    serviceStatus: 'Ready',
    mock: true
  }),

  // The current manager answers `instances` and, for older pages, the first node's flat list.
  'GET /api/process-monitor/managers': () => ({ ok: true, instances: INSTANCES, managers: INSTANCES[0].managers }),

  'POST /api/process-monitor/manager': () => ok,
  'POST /api/process-monitor/manager/add': () => ok,
  'POST /api/process-monitor/manager/remove': () => ok,
  'POST /api/process-monitor/restart': () => ok,

  'POST /api/process-monitor/upload/init': () => ({ ok: true, uploadId: 'mock-upload' }),
  'POST /api/process-monitor/upload/chunk': () => ({ ok: true }),
  'POST /api/process-monitor/upload/finalize': ({ body }) => {
    const cleared = Array.isArray(body?.clearFolders) ? body.clearFolders : [];
    const targets = body?.target && body.target !== 'all' ? INSTANCES.filter((i) => i.dp === body.target) : INSTANCES;
    return { ok: true, results: targets.map(({ system, hostname }) => ({ system, hostname, ok: true, cleared, skipped: [] })) };
  }
};
