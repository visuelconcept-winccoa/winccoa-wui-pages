<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-process-monitor

## 0.4.0 — 2026-11-05

**Upgrade.** Update the **aggregator first** (the processMonitor manager of the webserver's
host), then the other hosts, and restart each processMonitor manager. For this version only,
an agent older than 0.4.0 is still driven through its node DP (`.cmd` / `.pmon`); a 0.4.0
agent no longer publishes `.pmon`, so an aggregator left in 0.3.0 would show its list frozen.
The fallback goes with the next version.

- **Commands over vRPC** (#53): start, stop, restart, restart-all, add, remove and edit go to
  the target host's `Control` function, answered when pmon is done — no more `.cmd` written
  and `.cmdResult` polled.
- **Lists read now** (#52, #53): `ListManagers` asks each host (`ListLocal`, in parallel with
  the pings); the list right after an add is the real one. A host that stops answering keeps
  its last list in the aggregator's memory, with its age.
- **Node DP = registry only**: hostname, system and an `.updated` heartbeat every 60 s (last
  seen, refresh trigger).
- **Trace written by the manager** (#53): the audit line (`AuditTrail_ProcessMonitor`) and the
  History entry (`ProcessMonitor_History`) are written by the manager that runs the operation,
  one at a time, with the webserver's session user, else the user the page declares; the
  History tab reads `GET /history`; a logs export is traced through `POST /logs/exported`.
- **The agent restarting itself**: it answers, then exits and pmon starts it again — in start
  mode `always` only; a stop of itself is refused.
- **Add a manager — type list** (#51): the usual executables (`WCCOAjavascript` for a
  JavaScript manager) and those the host already runs, "Other…" for a free name, an options
  hint per type.

Details: `docs/wui-process-monitor/NOTES.md`, "Commands, lists and trace over vRPC".

Earlier versions: see the git history (`libs/wui-process-monitor`).
