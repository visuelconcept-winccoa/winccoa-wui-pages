# Integrate the Asset Lifecycle Intelligence page (`@visuelconcept/wui-asset-lifecycle-intelligence`) — source mode, Tier 3

**Standalone WinCC OA WebUI page** (`/asset-lifecycle`): asset domain model
+ **composite risk scoring engine** with DP persistence, and
**obsolescence/lead-time lookup** (Siemens Product Information Hub).
This is a **complete Tier 3**: frontend + backend module `/api/product-info` + an
**MSA manager `productInfo`**. **Self-contained source** distribution: the shared
kit/fleet-core/ai-kit is **vendored** under `_vendor/` (no `@visuelconcept/wui-kit`
prerequisite), and the page is **built against the target's runtime workspace**
(bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. **`@visuelconcept/wui-webserver`** installed in the project: it hosts the `/api/product-info` route (automatic backend module discovery).

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet> --register-pmon
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2 --register-pmon
```
The installer:
1. copies the **source** (vendored kit under `_vendor/`) → `<workspace>/…/standalone-pages/`;
2. inserts the **menu entry** → the workspace's `menuconfig.jsonc` (idempotent);
3. drops the **backend module** → `customer-webserver/src/modules/asset-lifecycle-intelligence/` (route `/api/product-info`);
4. deploys the **`productInfo` manager** → `<projet>/javascript/productInfo/` + `npm install`; with `--register-pmon`, adds the line to `config/progs`;
5. runs **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## After install (mandatory)
1. **Webserver**: `cd <projet>/javascript/customer-webserver && npm run build`, then **restart** the webserver manager (it auto-mounts `/api/product-info`).
2. **Manager**: start **`productInfo`** in the WinCC OA console. Check the manager order/number if pmon was edited.
3. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → **"Intelligence du cycle de vie des actifs"** entry, `/asset-lifecycle` loads the page.
2. `GET https://<dashboard>/api/product-info/health` → liveness JSON response (indicates whether the MSA client is available).
3. Open an asset's record → the obsolescence/delivery lookup (MLFB) queries the PIH via the `productInfo` manager.

## Notes / security
- The module mounts `/api/product-info/*` as `fullAccess` (demo) → restrict the `acl` in `backend/modules/asset-lifecycle-intelligence/index.ts` before production.
- The `productInfo` manager needs `winccoa-manager`, **provided by the WinCC OA runtime** (not in its `package.json`).
- ⚠️ **PIH API key**: the Product Information Hub lookup requires an API key set in the **`ProductInfo_Config`** DP (or via the **`PRODUCT_INFO_API_KEY`** environment variable). **No key is shipped** — the obsolescence/delivery lookup stays inactive until one is provided.
