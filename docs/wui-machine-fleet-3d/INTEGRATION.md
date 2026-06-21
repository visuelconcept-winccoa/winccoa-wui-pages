# Integrate the Machine Fleet 3D page (`@visuelconcept/wui-machine-fleet-3d`) — source mode, Tier hub

**Standalone WinCC OA WebUI** page: a **three.js 3D view** of the machine fleet (`/fleet-3d`)
with per-machine **status/KPI bubbles**, a **stop-cause catalog**, a contextual machine
dashboard (**Gantt + Pareto**) and an **AI assistant** (`/api/ai` bridge).
It is a **complete hub**: frontend + `/api/ai` backend module + **four Node
managers** (`machineSim`, `kpiCalc`, `aiAssistant`, `mcpServer`). **Self-contained source**
distribution: the shared kit is **vendored** under `machine-fleet-3d/_vendor/`
(`wui-kit`, `wui-fleet-core`, `wui-ai-kit` — no `@visuelconcept/*` prerequisites),
and the page is **compiled against the target's runtime workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. **`@visuelconcept/wui-webserver`** installed in the project: it hosts the `/api/ai` route (auto-discovery of backend modules).
3. The npm dependency from `module.json.frontend.npmDeps` (**`three`**) is installed automatically into the workspace by the installer.

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet> --register-pmon
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2 --register-pmon
```
The installer:
1. copies the **source** (kit vendored under `_vendor/`) → `<workspace>/…/standalone-pages/`;
2. inserts the **2 menu entries** → the workspace's `menuconfig.jsonc` (idempotent: `/fleet-3d` + `/fleet-3d/:atelier`);
3. installs **`three`** into the workspace (so `build:pages` bundles it);
4. drops the **backend module** `/api/ai` → `customer-webserver/src/modules/machine-fleet-3d/`;
5. deploys the **4 managers** → `<projet>/javascript/{machineSim,kpiCalc,aiAssistant,mcpServer}/` + `npm install`; with `--register-pmon`, adds their lines to `config/progs`;
6. runs **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## After install (mandatory)
1. **Webserver**: `cd <projet>/javascript/customer-webserver && npm run build`, then **restart** the webserver manager (it auto-mounts `/api/ai`).
2. **Managers**: start **`machineSim`**, **`kpiCalc`**, **`aiAssistant`**, **`mcpServer`** in the WinCC OA console. Check the manager order/number if pmon was edited.
3. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**.

## Verify
1. Logged in → **"Parc machines 3D"** entry, `/fleet-3d` loads the 3D view (per-machine status/KPI bubbles).
2. `GET https://<dashboard>/api/ai/health` → `ok` response (the AI bridge is mounted).
3. The KPI bubbles update (`machineSim` + `kpiCalc` managers active); the AI assistant responds via `aiAssistant`/`mcpServer`.

## Notes / security
- The module mounts `/api/ai/*` as **`fullAccess`** (demo) → restrict the `acl` in `backend/modules/machine-fleet-3d/index.ts` before production.
- The **4 managers** need `winccoa-manager`, **provided by the WinCC OA runtime** (not in the manager's `package.json`).
- **AI tokens**: provider tokens are read from the **`AI_Assistant_Config`** DP (or an environment variable) — **none are shipped**. Fill them in before the assistant will work.
- **`mcpServer`** requires its **own `npm install`** (done by the installer) and a **token** — **none is shipped**.
