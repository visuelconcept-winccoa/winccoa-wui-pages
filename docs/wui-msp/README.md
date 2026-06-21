# @visuelconcept/wui-msp — source module (Tier 1)

**MSP** standalone page (shell) for a WinCC OA WebUI dashboard. A frontend-only
page registered under `/msp` — the empty shell to grow the MSP feature into;
no backend module and no managers.

Self-contained **source** distribution: the shared kit is **vendored** under
`_vendor/` (no separate `@visuelconcept/wui-kit` prerequisite), and the page is
built on the **target's runtime workspace**, so the page bundle always matches
that runtime version (a page bundle is coupled to the shell's import map).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root>
```
- `--workspace` = the `@wincc-oa/webui-runtime` workspace that builds this project's dashboard (e.g. `…/WebDemo2/webui-workspace`).
- `--project` = the WinCC OA project root (its `data/dashboard-wc/` is the deploy target).

It copies the page source (kit vendored) into the workspace, adds the menu entry
to the workspace's `menuconfig.jsonc` (idempotent by `routeId`), and runs
`build:pages` (deploying into `<project>/data/dashboard-wc/`).

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) for the target project (the `--workspace`).
- No backend and no managers — this is a frontend-only page.
- No extra npm deps (`module.json` `frontend.npmDeps` is empty); anything declared there would be auto-installed into the workspace by the installer.

## Contents
```
module.json                         manifest (mode: source, tier 1)
install.mjs                          installer
frontend/standalone-pages/msp.ts     page entry SOURCE
frontend/standalone-pages/msp/       page SOURCE (kit vendored in msp/_vendor/)
frontend/menu.fragment.jsonc         menu entry (1: /msp, permission: connected)
```
