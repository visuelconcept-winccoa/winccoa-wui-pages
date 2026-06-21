# @visuelconcept/wui-thermal-reports — source module (Tier 1)

**Thermal Treatment Reports** page (`/thermal-reports`): per-charge heat-treatment
reports with recipe paliers + a tolerance band charted against the actual furnace
temperature curve (`dpGetPeriod`), quality/conformity assessment, an echarts band
chart and print. Stored **1 DP per report**.

Self-contained **source** distribution: the shared kit / fleet-core / ai-kit is
**vendored** under `_vendor/` (no separate `@visuelconcept/wui-kit` prerequisite),
and the page is built on the **target's runtime workspace** so the bundle always
matches that runtime's version (a page bundle is coupled to the shell's import map).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root>
```
- `--workspace` = the `@wincc-oa/webui-runtime` workspace that builds this project's dashboard (e.g. `…/WebDemo2/webui-workspace`).
- `--project` = the WinCC OA project root (its `data/dashboard-wc/` is the deploy target).

It (1) copies the page source (kit vendored under `_vendor/`) into the workspace,
(2) adds the menu entry to the workspace's `menuconfig.jsonc`, (3) installs the
frontend npm deps (`@siemens/ix-echarts`, `three`) into the workspace so
`build:pages` can bundle them, then (4) runs `build:pages` into
`<project>/data/dashboard-wc/`.

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

This module is **frontend-only**: there is no webserver backend to rebuild and no manager to start.

## Prerequisites
- A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) for the target project (the `--workspace`).
- The frontend npm deps declared in `module.json` (`@siemens/ix-echarts ~3.0.0`, `three ^0.169.0`) are **auto-installed** into the workspace by the installer — nothing to add by hand.

## Contents
```
module.json                                    manifest (mode: source, tier: 1)
install.mjs                                     installer
frontend/standalone-pages/thermal-reports.ts   page entry SOURCE
frontend/standalone-pages/thermal-reports/      sub-components SOURCE (kit vendored in _vendor/)
frontend/menu.fragment.jsonc                    menu entry (1: /thermal-reports, permission: connected)
```
