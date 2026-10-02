# @visuelconcept-winccoa/wui-mosaic — source module (Tier 1)

**Mosaic** display-wall page for a WinCC OA WebUI dashboard: a free
drag/resize wall that embeds other dashboard views as **chromeless,
same-origin iframes**. Boards are stored 1 DP each (`Mosaic_Board`) plus an
overview list.

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared kit comes
as its npm dependency, and the page is built against the target's own import map
— so the bundle always matches that runtime version (a page bundle is coupled to the shell's import map).

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use mosaic     # npm-installs @visuelconcept-winccoa/wui-mosaic with its kit, selects it
npx wui build prod     # compiles the page into <project>/data/dashboard-wc/, upserts its menu entries
npx wui check prod
```

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

This module is **frontend-only** (no backend, no manager) — no webserver
rebuild and no manager to start.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- No backend of its own (Tier 1 frontend-only page). **Requires** the `para` and `app-security` backends (`wuiPage.requires` — deployed headless when those pages are not selected), see [module dependencies](../module-dependencies.md).
- The shell's `?embed` (chromeless) flag is a WebUI shell patch that **wui-toolkit does not apply** (`wui init target` deploys the pristine shell): without it the tiles show the full shell chrome. See [NOTES.md](./NOTES.md).

## Contents
```
package.json                          npm package; wuiPage (routes, tier 1)
src/mosaic.ts                         page entry
src/mosaic/                           sub-components
menu.fragment.jsonc                   menu entries (list + board detail)
```
