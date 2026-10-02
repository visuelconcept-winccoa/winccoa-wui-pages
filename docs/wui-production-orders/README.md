# @visuelconcept-winccoa/wui-production-orders — source module (Tier 3)

Manage **production orders (OF)** in the WinCC OA WebUI dashboard at
**`/production-orders`**: OF are stored as a single JSON-list DP
(`ProductionOrders_List`) with CRUD + a status workflow + an **echarts Gantt**
and a link to the fleet. Top-page KPIs are computed **server-side** by the
**`productionOrdersKpi`** manager (into the `ProductionOrders_Kpi` DP).

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared kit /
fleet-core come as its npm dependencies, and the page is built against the
target's own import map (so the bundle matches its runtime).

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use production-orders
npx wui build prod
npx wui check prod
```
`wui use` npm-installs the package with its kits (`three` included); `wui build`
(1) compiles the page into `<project>/data/dashboard-wc/`, (2) adds the menu entry,
(3) deploys the **`productionOrdersKpi` manager** and appends it to `config/progs`
when missing.

## After install (required)
1. **Manager:** start **`productionOrdersKpi`** in the WinCC OA console (it `dpConnect`s the OF list and recomputes the `ProductionOrders_Kpi` DP). Check its number/order (`wui build` appended its `config/progs` line).
2. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- No backend module of its own (no `/api` route). **Requires** the `para` and `app-security` backends (`wuiPage.requires` — deployed headless when those pages are not selected), see [module dependencies](../module-dependencies.md).
- npm deps: `three ^0.169.0` comes with `@visuelconcept-winccoa/wui-fleet-core`; `echarts` is a peer dependency, expected from the WebUI platform.

## Contents
```
package.json                                         npm package; wuiPage (route, tier 3, manager productionOrdersKpi)
src/production-orders.ts                             page entry
src/production-orders/                               page source (data/ ui/ types.ts workflow.ts)
menu.fragment.jsonc                                  menu entry (permission: connected)
managers/productionOrdersKpi/                        index.js (server-side KPI manager → ProductionOrders_Kpi DP)
```
