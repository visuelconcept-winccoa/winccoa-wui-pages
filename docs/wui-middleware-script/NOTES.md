<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# wui-middleware-script — implementation notes

Read this (and `README.md` + `INTEGRATION.md`) **before editing** the page, the
bridge or the manager. It records the non-obvious contracts.

## DP model — `MiddlewareScript_Task` (3 Strings, two writers)

- `.name` — label (kit DpJsonStore convention).
- `.json` — task CONFIG, written by the PAGE only (store.ts).
- `.status` — execution state `{state, lastRunAt, lastDurationMs, lastError,
  runCount}`, written by the MANAGER only. Two writers → two elements, no
  contention (same validated design as `AppSecurity_Module`).

⚠️ The kit `DpJsonStore.ensureType` creates a 2-element (name/json) type. The
page store (`store.ts ensureTaskType`) therefore ensures the 3-element type
BEFORE the kit probe runs, and the manager's `ensureType` falls back to
`dpTypeChange` — so whichever side runs first, `.status` ends up present.
Keep BOTH ensures in sync if the type ever changes.

## Script contract (the sandbox API)

`(inputs, output, log)` — synchronous body, strict mode:
- `inputs.<alias>` — frozen snapshot of the declared inputs (dpGet before run);
- `output(alias, value)` — the ONLY write path; throws on an undeclared alias.
  The manager maps aliases to DPEs and dpSets AFTER a successful run — a
  thrown script writes nothing;
- `log(…)` — capped at 200 lines, returned by tests, dropped by normal runs;
- allowlisted globals only: Math, JSON, Number, String, Boolean, Array,
  Object, Date, RegExp, Error, isNaN/isFinite/parseFloat/parseInt. No require,
  no process, no timers, no fetch, no eval/`new Function`
  (`codeGeneration: strings=false`).

The page's "syntax OK/error" indicator is a PARSE-ONLY probe
(`new Function(...)` in types.ts, never invoked) — same body wrapping as the
worker, so what parses in the UI parses in the sandbox.

## Sandbox containment — honest limits

`worker_threads` + `node:vm` with a null-prototype context removes ambient
authority and survives run-away code (vm timeout for sync loops + parent
`worker.terminate()` backstop, KILL_GRACE_MS). It is a robust guard against
accidents, **not** a hardened boundary against a determined attacker (vm
escapes exist; allowlisted constructors are host objects). The real control is
WHO can edit scripts: the `edit` role (UI) — and `/test` is enforced
server-side. If a project ever needs true isolation, `isolated-vm` is the
upgrade path (native dependency — deliberate non-default).

## Manager runtime (index.js)

- **Hot reload**: full task re-read every `RELOAD_MS` (10 s), diffed by the
  config JSON string; changed tasks are unwired/rewired, deleted ones torn
  down. No dpConnect on `.json` — polling keeps it simple and also picks up
  brand-new DPs.
- **Stale-callback guard**: each entry carries a `gen`; `unwire` bumps it and
  best-effort `dpDisconnect`s. A late dpConnect callback from a replaced
  generation is a no-op even if the disconnect was unavailable.
- **Run coalescing**: a trigger during a run sets `rerun` — one queued re-run,
  no overlap, no unbounded queue.
- **dpe trigger**: `dpConnect(inputs, answer=false)` + per-task debounce
  (default 200 ms). `answer=false` avoids a run burst at wire-time.
- **Status writes**: `running` at start, `idle`/`error` at end (with duration,
  error, runCount). Disabled tasks get `disabled` at (re)wire time.
- Timeout clamped to [50 ms, 30 s] server-side whatever the config says.

## Test path

Page → `POST /api/middleware-script/test { task, inputValues }` →
`middlewareScriptController` (vRPC stub, stale-stub recreation on error) →
MSA service `MiddlewareScript.Test` → same `runSandbox`, **outputs returned,
never dpSet**. Missing `inputValues` aliases are read live (dpGet). A FAILING
script still answers HTTP 200 (`ok:false` + logs) — only an unreachable
service/manager is an HTTP error (503), which the panel turns into the
"manager démarré ?" hint. The tested task is the CURRENT DRAFT (unsaved edits
included) — deliberate, so you test before saving.

## Page behaviours

- Kit DpJsonStore semantics: offline fallback (in-memory demo task, `offline`
  badge), GxP audit (`AuditTrail_MiddlewareScript`, `updatedAt` excluded from
  diffs).
- Live badges: one `dpConnect` over every task's `.status` (store
  `watchStatuses`), re-issued when the task list changes. No manager → no
  emission → grey dots + "Pas de statut" tooltip.
- The editor works on a DRAFT (`structuredClone`); same-id refreshes keep local
  edits, selecting another task resets. Save validates (`validateTask`) and
  stamps `updatedAt`; Enable is gated by `control`, fields by `edit`, dry-run
  by `test`.

## Application Security (roles)

Declared in `src/app-security.roles.json` (self-registration in
`middleware-script.ts` + Discover): `view`, `edit`, `test`, `control`.
Server-side: only `/test` (`requireRole`) — task CRUD goes through the shared
`/api/para` DP-JSON API which stays open at the API level by convention
(see wui-para NOTES); the page gates those affordances in the UI.
