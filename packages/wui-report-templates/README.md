# @visuelconcept/wui-report-templates — source module (Tier 1)

Standalone WinCC OA WebUI page (`/report-templates`) to author **configurable
report templates**: parameterised sections (text / comment / fields / table /
DP-dataset + aggregation / checklist) with a **multi-level signature workflow**.
Templates are stored as `ReportBuilder_Template` DPs.

Self-contained **source** distribution: the shared report-builder code it reuses
is **vendored** under `_vendor/` (no separate `@visuelconcept/wui-kit` /
fleet-core / ai-kit prerequisite), and the page is built on the target's runtime
workspace so the bundle always matches that runtime version (a page bundle is
coupled to the shell's import map).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root>
```
- `--workspace` = the `@wincc-oa/webui-runtime` workspace that builds this project's dashboard (e.g. `…/WebDemo2/webui-workspace`).
- `--project` = the WinCC OA project root (its `data/dashboard-wc/` is the deploy target).

It copies the page source (vendored) into the workspace, adds the menu entry to
the workspace's `menuconfig.jsonc`, then runs `build:pages` (deploying into
`<project>/data/dashboard-wc/`).

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** for the target project (the `--workspace`).
- No backend module and no manager — this is a pure frontend (Tier 1) page that talks to WinCC OA through the runtime; `@visuelconcept/wui-webserver` is **not** required by this module.
- `module.json` declares no extra `frontend.npmDeps`; any it did declare would be auto-installed into the workspace by the installer.

## Contents
```
module.json                                        manifest (mode: source, tier 1)
install.mjs                                         installer
frontend/standalone-pages/report-templates.ts      page entry SOURCE
frontend/standalone-pages/report-templates/         page SOURCE + _vendor/ (shared report-builder code, vendored)
frontend/menu.fragment.jsonc                        1 menu entry (/report-templates, permission: connected)
```
