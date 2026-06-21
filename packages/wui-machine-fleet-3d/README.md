# @visuelconcept/wui-machine-fleet-3d — source module (Tier hub)

The **Machine Fleet 3D** hub page (`/fleet-3d`): a **three.js** 3D fleet view with
per-machine **state/KPI bubbles**, a **stop-cause catalog**, a contextual machine
dashboard (**Gantt + Pareto**), and an **AI assistant** (`/api/ai` bridge).
Ships four managers: `machineSim` (fleet simulation), `kpiCalc` (live KPIs),
`aiAssistant` + `mcpServer` (the AI assistant).

Self-contained **source** distribution: the shared kit is **vendored** under
`machine-fleet-3d/_vendor/` (`wui-kit`, `wui-fleet-core`, `wui-ai-kit` — no separate
`@visuelconcept/*` prerequisite), and the page is built on the target's runtime
workspace, so the bundle always matches its version.

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root> --register-pmon
```
It (1) copies the page source (vendored kit) into the workspace, (2) adds the menu
entries, (3) installs `three` in the workspace, (4) drops the `/api/ai` backend
module into the webserver, (5) deploys + `npm install`s the four managers
(`machineSim`, `kpiCalc`, `aiAssistant`, `mcpServer`) and, with `--register-pmon`,
adds them to `config/progs`, then (6) runs `build:pages` into
`<project>/data/dashboard-wc/`.

## After install (required)
1. **Webserver:** `cd <project>/javascript/customer-webserver && npm run build`, then restart the webserver manager (it auto-mounts `/api/ai`).
2. **Managers:** start **`machineSim`**, **`kpiCalc`**, **`aiAssistant`**, **`mcpServer`** in the WinCC OA console.
3. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** for the target project (the `--workspace`).
- **`@visuelconcept/wui-webserver`** installed in the project (hosts the `/api/ai` backend module via auto-discovery). See `dist-packages/README.md` for the ordered prerequisite chain.
- The npm dep in `module.json.frontend.npmDeps` (**`three`**) is auto-installed into the workspace by the installer.

## Contents
```
module.json / install.mjs
frontend/standalone-pages/machine-fleet-3d.ts + machine-fleet-3d/   (page SOURCE; kit vendored in machine-fleet-3d/_vendor/)
frontend/menu.fragment.jsonc                                       (2 entries: /fleet-3d list + /fleet-3d/:atelier detail)
backend/modules/machine-fleet-3d/                                  index.ts (mount /api/ai + acl) + aiController/aiRoute
manager/machineSim/  manager/kpiCalc/  manager/aiAssistant/  manager/mcpServer/   (Node managers + package.json)
```
