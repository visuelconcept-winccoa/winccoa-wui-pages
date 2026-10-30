# @visuelconcept-winccoa/wui-machine-fleet-3d — source module (Tier hub)

The **Machine Fleet 3D** hub page (`/fleet-3d`): a **three.js** 3D fleet view with
per-machine **state/KPI bubbles**, a **stop-cause catalog**, a contextual machine
dashboard (**gauge cards + Gantt + alarms + Pareto**), and an **AI assistant**
(`/api/ai` bridge).
Deploys one manager, `aiAssistant` (the AI assistant), registered `manual`. The assistant's MCP
tools come from an **optional, external** WinCC OA MCP server (ETM
`@etm-professional-control/winccoa-mcp-server`, ISC) — installed separately, **not shipped** here.

Two complementary modules, never deployed with this page:
- **live KPIs** (TRS / MTBF / MTTR in the bubbles and cards): the `kpiCalc` manager of
  [`fleet-kpi-analysis`](../wui-fleet-kpi-analysis/README.md) — `npx wui use fleet-kpi-analysis`;
- **simulated production** (demo, training, commissioning — not production): the `machineSim`
  manager of [`machine-sim`](../wui-machine-sim/README.md) — `npx wui use machine-sim`.

Without them the page works on the machines' real bindings; a configured KPI whose datapoint
does not exist is simply not shown.

Since 0.2, other modules can embed **one atelier's 3D view**, display only, with the public
`<wui-fleet-3d-view atelier="…">` element
(`@visuelconcept-winccoa/wui-machine-fleet-3d/fleet-view.js`), and list the ateliers for a picker
through `GET /api/ai/fleet/workshops` (role `view`) — see [EMBEDDING.md](EMBEDDING.md).

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared kits
(`wui-kit`, `wui-fleet-core`, `wui-ai-kit`, `wui-alarms-core`) come as its npm
dependencies, and the page is built against the target's own import map, so the
bundle always matches its runtime.

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use machine-fleet-3d
npx wui build prod
npx wui check prod
```
`wui use` npm-installs the package with its kits and `three`; `wui build` (1) compiles
the page into `<project>/data/dashboard-wc/`, (2) adds the menu entries, (3) deploys the
`/api/ai` backend module into the webserver and rebuilds it, (4) deploys the `aiAssistant`
manager and appends `node | manual | … |aiAssistant/index.js` to `config/progs` when missing. The AI assistant stays hidden until
`<project>/data/dashboard-wc/dashboard-features.json` holds `{ "aiAssistant": true }` —
wui-toolkit does not write that file.

## After install (required)
1. **Webserver:** restart the webserver manager (already rebuilt by `wui build`; it auto-mounts `/api/ai`).
2. **Manager:** if you enable the AI assistant, start **`aiAssistant`** in the WinCC OA console (set it to `always` to have it come back with the project). (MCP tools need the optional external MCP server — see NOTES.)
3. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Upgrading to 0.3

0.3.0 no longer deploys the `machineSim` and `kpiCalc` managers (0.2.0 deployed and started all
three, `always`):
- a site that **used the simulation** selects [`machine-sim`](../wui-machine-sim/README.md)
  (`npx wui use machine-sim`) — its AUTO_MAP is now opt-in (`--auto-map`);
- a site that shows **live KPIs** selects [`fleet-kpi-analysis`](../wui-fleet-kpi-analysis/README.md)
  (`npx wui use fleet-kpi-analysis`), which owns `kpiCalc` (and the `/fleet-kpi` page the overview
  links to);
- on a site that wants neither (a production site embedding `<wui-fleet-3d-view>`), managers
  already deployed are **not** taken back nor reported by `wui build` (only a module no longer
  selected has its managers listed): stop `machineSim` and remove its `config/progs` line in
  the WinCC OA console, then delete `javascript/machineSim/` (likewise `kpiCalc` if unused). The
  `MachineSim_*` datapoints and the bindings AUTO_MAP wrote stay until you delete / re-bind them.

`aiAssistant` is now registered `manual`; an existing `config/progs` line keeps its mode.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- The **dashboard webserver** installed by `npx wui init target prod` (hosts the `/api/ai` backend module via auto-discovery).
- The npm dep **`three`** is in the package's `dependencies`: npm installs it.

## Contents
```
package.json                                                       npm package; wuiPage.backend (mount /api/ai, own aiRoute + fleetAteliers, shared aiController + appSecurityGuard, manager aiAssistant — manual)
src/machine-fleet-3d.ts + src/machine-fleet-3d/                    (page source)
src/fleet-view.ts                                                  <wui-fleet-3d-view>, public: one atelier's 3D view for other modules (EMBEDDING.md)
backend/aiRoute.ts + backend/fleetAteliers.ts                      /api/ai: the AI bridge (wui-ai-kit's controller) + the read-only atelier routes /fleet/workshops[/:id]
mock/api.mjs + mock/demo-ateliers.json                             wui dev: the atelier routes (mock data's ateliers, else the demo one)
menu.fragment.jsonc                                                (2 entries: /fleet-3d list + /fleet-3d/:atelier detail)
aiAssistant + aiController (libs/wui-ai-kit/) — resolved by name at build; MCP server is external/optional
```
