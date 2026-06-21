# @visuelconcept/wui-asset-lifecycle-intelligence — source module (Tier 3)

**Asset Lifecycle Intelligence** page (`/asset-lifecycle`) for the WinCC OA WebUI
dashboard: an asset domain model + **composite risk-scoring engine** with DP
persistence, plus a **product obsolescence/delivery lookup** (Siemens Product
Information Hub) via the `/api/product-info` bridge to the **`productInfo` MSA
manager**.

Self-contained **source** distribution: the shared kit/fleet-core/ai-kit is
**vendored** under `_vendor/` (no separate `@visuelconcept/wui-kit` prerequisite),
and the page is built on the target's runtime workspace (so the bundle matches its
version).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root> --register-pmon
```
It (1) copies the page source (vendored kit) into the workspace, (2) adds the menu
entry, (3) drops the `/api/product-info` backend module into the webserver,
(4) deploys + `npm install`s the **`productInfo` manager** (and, with
`--register-pmon`, adds it to `config/progs`), then (5) runs `build:pages` into
`<project>/data/dashboard-wc/`.

## After install (required)
1. **Webserver:** `cd <project>/javascript/customer-webserver && npm run build`, then restart the webserver manager (it auto-mounts `/api/product-info`).
2. **Manager:** start **`productInfo`** in the WinCC OA console.
3. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) for the target project (the `--workspace`).
- **`@visuelconcept/wui-webserver`** installed in the project (hosts the `/api/product-info` route via backend-module auto-discovery). See `dist-packages/README.md` for the full ordered prerequisite chain.
- No extra npm deps: `module.json.frontend.npmDeps` is empty (the kit is vendored). Any deps it did list would be auto-installed into the workspace by the installer.

## Contents
```
module.json                                                          manifest (mode: source, tier 3)
install.mjs                                                          installer
frontend/standalone-pages/asset-lifecycle-intelligence.ts           page entry SOURCE
frontend/standalone-pages/asset-lifecycle-intelligence/             sub-components SOURCE (kit vendored in _vendor/)
frontend/menu.fragment.jsonc                                        menu entry (permission: connected)
backend/modules/asset-lifecycle-intelligence/                       /api/product-info module (index.ts + productInfoController/Route)
manager/productInfo/                                                index.js + package.json (productInfo MSA manager)
```
