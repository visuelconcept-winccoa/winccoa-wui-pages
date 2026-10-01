# @visuelconcept-winccoa/wui-para — source module

**PARA** datapoint-parametrization page for a WinCC OA WebUI dashboard
(page source + `/api/para` backend module). Distributed as an npm package and built
by **wui-toolkit** against the target's own import map, so the page bundle always
matches the target runtime version (a page bundle is coupled to the shell's import map).

## Features

- **Modèle (Types)** (model — types) **tab** — an ergonomic, nested tree editor for datapoint
  **types**: add elements / sub-structures, rename, change element type, set a
  `Typeref` target, delete. Creates new types and updates existing ones **in
  place** via `dptype/change` (preserves existing datapoints; renamed elements
  are matched by their original name and carried over with `newName`).
- **Instances & valeurs** (instances & values) **tab** — the master-detail browser (Type→DP→element tree
  + live values & config-attribute editor; create/rename/delete DPs, including
  batch-delete of the DPs ticked in the tree).
- **AI assistant** (header) — *proposal-only*: scoped to PARA modeling, runs with
  **read-only MCP tools** (`mcpMode: 'read-only'` — the manager filters out every
  mutating tool, so it can inspect the model but never writes), and can load a
  proposed type model straight into the editor for the user to review and save.
  Reuses `@visuelconcept-winccoa/wui-ai-kit` and the `/api/ai` bridge.
- **DPL (ASCII) import/export** — tick several DPs and/or DP-types in the
  instances tree and export a WinCC OA `.dpl`, or import one. Runs server-side
  via the **`dplAscii` MSA manager** driving `WCCOAasciiSQLite`.

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use para       # npm-installs @visuelconcept-winccoa/wui-para with its kits, selects it
npx wui build prod     # page + menu entry, /api/para backend, dplAscii manager
npx wui check prod
```
`wui build` compiles the page into `<project>/data/dashboard-wc/`, upserts the menu
entry into `menuconfig.json`, deploys the backend module into
`<project>/javascript/customer-webserver/` (and rebuilds it), and deploys the
`dplAscii` manager (appending its `config/progs` line when missing). `wui use` lists the
`dependsOn` (`/api/ai` for the AI assistant): selecting `machine-fleet-3d`, which
mounts it, is up to you.

## After install (required)
1. **Backend:** restart the webserver manager (`wui build` already rebuilt it).
2. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- The **dashboard webserver** installed by `npx wui init target prod` (provides `/api/para` via backend-module auto-discovery).
- For **DPL import/export**: the **`dplAscii`** JS manager registered in `config/progs` (by `wui build`) (e.g. `node | always | 30 | 2 | 2 |dplAscii/index.js`) and restarted. It drives `WCCOAasciiSQLite` via `child_process`, so that binary must be on the project PATH (standard WinCC OA install).
- For the **AI assistant**: the `/api/ai` bridge + the **`aiAssistant`** manager must be deployed (same as the Machine-Fleet pages). Without them the panel still opens but prompts return 5xx. The assistant uses the project's configured MCP servers in **read-only** mode (mutating tools filtered out in the manager), so it can inspect the model without being able to change it.

## Contents
```
package.json                        npm package; wuiPage.backend (mount /api/para, files, manager dplAscii)
src/para.ts                         page entry (two tabs + AI assistant)
src/para/                           sub-components
  para-type-editor.ts                 model (DP-type) nested tree editor
  para-element-types.ts               element-type catalog + ParaStructureNode
  para-ai-assistant.ts / para-ai-context.ts   proposal-only AI assistant
  para-dpl.ts                         DPL import/export client helpers
  para-nav.ts / para-detail.ts / para-config-detail.ts / para-value.ts / para-configs.ts / para-dp-dialog.ts
menu.fragment.jsonc                 menu entry (permission: connected)
backend/                            /api/para module
  paraController/Route/TypeNode       type/DP engineering (in-process winccoa)
  dplController.ts                    /api/para/dpl/* bridge -> DplAscii MSA service
managers/dplAscii/index.js          MSA manager: DPL export/import via WCCOAasciiSQLite
```
