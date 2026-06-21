# @visuelconcept/wui-fleet-kpi-analysis — source module (Tier 3)

**Fleet KPI Analysis** page (`/fleet-kpi`) for the WinCC OA WebUI dashboard:
**availability / TRS per machine** computed over opening time minus closures,
charted with echarts. Live per-machine TRS is produced by the **`kpiCalc`
manager**; the page reads and visualises it.

Self-contained **source** distribution: the shared kit / fleet-core / ai-kit is
**vendored** under `_vendor/` (no `@visuelconcept/wui-kit` prerequisite), and the
page is built on the target's runtime workspace (so the bundle matches its
version).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root> --register-pmon
```
It (1) copies the page source (kit vendored) into the workspace, (2) adds the
menu entry, (3) installs the frontend npm deps (`@siemens/ix-echarts`, `three`)
into the workspace so `build:pages` can bundle them, (4) deploys + `npm install`s
the **`kpiCalc` manager** (and, with `--register-pmon`, appends it to
`config/progs`), then (5) runs `build:pages` into `<project>/data/dashboard-wc/`.

## After install (required)
1. **Manager:** start **`kpiCalc`** in the WinCC OA console (it computes the live
   per-machine TRS the page reads). Verify its order/number if pmon was edited.
2. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then
   reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT
   enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) for the target
  project — the `--workspace`.
- No backend module: this page talks to WinCC OA via the standard WebUI runtime,
  so **`@visuelconcept/wui-webserver` is not required** by this page.
- The frontend npm deps declared in `module.json.frontend.npmDeps`
  (`@siemens/ix-echarts ~3.0.0`, `three ^0.169.0`) are **auto-installed** into
  the workspace by the installer.

## Contents
```
module.json                                          manifest (mode: source, Tier 3)
install.mjs                                           installer
frontend/standalone-pages/fleet-kpi-analysis.ts      page entry SOURCE
frontend/standalone-pages/fleet-kpi-analysis/        sub-components SOURCE (kit vendored in _vendor/)
frontend/menu.fragment.jsonc                         menu entry (/fleet-kpi, hidden — reached from the fleet overview)
manager/kpiCalc/                                      index.js (live per-machine TRS computation)
```
