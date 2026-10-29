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

## `wui dev` mock — `mock/api.mjs`

The package ships a mock of `/api/process-monitor`, merged by wui-toolkit into any site that selects
the module (`wui dev`, screenshots; wui-toolkit ≥ 0.20).

- `managers` answers two pmon nodes of one system (`SRV-SCADA-01`, ten managers, the S7Plus driver
  stopped; `SRV-SCADA-02`, four managers) in the manager's `ListManagers` shape — `instances` plus the
  first node's flat `managers` list; `health` reports the vRPC service ready. Every manager carries the
  fields of the managers table: start time (built per request, so the uptimes move; none for a
  stopped manager), manager number, configured and live start mode, restart settings. `WCCOAopcua`
  restarted four minutes ago (a start-time sort brings it up) and `WCCOAmod` on `SRV-SCADA-02` runs
  as `always` while `config/progs` says `once` (the console flags it).
- Start/stop/restart, restart-all, adding/removing a pmon entry and the ZIP upload/deploy are accepted
  and change nothing; a deploy reports success on every targeted node with the folders it would clear.
- The History tab and the audit trail go through `/api/para` (`ProcessMonitor_History`,
  `AuditTrail_ProcessMonitor`), not this mock.
