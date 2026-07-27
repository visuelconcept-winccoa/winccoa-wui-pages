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

## Reusable models (instantiation)

`MiddlewareScript_Model_<id>` DPs (plain 2-element name/json kit-store type —
no runtime status) carry: script + declared input/output ALIASES (no DPE) +
declared PARAMETERS with defaults. A task with `modelId` instantiates one:

- **Resolution** happens in the manager at reload time (`resolveTask`): script
  = model script; params = declared defaults overlaid by the instance's
  `task.params`. The hot-reload diff key INCLUDES the resolution, so saving a
  model rewires every instance within ~10 s. A missing model → task status
  `error` ("Modèle introuvable"), never a silent no-op.
- **Contract enforcement** (`ioMatchesModel`, validateTask): the instance's
  binding aliases must exactly cover the model's declared aliases; the UI
  prefills them when picking the model (keeping DPEs already bound to the same
  alias) and locks alias editing (only DPEs bind).
- **Test path**: the page sends the task with the model RESOLVED (script +
  params); the manager's `Test` also resolves `modelId` itself when the script
  comes empty (defense in depth). The model editor tests a pseudo-task built
  from the declarations with the parameter DEFAULTS.
- **Delete guard**: UI-only — the model editor refuses deletion while
  `usageCount > 0`. The manager tolerates a dangling `modelId` anyway (status
  error), because a DP can always disappear behind our back.
- Detaching an instance ("Script propre") copies the model script into the
  task when the task's own script is empty — deliberate fork semantics.

## Script contract (the sandbox API)

`(inputs, output, log, params)` — synchronous body, strict mode:
- `inputs.<alias>` — frozen snapshot of the declared inputs (dpGet before run);
- `output(alias, value)` — the ONLY write path; throws on an undeclared alias.
  The manager maps aliases to DPEs and dpSets AFTER a successful run — a
  thrown script writes nothing;
- `params.<name>` — frozen per-instance constants (model defaults overlaid by
  the task's values; empty object for a task without model unless it sets its
  own `params`);
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
- **Both editors (task + model) stay MOUNTED**, the inactive one hidden with a
  `.hidden` class (same pattern as the para tabs) — drafts survive switching
  the Tasks/Models list. ⚠ Do not "simplify" into a template ternary swapping
  `<wui-ms-editor>` ↔ `<wui-ms-model-editor>`: in the preview harness that
  swap left stale editors in the DOM (lit ChildPart not clearing — suspected
  interaction with the iX loader's HTMLElement shim; not reproducible in a
  minimal lit-only page). The hidden-toggle is deliberate.

## WinCC-OA-free preview (`preview/`)

`libs/wui-middleware-script/preview/` runs the REAL page without any WinCC OA:
esbuild aliases the runtime-only imports to `preview/stubs/*` (in-memory
DpJsonStore, simulated dpGet/dpConnect, granted roles, fetch mock whose
`/test` dry-runs the script browser-side), Siemens iX 2.x comes real from npm
(the runtime generation — `ix-tabs` `selectedChange`; note ix-icons 2.x has no
`start` icon, which is why the Test button uses `play`). `npm run dev` for the
iteration loop, `npm run shots` regenerates the two documentation PNGs
(playwright-core + `PW_CHROMIUM`). It is a preview, not a proof: manager,
sandbox limits, shell and enforcement only exist on a deployed project.

## Application Security (roles)

Declared in `src/app-security.roles.json` (self-registration in
`middleware-script.ts` + Discover): `view`, `edit`, `test`, `control`.
Server-side: only `/test` (`requireRole`) — task CRUD goes through the shared
`/api/para` DP-JSON API which stays open at the API level by convention
(see wui-para NOTES); the page gates those affordances in the UI.
