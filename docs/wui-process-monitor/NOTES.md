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
