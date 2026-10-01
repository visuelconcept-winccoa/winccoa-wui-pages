# Integrate the Fleet KPI Analysis page (`@visuelconcept-winccoa/wui-fleet-kpi-analysis`) — source mode, Tier 3

**Standalone WinCC OA WebUI page** for **fleet KPI analysis** (`/fleet-kpi`):
**availability / OEE per machine** computed over operating time minus
non-working days (closures), rendered with **echarts**. The real-time OEE per
machine is produced by the **Node manager `kpiCalc`**; the page reads and
displays it. This is a Tier 3 **with no backend module**: frontend + manager only.
Distributed as the npm package `@visuelconcept-winccoa/wui-fleet-kpi-analysis`, deployed
with **wui-toolkit** (`wui` CLI): the shared kits (kit / fleet-core) are npm
dependencies, and the page is **compiled against the target's own import map**
(bundle = correct version).

## Prerequisites
1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was
   equipped once with `npx wui init target prod`.
2. **No backend module**: the page goes through the standard WebUI runtime to
   talk to WinCC OA, so **the dashboard webserver is not required** by this
   page.
3. The **frontend npm dependencies**: `three` comes with
   `@visuelconcept-winccoa/wui-fleet-core` (installed by npm); `echarts` is a peer
   dependency, expected from the WebUI platform.

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use fleet-kpi-analysis   # npm-installs @visuelconcept-winccoa/wui-fleet-kpi-analysis (+ its kits), selects it
npx wui build prod               # page + menu entry, kpiCalc manager
npx wui check prod
```
`wui build`:
1. compiles the page → `<project>/data/dashboard-wc/pages/`;
2. upserts the **menu entry** (`/fleet-kpi`, hidden) into `menuconfig.json` (idempotent by `routeId`);
3. deploys the **`kpiCalc` manager** → `<project>/javascript/kpiCalc/` (+ `npm install` if it has dependencies) and appends its line to `config/progs` when missing.

## After install (mandatory)
1. **Manager**: start **`kpiCalc`** in the WinCC OA console (it computes the
   real-time OEE per machine that the page reads). Check the manager
   order/number (`wui build` appended its `config/progs` line).
2. **Browser**: DevTools → Application → Storage → **`Clear site data`**,
   reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only
   `Clear site data` purges it.

## Verify
1. Logged in → the **"Analyse des KPI"** (KPI analysis) page (`/fleet-kpi`) loads (reached
   from the fleet overview — the menu entry is hidden).
2. The **`kpiCalc`** manager is running in the WinCC OA console and feeds the
   KPI DPs; the availability / OEE per machine curves are shown (echarts).

## Notes / security
- This page **mounts no `/api/*` route**: no backend surface to harden on the
  webserver side.
- The **`kpiCalc`** manager needs **`winccoa-manager`**, **provided by the
  WinCC OA runtime** (not in the manager's `package.json`).
- The OEE calculation depends on operating time and **non-working days
  (closures)** as well as the cause time categories: these data must be
  present in the project for the KPIs to be meaningful.
