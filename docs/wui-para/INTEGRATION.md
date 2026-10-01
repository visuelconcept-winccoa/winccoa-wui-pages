# Integrate the PARA page (`@visuelconcept-winccoa/wui-para`) — source mode

**Standalone WinCC OA WebUI page** (Type→DP→element tree + edit/create/
rename/delete). Distributed as the npm package `@visuelconcept-winccoa/wui-para` and deployed
with **wui-toolkit** (`wui` CLI): it is **compiled against the target's own import
map**, so the bundle always matches the runtime version (a page
bundle is coupled to the shell's import map — that's the pitfall we hit: a
pre-built `.js` from another version won't work).

## Prerequisites
1. The project has a **wui-toolkit site** (`<project>/web`) whose `prod` target was equipped once with `npx wui init target prod` (WebUI shell + dashboard webserver).
2. The **dashboard webserver** installed by `npx wui init target prod` (provides `/api/para` via backend module auto-discovery).
3. For **DPL import/export**: the **`dplAscii`** JS manager (`libs/wui-para/managers/dplAscii/index.js`) deployed to the project's `javascript/` and registered in `config/progs` (both done by `wui build`), plus `WCCOAasciiSQLite` on PATH (standard install).
4. For the **AI assistant** (`dependsOn`): the `/api/ai` bridge + the **`aiAssistant`** manager (as used by the Machine-Fleet pages — select `machine-fleet-3d`, which mounts `/api/ai`). The assistant is proposal-only: it uses the configured MCP servers in **read-only** mode (mutating tools filtered out in the manager).

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use para       # npm-installs @visuelconcept-winccoa/wui-para (+ its kits) and selects it
npx wui build prod     # page + menu entry, /api/para backend, dplAscii manager
npx wui check prod
```
`wui build`:
1. compiles `para.js` **against the target's import map** → `<project>/data/dashboard-wc/pages/`;
2. upserts the menu entry (`menu.fragment.jsonc`) into `menuconfig.json` (idempotent);
3. deploys the **backend module** (`libs/wui-para/backend/`, incl. `dplController.ts`, + the shared `appSecurityGuard.ts`) → `<project>/javascript/customer-webserver/src/modules/para/` and rebuilds the webserver;
4. deploys the **`dplAscii`** manager → `<project>/javascript/dplAscii/` and appends its `config/progs` line when missing.

## After install (mandatory)
0. **Backend redeploy** (when iterating on the backend): `npx wui build prod` again copies the para backend files + the machine-fleet-3d `/api/ai` route (`aiController.ts`, shared from `libs/wui-ai-kit/backend/`, when `machine-fleet-3d` is selected) into the project webserver and rebuilds it. It restarts nothing.
1. **Backend**: **restart** the webserver manager (it compiles and auto-mounts the `/api/para` module, incl. the `/api/para/dpl/*` bridge). ⚠️ A successful build alone is not enough — the running webserver keeps the old code in memory until it is **restarted**, so a missed restart leaves `/api/para/dpl/*` returning 404.
2. **DPL manager**: check the `dplAscii` line `wui build` appended to `config/progs` (e.g. `node | always | 30 | 2 | 2 |dplAscii/index.js`) and (re)start it. Required for DPL import/export; the rest of the page works without it.
3. **Browser**: DevTools → Application → Storage → **`Clear site data`**, then reload (**logged in**).
   ⚠️ The service worker caches `menuconfig.json` → **`Ctrl+Shift+R` is NOT enough**, only `Clear site data` purges it. (This is what blocked us.)

## Verify
1. Logged in → the **"Paramétrage"** (parametrization) entry appears, `/para` loads the type tree.
2. `GET https://<dashboard>/api/para/health` → `{ ok, service:"para" }`.
3. Edit a value / create a DP → `POST /api/para/dp/set` (or `/dp/create`) 200.

## Security
The module mounts `/api/para/*` as `fullAccess` (demo). Before prod, restrict the `acl`
in `<project>/javascript/customer-webserver/src/modules/para/index.ts` — written once by
`wui build`, so a hand-tightened acl survives redeploys (e.g. `{ allowUsers: ['root','engineer'] }`).
The page is `permission: ["connected"]` (reserved for logged-in users).
