# @visuelconcept/wui-fleet-closures — source module (Tier 1)

Manage **non-working days** for the fleet on the **`/fleet-closures`** page:
year / workshop / machine filters, JSON import-export, and overlap handling
(replace / ignore / cancel). Frontend-only — no backend module, no manager.

Self-contained **source** distribution: the shared kit / fleet-core / ai-kit is
**vendored** under `_vendor/` (no separate `@visuelconcept/wui-kit` prerequisite),
and the page is built on the target's runtime workspace so the bundle always
matches that runtime version (a page bundle is coupled to the shell's import map).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root>
```
It copies the page source (vendored kit included) into the workspace, adds the
menu entry to the workspace's `menuconfig.jsonc`, installs the page's npm deps
into the workspace, and runs `build:pages` (deploying into
`<project>/data/dashboard-wc/`).

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) for the target project (the `--workspace`).
- No webserver / backend prerequisite (frontend-only page).
- npm deps declared in `module.json` (`three ^0.169.0`) are **auto-installed into the workspace** by the installer so `build:pages` can bundle them.

## Contents
```
module.json                                          manifest (mode: source, tier 1)
install.mjs                                           installer
frontend/standalone-pages/fleet-closures.ts          page entry SOURCE
frontend/standalone-pages/fleet-closures/            page sub-components (kit vendored in fleet-closures/_vendor/)
frontend/menu.fragment.jsonc                         menu entry (1 entry, hidden — reached from the fleet overview)
```
