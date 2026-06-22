# @visuelconcept/wui-audit-trail — source module (Tier 1)

**GxP Audit Trail** page for a WinCC OA WebUI dashboard, built on the **fixed
`_AuditTrail` datapoint type** (time / username / item / action / oldval →
newval / reason / …). It **manages** the project's `_AuditTrail` datapoints
(create — always NGA-archived — reassign archive group, delete) and **views**
the archived history of the selected one as a **log table**: default rolling
**last 24 h live**, with a **start/end datetime** range, and **CSV / JSON
export + print**. View state is persisted to an **`AuditTrail_Config` DP**.

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

## Prerequisites (runtime)

- At least one **active NGA archive group** (`_NGA_Group` with `.active` set). Creating an audit DP requires it (archiving is mandatory); the manager shows a warning when none exist.
- Audit **records** are written by WinCC OA's audit mechanism / panels / scripts — this page only creates/archives the DPs and visualizes them.

## Contents
```
module.json                                        manifest (mode: source, tier 1)
install.mjs                                         installer
frontend/standalone-pages/audit-trail.ts           page entry SOURCE
frontend/standalone-pages/audit-trail/             page sub-components SOURCE (kit vendored in audit-trail/_vendor/)
  ├─ types.ts            fixed _AuditTrail fields + AuditConfig
  ├─ engine.ts           NGA history query + pivot (one row per record)
  ├─ dp-admin.ts         list/create/archive/delete _AuditTrail DPs (PARA REST)
  ├─ at-manage-dialog.ts DP manager popup (create / archive group / delete)
  ├─ export.ts           CSV / JSON download + print view
  └─ config-store.ts     AuditTrail_Config persistence (DpSingleJsonStore)
frontend/menu.fragment.jsonc                        menu entry (permission: connected)
```
