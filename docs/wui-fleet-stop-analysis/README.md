# @visuelconcept-winccoa/wui-fleet-stop-analysis — source module (Tier 1)

**Fleet Stop-Cause Analysis** page (`/fleet-stops`) for the WinCC OA WebUI
dashboard: **downtime decomposition** (`dpGetPeriod` + an interval algorithm)
broken out **per stop cause**, presented in **table + ECharts** tabs.

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared kits
(`wui-kit`, `wui-fleet-core`) come as its npm dependencies, and the page is built
against the **target's own import map** so the bundle matches its runtime (a page bundle is
coupled to the shell's import map).

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use fleet-stop-analysis   # npm-installs @visuelconcept-winccoa/wui-fleet-stop-analysis with its kits, selects it
npx wui build prod                # compiles the page into <project>/data/dashboard-wc/, upserts its menu entry
npx wui check prod
```

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- No backend module and no manager of its own — a **frontend-only** page (it reads data via the dashboard's existing WinCC OA connection).
- **Requires** the `para` and `app-security` backends (`wuiPage.requires` — deployed headless when those pages are not selected), see [module dependencies](../module-dependencies.md).
- npm deps: `three` comes with `@visuelconcept-winccoa/wui-fleet-core` (npm installs it with the package — you don't install it yourself); `echarts` is a peer dependency, expected from the WebUI platform.

## Contents
```
package.json                                         npm package; wuiPage (route, tier 1)
src/fleet-stop-analysis.ts                           page entry
src/i18n.ts, src/app-security.roles.json             strings, the module's role catalog
menu.fragment.jsonc                                  menu entry (/fleet-stops, hidden — reached from the fleet overview)
```
