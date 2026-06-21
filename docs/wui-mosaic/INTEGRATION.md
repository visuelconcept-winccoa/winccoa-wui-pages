# Integrate the Mosaic page (`@visuelconcept/wui-mosaic`) — source mode, Tier 1

**Standalone WinCC OA WebUI page**: a free-form **display wall** (drag/resize)
that embeds other dashboard views as **same-origin chromeless iframes**.
This is a **Tier 1 frontend-only** page (no backend module, no manager).
Each wall is stored in a DP (`Mosaic_Board`) + a preview list.
**Self-contained source** distribution: the shared kit is **vendored** under
`_vendor/` (no `@visuelconcept/wui-kit` prerequisite), and the page is
**compiled against the target's runtime workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. No backend prerequisite (frontend-only page). `module.json.frontend.npmDeps` is empty → the installer adds no npm package to the workspace.

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet>
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
The installer:
1. copies the **source** (kit vendored under `_vendor/`) → `<workspace>/…/standalone-pages/`;
2. inserts the **menu entries** → the workspace's `menuconfig.jsonc` (idempotent);
3. runs **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

No webserver to recompile and no manager to start (frontend-only page).

## Verify
1. Logged in → the **"Mosaic"** entry appears in the menu, `/mosaic` loads the list of walls.
2. Create a wall (creates a `Mosaic_Board` DP), add tiles → the embedded views display as same-origin chromeless iframes.

## Notes / security
- **Frontend-only** page: no `/api/*` route, no manager — nothing to harden on the backend side.
- The iframes are **same-origin** only (views of the same dashboard, chromeless): no arbitrary external URL embedded.
- Nothing stores a secret on the page side: walls only contain references to internal views (DP `Mosaic_Board`).
