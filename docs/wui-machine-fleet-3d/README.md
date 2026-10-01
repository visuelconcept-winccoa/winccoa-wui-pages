# @visuelconcept-winccoa/wui-machine-fleet-3d — source module (Tier hub)

The **Machine Fleet 3D** hub page (`/fleet-3d`): a **three.js** 3D fleet view with
per-machine **state/KPI bubbles**, a **stop-cause catalog**, a contextual machine
dashboard (**gauge cards + Gantt + alarms + Pareto**), and an **AI assistant**
(`/api/ai` bridge).
Ships three managers: `machineSim` (fleet simulation), `kpiCalc` (live KPIs),
`aiAssistant` (the AI assistant). The assistant's MCP tools come from an
**optional, external** WinCC OA MCP server (ETM `@etm-professional-control/winccoa-mcp-server`,
ISC) — installed separately, **not shipped** here.

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
`/api/ai` backend module into the webserver and rebuilds it, (4) deploys + `npm install`s
the three managers (`machineSim`, `kpiCalc`, `aiAssistant`) and appends them to
`config/progs` when missing. The AI assistant stays hidden until
`<project>/data/dashboard-wc/dashboard-features.json` holds `{ "aiAssistant": true }` —
wui-toolkit does not write that file.

## After install (required)
1. **Webserver:** restart the webserver manager (already rebuilt by `wui build`; it auto-mounts `/api/ai`).
2. **Managers:** start **`machineSim`**, **`kpiCalc`**, **`aiAssistant`** in the WinCC OA console. (MCP tools need the optional external MCP server — see NOTES.)
3. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- The **dashboard webserver** installed by `npx wui init target prod` (hosts the `/api/ai` backend module via auto-discovery).
- The npm dep **`three`** is in the package's `dependencies`: npm installs it.

## Contents
```
package.json                                                       npm package; wuiPage.backend (mount /api/ai, shared aiController/aiRoute, 3 managers)
src/machine-fleet-3d.ts + src/machine-fleet-3d/                    (page source)
menu.fragment.jsonc                                                (2 entries: /fleet-3d list + /fleet-3d/:atelier detail)
managers/machineSim/                                               Node manager (simulation)
kpiCalc (libs/wui-fleet-kpi-analysis/managers/), aiAssistant + aiController/aiRoute (libs/wui-ai-kit/) — resolved by name at build; MCP server is external/optional
```
