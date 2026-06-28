# Integrate the Production Orders page (`@visuelconcept/wui-production-orders`) — source mode, Tier 3

**Standalone WinCC OA WebUI** page to manage **production orders (OF)**
on **`/production-orders`**: the orders are stored in a **single JSON list DP**
(`ProductionOrders_List`), with CRUD + status workflow + an **echarts Gantt** and
a link to the fleet. The KPIs at the top of the page are computed **server-side** by the
**`productionOrdersKpi`** manager (DP `ProductionOrders_Kpi`). It is a **Tier 3** page
with no HTTP backend: frontend + one **Node manager**. **Self-contained source**
distribution: the shared kit / fleet-core is **vendored** under `_vendor/`
(no `@visuelconcept/wui-kit` prerequisite), and the page is **compiled against the
target's runtime workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. No `@visuelconcept/wui-webserver` required: **no backend module** (no `/api` route).
3. The npm deps from `module.json` (`@siemens/ix-echarts`, `three`) are **installed automatically** into the workspace by the installer.

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <project-root> --register-pmon
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2 --register-pmon
```
The installer:
1. copies the **source** (vendored kit) → `<workspace>/…/standalone-pages/`;
2. inserts the **menu entry** → the workspace's `menuconfig.jsonc` (idempotent);
3. installs **`@siemens/ix-echarts`** and **`three`** into the workspace (so `build:pages` bundles them);
4. deploys the **`productionOrdersKpi`** manager → `<project>/javascript/productionOrdersKpi/` + `npm install`; with `--register-pmon`, adds the line to `config/progs`;
5. runs **`build:pages`** (OUT_DIR=`<project>/data/dashboard-wc`).

## After install (mandatory)
1. **Manager**: start **`productionOrdersKpi`** in the WinCC OA console (it `dpConnect`s the order list and recomputes the `ProductionOrders_Kpi` DP). Check the manager order/number if pmon was edited.
2. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → **"Ordres de production"** (production orders) entry, `/production-orders` loads the order list.
2. Create / edit an order (persists in `ProductionOrders_List`), advance the status → the **Gantt** updates.
3. With the `productionOrdersKpi` manager started → the **top-of-page KPIs** (DP `ProductionOrders_Kpi`) populate and refresh.

## Notes / security
- No backend module and no `/api` route: no HTTP surface to harden on the webserver side for this page.
- The **`productionOrdersKpi`** manager needs **`winccoa-manager`**, provided by the WinCC OA runtime (not in the manager's `package.json`).
- The manager reads/writes only the project's `ProductionOrders_List` / `ProductionOrders_Kpi` DPs; no secret or token is embedded.
