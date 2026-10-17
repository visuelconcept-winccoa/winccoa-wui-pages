// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * S7Plus Browse — WinCC OA **JavaScript Manager** hosting the MSA (Manager
 * Service API) vRPC service `S7PlusBrowse`: the *one* owner of the S7Plus
 * driver's symbolic browse dialogue.
 *
 * Architecture (mirrors the DplAscii / AiAssistant managers):
 *
 *   WebUI page ──HTTP /api/eng/s7plus/*──▶ dashboard webserver (vRPC stub:
 *                                          libs/wui-eng-studio/backend/engS7PlusBrowse.ts)
 *                                              │  MSA vRPC
 *                                              ▼
 *                                    THIS manager: service "S7PlusBrowse"
 *                                              │  dpSet / dpConnect on
 *                                              │  _<conn>.Browse.*
 *                                              ▼
 *                                    WCCOAs7plus driver ──▶ TIA export file
 *                                                       └─▶ the live S7-1200/1500
 *
 * Register in config/progs (the deployer does it from `specs.json`):
 *
 *   node             | always |      30 |        2 |        2 |s7plusBrowse/index.js
 *
 * ## The protocol, read from the installed WinCC OA 3.21 (never guessed)
 *
 * The driver exposes a single request/response slot on **each connection**
 * datapoint (`_S7PlusConnection.Browse`, verified in
 * `dbdfiles/version_3.21/dptypes.txt` and against the live project):
 *
 *   * write `Browse.GetBranch` = `[requestId, item, hmiVisible]` (dyn_string),
 *   * the driver answers by filling `Browse.NodePaths`, `SystemTypes`,
 *     `ValueTypes`, `ItemLengths`, `NodeComments` — five PARALLEL arrays — and
 *     finally echoes `Browse.RequestId`, which is the completion signal,
 *   * `item` is a `|`-separated path: `''` → the TIA projects, `'<project>'` →
 *     its stations, `'<project>|<station>'` → the station's blocks and tag
 *     tables, `'<project>|<station>|Blocks|<DB>'` → a block's members. The
 *     reserved project `S7Plus$Online` browses the **live PLC** instead of an
 *     export placed under `<proj>/data/TIA_Projects`.
 *
 * Source of every line of that: `panels/para/s7plus_symbolic.pnl`
 * (`treeConnect` / `tabConnect` / the tree's `expanded` callback),
 * `scripts/libs/s7PlusDrvPara.ctl` (`paS7PlusBrowseParams`, `S7PLUS_INOA`),
 * `panels/para/s7plus_engineering.pnl` (`sStationOnline`), and error 00025 of
 * `msg/en_US.utf8/s7plus.cat`. Recorded in `docs/wui-eng-studio/S7PLUS-BROWSE.md`.
 *
 * ## Why a DEDICATED manager and not the webserver
 *
 *  1. **One slot per connection.** `Browse.GetBranch` is a single element: a
 *     second request overwrites the first before its answer arrives, and the
 *     first caller then waits for a reply that will never come. A walk of one
 *     station is hundreds of requests, and two operators may browse at once — so
 *     the requests of a connection MUST be serialised by one owner. A webserver
 *     cannot be that owner: it is restarted on every deploy, and there can be
 *     several of them.
 *  2. **It is a long, chatty conversation with a PLC**, not an HTTP-shaped read.
 *     Keeping it out of the webserver's event loop means a slow station cannot
 *     make the whole dashboard sluggish.
 *  3. **The driver must be running** and the answer is only as good as the
 *     connection's state — diagnosing that (which drivers run, which connection
 *     is up, which station is configured) belongs next to the dialogue itself,
 *     which is what `Health` and `Connections` report.
 *
 * The manager holds **no engineering logic**: it answers one browse LEVEL and
 * lists what can be browsed. Turning levels into an address book (paths, caps,
 * datatypes, warnings) is the pure core's job (`@visuelconcept-winccoa/wui-eng-core`,
 * `s7plus/browse.ts`), unit-tested with a fake port and no runtime.
 *
 * After editing this file, restart the s7plusBrowse manager (like every WinCC OA
 * manager it keeps its old code in memory).
 */
const { WinccoaManager, Vrpc } = require('winccoa-manager');

const winccoa = new WinccoaManager();

const SERVICE_NAME = 'S7PlusBrowse';
/** DP type of an S7Plus connection. */
const CONN_TYPE = '_S7PlusConnection';
/** Prefix a connection datapoint carries (`S7PLUS_INOA` in the vendor's own lib). */
const CONN_PREFIX = '_';
/** Sub-path of the browse slot on a connection datapoint. */
const BROWSE = '.Browse.';
/**
 * One browse must not hang a walk forever. The standard panel gives up after 30 s
 * (`s7plus_symbolic.pnl`: 600 × 100 ms); a station's root level on a large program
 * is the slowest of them, so this is more generous while still bounded.
 */
const BROWSE_TIMEOUT_MS = 60_000;

let requestCounter = 0;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[S7PlusBrowse] ${msg}`);
}

function vrpcError(code, message) {
  return new Vrpc.Error(new Vrpc.Status(Vrpc.StatusCode[code], message));
}

/**
 * Datapoint of a connection, from whatever the caller passed: a bare reference
 * name (`Four2`), the datapoint (`_Four2`) or a fully qualified one
 * (`System1:_Four2`) — `dpNames` answers the last two forms, an `_address`
 * reference the first.
 */
function resolveConnDp(connection) {
  const name = String(connection || '').trim().replace(/\.$/, '');
  if (name === '') throw vrpcError('InvalidArgument', 'connection is required');
  return name.includes(':') || name.startsWith(CONN_PREFIX) ? name : `${CONN_PREFIX}${name}`;
}

/** The reference name of a connection datapoint (`System1:_Four2` -> `Four2`). */
function connectionName(dpName) {
  const full = String(dpName).replace(/\.$/, '');
  const afterSystem = full.includes(':') ? full.slice(full.indexOf(':') + 1) : full;
  return afterSystem.startsWith(CONN_PREFIX) ? afterSystem.slice(CONN_PREFIX.length) : afterSystem;
}

/** First element of a dpGet answer that may or may not come back wrapped. */
function single(value) {
  return Array.isArray(value) ? value[0] : value;
}

/** A `dyn_*` answer as an array, whatever the driver left in the element. */
function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

/**
 * A langString as one string. The manager runs with the default
 * `StringActiveLanguage` format, so a comment normally arrives as a plain string;
 * an object/array form is still handled rather than stringified into `[object
 * Object]` — a wrong DPE description is worse than none.
 */
function langText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return String(value.find((entry) => String(entry ?? '') !== '') ?? '');
  if (typeof value === 'object') {
    const first = Object.values(value).find((entry) => String(entry ?? '') !== '');
    return String(first ?? '');
  }
  return String(value);
}

/** A number the driver may have left empty; `fallback` when it said nothing. */
function asNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---- one browse level -------------------------------------------------------

/**
 * The serialisation, per connection datapoint: the tail of the pending chain.
 * Requests of DIFFERENT connections run concurrently (they use different slots);
 * requests of the SAME one queue, because they do not.
 */
const queues = new Map();

/**
 * One `GetBranch` request/response with request-id correlation.
 *
 * The flow is the standard panel's, in the same order (which matters: the echo is
 * cleared BEFORE the request, so a stale id from a previous browse cannot be
 * mistaken for this answer):
 *
 *   1. `RequestId := ''`
 *   2. subscribe to `RequestId` + the five answer arrays
 *   3. `GetBranch := [requestId, item, hmiVisible]`
 *   4. on every update, re-read the six values and accept the ones whose
 *      `RequestId` is ours.
 */
function browseOnce(connDp, item, hmiVisibleOnly) {
  requestCounter += 1;
  const requestId = `engstudio_${process.pid}_${requestCounter}`;
  const answerDpes = [
    `${connDp}${BROWSE}RequestId`,
    `${connDp}${BROWSE}NodePaths`,
    `${connDp}${BROWSE}SystemTypes`,
    `${connDp}${BROWSE}ValueTypes`,
    `${connDp}${BROWSE}ItemLengths`,
    `${connDp}${BROWSE}NodeComments`
  ];
  return new Promise((resolve, reject) => {
    let connId = null;
    let timer = null;
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (connId !== null) {
        try {
          winccoa.dpDisconnect(connId);
        } catch {
          /* the subscription may already be gone */
        }
        connId = null;
      }
    };
    const fail = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    timer = setTimeout(() => {
      if (done) return;
      cleanup();
      reject(
        new Error(
          `browse of '${item}' timed out after ${BROWSE_TIMEOUT_MS / 1000}s — is the S7Plus driver running and the connection up?`
        )
      );
    }, BROWSE_TIMEOUT_MS);

    const onUpdate = async () => {
      if (done) return;
      try {
        const values = await winccoa.dpGet(answerDpes);
        if (String(values[0] ?? '') !== requestId) return; // another request's answer
        const nodePaths = asArray(values[1]);
        const systemTypes = asArray(values[2]);
        const valueTypes = asArray(values[3]);
        const itemLengths = asArray(values[4]);
        const comments = asArray(values[5]);
        const nodes = [];
        for (let i = 0; i < nodePaths.length; i += 1) {
          const nodePath = String(nodePaths[i] ?? '');
          // The driver pads a level with empty slots when a query matched nothing.
          if (nodePath === '') continue;
          nodes.push({
            nodePath,
            systemType: String(systemTypes[i] ?? ''),
            valueType: String(valueTypes[i] ?? ''),
            itemLength: asNumber(itemLengths[i], -1),
            comment: langText(comments[i])
          });
        }
        cleanup();
        resolve(nodes);
      } catch (error) {
        fail(error);
      }
    };

    // Clear the echo first, then subscribe, then ask. Reversing the first two
    // would let the answer of a PREVIOUS browse satisfy this one.
    winccoa
      .dpSetWait(`${connDp}${BROWSE}RequestId`, '')
      .then(() => {
        if (done) return;
        connId = winccoa.dpConnect(onUpdate, answerDpes, false);
        // `hmiVisible` is the driver's third parameter: 1 = only the elements
        // flagged "Visible in HMI Engineering" in TIA.
        return winccoa.dpSetWait(`${connDp}${BROWSE}GetBranch`, [requestId, item, hmiVisibleOnly ? 1 : 0]);
      })
      .catch(fail);
  });
}

/** Queue a browse behind whatever is already running on that connection. */
function browseLevel(connection, item, hmiVisibleOnly) {
  const connDp = resolveConnDp(connection);
  const previous = queues.get(connDp) ?? Promise.resolve();
  // Chain on SETTLE, not on success: one failed browse must not poison the queue.
  const run = previous.then(
    () => browseOnce(connDp, item, hmiVisibleOnly),
    () => browseOnce(connDp, item, hmiVisibleOnly)
  );
  queues.set(
    connDp,
    run.catch(() => undefined)
  );
  return run;
}

// ---- service methods --------------------------------------------------------

/**
 * Running S7Plus driver manager numbers, or `null` when the answer is unknown.
 *
 * The vendor's own test, ported: the running manager numbers come from
 * `_Connections.Driver.ManNums` and each is kept when `_Driver<n>.DT` equals
 * `S7PLUS` case-insensitively — `drvsCheckRunningDrvNums("S7PLUS", false)` in
 * `scripts/libs/driverSettings.ctl`, called that way by `s7PlusDrvPara.ctl`.
 *
 * It matters for a browse: the driver answers `GetBranch`, so a stopped driver
 * makes every browse time out (the standard panel refuses to open the symbolic
 * selection at all — `tiaDrvNumForSym`: "The S7+ driver with number $1 must be
 * started to use symbolic configuration!"). `null` (could not tell) is NOT
 * reported as "none running": a diagnosis this manager could not make must not
 * become a claim.
 */
async function runningS7PlusDrivers() {
  let managerNumbers;
  try {
    const value = await winccoa.dpGet('_Connections.Driver.ManNums');
    managerNumbers = asArray(value)
      .map((entry) => asNumber(entry, Number.NaN))
      .filter((entry) => Number.isFinite(entry));
  } catch {
    return null;
  }
  const numbers = [];
  for (const number of managerNumbers) {
    try {
      const type = String(single(await winccoa.dpGet(`_Driver${number}.DT`)) ?? '');
      if (type.toUpperCase() === 'S7PLUS') numbers.push(number);
    } catch {
      // An unreadable DT says nothing about that driver; the others still count.
    }
  }
  return numbers;
}

/**
 * The project's S7Plus connections, with what decides whether a browse can work
 * at all: the driver number, the connection state and the configured station.
 *
 * `Config.StationName` is the source the standard panel itself browses with — a
 * `project|station` pair, or the reserved online marker. Reporting it means the
 * page can OFFER the station already configured on the WinCC OA side instead of
 * asking an engineer to retype it.
 */
async function connections() {
  const dps = winccoa.dpNames('*', CONN_TYPE) ?? [];
  const result = [];
  for (const dpName of dps) {
    const dp = String(dpName).replace(/\.$/, '');
    const entry = { name: connectionName(dp), dp, connected: false };
    try {
      const values = await winccoa.dpGet([
        `${dp}.State.ConnState`,
        `${dp}.Config.StationName`,
        `${dp}.Config.DrvNumber`,
        `${dp}.Config.Address`,
        `${dp}.Common.State.ConnState`
      ]);
      const state = asNumber(single(values[0]), undefined);
      const commonState = asNumber(single(values[4]), undefined);
      if (state !== undefined) entry.connState = state;
      if (commonState !== undefined) entry.commonConnState = commonState;
      // The driver panel's own reading (`setCommonConnStateShape`): >= 256 up,
      // 1/5 down, anything else says nothing. `Common.State.ConnState` is the
      // element every connection type carries, so it is the one compared.
      entry.connected = commonState !== undefined && commonState >= 256;
      const station = String(single(values[1]) ?? '');
      if (station !== '') entry.station = station;
      const drvNumber = asNumber(single(values[2]), undefined);
      if (drvNumber !== undefined && drvNumber > 0) entry.driverNumber = drvNumber;
      const address = String(single(values[3]) ?? '');
      if (address !== '') entry.address = address;
    } catch (error) {
      // An unreadable connection is REPORTED, not fatal: the others are still
      // browsable, and a page that shows nothing teaches nothing.
      entry.error = error instanceof Error ? error.message : String(error);
    }
    result.push(entry);
  }
  return { ok: true, connections: result };
}

async function health() {
  const drivers = await runningS7PlusDrivers();
  let count = 0;
  try {
    count = (winccoa.dpNames('*', CONN_TYPE) ?? []).length;
  } catch {
    count = 0;
  }
  let system;
  try {
    system = winccoa.getSystemName();
  } catch {
    system = undefined;
  }
  return {
    ok: true,
    service: SERVICE_NAME,
    ...(system === undefined ? {} : { system }),
    connections: count,
    // Absent when it could not be read — never an empty list, which would read as
    // "no S7Plus driver runs" and send an engineer looking for the wrong problem.
    ...(drivers === null ? {} : { drivers })
  };
}

/**
 * The browsable SOURCES of a connection: the TIA project exports the driver
 * found under `<proj>/data/TIA_Projects`, plus the reserved ONLINE project.
 *
 * The online entry is always offered — the driver reports it only as a station of
 * its own reserved project, and an engineer who wants to read the running PLC
 * must not have to know that name.
 */
async function projects(req) {
  const nodes = await browseLevel(req.connection, '', req.hmiVisibleOnly !== false);
  const found = nodes
    .filter((node) => node.systemType === 'Project')
    .map((node) => ({ name: node.nodePath.split('|')[0], online: node.nodePath.split('|')[0] === 'S7Plus$Online' }));
  const hasOnline = found.some((project) => project.online);
  return {
    ok: true,
    projects: hasOnline ? found : [...found, { name: 'S7Plus$Online', online: true }]
  };
}

/** The stations of one TIA project (`SystemTypes = 'Station'`). */
async function stations(req) {
  const project = String(req.project || '').trim();
  if (project === '') return { ok: false, error: 'project is required' };
  const nodes = await browseLevel(req.connection, project, req.hmiVisibleOnly !== false);
  const found = nodes
    .filter((node) => node.systemType === 'Station')
    .map((node) => {
      const name = node.nodePath.split('|')[0];
      return { name, station: `${project}|${name}` };
    });
  return { ok: true, stations: found };
}

/** One level, exactly as the driver reports it — the core walker's port. */
async function level(req) {
  const item = req.item === undefined || req.item === null ? '' : String(req.item);
  const nodes = await browseLevel(req.connection, item, req.hmiVisibleOnly !== false);
  return { ok: true, item, nodes };
}

// ---- MSA vRPC service -------------------------------------------------------

class S7PlusBrowseService extends Vrpc.ServiceBase {
  constructor() {
    super(SERVICE_NAME);
    this.registerFunction('Health', (ctx, request) => this.handle(ctx, request, health));
    this.registerFunction('Connections', (ctx, request) => this.handle(ctx, request, connections));
    this.registerFunction('Projects', (ctx, request) => this.handle(ctx, request, projects));
    this.registerFunction('Stations', (ctx, request) => this.handle(ctx, request, stations));
    this.registerFunction('Level', (ctx, request) => this.handle(ctx, request, level));
  }

  async handle(serverContext, request, fn) {
    serverContext.cancelSignal.throwIfAborted();
    if (!request.isString() || request.isNull()) {
      throw vrpcError('InvalidArgument', 'the request must be a JSON string');
    }
    let req;
    try {
      req = JSON.parse(request.getString());
    } catch {
      throw vrpcError('InvalidArgument', 'invalid request JSON');
    }
    let result;
    try {
      result = await fn(req ?? {});
    } catch (error) {
      // A browse that failed is an ENGINEERING answer (driver stopped, PLC
      // unreachable, unknown item), not a transport fault: it comes back as
      // `{ok:false,error}` so the page can show it. Only a malformed call throws.
      const message = error instanceof Error ? error.message : String(error);
      log(`browse failed: ${message}`);
      result = { ok: false, error: message };
    }
    return Vrpc.Variant.createString(JSON.stringify(result));
  }
}

async function run() {
  log('starting the S7Plus browse service (MSA vRPC)…');
  const container = new Vrpc.ServiceContainer();
  container.registerService(new S7PlusBrowseService(), new Vrpc.ServiceOptions());
  try {
    await container.startAllServices();
    log(`service "${SERVICE_NAME}" started.`);
  } catch (error) {
    log(`failed to start the service: ${error}`);
  }
}

run().catch((error) => log(`fatal: ${error}`));
