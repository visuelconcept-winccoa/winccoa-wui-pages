# Integrate the Production Orders page (`@visuelconcept-winccoa/wui-production-orders`) — source mode, Tier 3

**Standalone WinCC OA WebUI** page to manage **production orders (OF)**
on **`/production-orders`**: the orders are stored in a **single JSON list DP**
(`ProductionOrders_List`), with CRUD + status workflow + an **echarts Gantt** and
a link to the fleet. The KPIs at the top of the page are computed **server-side** by the
**`productionOrdersKpi`** manager (DP `ProductionOrders_Kpi`). It is a **Tier 3** page
with no HTTP backend: frontend + one **Node manager**. Distributed as the npm
package `@visuelconcept-winccoa/wui-production-orders`, deployed with **wui-toolkit** (`wui`
CLI): the shared kit / fleet-core are npm dependencies, and the page is **compiled
against the target's own import map** (bundle = correct version).

## Prerequisites
1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was equipped once with `npx wui init target prod`.
2. The dashboard webserver is not required: **no backend module** (no `/api` route).
3. npm deps: `three` comes with `@visuelconcept-winccoa/wui-fleet-core` (installed by npm); `echarts` is a peer dependency, expected from the WebUI platform.

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use production-orders   # npm-installs @visuelconcept-winccoa/wui-production-orders (+ its kits), selects it
npx wui build prod              # page + menu entry, productionOrdersKpi manager
npx wui check prod
```
`wui build`:
1. compiles the page → `<project>/data/dashboard-wc/pages/`;
2. upserts the **menu entry** (`menu.fragment.jsonc`) into `menuconfig.json` (idempotent);
3. deploys the **`productionOrdersKpi`** manager → `<project>/javascript/productionOrdersKpi/` (+ `npm install` if it has dependencies), and appends its line to `config/progs` when missing.

## After install (mandatory)
1. **Manager**: start **`productionOrdersKpi`** in the WinCC OA console (it `dpConnect`s the order list and recomputes the `ProductionOrders_Kpi` DP). Check the manager order/number (`wui build` appended its `config/progs` line).
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
