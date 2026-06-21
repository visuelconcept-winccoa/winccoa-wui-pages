# @visuelconcept/wui-report-builder — source module (Tier 1)

**Report Builder** pages (`/report-builder` + `/report-builder/:reportid`) for a
WinCC OA WebUI dashboard. Builds **report instances from templates**: fill data,
recompute dataset aggregations from archives, checklist-gated **multi-level
signing**, then lock + print. Each report is stored as a `ReportBuilder_Report` DP.

Self-contained **source** distribution: the shared kit is **vendored** under
`report-builder/_vendor/` (no separate `@visuelconcept/wui-kit` prerequisite), and
the page is built on the target's runtime workspace so the bundle matches its version.

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root>
```
- `--workspace` = the `@wincc-oa/webui-runtime` workspace that builds this project's dashboard (e.g. `…/WebDemo2/webui-workspace`).
- `--project` = the WinCC OA project root (its `data/dashboard-wc/` is the deploy target).

It (1) copies the page source (vendored kit) into the workspace, (2) adds the two
menu entries to the workspace's `menuconfig.jsonc` (idempotent), (3) installs
`@siemens/ix-echarts` in the workspace so `build:pages` can bundle it, then
(4) runs `build:pages` into `<project>/data/dashboard-wc/`.

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** for the target project (the `--workspace`).
- No backend module and no manager ship with this page (pure frontend, Tier 1).
- The npm dep declared in `module.json` (`@siemens/ix-echarts ~3.0.0`) is **auto-installed into the workspace** by the installer.

## Contents
```
module.json                                          manifest (mode: source, tier 1)
install.mjs                                           installer
frontend/standalone-pages/report-builder.ts          page entry SOURCE
frontend/standalone-pages/report-builder/            page SOURCE (engine.ts, print.ts, types.ts, data/, ui/)
  └─ _vendor/wui-kit/                                 vendored shared kit (no external prerequisite)
frontend/menu.fragment.jsonc                         2 entries: /report-builder (Reports) + /report-builder/:reportid (hidden detail)
```
