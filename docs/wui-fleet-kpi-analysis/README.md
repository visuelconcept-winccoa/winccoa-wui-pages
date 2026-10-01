# @visuelconcept-winccoa/wui-fleet-kpi-analysis — source module (Tier 3)

**Fleet KPI Analysis** page (`/fleet-kpi`) for the WinCC OA WebUI dashboard:
**availability / TRS per machine** computed over opening time minus closures,
charted with echarts. Live per-machine TRS is produced by the **`kpiCalc`
manager**; the page reads and visualises it.

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared kit /
fleet-core come as its npm dependencies, and the page is built against the
target's own import map (so the bundle matches its runtime).

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use fleet-kpi-analysis
npx wui build prod
npx wui check prod
```
`wui use` npm-installs the package with its kits (`three` included); `wui build`
(1) compiles the page into `<project>/data/dashboard-wc/`, (2) adds the menu entry,
(3) deploys + `npm install`s the **`kpiCalc` manager** and appends it to
`config/progs` when missing.

## After install (required)
1. **Manager:** start **`kpiCalc`** in the WinCC OA console (it computes the live
   per-machine TRS the page reads). Verify its order/number (`wui build` appended its `config/progs` line).
2. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then
   reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT
   enough**; only `Clear site data` purges it.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done
  once).
- No backend module: this page talks to WinCC OA via the standard WebUI runtime,
  so **the dashboard webserver is not required** by this page.
- Frontend npm deps: `three ^0.169.0` comes with `@visuelconcept-winccoa/wui-fleet-core`;
  `echarts` is a peer dependency, expected from the WebUI platform.

## Contents
```
package.json                                         npm package; wuiPage (route, Tier 3, managers: kpiCalc)
src/fleet-kpi-analysis.ts                            page entry
src/fleet-kpi-analysis/                              sub-components
menu.fragment.jsonc                                  menu entry (/fleet-kpi, hidden — reached from the fleet overview)
managers/kpiCalc/                                    index.js (live per-machine TRS computation)
```
