# @visuelconcept/wui-mosaic — source module (Tier 1)

**Mosaic** display-wall page for a WinCC OA WebUI dashboard: a free
drag/resize wall that embeds other dashboard views as **chromeless,
same-origin iframes**. Boards are stored 1 DP each (`Mosaic_Board`) plus an
overview list.

Self-contained **source** distribution: the shared kit is **vendored** under
`_vendor/` (no `@visuelconcept/wui-kit` prerequisite), and the page is built on
the target's runtime workspace — so the bundle always matches that runtime
version (a page bundle is coupled to the shell's import map).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root>
```
- `--workspace` = the `@wincc-oa/webui-runtime` workspace that builds this project's dashboard (e.g. `…/WebDemo2/webui-workspace`).
- `--project` = the WinCC OA project root (its `data/dashboard-wc/` is the deploy target).

It copies the page source (kit vendored) into the workspace, adds the menu
entries to the workspace's `menuconfig.jsonc`, and runs `build:pages`
(deploying into `<project>/data/dashboard-wc/`).

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

This module is **frontend-only** (no backend, no manager) — no webserver
rebuild and no manager to start.

## Prerequisites
- A **WebUI Runtime workspace** for the target project (the `--workspace`).
- No backend prerequisite (this is a Tier 1 frontend-only page). `module.json.frontend.npmDeps` is empty, so the installer adds no extra npm packages to the workspace.

## Contents
```
module.json                            manifest (mode: source, tier 1)
install.mjs                            installer
frontend/standalone-pages/mosaic.ts   page entry SOURCE
frontend/standalone-pages/mosaic/     sub-components SOURCE (kit vendored in mosaic/_vendor/)
frontend/menu.fragment.jsonc          menu entries (list + board detail)
```
