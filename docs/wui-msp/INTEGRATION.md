# Integrate the MSP page (`@visuelconcept/wui-msp`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** "MSP" (shell) registered under
`/msp`. This is a **Tier 1**: **frontend only** — no backend module,
no manager. **Self-contained source** distribution: the shared kit is
**vendored** under `_vendor/` (no `@visuelconcept/wui-kit` prerequisite), and the
page is **compiled against the target's runtime workspace** (the bundle matches
the correct runtime version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. No backend or manager required; no additional npm dependency (`module.json` `frontend.npmDeps` is empty).

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet>
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
The installer:
1. copies the **source** (vendored kit) → `<workspace>/…/standalone-pages/`;
2. inserts the **menu entry** (`/msp`) → the workspace's `menuconfig.jsonc` (idempotent by `routeId`);
3. runs **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → the **"MSP"** entry appears in the menu.
2. `/msp` loads the page (shell).

## Notes / security
- **Frontend-only** page: no `/api/*` route exposed, no manager to start or register in pmon.
- The menu entry's permission is `connected` (any authenticated user) — restrict in `frontend/menu.fragment.jsonc` if needed before prod.
