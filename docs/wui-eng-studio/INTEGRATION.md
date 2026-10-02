<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Engineering Studio — integration

## Manifest

`libs/wui-eng-studio/package.json` → `wuiPage.backend` (page id `eng-studio`; the
route sources live in `libs/wui-eng-studio/backend/`; wui-toolkit reads this
contract at `wui build`):

```json
"backend": {
  "mount": "/api/eng",
  "routeClass": "EngRoute",
  "routeFile": "engRoute",
  "files": [
    "engController.ts", "engRoute.ts", "engStore.ts",
    "engOpcuaBrowse.ts", "engS7Browse.ts", "engS7PlusBrowse.ts", "engVrpc.ts"
  ],
  "shared": ["@visuelconcept-winccoa/wui-app-security/appSecurityGuard.ts"],
  "vendorPackages": ["@visuelconcept-winccoa/wui-eng-core"],
  "managers": ["s7Browse", "s7plusBrowse"],
  "notes": ["/api/eng/*"]
}
```

- `shared` — the role guard, sourced from `libs/wui-app-security/backend/` and
  copied into the module folder at deploy time.
- The backend itself runs against `WsjServerGlobal.winccoa` (like para /
  tag-importer) — **except the S7 and S7Plus browse**, which go through the
  dedicated `s7Browse` / `s7plusBrowse` JavaScript managers
  (`managers/`, MSA vRPC services `S7Browse` / `S7PlusBrowse`). The driver's
  browse slot is ONE element per connection, so a walk's requests must be
  serialised by a single long-lived owner — which a webserver, restarted on every
  deploy, cannot be. There is no direct-API fallback on purpose; the routes report
  the manager's absence instead. See [S7PLUS-BROWSE.md](./S7PLUS-BROWSE.md).
- `project-scripts/wui/engStudioService.ctl` is the CTRL side of the project
  writes. **wui-toolkit 0.6.0 deploys no CTRL script**: copy it into
  `<project>/scripts/wui/` and register it in `config/progs` by hand until the
  toolkit grows a slot for it.
- `vendorPackages` — the backend `engController` imports the **pure**
  `@visuelconcept-winccoa/wui-eng-core` (the shared diff/apply/builders). It is vendored
  next to the backend files at deploy time (`_vendor/`). Keeping the logic in the
  core — not re-copied into the backend — is the whole point of the decoupling.

## Backend API (`/api/eng`) — role-gated **fail-closed**

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET  | `/health` | — | liveness + the resolved store path |
| GET  | `/roles` | — | the **caller's own** studio grants (what the UI gates on) |
| GET  | `/devices` | `view` | the device registry, each device decorated with its **live connection state** (read, never stored — see below) |
| GET  | `/devices/state` | `view` | the LIVE fields only (`{states: DeviceStateUpdate[]}`) — what the page's 5 s refresh polls |
| POST | `/devices` `{device}` | `manage-devices` | **create** one device — the **server** derives the id → `201 {device, devices, connectionProvision?}` |
| POST | `/devices/:id` `{device}` | `manage-devices` | **update** that device (`404` if unknown; the body's `id` is ignored) — same `connectionProvision?` |
| DELETE | `/devices/:id` | `manage-devices` | forget one device; **its books are kept** (the relation is N:N) |
| PUT  | `/devices` `{devices}` | `manage-devices` | replace the whole registry (bulk provisioning / migration) |
| GET  | `/connections` | `view` | the project's OPC UA connections (`_OPCUAServer`), browsable |
| GET  | `/drivers` | `view` | every `_Driver<n>` with its `DT` and whether it runs — what the forms OFFER as `driverNumber` |
| POST | `/browse/level` `{connection,nodeId?}` | `view` | **one level** of an address space: the server explorer, and the client-driven walk |
| GET  | `/s7plus/health` | `view` | whether the `s7plusBrowse` manager answers, and which S7Plus drivers it sees running |
| GET  | `/s7plus/connections` | `view` | the project's `_S7PlusConnection`s: state, configured `Config.StationName`, driver number |
| POST | `/s7plus/projects` `{connection}` | `view` | the browsable TIA sources: the exports under `data/TIA_Projects` + the reserved online project |
| POST | `/s7plus/stations` `{connection,project}` | `view` | the stations of one TIA project |
| POST | `/s7plus/level` `{connection,item?,hmiVisibleOnly?}` | `view` | **one level** of an S7Plus station — the station explorer, and the client-driven walk |
| GET  | `/books` | `view` | every address book, re-qualified (roles) minus the signals hidden by hand |
| GET  | `/books/:id` | `view` | one book |
| POST | `/books` `{bookId,name?,interface?}` | `manage-devices` | create an **empty** catalog (declare first, walk into it after) → `201` |
| PUT  | `/books/:id` `{book}` | `manage-devices` | store a book the CLIENT built — the landing point of the progress-reporting walk |
| POST | `/books/ingest` `{bookId,format,…}` | `manage-devices` | build a book from a file source (`simaticml` \| `s7sym` \| `s7awl` \| `xvm` \| `csv` \| `nodeset`) |
| POST | `/s7/probe` `{deviceId}`\|`{host,rack?,slot?}` | `view` | who answers at this address: CPU identity + negotiated PDU size, no block walk |
| POST | `/books/:id/s7-inventory` `{deviceId}`\|`{host,…}` | `view` | read the CPU's **block directory** and cross-check this catalog against it — **writes nothing**, to neither the catalog nor the PLC |
| POST | `/books/browse` `{bookId,connection,…}` | `manage-devices` | walk a LIVE OPC UA server into a book, **server-side in one call** (no progress) |
| POST | `/books/browse-s7plus` `{bookId,connection,station?,…}` | `manage-devices` | same, for an S7-1200/1500 station (`station` defaults to the ONLINE marker) |
| POST | `/books/:id/refresh` | `manage-devices` | re-read the source (re-browse when replayable), else re-run the rules |
| POST | `/books/:id/roles` `{roles}` | `manage-devices` | persist the operator's **manual** role overrides |
| POST | `/books/:id/access` `{access}` | `manage-devices` | persist **manual access overrides** (drives the address direction) |
| POST | `/books/:id/exclude` `{excluded}` | `manage-devices` | HIDE (`true`) or restore (`false`) signals by hand — an override, so a re-walk keeps it |
| DELETE | `/books/:id` | `manage-devices` | forget a catalog and **detach it from every equipment** that used it |
| GET  | `/models` | `view` | the reusable models (structure + mappings, applied to any equipment) |
| POST | `/models` `{model}` | `edit-model` | create or replace one (id derived from the name when absent) |
| DELETE | `/models/:id` | `edit-model` | forget one |
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

**`GET /devices`** — the stored registry, each device carrying a state the server
**read** rather than one it stored:

| field | meaning |
|-------|---------|
| `state` | `connected` \| `disconnected` \| `unknown` — mapped from the raw code with the thresholds the WinCC OA driver panel itself uses (`>= 256` connected, `1`/`5` down, the rest undefined) |
| `stateSource` | why: `connstate` (read on `<connection>.Common.State.ConnState`), `opcua-connstate` (the `_OPCUAServer.State.ConnState` fallback), `unknown-connection`, `ambiguous-connection`, `probe-failed`, `unprobed` |
| `stateConnection` | the connection datapoint (or the reference/address) the state was read on, or looked for |
| `stateCode` | the raw `ConnState`, when one was read — `1` not connected, `3` inactive, `5` failure, `256…260` connected |

**`GET /devices/state`** — the same probe, answering `{ states: [{ id, state, stateSource,
stateConnection, stateCode }] }` and nothing else. It exists because the page refreshes on
a timer: the payload of a call made every few seconds should be proportional to what it
can say, and a full registry landing on a page mid-edit would overwrite the operator's
work. The client merges it by id into the live fields only (the core's
`withDeviceStates`), and turns every lamp grey (`statesUnreadable`) once the refresh has
failed three times in a row.

Nothing is persisted: `normalizeDevice` always stores `state: 'unknown'`, and every
device-mutating route re-reads the state before answering, so a client never has to
guess whether the value it holds is current. A device the declaration cannot tie to
exactly ONE connection stays `unknown` (with the reason) — never `disconnected`, which
is a statement about the machine only a driver may make.

**`POST /devices` / `POST /devices/:id`** — body `{ device: DeviceDraft }`:

```jsonc
{ "device": {
  "name": "Z09_Four2",            // must be a valid WinCC OA identifier: DP names derive from it
  "protocol": "s7plus",           // opcua | s7 | s7plus | modbus — also decides the ACCESS MODE
                                  // (accessModes is accepted but IGNORED: derived as [protocol])
  "connection": { "ip": "192.168.10.21", "rack": 0, "slot": 1 },
  "driverNumber": 3,              // WinCC OA manager number; required in practice outside OPC UA
  "pollGroup": "_EngStudio_Poll",
  "bookIds": ["book-s7-four"]     // N:N — a book may be listed by several devices
} }
```

`connection` keys are **per protocol** and defined by the core's `PROTOCOL_PARAMS`
(`opcua`: `server`\*, `endpoint` — `s7`/`s7plus`: `ip`\*, `rack`, `slot` —
`modbus`: `ip`\*, `port`, `unitId`, `cpu`, `wordOrder`, `zeroBased`; \* = required).
Keys of another protocol are dropped on normalisation, numeric ones are coerced, and
`state` is always stored as `unknown` — only a probe may claim `connected`.

Two Modbus keys are **declarative**: `wordOrder` (`"big"` | `"little"`) and
`zeroBased` (boolean). They are configured on the WinCC OA side — project `config`
file / creation of the connection to the device — and **never written by the studio**;
`_address` has no byte-order attribute. They are stored because they decide how every
register of the book is interpreted. Both are **tri-state**: omit the key for "not
stated"; `false` means "checked, it is not zero-based". An out-of-range `wordOrder` is
refused (`device.param-invalid`).

A refusal is `400 { error, problems }` where `problems` are the core's
`EngWarning`s (`device.name-invalid`, `device.param-required`, …) — the same
objects the form renders, so an API client can localise them the same way.
`device.driver-recommended` is **advisory** and never blocks.

**Connection provisioning.** When an **OPC UA** device declares a `server` the
project has no connection for, the save **creates it**: the `_OPCUAServer`
datapoint (the tag importer's proven write set — `ConnInfo` from the device's
`endpoint`, no security), registered with `_OPCUA<n>` (`n` = the device's
`driverNumber`, else the first running `OPCUAC` driver). The response then carries

```jsonc
"connectionProvision": {
  "name": "Remplisseuse",     // as the device declares it (the _address reference)
  "dp": "_Remplisseuse",      // present when the DP was created
  "created": true,
  "warnings": []              // e.g. no endpoint declared, no driver to register with
}
```

`created: false` + `warnings` when the creation failed — the device save itself
**never** fails on it. Only OPC UA is provisioned: the S7/S7Plus/Modbus connection
config write sets are not verified in this repo, so those connections are still
created on the WinCC OA side.

**Connection security.** An OPC UA declaration may carry `user`, `password`,
`securityPolicy`, `messageMode`, `clientCertificate` and the certificate-relaxation
bits (`allowUnsecured`, `ignoreInvalidCert`, …, `ignoreBasicConstraints`) — the
standard panel's own settings (`Config.AccessInfo`, `Config.Security.*`,
`Config.Flags` bits 8–15, read-modify-write). Only what is declared is written.
The `password` is **write-through**: pushed to the runtime via the vendor's own
`drvsSecSetPassword` (one-shot `WCCOActrl`, secret in the child environment,
encrypted with the project's driver certificate) and NEVER stored — neither in
`devices.json` nor anywhere else the studio owns. The response then carries

```jsonc
"connectionSecurity": {
  "applied": ["user", "policy", "mode", "flags", "password"],
  "passwordSet": true,        // what Config.Password READS BACK, not a hope
  "warnings": []              // e.g. no driver certificate → password refused
}
```

Prerequisites for the password path: the project's **driver certificate** must
exist (`_DriverSecurity.PublicKey` non-empty — create it once in System
Management → Driver certificate; without it the password is refused with that
exact warning, like the standard panel), `WINCCOA_PROJ` must point at the
project (it already does wherever the store works), and the webserver user must
be allowed to start `WCCOActrl` (found via the project config's `pvss_path`).
Every project write of the page (this connection creation and security, plus
datapoints, DP types, configs and poll groups) is performed by the **EngStudio
CTRL manager** over MSA vRPC — `scripts/wui/engStudioService.ctl`, which ships with
the module (`libs/wui-eng-studio/project-scripts/`) and is copied into the project and
registered in `config/progs` by hand (wui-toolkit 0.6.0 deploys no CTRL script), then
started in pmon. See
[CTRL-MANAGER.md](./CTRL-MANAGER.md) for the service surface and the
direct-API fallback. `GET /devices` decorates each OPC UA device with
`passwordSet` (blob non-empty on the live connection), and `GET /health` reports
`manager: {reachable, driverCertificate, …}`.

**`POST /books/ingest`** — one shape per generator:

| `format` | required body | source |
|----------|---------------|--------|
| `simaticml` | `documents: [{fileName, xml}]` | TIA Openness `PlcBlock.Export()` bundle |
| `xvm` | `xml` | Control Expert `.XVM` / `.XSY` |
| `csv` | `text` | Control Expert data-editor export (CSV/TSV) |
| `nodeset` | `xml` | OPC UA NodeSet2 (`UANodeSet`) — companion spec or server export |

Optional for all four: `name`, `file` (recorded in the provenance),
`interface: {protocol, connection, …}` — omit it to store a **template catalog**
(bound per equipment at generation time, see NOTES). `nodeset` **ignores**
`interface` on purpose: a NodeSet's namespace indices are file-local, so it is
always a template catalog.

**`POST /books/browse`** — `{bookId, connection}` required; optional `name`,
`rootNodeId` (defaults to the Objects folder `ns=0;i=85`), `maxDepth`, `maxEntries`,
`maxRequests`, `driverNumber`. It REPLACES a book of the same id — that is what a
re-browse is — and answers `{book, rebrowsed: true, delta?}`, where `delta` lists the
paths `added` / `removed` / `changed` versus the previous version.

`POST /books/:id/refresh` answers the same shape: it replays the parameters recorded
in `provenance.browse` when the book has them, otherwise it only re-runs the role
rules and says so (`rebrowsed: false` + a `note`).

A failed browse answers **502 with the stored book untouched** — a server blink must
never destroy a catalog.

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
books/<bookId>.json          AddressBook (entries carry their resolved roles;
                             `warnings` are structured EngWarning objects — books
                             written before that carried plain strings and are still
                             read, see the core's `asEngWarnings`)
books/<bookId>.roles.json    { <entryPath>: SignalRole }  — MANUAL overrides only
books/<bookId>.access.json   { <entryPath>: 'r'|'w'|'rw' } — MANUAL overrides only
books/<bookId>.excluded.json { <entryPath>: true }        — signals HIDDEN by hand
models/<id>.json             ModelTemplate (structure + bindings — NOT the target
                             or the equipment names: those differ per use)
workspaces/<name>.json       Workspace (incl. its check-out baseline)
```

Ids are sanitised (`safeId`) so a request can never escape the root, and every
write is temp-file + rename, so a crash never leaves a half-written book.

The three manual overrides (roles, access **and** exclusions) live in their **own**
files on purpose: a book refresh or a re-ingest replaces the catalog but keeps the
overrides, so re-importing a TIA export or re-browsing a server never loses the
operator's qualification work. `POST /books/:id/access` accepts `'r' | 'w' | 'rw'`,
and `''` to clear an override; `POST /books/:id/exclude` takes `true` to hide and
`false` to restore.

The **stored book always holds the full reading of the source** — the exclusions are
applied on the way out (`presented()`), never before `saveBook`. That is what makes
hiding reversible: fold it into what is stored and hiding becomes deleting, with
nothing left to restore. A book being *served* additionally carries `excludedPaths`
(and a `book.excluded` warning), so a client can never show a shortened catalog
without saying so.

## Runtime coupling (the only places the backend touches OA)

- **Driver number of an address** — `resolveAddressContext` resolves, in order:
  the stored device's explicit `driverNumber`, then auto-detection (running
  managers from `_Connections.Driver.ManNums`, matched on `_Driver<n>.DT`), then
  a **hard error**. Only `OPCUAC` is a verified `DT` value, so S7/Modbus devices
  must carry an explicit `driverNumber` — writing an address to the wrong driver
  breaks the binding *silently*, which is worse than refusing.
- **Poll group** — a polled address needs one, and only a polled one gets it
  (`_poll_group` is written exactly when the direction is polled). The controller
  ensures the group the leaf names — the three the studio offers, `_Poll_Fast`
  500 ms, `_Poll_Normal` 1 s, `_Poll_Slow` 10 s — else the device's own `pollGroup`,
  else `_EngStudio_Poll` (type `_PollGroup`, active, 1000 ms), created once per
  process. An existing group is never re-timed.
- **OPC UA subscriptions** — a leaf acquired *spontaneously* names one, and the
  studio only **lists** them (`_OPCUASubscription` datapoints, read for
  `/api/eng/config-options`, the leading `_` stripped for the address). It never
  creates or tunes one: the publishing interval, the sampling interval and the
  deadband are attributes of that datapoint (`Config.RequestedPublishingInterval`,
  `Config.MonitoredItems.DataChangeFilter.*`) and are a project-wide decision that
  belongs in PARA. A project with no subscription therefore still works — those
  leaves fall back to polling, with a warning naming each one.
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

## Language

The page renders in EN / FR / DE. In the WinCC OA context the language follows the
**user connection**: the page reads `localStorage['lang']` — the key the WebUI
shell's own translation loader boots lit-translate from — so it needs no
configuration and no `@wincc-oa/*` import. An explicit `lang` attribute on the
element (`<wui-eng-studio lang="de_AT.utf8">`, WinCC OA locale identifiers
accepted) still overrides it; outside the shell the resolution continues with
`?lang=` (demo, screenshots) → `<html lang>` → `navigator.language` → English.
There is no language picker in the UI. Core-generated warnings are localised too
(structured `EngWarning` codes — see NOTES "Localisation: structured warnings").

## Prerequisites

- **Frontend**: none beyond the runtime (the page uses only `lit`).
- **Backend**: the dashboard webserver installed by `npx wui init target prod`
  (provides `/api/eng` via backend module auto-discovery). `@visuelconcept-winccoa/wui-eng-core`
  needs no installation on the webserver — `wui build` vendors it into the module (see "Deployment").
- **Write access to the store root** for the webserver's user (see above).
- **Live address binding**: a running driver per device (OPC UA client / S7 /
  Modbus) and, for polled addresses, a poll group. Declare `driverNumber` on every
  non-OPC-UA device — auto-detection is only verified for `OPCUAC`.
- **Online OPC UA browse**: a `_OPCUAServer` connection **connected** through a
  running OPC UA client manager. The browse writes `_<conn>.Browse.GetBranch` and
  reads the echoed `Browse.*` arrays (the tag importer's proven protocol), so the
  webserver needs write access to that connection datapoint. Browses of one
  connection are queued server-side; a level times out after 60 s.
- **Classic S7 catalogs (S7-300/400)**: nothing — they are built from the STEP 7
  exports (symbol table and/or AWL sources) and need no runtime at all.
- **Checking a classic-S7 catalog against its CPU** (optional): the **`s7Browse`
  JavaScript manager**, started, plus TCP reachability from the WinCC OA host to
  the PLC on **port 102** (ISO-on-TCP) and the equipment's `ip`/`rack`/`slot`
  filled in on its device form. Without the manager the studio hides the action
  and everything else about S7 keeps working — see below.

## Deployment

Deployed with **wui-toolkit** from the WinCC OA project's site (`<project>/web`); the
module is the npm package `@visuelconcept-winccoa/wui-eng-studio` (`src/eng-studio.ts` + its
`menu.fragment.jsonc` + its `package.json#wuiPage.backend`):

```powershell
npx wui init target prod      # once, on a fresh project (WebUI shell + dashboard webserver)
npx wui use eng-studio
npx wui build prod
npx wui check prod
```

`wui build` compiles the page, upserts the menu entry, writes the backend module
descriptor (`src/modules/eng-studio/index.ts` of the dashboard webserver, mount
`/api/eng` — written once, a hand-tightened acl survives redeploys), copies the route
files listed in the manifest's `files` (from `libs/wui-eng-studio/backend/`) and
`shared` (the app-security guard), and rebuilds the webserver. Restart the webserver
manager from the WinCC OA console.

**The core library is vendored into the module.** `engController.ts` imports
`@visuelconcept-winccoa/wui-eng-core` — the engineering domain it shares with the page — and
that specifier does not exist on a customer webserver. Installing it as a package
would not fix it either: the library ships TypeScript sources, and `tsc` does not
*emit* files it reads from `node_modules`, so the import would compile and fail at
runtime. So the manifest declares

```jsonc
"backend": { "vendorPackages": ["@visuelconcept-winccoa/wui-eng-core"] }
```

and `wui build` copies the library's sources to
`modules/eng-studio/_vendor/wui-eng-core/` — where the webserver's own `tsc` compiles
and emits them — then rewrites the bare specifier in the copied route files to
`./_vendor/wui-eng-core/index.js`. Only import/export specifiers are rewritten (a
package name inside a comment stays as written), and `*.spec.ts` files are excluded
(they import vitest, which would break the webserver build).

### The `s7Browse` manager (optional, for the classic-S7 online check)

`package.json#wuiPage.backend.managers` lists `s7Browse`, so `npx wui build` stages
`libs/wui-eng-studio/managers/s7Browse/` into `<project>/javascript/s7Browse/`; register it
in `config/progs`:

```
node             | manual |      30 |        3 |        5 |s7Browse/index.js
```

`manual` on purpose: the manager only answers requests from the studio, so an
operator decides when a project may reach out to its PLCs. Start it in pmon — the
deployer never starts a manager, that is a live-system action — and restart the
webserver so the new routes are loaded.

**Its absence is not a degradation.** The S7 catalogs come from the project's
exports and are complete without it; only the online cross-check needs it, and the
page **hides** that action rather than showing it fail. `GET /api/eng/health`
reports it separately from the CTRL manager:

```jsonc
{ "manager":  { "reachable": true,  … },   // EngStudio CTRL — project writes
  "s7Browse": { "reachable": false } }     // classic-S7 reader — optional
```

**What it can do, and cannot.** Its protocol client implements the S7comm
block-directory subset only: connect, negotiate, read the system-status lists,
count and list blocks, describe a block. **No variable read, no write, no upload,
no run/stop** — so it cannot disturb a production PLC however it is called. That
is why its two routes (`POST /s7/probe`, `POST /books/:id/s7-inventory`) take
`view` rather than `manage-devices`: they read a CPU and store nothing, so they
grant no more than the reads beside them. Full reference and verification status:
[S7-BROWSING.md](./S7-BROWSING.md).

## Typecheck the backend without WinCC OA

`npm test` (wui-toolkit's `wui test`, from the repo root) type-checks the studio's route
modules as the webserver compiles them: against the **real**
`@visuelconcept-winccoa/wui-eng-core` sources (its `vendorPackages`), with the
webserver-only packages (`ultimate-express`, `@winccoa/backend`, `winccoa-manager`)
declared by the toolkit — like every module's backend.

That catches the mistakes that matter offline (a wrong core API, a missing
`await`, a bad narrowing). The declarations are dev-only: on a real webserver the
genuine packages are used and the core is vendored (see "Deployment" above).

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
3. A **standard-DB offset sample** from a live project (the DB's real member
   offsets next to its export) to cross-check `simaticml/offsets.ts`.
   ✅ *Done — the `_datatype` transformation codes of S7, S7Plus and Modbus are no
   longer sentinels*: the `_address` appendix tables you supplied are recorded in
   [VENDOR-ADDRESS-TRANSFORMATIONS.md](./VENDOR-ADDRESS-TRANSFORMATIONS.md) and
   asserted code-by-code in the unit tests. Keep in mind the vendor host
   (`www.winccoa.com`) is **unreachable from our dev/CI containers** — the HTTPS
   proxy rejects the CONNECT with 403 — so that file is the reference we can audit
   against; refresh it from the online help when upgrading WinCC OA.
4. A **real Control Expert variables export** (data editor → Export; the native
   `.XVM` XML is welcome too) to calibrate `schneider/variables.ts` on actual
   column sets, and — per device, since no table settles it — the **byte/word order**
   and the **zero-based-addressing** setting of each Modbus device.
5. If a UMAS-based online browse is wanted (Schneider's extended Modbus, FC
   `0x5A`), an explicit go/no-go: it is proprietary and security-sensitive — see
   NOTES.md.
6. A **real OPC UA NodeSet2** file (a companion spec such as PackML/OPC 30050, or a
   vendor/server export). The reader's fixtures are hand-written `UANodeSet`
   documents following OPC UA Part 6 — faithful to the schema, but not calibrated
   against a vendor file (the OPC Foundation pages return HTTP 403 here).
7. Confirmation, on a real server, of one browse behaviour the driver docs do not
   settle: whether `Browse.BrowsePaths` is a full path from the browse root — that
   would let one request cover several levels instead of one. (The `AccessLevel`
   question is now answered at runtime: the backend introspects the `_OPCUAServer`
   type and logs which branch it took. Send me that log line and I can drop the
   fallback if your driver exposes it.)

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
