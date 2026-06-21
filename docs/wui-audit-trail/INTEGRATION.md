# Integrate the Audit Trail page (`@visuelconcept/wui-audit-trail`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** displaying a **pivot (cross-tab) table of the
NGA archived history of elements** of a datapoint, driven by a **configuration
popup** (DP / period / columns / refresh) persisted in a DP
**`AuditTrail_Config`**. This is a **Tier 1**: **frontend only** (no backend
module, no manager). **Self-contained source** distribution: the shared kit is
**vendored** under `audit-trail/_vendor/` (no `@visuelconcept/wui-kit`
prerequisite), and the page is **compiled against the target's runtime
workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. No backend or manager required. `module.json.frontend.npmDeps` is empty: the installer adds no npm dependency to the workspace.

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
2. inserts the **menu entry** → the workspace's `menuconfig.jsonc` (idempotent by `routeId`);
3. runs **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → the **"Audit Trail"** entry appears in the menu, `/audit-trail` loads the page.
2. Open the **config popup**: pick an NGA archived DP, a period and columns → the pivot table fills with the element history.
3. The config is persisted in the DP **`AuditTrail_Config`** (reloaded on next display).

## Notes / security
- **Frontend-only** page: no `/api/*` route exposed, no manager to start.
- The menu entry is `permission: ["connected"]` → visible to any logged-in user; restrict via the menu fragment's `permission` if needed.
- The page reads the history via the **NGA** archives of the targeted DP: make sure NGA archiving is active on the elements to be audited.
