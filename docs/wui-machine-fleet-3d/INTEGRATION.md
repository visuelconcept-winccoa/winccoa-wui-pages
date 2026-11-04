# Integrate the Machine Fleet 3D page (`@visuelconcept-winccoa/wui-machine-fleet-3d`) — source mode, Tier hub

**Standalone WinCC OA WebUI** page: a **three.js 3D view** of the machine fleet (`/fleet-3d`)
with per-machine **status/KPI bubbles**, a **stop-cause catalog**, a contextual machine
dashboard (**gauge cards + Gantt + alarms + Pareto**) and an **AI assistant**
(`/api/ai` bridge).
It is a **hub**: frontend + `/api/ai` backend module + the **`aiAssistant`** Node manager
(registered `manual`). Live KPIs (`kpiCalc`) come with the
[`fleet-kpi-analysis`](../wui-fleet-kpi-analysis/INTEGRATION.md) module and simulated production
(`machineSim`, demo only) with the [`machine-sim`](../wui-machine-sim/README.md) module — neither is
deployed with this page. The assistant's MCP tools are
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
npx wui build prod             # pages + menu, /api/ai backend, the aiAssistant manager
npx wui check prod
```
`wui build`:
1. compiles the page (`three` bundled) → `<project>/data/dashboard-wc/pages/`;
2. upserts the **2 menu entries** into `menuconfig.json` (idempotent: `/fleet-3d` + `/fleet-3d/:atelier`);
3. deploys the **backend module** `/api/ai` (the module's `aiRoute.ts` + `fleetAteliers.ts`, `wui-ai-kit`'s `aiController.ts`, `wui-app-security`'s `appSecurityGuard.ts`) → `<project>/javascript/customer-webserver/src/modules/machine-fleet-3d/` and rebuilds the webserver;
4. deploys the **`aiAssistant` manager** → `<project>/javascript/aiAssistant/`, and appends `node | manual | … |aiAssistant/index.js` to `config/progs` when missing (an existing line keeps its mode).

Managers are resolved **by name** across the installed modules: `aiAssistant` lives in
`wui-ai-kit`, a dependency of this package (a kit has no page, so this module deploys it).

Optional companions, selected on their own:
```powershell
npx wui use fleet-kpi-analysis   # kpiCalc manager: live TRS / MTBF / MTTR in the bubbles + the /fleet-kpi page
npx wui use machine-sim          # machineSim manager: simulated production — demo / commissioning only, never production
```

The AI assistant is OFF by default in the pages: enable it with
`<project>/data/dashboard-wc/dashboard-features.json` = `{ "aiAssistant": true }` —
wui-toolkit does not write that file.

## After install (mandatory)
1. **Webserver**: **restart** the webserver manager (already rebuilt by `wui build`; it auto-mounts `/api/ai`).
2. **Manager**: when the AI assistant is enabled, start **`aiAssistant`** in the WinCC OA console (registered `manual`; set it to `always` to have it come back with the project). Check the manager order/number. (For MCP tools, also run the optional external MCP server — see Notes.)
3. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**.

## Upgrading from 0.2
0.2.0 deployed and started (`always`) `machineSim` and `kpiCalc` as well. From 0.3.0: a site that
used the simulation selects `machine-sim` (whose AUTO_MAP is now opt-in), a site that shows live
KPIs selects `fleet-kpi-analysis`. Managers already deployed are neither taken back nor reported
by `wui build`: on a production site, stop `machineSim` and remove its `config/progs` line in the
console — details in [README.md](README.md#upgrading-to-03).

## Verify
1. Logged in → **"Parc machines 3D"** (3D machine fleet) entry, `/fleet-3d` loads the 3D view (per-machine status/KPI bubbles).
2. `GET https://<dashboard>/api/ai/health` → `ok` response (the AI bridge is mounted); `GET https://<dashboard>/api/ai/fleet/workshops` → `{ ok: true, ateliers: [...] }` (the atelier listing for embedding hosts, role `view`).
3. The state and parameter bubbles follow the machines' bound datapoints; configured KPIs show once `kpiCalc` ([`fleet-kpi-analysis`](../wui-fleet-kpi-analysis/INTEGRATION.md)) runs; the AI assistant responds via `aiAssistant` (MCP tools require the optional external MCP server).

## Notes / security
- **Embedding** one atelier in another module (`<wui-fleet-3d-view>`, `GET /api/ai/fleet/workshops`): [EMBEDDING.md](EMBEDDING.md). The atelier routes need the module's `view` role, checked against the caller's verified WebUI token (`backend/fleetGuard.ts`).
- The module mounts `/api/ai/*` as **`fullAccess`** (demo) → restrict the `acl` in `<project>/javascript/customer-webserver/src/modules/machine-fleet-3d/index.ts` before production (written once by `wui build`: a hand-tightened acl survives redeploys).
- The **`aiAssistant`** manager needs `winccoa-manager`, **provided by the WinCC OA runtime** (not in the manager's `package.json`).
- **AI tokens**: provider tokens are read from the **`AI_Assistant_Config`** DP (or an environment variable) — **none are shipped**. Fill them in before the assistant will work.
- **MCP tools (optional, external)**: `aiAssistant` is the MCP *client*; it reaches an MCP server over HTTP at the URL/token in `AI_Assistant_Config.mcpServers` (default `http://127.0.0.1:3000/mcp`). The MCP *server* is **not bundled** — install/run ETM's `@etm-professional-control/winccoa-mcp-server` (ISC) separately if you want WinCC OA MCP tools. Without it, the assistant still answers but has no tools.
