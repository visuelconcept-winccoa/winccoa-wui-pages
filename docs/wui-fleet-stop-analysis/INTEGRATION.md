# Integrate the Fleet Stop-Cause Analysis page (`@visuelconcept-winccoa/wui-fleet-stop-analysis`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** for **stop-cause analysis** (`/fleet-stops`):
breakdown of stop time (`dpGetPeriod` + interval algorithm) split
**by cause**, in **table + ECharts** tabs. This is a **Tier 1**: **frontend
only** (no backend module, no manager). Distributed as the npm
package `@visuelconcept-winccoa/wui-fleet-stop-analysis`, deployed with **wui-toolkit** (`wui`
CLI): the shared kits (`wui-kit`, `wui-fleet-core`) are npm dependencies, and the page
is **compiled against the target's own import map** (bundle = correct version).

## Prerequisites
1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was equipped once with `npx wui init target prod`.
2. **No** backend module or manager. Frontend npm deps: `three` comes with `@visuelconcept-winccoa/wui-fleet-core` (installed by npm); `echarts` is a peer dependency, expected from the WebUI platform.

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use fleet-stop-analysis   # npm-installs @visuelconcept-winccoa/wui-fleet-stop-analysis (+ its kits), selects it
npx wui build prod                # compiles the page, upserts its menu entry
npx wui check prod
```
`wui build`:
1. compiles the page → `<project>/data/dashboard-wc/pages/`;
2. upserts the **menu entry** (`menu.fragment.jsonc`) into `menuconfig.json` (idempotent by `routeId`).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → the **`/fleet-stops`** page loads (entry "Analyse des causes d'arrêts" (stop-cause analysis), normally reached from the fleet overview — the menu entry is `hidden`).
2. Select a period → the per-cause breakdown shows in the **table** tab and the **ECharts** chart.

## Notes / security
- **Frontend-only** page: no `/api/*` route exposed, no manager to start. Data is read through the dashboard's existing WinCC OA connection.
- The menu entry is `hidden` (reached from the fleet overview); change this flag in `menu.fragment.jsonc` if you want to expose it directly.
