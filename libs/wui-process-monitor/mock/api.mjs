// `wui dev`: the /api/process-monitor backend, mocked (wui-toolkit ≥ 0.20). Two pmon nodes of a
// demo project, with the manager list the processMonitor manager publishes (`ListManagers`:
// pmon-client.js `listManagers`, one instance per node DP). Control, pmon configuration edits and
// the ZIP upload/deploy are accepted and change nothing. The Logs tab reads a few log files per
// host (log-files.js shape: tail, incremental read by offset, .bak merge); `WCCOActrl1.log` of
// SRV-SCADA-01 grows by one entry every 3 s to show the live tail.
// Instance states (issue 39): SRV-SCADA-01 is the aggregator's own node, connected; SRV-SCADA-02
// runs an agent older than 0.3.0 (no Ping); SRV-SCADA-03 was decommissioned: its agent does not
// answer and its last snapshot is nine days old. Only that one can be deleted (POST
// /instance/delete), and the deletion lasts until the dev server restarts.

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

/** Instances deleted through the mock (until the dev server restarts). */
const deleted = new Set();
const MOCK_STARTED_AT = new Date().toISOString();

/** The `status` the manager attaches to each instance after pinging it (instance-state.js). */
const status = (state, { version = '', error } = {}) => ({
  state,
  checkedAt: new Date().toISOString(),
  version,
  startedAt: version ? MOCK_STARTED_AT : '',
  ...(error ? { error } : {})
});

/** The nodes, built per request so the start times (and the uptimes) move with the clock. */
const instances = () => {
  const updated = new Date().toISOString();
  return [
    {
      system: 'System1:',
      hostname: 'SRV-SCADA-01',
      updated,
      dp: 'System1:ProcessMonitor_Node_SRV_SCADA_01',
      local: true,
      status: status('connected', { version: '0.3.0' }),
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
      local: false,
      status: status('agent-too-old', { error: 'Ping: Unimplemented' }),
      managers: [
        manager(0, 'WCCILpmon', '', { pid: 2860, startModeCfg: 'manual', startedAgo: 26 * 60 }),
        manager(1, 'WCCOAui', '-m gedi', { state: 0, startModeCfg: 'manual' }),
        manager(2, 'WCCOAjavascript', '-num 5 processMonitor/index.js', { pid: 2944, manNum: 5, startedAgo: 26 * 60 }),
        // Configured "once", run by pmon as "always": the console flags the difference.
        manager(3, 'WCCOAmod', '-num 6', { state: 1, pid: 2971, manNum: 6, startModeCfg: 'once', liveMode: 'always', startedAgo: 0.5 })
      ]
    },
    {
      // Decommissioned: the agent no longer answers, the snapshot is nine days old.
      system: 'System1:',
      hostname: 'SRV-SCADA-03',
      updated: new Date(Date.now() - 9 * 24 * 60 * MINUTE).toISOString(),
      dp: 'System1:ProcessMonitor_Node_SRV_SCADA_03',
      local: false,
      status: status('agent-unreachable', { error: 'Ping: no answer within 2500 ms' }),
      managers: [
        manager(0, 'WCCILpmon', '', { pid: 1980, startModeCfg: 'manual', startedAgo: 30 * 24 * 60 }),
        manager(1, 'WCCOAjavascript', '-num 5 processMonitor/index.js', { pid: 2010, manNum: 5, startedAgo: 30 * 24 * 60 })
      ]
    }
  ].filter((i) => !deleted.has(i.dp));
};

const ok = { ok: true, mock: true };

// ---- logs ------------------------------------------------------------------

const MOCK_START = Date.now();
const pad = (n, w = 2) => String(n).padStart(w, '0');
/** WinCC OA log time text (host local time). */
const logTime = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};
const entry = (ms, manager, num, category, severity, code, text) =>
  `${manager.padEnd(13)} (${num}), ${logTime(ms)}, ${category.padEnd(5)}, ${severity.padEnd(7)}, ${String(code).padStart(5)}, ${text}\n`;

const DAY = 24 * 60 * MINUTE;

/** A CTRL manager's log: start-up, a few warnings, a multi-line error, then the live part. */
const ctrlLog = (from, count, offsetMin = 0) => {
  let out = '';
  for (let i = 0; i < count; i++) {
    const ms = from + (i + offsetMin) * MINUTE;
    if (i % 7 === 3) {
      out += entry(ms, 'WCCOActrl', 1, 'CTRL', 'WARNING', '5/ctrl', 'Location of the error: Module: CTRL');
      out += '    Script: pvss_scripts.lst\n    Line: 42\nIn libs/wui/processMonitor.ctl, function main\n';
    } else if (i % 11 === 5) {
      out += entry(ms, 'WCCOActrl', 1, 'CTRL', 'SEVERE', '72/ctrl', 'Syntax error, user "operator1" from 10.0.4.17');
    } else {
      out += entry(ms, 'WCCOActrl', 1, 'CTRL', 'INFO', 0, `cycle ${i}: 128 datapoints read`);
    }
  }
  return out;
};

/** The growing part of WCCOActrl1.log: one entry every 3 s since the mock started. */
const liveCtrl = () => {
  let out = '';
  const n = Math.min(2000, Math.floor((Date.now() - MOCK_START) / 3000));
  for (let i = 0; i < n; i++) {
    const ms = MOCK_START + i * 3000;
    out += i % 5 === 4 ? entry(ms, 'WCCOActrl', 1, 'CTRL', 'WARNING', '5/ctrl', `tag S7_Line1.speed out of range (${100 + i})`) : entry(ms, 'WCCOActrl', 1, 'CTRL', 'INFO', 0, `live tick ${i}`);
  }
  return out;
};

const pvssLog = (base) =>
  entry(base, 'WCCILpmon', 0, 'SYS', 'INFO', 0, ', Manager started') +
  entry(base + 1000, 'WCCILdata', 0, 'PARAM', 'WARNING', 54, 'Parameter incorrect, config file entry ignored: "maxBcmBufferSize"') +
  entry(base + 2000, 'WCCILevent', 0, 'SYS', 'INFO', 0, 'Connection to data manager established') +
  entry(base + 60_000, 'WCCOAvalarch', 0, 'REDU', 'INFO', 12, 'Redundancy switched: SRV-SCADA-02 is active') +
  entry(base + 120_000, 'WCCOAs7plus', 4, 'IMPL', 'SEVERE', 21, 'Connection to PLC 192.168.10.20 lost') +
  entry(base + 125_000, 'WCCOAs7plus', 4, 'IMPL', 'FATAL', 3, 'Out of memory, exiting');

/** Log files per node DP: name → { text(), mtime, bak? } (text built per request). */
const LOGS = {
  'System1:ProcessMonitor_Node_SRV_SCADA_01': {
    'PVSS_II.log': { text: () => pvssLog(MOCK_START - 3 * DAY), bak: 'PVSS_II.log.bak' },
    'PVSS_II.log.bak': { text: () => pvssLog(MOCK_START - 9 * DAY) },
    'WCCILpmon.log': { text: () => entry(MOCK_START - 3 * DAY, 'WCCILpmon', 0, 'SYS', 'INFO', 0, 'pmon started, port 4999') },
    'WCCOActrl1.log': { text: () => ctrlLog(MOCK_START - 2 * 60 * MINUTE, 120) + liveCtrl(), bak: 'WCCOActrl1.bak' },
    'WCCOActrl1.bak': { text: () => ctrlLog(MOCK_START - DAY, 60) },
    'node_5.log': { text: () => 'Process Monitor starting\nlistening for vRPC as ProcessMonitor_SRV_SCADA_01\n' }
  },
  'System1:ProcessMonitor_Node_SRV_SCADA_02': {
    'PVSS_II.log': { text: () => pvssLog(MOCK_START - 26 * 60 * MINUTE) },
    'WCCOAmod6.log': { text: () => entry(MOCK_START - 30_000, 'WCCOAmod', 6, 'IMPL', 'WARNING', 8, 'Modbus slave 3 timeout'), bak: 'WCCOAmod6.bak' },
    'WCCOAmod6.bak': { text: () => entry(MOCK_START - DAY, 'WCCOAmod', 6, 'IMPL', 'INFO', 0, 'Modbus driver started') }
  }
};

const MANAGER_OF = {
  'WCCILpmon.log': { name: 'WCCILpmon', manNum: 0, index: 0 },
  'WCCOActrl1.log': { name: 'WCCOActrl', manNum: 1, index: 4 },
  'WCCOActrl1.bak': { name: 'WCCOActrl', manNum: 1, index: 4 },
  'node_5.log': { name: 'WCCOAjavascript', manNum: 5, index: 8 },
  'WCCOAmod6.log': { name: 'WCCOAmod', manNum: 6, index: 3 },
  'WCCOAmod6.bak': { name: 'WCCOAmod', manNum: 6, index: 3 }
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** The pmon entry a manager request targets (node DP + index ≥ 1), or undefined. */
const entryOf = (body) => {
  const all = instances();
  const inst = all.find((i) => i.dp === body?.node) ?? all[0];
  return Number.isInteger(body?.index) && body.index >= 1 ? inst.managers[body.index] : undefined;
};

const nodeLogs = (node) => LOGS[node] ?? LOGS[instances()[0].dp];

/** Last `n` lines of a text (0 = all), and whether older lines were left out. */
const tail = (text, n) => {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (n <= 0 || lines.length <= n) return { text: text, truncated: false };
  return { text: lines.slice(-n).join('\n') + '\n', truncated: true };
};
const countLines = (text) => text.split('\n').filter((l, i, a) => i < a.length - 1 || l !== '').length;

/** The log-files.js `readLogFiles` reply, on the mock texts (ASCII: characters = bytes). */
const readLogs = (body, whole = false) => {
  const files = nodeLogs(body?.node);
  const names = Array.isArray(body?.files) ? body.files : [];
  if (names.length === 0) throw httpError(400, 'files (log file names) required');
  const unknown = names.filter((n) => !files[n]);
  if (unknown.length > 0) return { ok: false, error: `unknown log file: ${unknown.join(', ')}` };
  const maxLines = whole ? 0 : Number.isInteger(body?.maxLines) ? body.maxLines : 0;
  return {
    ok: true,
    host: body?.node ?? '',
    files: names.map((name) => {
      const text = files[name].text();
      const from = body?.fromOffset?.[name];
      if (!whole && Number.isInteger(from) && from >= 0 && from <= text.length) {
        return { name, text: text.slice(from), offset: text.length, size: text.length, truncated: false, reset: false };
      }
      const t = tail(text, maxLines);
      const out = { name, text: t.text, offset: text.length, size: text.length, truncated: t.truncated, reset: Number.isInteger(from) };
      const bakName = files[name].bak;
      const missing = maxLines > 0 ? maxLines - countLines(t.text) : 0;
      if (body?.mergeBak === true && bakName && (maxLines === 0 || missing > 0)) {
        const b = tail(files[bakName].text(), missing);
        out.bak = { name: bakName, text: b.text, truncated: b.truncated };
      }
      return out;
    })
  };
};

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
  // Issue 40: pmon refuses to delete a running manager; `stopFirst` stops it, then deletes it.
  'POST /api/process-monitor/manager/remove': ({ body }) => {
    const m = entryOf(body);
    if (!m) throw httpError(400, 'index (number ≥ 1) requis — 0 est pmon');
    if (m.state !== 0 && body?.stopFirst !== true) {
      return { ok: false, error: `ERROR SINGLE_MGR:DEL ${m.index} not possible (${m.name} is running)` };
    }
    return { ...ok, index: m.index, ...(m.state !== 0 ? { detail: { stopped: true } } : {}) };
  },
  // Issue 40: SINGLE_MGR:PROP_PUT, checked by the manager — the mock echoes before / after.
  'POST /api/process-monitor/manager/update': ({ body }) => {
    const m = entryOf(body);
    if (!m) throw httpError(400, 'index (number ≥ 1) requis — pmon lui-même ne se modifie pas');
    if (!['manual', 'once', 'always'].includes(body?.startMode)) throw httpError(400, 'startMode (manual|once|always) requis');
    for (const [key, [min, max]] of Object.entries({ secKill: [1, 3600], restartCount: [1, 100], resetMin: [1, 1440] })) {
      const v = body?.[key];
      if (!Number.isInteger(v) || v < min || v > max) throw httpError(400, `${key} (${min}–${max}) requis`);
    }
    const before = { name: m.name, startMode: m.startModeCfg, secKill: m.secKill, restartCount: m.restartCount, resetMin: m.resetMin, options: m.options };
    const after = { name: m.name, startMode: body.startMode, secKill: body.secKill, restartCount: body.restartCount, resetMin: body.resetMin, options: String(body.options ?? '').trim() };
    return { ...ok, index: m.index, warning: '', detail: { before, after, restarted: body.restart === true && m.state !== 0 } };
  },
  'POST /api/process-monitor/restart': () => ok,

  'GET /api/process-monitor/logs': ({ query }) => {
    const files = nodeLogs(query?.node);
    const names = Object.keys(files).sort((a, b) => a.localeCompare(b));
    return {
      ok: true,
      host: query?.node ?? '',
      files: names.map((name) => {
        const size = files[name].text().length;
        const bakOf = names.find((n) => files[n].bak === name) ?? '';
        return { name, size, mtime: new Date().toISOString(), bak: files[name].bak ?? '', bakOf, manager: MANAGER_OF[name] ?? null };
      })
    };
  },
  'POST /api/process-monitor/logs/read': ({ body }) => readLogs(body),
  'POST /api/process-monitor/logs/export': ({ body }) => readLogs(body, true),

  'POST /api/process-monitor/upload/init': () => ({ ok: true, uploadId: 'mock-upload' }),
  'POST /api/process-monitor/upload/chunk': () => ({ ok: true }),
  'POST /api/process-monitor/upload/finalize': ({ body }) => {
    const cleared = Array.isArray(body?.clearFolders) ? body.clearFolders : [];
    const all = instances();
    const targets = body?.target && body.target !== 'all' ? all.filter((i) => i.dp === body.target) : all;
    // A node whose agent does not answer fails on its own, like deploy-transfer.js reports it.
    const results = targets.map(({ system, hostname, status: st }) =>
      st.state === 'agent-unreachable'
        ? { system, hostname, ok: false, cleared: [], skipped: [], error: `agent too old or not reachable over vRPC — update/restart the processMonitor manager on ${hostname}` }
        : { system, hostname, ok: true, cleared, skipped: [] }
    );
    return { ok: results.every((r) => r.ok), results };
  },

  // Issue 39: the manager refuses its own node and any instance whose agent answers.
  'POST /api/process-monitor/instance/delete': ({ body }) => {
    const node = typeof body?.node === 'string' ? body.node.trim() : '';
    if (!node || node === 'all') throw httpError(400, 'node (instance DP) required');
    const target = instances().find((i) => i.dp === node);
    if (!target) return { ok: false, code: 'unknown', error: `unknown instance: ${node}` };
    const head = { dp: target.dp, system: target.system, hostname: target.hostname, lastSeen: target.updated, state: target.status.state };
    if (target.local) return { ok: false, ...head, code: 'local', error: "the aggregator's own node cannot be deleted" };
    if (target.status.state !== 'agent-unreachable') {
      return { ok: false, ...head, code: 'answers', error: 'the agent answers over vRPC: a running agent recreates its DP at once' };
    }
    deleted.add(target.dp);
    return { ok: true, ...head };
  }
};
