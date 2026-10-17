<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# wui-process-monitor — notes

The module's contracts are documented in its sources for now: the page (`src/process-monitor.ts`), the
backend route (`backend/processMonitorRoute.ts`, `/api/process-monitor`) and the `processMonitor`
manager (`managers/processMonitor/index.js`, MSA vRPC service `ProcessMonitor_<hostname>`).

## `wui dev` mock — `mock/api.mjs`

The package ships a mock of `/api/process-monitor`, merged by wui-toolkit into any site that selects
the module (`wui dev`, screenshots; wui-toolkit ≥ 0.20).

- `managers` answers two pmon nodes of one system (`SRV-SCADA-01`, ten managers, the S7Plus driver
  stopped; `SRV-SCADA-02`, four managers) in the manager's `ListManagers` shape — `instances` plus the
  first node's flat `managers` list; `health` reports the vRPC service ready.
- Start/stop/restart, restart-all, adding/removing a pmon entry and the ZIP upload/deploy are accepted
  and change nothing; a deploy reports success on every targeted node with the folders it would clear.
- The History tab and the audit trail go through `/api/para` (`ProcessMonitor_History`,
  `AuditTrail_ProcessMonitor`), not this mock.
