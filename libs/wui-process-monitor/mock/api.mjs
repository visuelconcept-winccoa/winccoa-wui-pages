// `wui dev`: the /api/process-monitor backend, mocked (wui-toolkit ≥ 0.20). Two pmon nodes of a
// demo project, with the manager list the processMonitor manager publishes (`ListManagers`:
// pmon-client.js `listManagers`, one instance per node DP). Control, pmon configuration edits and
// the ZIP upload/deploy are accepted and change nothing.

const MINUTE = 60_000;

/**
 * One pmon entry, as `pmon-client.js` merges MGRLIST:LIST and MGRLIST:STATI. `startedAgo` is
 * the start time in minutes before the request (pmon's text is turned into ISO by the
 * manager); a stopped manager has none.
 */
const manager = (
  index,
  name,
  options,
  { state = 2, pid = 0, startModeCfg = 'always', liveMode = startModeCfg, manNum = 0, startedAgo = 3 * 24 * 60, secKill = 30, restartCount = 3, resetMin = 1 } = {}
) => ({
  index,
  name,
  options,
  startModeCfg,
  secKill,
  restartCount,
  resetMin,
  state,
  stateLabel: { 0: 'stopped', 1: 'init', 2: 'running', 3: 'blocked' }[state],
  pid: state === 0 ? -1 : pid,
  startMode: { manual: 0, once: 1, always: 2 }[liveMode],
  startTime: state === 0 ? '' : new Date(Date.now() - startedAgo * MINUTE).toISOString(),
  manNum
});

/** The two nodes, built per request so the start times (and the uptimes) move with the clock. */
const instances = () => {
  const updated = new Date().toISOString();
  return [
    {
      system: 'System1:',
      hostname: 'SRV-SCADA-01',
      updated,
      dp: 'System1:ProcessMonitor_Node_SRV_SCADA_01',
      managers: [
        manager(0, 'WCCILpmon', '', { pid: 4120, startModeCfg: 'manual' }),
        manager(1, 'WCCILdata', '', { pid: 4188 }),
        manager(2, 'WCCOAvalarch', '-num 0', { pid: 4204 }),
        manager(3, 'WCCILevent', '', { pid: 4236 }),
        manager(4, 'WCCOActrl', '-num 1 -f pvss_scripts.lst', { pid: 4302, startModeCfg: 'once', manNum: 1 }),
        manager(5, 'WCCILsim', '', { pid: 4318 }),
        // Restarted a few minutes ago: the one a start-time sort brings up.
        manager(6, 'WCCOAopcua', '-num 2', { pid: 6871, manNum: 2, startedAgo: 4, secKill: 60, restartCount: 5, resetMin: 10 }),
        manager(7, 'WCCOAjavascript', '-num 3 webui/webui.js', { pid: 4410, manNum: 3 }),
        manager(8, 'WCCOAjavascript', '-num 5 processMonitor/index.js', { pid: 4452, manNum: 5 }),
        manager(9, 'WCCOAs7plus', '-num 4', { state: 0, startModeCfg: 'manual', manNum: 4 })
      ]
    },
    {
      system: 'System1:',
      hostname: 'SRV-SCADA-02',
      updated,
      dp: 'System1:ProcessMonitor_Node_SRV_SCADA_02',
      managers: [
        manager(0, 'WCCILpmon', '', { pid: 2860, startModeCfg: 'manual', startedAgo: 26 * 60 }),
        manager(1, 'WCCOAui', '-m gedi', { state: 0, startModeCfg: 'manual' }),
        manager(2, 'WCCOAjavascript', '-num 5 processMonitor/index.js', { pid: 2944, manNum: 5, startedAgo: 26 * 60 }),
        // Configured "once", run by pmon as "always": the console flags the difference.
        manager(3, 'WCCOAmod', '-num 6', { state: 1, pid: 2971, manNum: 6, startModeCfg: 'once', liveMode: 'always', startedAgo: 0.5 })
      ]
    }
  ];
};

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
  'GET /api/process-monitor/managers': () => {
    const all = instances();
    return { ok: true, instances: all, managers: all[0].managers };
  },

  'POST /api/process-monitor/manager': () => ok,
  'POST /api/process-monitor/manager/add': () => ok,
  'POST /api/process-monitor/manager/remove': () => ok,
  'POST /api/process-monitor/restart': () => ok,

  'POST /api/process-monitor/upload/init': () => ({ ok: true, uploadId: 'mock-upload' }),
  'POST /api/process-monitor/upload/chunk': () => ({ ok: true }),
  'POST /api/process-monitor/upload/finalize': ({ body }) => {
    const cleared = Array.isArray(body?.clearFolders) ? body.clearFolders : [];
    const all = instances();
    const targets = body?.target && body.target !== 'all' ? all.filter((i) => i.dp === body.target) : all;
    return { ok: true, results: targets.map(({ system, hostname }) => ({ system, hostname, ok: true, cleared, skipped: [] })) };
  }
};
