# @visuelconcept/wui-para — source module

**PARA** datapoint-parametrization page for a WinCC OA WebUI dashboard
(page source + `/api/para` backend module). Distributed as **source** and built
on the target's runtime workspace, so the page bundle always matches the target
runtime version (a page bundle is coupled to the shell's import map).

## Features

- **Modèle (Types)** (model — types) **tab** — an ergonomic, nested tree editor for datapoint
  **types**: add elements / sub-structures, rename, change element type, set a
  `Typeref` target, delete. Creates new types and updates existing ones **in
  place** via `dptype/change` (preserves existing datapoints; renamed elements
  are matched by their original name and carried over with `newName`).
- **Instances & valeurs** (instances & values) **tab** — the master-detail browser (Type→DP→element tree
  + live values & config-attribute editor; create/rename/delete DPs).
- **AI assistant** (header) — *proposal-only*: scoped to PARA modeling, runs with
  **no MCP tools** (`mcpServers: []`, so it never mutates), and can load a
  proposed type model straight into the editor for the user to review and save.
  Reuses `@visuelconcept/wui-ai-kit` and the `/api/ai` bridge.
- **DPL (ASCII) import/export** — tick several DPs and/or DP-types in the
  instances tree and export a WinCC OA `.dpl`, or import one. Runs server-side
  via the **`dplAscii` MSA manager** driving `WCCOAasciiSQLite`.

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
- For **DPL import/export**: the **`dplAscii`** JS manager registered in `config/progs` (e.g. `node | always | 30 | 2 | 2 |dplAscii/index.js`) and restarted. It drives `WCCOAasciiSQLite` via `child_process`, so that binary must be on the project PATH (standard WinCC OA install).
- For the **AI assistant**: the `/api/ai` bridge + the **`aiAssistant`** manager must be deployed (same as the Machine-Fleet pages). Without them the panel still opens but prompts return 5xx. The assistant never uses MCP (it sends `mcpServers: []`).

## Contents
```
module.json                         manifest (mode: source)
install.mjs                         installer
frontend/standalone-pages/para.ts   page entry SOURCE (two tabs + AI assistant)
frontend/standalone-pages/para/     sub-components SOURCE
  para-type-editor.ts                 model (DP-type) nested tree editor
  para-element-types.ts               element-type catalog + ParaStructureNode
  para-ai-assistant.ts / para-ai-context.ts   proposal-only AI assistant
  para-dpl.ts                         DPL import/export client helpers
  para-nav.ts / para-detail.ts / para-config-detail.ts / para-value.ts / para-configs.ts / para-dp-dialog.ts
frontend/menu.fragment.jsonc        menu entry (permission: connected)
backend/modules/para/               /api/para module
  paraController/Route/TypeNode       type/DP engineering (in-process winccoa)
  dplController.ts                    /api/para/dpl/* bridge -> DplAscii MSA service
backend/managers/dplAscii/index.js  MSA manager: DPL export/import via WCCOAasciiSQLite
```
