# @visuelconcept/wui-production-orders — source module (Tier 3)

Manage **production orders (OF)** in the WinCC OA WebUI dashboard at
**`/production-orders`**: OF are stored as a single JSON-list DP
(`ProductionOrders_List`) with CRUD + a status workflow + an **echarts Gantt**
and a link to the fleet. Top-page KPIs are computed **server-side** by the
**`productionOrdersKpi`** manager (into the `ProductionOrders_Kpi` DP).

Self-contained **source** distribution: the shared kit / fleet-core is
**vendored** under `_vendor/` (no separate `@visuelconcept/wui-kit` /
`wui-fleet-core` prerequisite), and the page is built on the target's runtime
workspace (so the bundle matches its version).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root> --register-pmon
```
It (1) copies the page source (vendored kit) into the workspace, (2) adds the
menu entry, (3) installs the npm deps (`@siemens/ix-echarts`, `three`) into the
workspace so `build:pages` bundles them, (4) deploys + `npm install`s the
**`productionOrdersKpi` manager** (and, with `--register-pmon`, adds it to
`config/progs`), then (5) runs `build:pages` into `<project>/data/dashboard-wc/`.

## After install (required)
1. **Manager:** start **`productionOrdersKpi`** in the WinCC OA console (it `dpConnect`s the OF list and recomputes the `ProductionOrders_Kpi` DP). Check its number/order if `config/progs` was edited.
2. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** for the target project (the `--workspace`, `@wincc-oa/webui-runtime`).
- No `@visuelconcept/wui-webserver` needed — this page has **no backend module** (no `/api` route).
- The npm deps in `module.json` (`@siemens/ix-echarts ~3.0.0`, `three ^0.169.0`) are **auto-installed** into the workspace by the installer.

## Contents
```
module.json                                          manifest (mode: source, tier 3)
install.mjs                                           installer
frontend/standalone-pages/production-orders.ts       page entry SOURCE
frontend/standalone-pages/production-orders/          page SOURCE (data/ ui/ types.ts workflow.ts)
  _vendor/                                            vendored shared kit (wui-kit + wui-fleet-core)
frontend/menu.fragment.jsonc                          menu entry (permission: connected)
manager/productionOrdersKpi/                          index.js (server-side KPI manager → ProductionOrders_Kpi DP)
```
