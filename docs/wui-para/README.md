# @visuelconcept/wui-para — source module

**PARA** datapoint-parametrization page for a WinCC OA WebUI dashboard
(page source + `/api/para` backend module). Distributed as **source** and built
on the target's runtime workspace, so the page bundle always matches the target
runtime version (a page bundle is coupled to the shell's import map).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root>
```
- `--workspace` = the `@wincc-oa/webui-runtime` workspace that builds this project's dashboard (e.g. `…/WebDemo2/webui-workspace`).
- `--project` = the WinCC OA project root (its `data/dashboard-wc/` is the deploy target; its `javascript/customer-webserver/` hosts the backend).

It copies the page source into the workspace, adds the menu entry to the
workspace's `menuconfig.jsonc`, drops the backend module into the webserver, and
runs `build:pages` (deploying into `<project>/data/dashboard-wc/`).

## After install (required)
1. **Backend:** `cd <project>/javascript/customer-webserver && npm run build`, then restart the webserver manager.
2. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** for the target project (the `--workspace`).
- **`@visuelconcept/wui-webserver`** installed in the project (provides `/api/para` via backend-module auto-discovery). See `dist-packages/README.md` for the full ordered prerequisite chain.

## Contents
```
module.json                         manifest (mode: source)
install.mjs                         installer
frontend/standalone-pages/para.ts   page entry SOURCE
frontend/standalone-pages/para/     sub-components SOURCE
frontend/menu.fragment.jsonc        menu entry (permission: connected)
backend/modules/para/               /api/para module (index.ts + paraController/Route/TypeNode)
```
