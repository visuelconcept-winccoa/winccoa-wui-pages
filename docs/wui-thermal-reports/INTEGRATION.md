# Integrate the Thermal Treatment Reports page (`@visuelconcept-winccoa/wui-thermal-reports`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** for **thermal treatment reports**
(`/thermal-reports`): one report per load, with recipe steps + a tolerance band
overlaid on the **actual furnace temperature curve** (`dpGetPeriod`),
quality/conformity evaluation, echarts chart (band) and printing. Storage:
**1 DP per report**. This is a **Tier 1**: **frontend only** (no backend module,
no Node manager). Distributed as the npm package `@visuelconcept-winccoa/wui-thermal-reports`,
deployed with **wui-toolkit** (`wui` CLI): the shared kits (kit / fleet-core) are npm
dependencies, and the page is **compiled against the target's own import map** (bundle =
correct version).

## Prerequisites
1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was equipped once with `npx wui init target prod`.
2. Frontend npm deps: `three ^0.169.0` comes with `@visuelconcept-winccoa/wui-fleet-core` (installed by npm — nothing to add by hand); `echarts` is a peer dependency, expected from the WebUI platform.

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use thermal-reports   # npm-installs @visuelconcept-winccoa/wui-thermal-reports (+ its kits), selects it
npx wui build prod            # compiles the page, upserts its menu entry
npx wui check prod
```
`wui build`:
1. compiles the page → `<project>/data/dashboard-wc/pages/`;
2. upserts the **menu entry** (`menu.fragment.jsonc`) into `menuconfig.json` (idempotent).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

No webserver to recompile and no manager to start: this module is **frontend only**.

## Verify
1. Logged in → the **"Rapports traitement thermique"** (thermal treatment reports) entry appears in the menu.
2. `/thermal-reports` loads the report list; opening/creating a report shows the actual furnace curve (read via `dpGetPeriod`) overlaid on the recipe's tolerance band, with the quality/conformity verdict and printing.

## Notes / security
- **Pure frontend** module: no network surface added (no `/api/*` route, no exposed manager). Nothing to harden on the backend side.
- The page reads/writes DPs via the standard WebUI channel (one DP per report); the rights are those of the dashboard's logged-in user.
