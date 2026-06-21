# WinCC OA WebUI Pages — `@visuelconcept/wui-*`

A collection of **redistributable standalone pages** for the WinCC OA
[WebUI Runtime](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Basics.html)
dashboard. Each page is a Lit 3 / [Siemens iX](https://ix.siemens.io/) web component that
plugs into the dashboard shell, displays live WinCC OA process data over WebSocket
([OaRxJsApi](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/apis/oarxjsapi/oarxjsapi_overview.html)),
and — when needed — ships its own webserver module and WinCC OA manager(s).

This repo is the **source of truth**: pages live in `libs/wui-<page>/`, and the
self-contained distributable packages under `packages/` are **generated** from
them (and git-ignored). You develop a page by wiring this repo into a runtime
workspace (see [DEVELOPMENT.md](./DEVELOPMENT.md)); you ship a page by generating
its package and running its installer against a WinCC OA project (see
[Getting Started](#getting-started--deploy-to-a-wincc-oa-project) below).

## Modules

All pages are published under the `@visuelconcept/` scope (e.g.
`@visuelconcept/wui-para`). Source: `libs/wui-<page>/`. Per-page docs:
`docs/wui-<page>/{README,INTEGRATION,NOTES}.md`.

| Module | Route | What it does | Backend |
| --- | --- | --- | --- |
| `wui-asset-lifecycle-intelligence` | `/asset-lifecycle` | Asset risk-scoring with product obsolescence / delivery lookup via the Siemens Product Information Hub | `/api/product-info` + `productInfo` mgr |
| `wui-audit-trail` | `/audit-trail` | Pivot table of a datapoint's NGA-archived value history (configurable period, columns, refresh) | — |
| `wui-camera-streams` | `/camera-streams` | View RTSP IP cameras in-browser over a WebSocket relay (JSMpeg, no plugin) | `/api/rtsp` + `rtspProxy` mgr |
| `wui-fleet-closures` | `/fleet-closures` | Manage fleet non-working days (year / atelier / machine filters, JSON import-export) | — |
| `wui-fleet-kpi-analysis` | `/fleet-kpi` | Per-machine availability & TRS charts, computed live by a manager over opening time minus closures | `kpiCalc` mgr |
| `wui-fleet-stop-analysis` | `/fleet-stops` | Downtime decomposition per stop cause (table + ECharts views) | — |
| `wui-machine-fleet-3d` | `/fleet-3d` | Three.js 3D fleet view with per-machine state/KPI bubbles, contextual Gantt/Pareto, and AI assistant (hub page) | `/api/ai` + `machineSim`, `kpiCalc`, `aiAssistant`, `mcpServer` mgrs |
| `wui-mosaic` | `/mosaic` | Display-wall page embedding other dashboard views as chromeless, same-origin iframes | — |
| `wui-msp` | `/msp` | Frontend-only shell page to grow the MSP feature into | — |
| `wui-para` | `/para` | Datapoint-parametrization page | `/api/para` |
| `wui-production-orders` | `/production-orders` | Production orders CRUD + status workflow + ECharts Gantt + server-side KPI | `productionOrdersKpi` mgr |
| `wui-remote-vnc` | `/remote-vnc` | Manage VNC connections and open them in-browser via bundled noVNC over a WebSocket relay | `/api/vnc` + `vncProxy` mgr |
| `wui-report-builder` | `/report-builder` | Build report instances from templates (data filling, archive aggregations, multi-level signing, print) | — |
| `wui-report-templates` | `/report-templates` | Author report templates (parameterised sections, multi-level signature workflow) | — |
| `wui-thermal-reports` | `/thermal-reports` | Per-charge heat-treatment reports (recipe stages, furnace curves vs. tolerance bands) | — |

- **Frontend-only** pages (`Backend = —`) deploy with just a page build onto the
  shell — no extra webserver module, no manager.
- **Backend** pages additionally ship a webserver module (`/api/*`) and/or one or
  more WinCC OA managers. They require the `@visuelconcept/wui-webserver` layer,
  and managers must be registered in pmon. Their installer wires all of this and
  pulls any extra npm deps (`three`, `@siemens/ix-echarts`, `@cycjimmy/jsmpeg-player`,
  `@novnc/novnc`) automatically.

## Getting Started — deploy to a WinCC OA project

A redistributable page is a **leaf**: it needs a **host stack**. Install bottom-up.

```
[3] Page modules    @visuelconcept/wui-<page>     (para, camera-streams, …)        ← the content
[2] Webserver       @visuelconcept/wui-webserver  (serves data/ + /api, auto-discovers backend modules)
[1] WebUI shell     @wincc-oa/webui-runtime        (data/dashboard-wc/: index.html, entry/ import map, menuconfig, SW)
[0] WinCC OA project 3.21+, webserver.js + WebSocket, Node 22 / npm 10, valid license
```

> A page (`para.js`) **externalizes** lit / `@siemens/ix` / `@wincc-oa/*` / rxjs —
> those come from the shell's **import map** (`index.html` + `entry/*.js`). Without
> layer **[1]** a page has no host and no way to resolve its imports.

### [0] WinCC OA project (base)

- WinCC OA **3.21+**, **Node 22 LTS**, **npm 10+**.
- A project with **webserver.js enabled (WebSocket support)**.
- `config/config`: `[webserverjs] httpsPort` + TLS certificates (the dashboard is served over https).
- A valid **UI license**: **Client** = read/write (view, edit, publish), **Light** = view-only.
  ([Requirements and Licensing](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/Dashboard/topics/Dashboard_Requirements.html).)

### [1] WebUI Runtime shell — the host

The shell is third-party (installed by WinCC OA). In a separate runtime workspace:

```bash
npm install @wincc-oa/webui-runtime
npx webui-runtime-init
npm install --save-dev --no-audit --no-fund
npm run init:oa-data
```

Build + deploy the shell **into the project**:

```bash
# Linux / macOS (bash)
OUT_DIR=<project>/data/dashboard-wc npm run build
```
```powershell
# Windows (PowerShell)
$env:OUT_DIR="<project>\data\dashboard-wc"; npm run build
```

This writes `data/dashboard-wc/`: `index.html` (+ import map), `entry/` (shared
lit/ix/rxjs/wui bundles — what pages externalize), `assets/`, `serviceworker.js`,
`menuconfig.json`, `customstyles.css`, `worker/`, … **Verify**:
`https://<host>:<httpsPort>/data/dashboard-wc/index.html` loads the dashboard.

### [2] Webserver — `@visuelconcept/wui-webserver` (backend pages only)

Required only if you install **backend** pages (those with `/api/*` or a manager).
It serves the dashboard and auto-discovers page backend modules. **One webserver
per httpsPort** — disable the standard `webserver-js/run.js` if it runs.

```bash
node webserver/install.mjs --project <project> [--winccoa <WinCCOA-install>] [--register-pmon]
```

Installs into `<project>/javascript/customer-webserver/`, runs `npm install` + build,
and prints the pmon line. (Details: `webserver/SETUP.md`.)

### [3] Page modules — clone this repo and deploy a page

Pages are distributed **in source** and **compiled on the target's runtime
workspace** (a page bundle is coupled to the shell's version — a `.js` pre-built
against another version won't work).

```bash
git clone https://github.com/visuelconcept/winccoa-wui-pages
cd winccoa-wui-pages
node tools/build-package.mjs tools/specs.json   # (re)generate packages/wui-<page>/  (git-ignored)
```

> `packages/` is generated, not committed. Generate it as above, or fetch it from a Release.

Install a page into your project:

```bash
node packages/wui-<page>/install.mjs --workspace <runtime-workspace> --project <project> [--register-pmon]
```

The installer copies the page source into `<workspace>/…/standalone-pages/`, adds
its entry to the workspace `menuconfig.jsonc` (idempotent by `routeId`), drops any
backend module into `customer-webserver/src/modules/`, deploys any manager(s) into
`<project>/javascript/<manager>/`, and runs the page build into
`<project>/data/dashboard-wc/`. (Per-page specifics: `docs/wui-<page>/INTEGRATION.md`.)

### After install (mandatory)

1. **Backend pages**: `cd <project>/javascript/customer-webserver && npm run build`,
   restart the webserver; start any manager(s) in the WinCC OA console; register
   Tier-3 managers in pmon (installer `--register-pmon`).
2. **Browser**: DevTools → Application → Storage → **`Clear site data`**, then reload
   while logged in. The service worker caches `menuconfig.json`, so **`Ctrl+Shift+R`
   is not enough** — only `Clear site data` purges it.

### Install-order checklist

1. **[0]** WinCC OA 3.21 project + webserver.js/WebSocket + Node 22 / npm 10 + license.
2. **[1]** `@wincc-oa/webui-runtime` → `webui-runtime-init` → `build` (`OUT_DIR=<project>/data/dashboard-wc`) → `init:oa-data`. **← the shell**
3. **[2]** `@visuelconcept/wui-webserver` (only if any page has a backend).
4. **[3]** `@visuelconcept/wui-<page>` × N (the pages).

> **No secrets in the repo**: the PIH key (`ProductInfo_Config` DP / `PRODUCT_INFO_API_KEY`)
> and LLM tokens (`AI_Assistant_Config` DP) are provided on the target, never committed.

## Develop

To work on a page with hot reload, wire this repo into a runtime workspace and run
the Vite dev server against a live WinCC OA. See **[DEVELOPMENT.md](./DEVELOPMENT.md)**
for the dev workspace setup, HMR loop, the "add a new page" convention, the two
build outputs, and the runtime API reference (services, DI, routing, i18n).

## Documentation

- **Per-module** — `docs/wui-<page>/README.md` (overview), `INTEGRATION.md` (install),
  `NOTES.md` (design notes).
- **Technical guides** — `docs/knowledge/` (widget development, customization,
  standalone pages, architecture, Siemens iX, backend integration).
- **Official WinCC OA WebUI Runtime docs**:
  [Overview](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Basics.html) ·
  [Setup & Deployment](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Setup_Deployment.html) ·
  [Customization](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Customization.html) ·
  [Standalone Pages](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Standalone_Pages.html) ·
  [Datapoint Connectivity](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Datapoint_Connectivity.html)

## License

MIT (see [LICENSE](./LICENSE)). Running the pages requires a valid WinCC OA base
package and UI license as described under [Requirements](#0-wincc-oa-project-base).
