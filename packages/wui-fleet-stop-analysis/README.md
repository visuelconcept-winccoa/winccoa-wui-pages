# @visuelconcept/wui-fleet-stop-analysis — source module (Tier 1)

**Fleet Stop-Cause Analysis** page (`/fleet-stops`) for the WinCC OA WebUI
dashboard: **downtime decomposition** (`dpGetPeriod` + an interval algorithm)
broken out **per stop cause**, presented in **table + ECharts** tabs.

Self-contained **source** distribution: the shared kit (`wui-kit`, `wui-fleet-core`)
is **vendored** under `fleet-stop-analysis/_vendor/` (no separate
`@visuelconcept/wui-kit` / fleet-core prerequisite), and the page is built on the
**target's runtime workspace** so the bundle matches its version (a page bundle is
coupled to the shell's import map).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root>
```
It (1) copies the page source (vendored kit included) into the workspace,
(2) adds the menu entry to the workspace's `menuconfig.jsonc`, (3) installs the
frontend npm deps (`@siemens/ix-echarts`, `three`) into the workspace so
`build:pages` can bundle them, then (4) runs `build:pages` into
`<project>/data/dashboard-wc/`.

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** for the target project (the `--workspace`, e.g. `…/WebDemo2/webui-workspace`).
- No backend module and no manager — this is a **frontend-only** page (it reads data via the dashboard's existing WinCC OA connection).
- The npm deps in `module.json` (`@siemens/ix-echarts`, `three`) are **auto-installed into the workspace** by the installer; you don't install them yourself.

## Contents
```
module.json                                          manifest (mode: source, tier 1)
install.mjs                                           installer
frontend/standalone-pages/fleet-stop-analysis.ts     page entry SOURCE
frontend/standalone-pages/fleet-stop-analysis/        sub-components SOURCE (kit vendored in _vendor/)
frontend/menu.fragment.jsonc                          menu entry (/fleet-stops, hidden — reached from the fleet overview)
```
