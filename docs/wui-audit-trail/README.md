# @visuelconcept/wui-audit-trail — source module (Tier 1)

**Audit Trail** page for a WinCC OA WebUI dashboard: a **pivot table of a
datapoint's NGA-archived element history**, driven by a **config popup**
(DP / period / columns / refresh) that is persisted to an **`AuditTrail_Config`
DP**.

Self-contained **source** distribution: the shared kit is **vendored** under
`audit-trail/_vendor/` (no `@visuelconcept/wui-kit` prerequisite), and the page
is built on the target's runtime workspace (so the bundle matches its version).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root>
```
- `--workspace` = the `@wincc-oa/webui-runtime` workspace that builds this project's dashboard (e.g. `…/WebDemo2/webui-workspace`).
- `--project` = the WinCC OA project root (its `data/dashboard-wc/` is the deploy target).

It copies the page source (kit vendored) into the workspace, adds the menu entry
to the workspace's `menuconfig.jsonc`, and runs `build:pages` (deploying into
`<project>/data/dashboard-wc/`).

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** for the target project (the `--workspace`).
- No backend module and no manager — this is a **frontend-only Tier 1** page.
- `module.json.frontend.npmDeps` is empty, so the installer adds no extra npm dependencies to the workspace.

## Contents
```
module.json                                        manifest (mode: source, tier 1)
install.mjs                                         installer
frontend/standalone-pages/audit-trail.ts           page entry SOURCE
frontend/standalone-pages/audit-trail/             page sub-components SOURCE (kit vendored in audit-trail/_vendor/)
frontend/menu.fragment.jsonc                        menu entry (permission: connected)
```
