<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Engineering Studio — integration

## Manifest

`tools/specs.json` entry (page id `eng-studio`):

```json
{
  "page": "eng-studio",
  "name": "@visuelconcept/wui-eng-studio",
  "title": "Engineering Studio",
  "tier": 3,
  "backend": {
    "mount": "/api/eng",
    "routeClass": "EngRoute",
    "routeFile": "engRoute",
    "srcFiles": ["engController.ts", "engRoute.ts", "engStore.ts", "appSecurityGuard.ts"],
    "vendorPackages": ["@visuelconcept/wui-eng-core"]
  }
}
```

- No dedicated manager — the backend runs against `WsjServerGlobal.winccoa`
  (like para / tag-importer).
- `vendorPackages` — the backend `engController` imports the **pure**
  `@visuelconcept/wui-eng-core` (the shared diff/apply/builders). It is vendored
  next to the `srcFiles` at deploy time, exactly as page **kits** are vendored
  for the frontend (`_vendor/`). Keeping the logic in the core — not re-copied
  into the backend — is the whole point of the decoupling.

## Backend API (`/api/eng`) — role-gated **fail-closed**

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET  | `/health` | — | liveness + the resolved store path |
| GET  | `/roles` | — | the **caller's own** studio grants (what the UI gates on) |
| GET  | `/devices` | `view` | the device registry |
| POST | `/devices` `{devices}` | `manage-devices` | replace the device registry |
| GET  | `/books` | `view` | every address book, re-qualified (roles) |
| GET  | `/books/:id` | `view` | one book |
| POST | `/books/ingest` `{bookId,format,…}` | `manage-devices` | build a book from a file source (`simaticml` \| `xvm` \| `csv`) |
| POST | `/books/:id/refresh` | `manage-devices` | re-run the role rules over the stored book |
| POST | `/books/:id/roles` `{roles}` | `manage-devices` | persist the operator's **manual** role overrides |
| GET  | `/workspace?name=` | `view` | the working copy |
| POST | `/workspace` `{workspace}` | `edit-model` | save the working copy |
| POST | `/checkout` `{name,types?,dpes?}` | `edit-model` | read the project into a workspace **+ baseline fingerprints** |
| GET/POST | `/live` `{types?,dpes?}` | `view` | read the live project into a `LiveSnapshot` |
| POST | `/plan` `{workspace}` | `view` | server-side diff (same engine as the UI) |
| POST | `/test-read` `{dpes}` | `view` | current values via `dpGet` (pre-check-in validation) |
| POST | `/checkin` `{plan,dryRun}` | `checkin` | apply an `EngPlan` (dry-run previews) |

Each route is gated by the **strongest capability it grants, never by its HTTP
verb**: `POST /plan` and `POST /test-read` only read, so they take `view`;
`POST /checkout` writes a workspace file, so it takes `edit-model`.

`/health` and `/roles` are deliberately ungated — the page must be able to tell
"backend absent" from "not allowed", and `/roles` only ever reports the caller's
own grants.

Unlike the **shared** para persistence API (open on purpose, because every page
store uses it), *nothing here is shared* — so every studio route is gated with
`requireRole('eng-studio', …)`. ⚠️ Enforcement is only effective with the
**webserver's own HTTP authentication enabled**: without a session identity the
shared `appSecurityGuard` fails OPEN with a warning (see its header), so on a
default deployment these guards are inert and an API caller bypasses the UI
gating. Enable webserver auth in production.

### Payloads worth knowing

**`POST /books/ingest`** — one shape per generator:

| `format` | required body | source |
|----------|---------------|--------|
| `simaticml` | `documents: [{fileName, xml}]` | TIA Openness `PlcBlock.Export()` bundle |
| `xvm` | `xml` | Control Expert `.XVM` / `.XSY` |
| `csv` | `text` | Control Expert data-editor export (CSV/TSV) |

Optional for all three: `name`, `file` (recorded in the provenance),
`interface: {protocol, connection, …}` — omit it to store a **template catalog**
(bound per equipment at generation time, see NOTES).

**`POST /live` and `POST /plan`** — `dpes` is the **config read-back scope**. Both
the page and the controller derive it from `liveScopeOf(workspace)` in the core:
the union of the workspace's config keys **and its baseline `cfg:` keys**. The
baseline half is what makes a *deletion* visible — a config the user removed from
the workspace is no longer a workspace key, so without it the diff would silently
drop the removal. `/live` is a POST because a DPE list is unbounded (a real
check-out is thousands of them, past any URL length limit); the GET form stays for
a quick types-and-datapoints probe.

## Engineering store (JSON files, not datapoints)

Devices, books, workspaces and role overrides are **engineering** data, so
`engStore.ts` keeps them as files — an address book holds thousands of entries (a
DP string element is the wrong container), and a workspace is meant to be
diffed, backed up and versioned outside the project.

Root, in order: `$ENG_STUDIO_STORE` → `<$WINCCOA_PROJ>/data/eng-studio` →
`./data/eng-studio`. `GET /health` returns the resolved path.

```
devices.json                 Device[]
books/<bookId>.json          AddressBook (entries carry their resolved roles)
books/<bookId>.roles.json    { <entryPath>: SignalRole }  — MANUAL overrides only
workspaces/<name>.json       Workspace (incl. its check-out baseline)
```

Ids are sanitised (`safeId`) so a request can never escape the root, and every
write is temp-file + rename, so a crash never leaves a half-written book.

Manual overrides live in their **own** file on purpose: a book refresh or a
re-ingest replaces the catalog but keeps the overrides, so re-importing a TIA
export never loses the operator's qualification work.

## Runtime coupling (the only places the backend touches OA)

- **Driver number of an address** — `resolveAddressContext` resolves, in order:
  the stored device's explicit `driverNumber`, then auto-detection (running
  managers from `_Connections.Driver.ManNums`, matched on `_Driver<n>.DT`), then
  a **hard error**. Only `OPCUAC` is a verified `DT` value, so S7/Modbus devices
  must carry an explicit `driverNumber` — writing an address to the wrong driver
  breaks the binding *silently*, which is worse than refusing.
- **Poll group** — a polled address needs one; the controller ensures
  `_EngStudio_Poll` (type `_PollGroup`, active, 1000 ms) once per process, or the
  device's own `pollGroup` when it declares one.
- **Config read-back** — 16 attributes per DPE (`configReadPaths`), read in
  batches of 40 DPEs with a per-DPE fallback when a batch fails (one absent DPE
  fails the whole `dpGet`). The raw → `DpeConfigs` mapping is in the core
  (`configsFromRaw`), unit-tested with no runtime; a DPE with no config at all is
  simply **absent** from the snapshot.
- **Diff comparability** — an `AddressConfig` carries `deviceId`/`mode` as studio
  *provenance*: they are never written to OA, so a read-back cannot recover them.
  The diff compares `comparableConfigs()` (written attributes only) — otherwise
  every checked-out address would look permanently modified.

## Application Security

Roles declared in `libs/wui-eng-studio/src/app-security.roles.json` (imported by
the page for `registerModuleRoles`), OPEN until an admin assigns groups:

- `view` — see the page and read the live project;
- `edit-model` — edit the workspace (types/DPs/configs);
- `manage-devices` — declare devices, generate/refresh address books, ingest;
- `checkin` — apply the workspace to the live project.

The page gates its affordances via `hasRole$`; the backend enforces the same on
the write routes.

## Prerequisites

- **Frontend**: none beyond the runtime (the page uses only `lit`).
- **Backend**: `@visuelconcept/wui-webserver` (provides `/api/eng` via backend
  module auto-discovery) + the vendored `@visuelconcept/wui-eng-core`.
- **Write access to the store root** for the webserver's user (see above).
- **Live address binding**: a running driver per device (OPC UA client / S7 /
  Modbus) and, for polled addresses, a poll group. Declare `driverNumber` on every
  non-OPC-UA device — auto-detection is only verified for `OPCUAC`.

## Typecheck the backend without WinCC OA

`backend/tsconfig.typecheck.json` compiles the studio's route modules against the
**real** `@visuelconcept/wui-eng-core` sources, with the webserver-only packages
(`ultimate-express`, `@winccoa/backend`, `winccoa-manager`) stubbed in
`backend/types/runtime-stubs.d.ts`:

```bash
cd libs/wui-eng-core && ./node_modules/.bin/tsc -p ../../backend/tsconfig.typecheck.json
```

That catches the mistakes that matter offline (a wrong core API, a missing
`await`, a bad narrowing). The stubs are dev-only — they are not in any spec's
`srcFiles`, so the deploy resolves the genuine packages.

## ⚠️ Inputs still needed from you (to finish, not to demo)

The demo, docs, screenshots and unit tests need **nothing** — they run offline.
To harden the **SimaticML/TIA** path against real data, please provide:

1. **Real SimaticML exports** (TIA Openness `PlcBlock.Export()` /
   `PlcType.Export()`), dropped in `libs/wui-eng-core/src/samples/` or attached:
   - one **optimized** global DB that references a **UDT**;
   - one **standard** (non-optimized) DB mixing `Bool` / `Int` / `Real` /
     `String[n]` (to validate the offset computation against real offsets);
   - the **UDT** export(s) referenced above.
2. **Ingestion mode** for v1 — watched folder, HTTP `POST`, or both
   (recommended: both — the folder is robust in OT, the POST serves the agent).
3. Confirmation of the **S7 `_datatype` transformation codes** and a
   **standard-DB offset** sample from a live project, to lift the sentinels in
   `drivers/s7.ts` / verify `simaticml/offsets.ts`.
4. A **real Control Expert variables export** (data editor → Export; the native
   `.XVM` XML is welcome too) to calibrate `schneider/variables.ts` on actual
   column sets, plus the WinCC OA **Modbus driver `_datatype` codes** to lift the
   `MODBUS_DATATYPE_UNVERIFIED` sentinel.
5. If a UMAS-based online browse is wanted (Schneider's extended Modbus, FC
   `0x5A`), an explicit go/no-go: it is proprietary and security-sensitive — see
   NOTES.md.

Until (1) and (3) arrive, the S7 SimaticML path stays behind its verification
markers (NOTES "verified vs pending"); OPC UA is already on the verified
tag-importer mapping.

## Verify (once deployed)

1. Logged in → the **"Engineering Studio"** entry appears, `/eng-studio` loads.
2. `GET /api/eng/health` → `{ ok, service: "eng", store: "<path>" }` — check that
   the store path is where you expect it (and writable).
3. `GET /api/eng/live` → `{ ok, snapshot }` with the project's types/DPs.
4. `POST /api/eng/checkout {"name":"test"}` → a workspace with a non-empty
   `baseline`, and `workspaces/test.json` appears in the store.
5. `POST /api/eng/plan {"workspace":<that workspace>}` → an **empty** plan
   (a fresh check-out has nothing to change — if it is not empty, the read-back
   and the write builders disagree; report it, that is a bug, not a setting).
6. A dry-run check-in of a trivial workspace → `ApplyReport` with `dryRun: true`,
   then the same without `dryRun` → the objects appear in the project.
