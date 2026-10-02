# Integrate the Machine Fleet 3D page (`@visuelconcept-winccoa/wui-machine-fleet-3d`) — source mode, Tier hub

**Standalone WinCC OA WebUI** page: a **three.js 3D view** of the machine fleet (`/fleet-3d`)
with per-machine **status/KPI bubbles**, a **stop-cause catalog**, a contextual machine
dashboard (**gauge cards + Gantt + alarms + Pareto**) and an **AI assistant**
(`/api/ai` bridge).
It is a **complete hub**: frontend + `/api/ai` backend module + **three Node
managers** (`machineSim`, `kpiCalc`, `aiAssistant`). The assistant's MCP tools are
served by an **optional, external** WinCC OA MCP server (ETM
`@etm-professional-control/winccoa-mcp-server`, ISC) — install it separately if you
want them (`npx wui init mcp prod` adds it); it is **not shipped** with this page.
Distributed as the npm package `@visuelconcept-winccoa/wui-machine-fleet-3d`, deployed with
**wui-toolkit** (`wui` CLI): the shared kits (`wui-kit`, `wui-fleet-core`, `wui-ai-kit`,
`wui-alarms-core`) are npm dependencies, and the page is **compiled against the target's
own import map** (bundle = correct version).

## Prerequisites
1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was equipped once with `npx wui init target prod`.
2. The **dashboard webserver** that `npx wui init target prod` installs: it hosts the `/api/ai` route (auto-discovery of backend modules).
3. The npm dependency **`three`** is installed by npm with the package (it is in its `dependencies`).

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use machine-fleet-3d   # npm-installs @visuelconcept-winccoa/wui-machine-fleet-3d (+ kits, three), selects it
npx wui build prod             # pages + menu, /api/ai backend, the 3 managers
npx wui check prod
```
`wui build`:
1. compiles the page (`three` bundled) → `<project>/data/dashboard-wc/pages/`;
2. upserts the **2 menu entries** into `menuconfig.json` (idempotent: `/fleet-3d` + `/fleet-3d/:atelier`);
3. deploys the **backend module** `/api/ai` (the `wui-ai-kit` route files) → `<project>/javascript/customer-webserver/src/modules/machine-fleet-3d/` and rebuilds the webserver;
4. deploys the **3 managers** → `<project>/javascript/{machineSim,kpiCalc,aiAssistant}/` + `npm install`, and appends their lines to `config/progs` when missing.

Managers are resolved **by name** across the installed modules: `kpiCalc` lives in
`@visuelconcept-winccoa/wui-fleet-kpi-analysis` and `aiAssistant` in `wui-ai-kit` — both
dependencies of this package, so `npm install` brings them (installed, not selected).

The AI assistant is OFF by default in the pages: enable it with
`<project>/data/dashboard-wc/dashboard-features.json` = `{ "aiAssistant": true }` —
wui-toolkit does not write that file.

## After install (mandatory)
1. **Webserver**: **restart** the webserver manager (already rebuilt by `wui build`; it auto-mounts `/api/ai`).
2. **Managers**: start **`machineSim`**, **`kpiCalc`**, **`aiAssistant`** in the WinCC OA console. Check the manager order/number (`wui build` appended their `config/progs` lines). (For MCP tools, also run the optional external MCP server — see Notes.)
3. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**.

## Verify
1. Logged in → **"Parc machines 3D"** (3D machine fleet) entry, `/fleet-3d` loads the 3D view (per-machine status/KPI bubbles).
2. `GET https://<dashboard>/api/ai/health` → `ok` response (the AI bridge is mounted).
3. The KPI bubbles update (`machineSim` + `kpiCalc` managers active); the AI assistant responds via `aiAssistant` (MCP tools require the optional external MCP server).

## Notes / security
- The module mounts `/api/ai/*` as **`fullAccess`** (demo) → restrict the `acl` in `<project>/javascript/customer-webserver/src/modules/machine-fleet-3d/index.ts` before production (written once by `wui build`: a hand-tightened acl survives redeploys).
- The **3 managers** need `winccoa-manager`, **provided by the WinCC OA runtime** (not in the manager's `package.json`).
- **AI tokens**: provider tokens are read from the **`AI_Assistant_Config`** DP (or an environment variable) — **none are shipped**. Fill them in before the assistant will work.
- **MCP tools (optional, external)**: `aiAssistant` is the MCP *client*; it reaches an MCP server over HTTP at the URL/token in `AI_Assistant_Config.mcpServers` (default `http://127.0.0.1:3000/mcp`). The MCP *server* is **not bundled** — install/run ETM's `@etm-professional-control/winccoa-mcp-server` (ISC) separately if you want WinCC OA MCP tools. Without it, the assistant still answers but has no tools.
