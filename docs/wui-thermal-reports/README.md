# @visuelconcept-winccoa/wui-thermal-reports — source module (Tier 1)

**Thermal Treatment Reports** page (`/thermal-reports`): per-charge heat-treatment
reports with recipe paliers + a tolerance band charted against the actual furnace
temperature curve (`dpGetPeriod`), quality/conformity assessment, an echarts band
chart and print. Stored **1 DP per report**.

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared kit /
fleet-core come as its npm dependencies, and the page is built against the
**target's own import map** so the bundle always matches that runtime's version (a page bundle is coupled to the shell's import map).

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use thermal-reports   # npm-installs @visuelconcept-winccoa/wui-thermal-reports with its kits, selects it
npx wui build prod            # compiles the page into <project>/data/dashboard-wc/, upserts its menu entry
npx wui check prod
```

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

This module is **frontend-only**: it has no webserver backend of its own and no manager to start. **Requires** the `para` and `app-security` backends (`wuiPage.requires` — deployed headless when those pages are not selected), see [module dependencies](../module-dependencies.md).

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- Frontend npm deps: `three ^0.169.0` comes with `@visuelconcept-winccoa/wui-fleet-core` (npm installs it — nothing to add by hand); `echarts` is a peer dependency, expected from the WebUI platform.

## Contents
```
package.json                                   npm package; wuiPage (route, tier 1)
src/thermal-reports.ts                         page entry
src/thermal-reports/                           sub-components
menu.fragment.jsonc                            menu entry (1: /thermal-reports, permission: connected)
```
