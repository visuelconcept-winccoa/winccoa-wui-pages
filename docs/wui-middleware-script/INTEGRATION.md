<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Integrate the Middleware-Script page (`@visuelconcept/wui-middleware-script`)

**Standalone WinCC OA WebUI page** + backend bridge + executing manager.
Distributed as **source** (compiled against the target's runtime workspace,
like every page of this repo).

## Prerequisites

1. A **WebUI Runtime workspace** building the target dashboard.
2. **`@visuelconcept/wui-webserver`** installed (backend module auto-discovery).
3. The **`wui-para` backend** (`/api/para`) — the page persists its
   `MiddlewareScript_Task` DPs through the shared DP-JSON API.
4. Node 22 on the target (manager + worker_threads sandbox).

## Deploy (dev, from this repo)

1. **Frontend**: the page builds with `npm run build:pages` (or deploy a curated
   set with `node tools/scripts/deploy-release.mjs --project <root>` and tick
   `middleware-script`).
2. **Backend**: `npm run deploy:backend -- --project <root> --only middleware-script`
   copies `middlewareScriptController.ts`, `middlewareScriptRoute.ts` and
   `appSecurityGuard.ts` into the project webserver and rebuilds it. Then
   **restart the webserver manager** (a successful build alone keeps the old
   code in memory — `/api/middleware-script/*` stays 404 until the restart).
3. **Manager**: copy `backend/managers/middlewareScript/` (BOTH `index.js` and
   `sandbox-worker.js`) into the project's `javascript/` and register it in
   `config/progs`:

   ```
   node | always | 30 | 2 | 2 |middlewareScript/index.js
   ```

   Start it in pmon. After editing the manager, **restart** it.
4. **Browser**: DevTools → Application → Storage → **`Clear site data`**, then
   reload logged-in (the service worker caches `menuconfig.json`; Ctrl+Shift+R
   is NOT enough).

## Verify

1. Logged in → the **"Middleware Script"** entry appears; `/middleware-script`
   lists tasks (empty at first).
2. `GET /api/middleware-script/health` → `{ ok, service: "middleware-script", vrpc: true }`.
3. Create a task, add an input+output, write `output('out1', 1)`, open the
   **Test** tab → Run: outputs/logs/duration come back (503 = manager not
   running or vRPC unavailable).
4. Enable the task → within ~10 s the list badge turns green (`.status` written
   by the manager); trigger an input change (or wait for the period) and check
   the output DPE.

## Security

- `/test` is gated server-side (`requireRole('middleware-script', 'test')`);
  UI affordances are gated by `edit` / `control` / `test`. All roles are OPEN
  until an admin assigns groups in `/app-security` — assign them before
  production, `edit` above all: **whoever can edit scripts drives the
  manager's dpSet within the declared outputs**.
- The sandbox removes ambient authority (no require/process/network/DP API,
  declared-outputs-only writes, hard timeout), but treat it as an
  accident guard, not a hardened boundary — the `edit` role is the real
  control (see NOTES.md).
- The page is `permission: ["connected"]`.
