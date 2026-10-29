<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# wui-process-monitor — notes

The module's contracts are documented in its sources for now: the page (`src/process-monitor.ts`), the
backend route (`backend/processMonitorRoute.ts`, `/api/process-monitor`) and the `processMonitor`
manager (`managers/processMonitor/index.js`, MSA vRPC service `ProcessMonitor_<hostname>`).

## Managers table — the pmon fields

`pmon-client.js` merges `MGRLIST:LIST` (configuration: start mode, `secKill`, restart count, reset
minutes, options) and `MGRLIST:STATI` (live: state, PID, start mode, start time, manager number) by
position. pmon's start time is text in its host's local time (`2026.10.29 10:12:33.123`): the agent,
which runs on that host, turns it into ISO 8601 once (`parsePmonTime`, tolerant of other separators
and of a day-first date). An empty time or the 1970 epoch of a manager that never ran becomes `''`;
a text it cannot read is passed on as is and shown raw, without an uptime. The console shows the start
as date + uptime ("—" when stopped), the manager number (to find its log file), the configured start
mode with a flag when pmon runs it with another one, and the restart settings in that cell's tooltip;
name, state and start time sort on a header click.

## Deploy to the other nodes — vRPC transfer

The page uploads the ZIP in chunks to `<project>/temp` of the webserver's host, then calls `Deploy`
on the `ProcessMonitor_<hostname>` service of that host (the aggregator). Since 0.2.0 the aggregator
ships the ZIP to every OTHER targeted node by calling that node's own `ProcessMonitor_<hostname>`
service (the name is derived from its node DP `ProcessMonitor_Node_<hostname>`), with no datapoint in
between (`managers/processMonitor/deploy-transfer.js`, issue 32):

- `ReceiveBegin {fileName, size, sha256}` → `{ok, transferId}`: the agent opens
  `temp/pm-deploy-<transferId>.zip`;
- `ReceiveChunk {transferId, offset, data, chunkSha256}` → `{ok, received}`: `data` is ONE chunk as a
  base64 string (768 KiB raw, about 1 MiB on the wire; `PM_DEPLOY_CHUNK_BYTES` overrides the raw
  size), read with `fs.createReadStream` — the ZIP is never held whole in memory. The bytes are
  written at `offset`, so a retried chunk is idempotent; a chunk whose hash does not match, a gap or a
  chunk past the announced size is refused. Each chunk is retried up to three times;
- `ReceiveCommit {transferId, sha256, clearFolders, restart}` → `{ok, deployId}`: size and SHA-256 of
  the whole file checked, then `doLocalDeploy` runs asynchronously;
- `DeployStatus {deployId}` → `{state: running | done | failed, cleared, skipped, error}`: polled every
  second with no fixed cap (an agent that answers is alive; ten failed polls in a row fail the node).
  A remote agent fires its `restart` 5 s after reporting the result, so the poll sees "done" first;
- `ReceiveAbort {transferId}`: deletes the temp file. Transfers idle for 30 min are aborted, and the
  `pm-deploy-*.zip` files of a previous run are deleted at startup.

The local node is still deployed last (its `restart` recycles the aggregator and the webserver), and
the `Deploy` reply keeps its shape (`results: [{system, hostname, ok, cleared, skipped, error}]`).

There is no DPE fallback. A node whose agent predates these methods (`Unimplemented`) or whose service
cannot be reached fails on its own with "agent too old or not reachable over vRPC — update/restart the
processMonitor manager on <host>"; the other nodes are deployed. Update and restart the
`processMonitor` manager on every node together. The `.deployCmd` / `.deployData` / `.deployResult`
elements are gone from the `ProcessMonitor_Node` type of a new project; on an existing one the type is
not changed, and the agent empties a leftover `.deployData` at startup so no old ZIP stays in the DP.
Start / stop / restart and the pmon configuration edits still go through `.cmd` / `.cmdResult`.

Not verified on a real system: reaching the service of a node that belongs to ANOTHER system of a
distributed project (the stub is created by name only, like the webserver bridge does), and the MSA
message size limit (the chunk size is kept at about 1 MiB of text for that reason).

## Logs tab — the log files of each host

The Logs tab (role `process-monitor/logs-read`, separate from manager control: logs can hold user
names and addresses) reads the WinCC OA log files of one host, `<project>/log` only. The page asks the
aggregator (`GET /logs?node=`, `POST /logs/read`, `POST /logs/export`, all behind `requireRole`), which
answers for its own node and calls the `ListLogs` / `ReadLog` / `ExportLog` vRPC methods of the TARGET
node's own `ProcessMonitor_<hostname>` service for the others, like the deploy transfer; an agent
without them fails with the same "agent too old or not reachable" message
(`managers/processMonitor/log-files.js`):

- a requested name must be in the folder's listing (`.log`, `.bak`, `.log.bak`, no sub-folder) — never
  a path;
- `maxLines > 0`: the last lines, read from the end in 64 KiB blocks; `fromOffset[name]`: only what was
  written since (a line still being written waits for the next read), `reset: true` when the file was
  rotated; `maxLines` 0 (pause, raw export): the whole file, capped at its last 8 MiB (`truncated`);
- `mergeBak`: the previous rotation comes along on a fresh read, whole or for the lines the current
  file lacks;
- the text is UTF-8, or Latin-1 when it is not valid UTF-8.

In the browser (`src/process-monitor/logs.ts`, unit-tested on WinCC OA samples) a header line
`<manager> (<num>), <date time>, <category>, <severity>, <code>, <text>` starts an entry; other lines
are attached to the entry before them (before the first header, each is its own entry), so a filter
never cuts a multi-line entry. Several files are interleaved by time; the `.bak` comes before its file
with a rotation marker. Filters: categories, minimum severity, free text (case-insensitive, optional
regular expression, matches highlighted). Severities and categories are coloured with theme variables.

**Live** shows the last N lines (100 / 500 / 1000 / 5000) and polls every 2 / 5 / 10 / 30 s with ONE
request for all the selected files, skipped while the previous one runs — never one request or stream
per file (the webserver is HTTP/1.1, a browser opens 6 connections per server). **Pause** stops the
polling and loads the whole files (at most the newest 10 000 entries are drawn; export has them all);
resuming reloads the tail and follows the end again. Exports — the displayed entries as `.log` or CSV
(`time;manager;category;severity;text`), or the raw files (`.bak` merged or not, one file with a
header per log) — are named `logs_<host>_<date>.<ext>` and traced to the audit trail and the History
tab (`EXPORT_LOGS`: user, host, files).

## Host instances — real state checked over vRPC (issue 39)

Each pmon host has its node DP `ProcessMonitor_Node_<hostname>`, created by its agent. The page used
to show its last snapshot whatever its age. Since 0.3.0 every agent answers `Ping()` on its
`ProcessMonitor_<hostname>` service (`managers/processMonitor/instance-state.js`):

`Ping() → {ok, hostname, system, node, version, startedAt, pmon: reachable | unreachable}` — `version`
is the module version (`AGENT_VERSION` in `index.js`, kept equal to `package.json` by a unit test),
`pmon` the result of one `MGRLIST:LIST` with a 1.5 s timeout.

`ListManagers` pings every node DP **in parallel, in the same call** (never one HTTP request per
instance: the browser opens 6 HTTP/1.1 connections per server), 2.5 s timeout per node, the local
node in-process (no stub); pings in flight or under 2 s old are shared by concurrent calls. Each
instance gets `local` (the aggregator's own node) and `status: {state, checkedAt, version, startedAt,
error?}`:

| State | Meaning |
|---|---|
| `connected` | the agent answers and reaches its pmon |
| `pmon-unreachable` | the agent answers, its MGRLIST query fails |
| `agent-too-old` | the service answers `Unimplemented` (status code, or an "unimplemented / unknown function" text) for `Ping`: agent older than 0.3.0 |
| `agent-unreachable` | no answer in time, or no such service: manager stopped, host down, network, host renamed or decommissioned |
| `not-checkable` | a node of ANOTHER system that does not answer: reaching a service of another system by name is not verified (issue 32), so it is never reported as disconnected |

A ping that fails drops the cached stub of that node, so the next refresh reconnects. The agent's
version and start time come from `Ping` only; they are not published in the node DP, because
`ensureNodeType` never changes an existing `ProcessMonitor_Node` type (new elements would be missing
on existing projects).

The page shows a coloured dot on each instance tab, a compact **Instances** list (state, last seen
from `.updated` with its age, agent version, a hint past 7 days, "invalid instances only" filter;
open by itself while an instance is invalid) and, for an instance that is not connected, its last
snapshot greyed with a banner giving the state and the snapshot's age. Start/stop/restart and the
configuration edits are hidden for an `agent-unreachable` instance (nobody reads its `.cmd`).

**Delete instance** — role `process-monitor/manage-instances` (separate from manager control; open
until the admin assigns groups): offered only for an `agent-unreachable` instance, never for the local
node. The confirmation ("Delete instance") names the host, the system and the last-seen date, and
says that the DP and its history are deleted. `POST /instance/delete {node}` (behind `requireRole`)
→ `DeleteInstance` on the aggregator, which matches exactly one node DP (never "all", never a host
guess), refuses the local node, **pings the node again** and refuses unless the agent is still
unreachable (`code: local | answers | not-checkable`), then `dpDelete`s the node DP. The page traces
the attempt to the audit trail and the History tab (`DELETE_INSTANCE`: who, host, system, DP, last
seen). An agent that starts again recreates its DP (`ensureNodeDp`), so deleting a valid instance by
mistake is recoverable.

Not verified on a real system: the MSA status of a call to a function an older agent does not
register (mapped to `agent-too-old` by status code `Unimplemented` or by its text), and how a node of
another system answers (always `not-checkable` when it fails).

## `wui dev` mock — `mock/api.mjs`

The package ships a mock of `/api/process-monitor`, merged by wui-toolkit into any site that selects
the module (`wui dev`, screenshots; wui-toolkit ≥ 0.20).

- `managers` answers three pmon nodes of one system (`SRV-SCADA-01`, the local node, connected, ten
  managers, the S7Plus driver stopped; `SRV-SCADA-02`, four managers, an agent older than 0.3.0;
  `SRV-SCADA-03`, decommissioned: agent unreachable, snapshot nine days old) in the manager's
  `ListManagers` shape — `instances` plus the
  first node's flat `managers` list; `health` reports the vRPC service ready. Every manager carries the
  fields of the managers table: start time (built per request, so the uptimes move; none for a
  stopped manager), manager number, configured and live start mode, restart settings. `WCCOAopcua`
  restarted four minutes ago (a start-time sort brings it up) and `WCCOAmod` on `SRV-SCADA-02` runs
  as `always` while `config/progs` says `once` (the console flags it).
- Start/stop/restart, restart-all, adding/removing a pmon entry and the ZIP upload/deploy are accepted
  and change nothing; a deploy reports success on every targeted node with the folders it would clear,
  except `SRV-SCADA-03`, which fails with the "agent too old or not reachable" message.
- `instance/delete` refuses the local node (`code: local`) and the old agent (`code: answers`) and
  deletes `SRV-SCADA-03` until the dev server restarts.
- Logs: `SRV-SCADA-01` has `PVSS_II.log` (+ `.log.bak`), `WCCILpmon.log`, `WCCOActrl1.log` (+ `.bak`,
  multi-line CTRL errors) and `node_5.log` (lines without a header); `SRV-SCADA-02` has `PVSS_II.log`
  and `WCCOAmod6.log` (+ `.bak`). `WCCOActrl1.log` grows by one entry every 3 s since the mock started,
  for the live tail; reads follow the manager's tail / offset / `.bak` rules.
- The History tab and the audit trail go through `/api/para` (`ProcessMonitor_History`,
  `AuditTrail_ProcessMonitor`), not this mock.
