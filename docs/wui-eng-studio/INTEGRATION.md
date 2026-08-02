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
    "srcFiles": ["engController.ts", "engRoute.ts", "appSecurityGuard.ts"],
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
| GET  | `/health` | — | liveness |
| GET  | `/live` | `view` | read the live project into a `LiveSnapshot` (check-out / diff) |
| POST | `/test-read` `{dpes}` | `view` | current values via `dpGet` (pre-check-in validation) |
| POST | `/checkin` `{plan,dryRun}` | `checkin` | apply an `EngPlan` (dry-run previews) |
| POST | `/addressbook/ingest` `{deviceId,documents}` | `manage-devices` | ingest a SimaticML bundle → address book |

Unlike the **shared** para persistence API (open on purpose), the studio's write
routes are gated with `requireRole('eng-studio', …)` — check-in is a
studio-scoped, powerful operation. ⚠️ Enforcement is only effective with the
**webserver's own HTTP authentication enabled**: without a session identity the
shared `appSecurityGuard` fails OPEN with a warning (see its header). Enable
webserver auth in production.

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
- **Live address binding** (later increment): a running driver per device
  (OPC UA client / S7) and a poll group — resolved by `resolveAddressContext`
  (currently a static skeleton).

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
2. `GET /api/eng/health` → `{ ok, service: "eng" }`.
3. `GET /api/eng/live` → `{ ok, snapshot }` with the project's types/DPs.
4. A dry-run check-in of a trivial workspace → `ApplyReport` with `dryRun: true`.
