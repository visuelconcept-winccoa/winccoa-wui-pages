# Integrate the Audit Trail page (`@visuelconcept/wui-audit-trail`) — source mode, Tier 1

**Standalone WinCC OA WebUI page**: a **GxP audit-trail viewer + manager** over
the **fixed `_AuditTrail` datapoint type**. It lists the project's `_AuditTrail`
datapoints, shows the selected one's **NGA-archived history as a log table**
(default rolling **last 24 h live**, plus a **start/end datetime** range), and
**exports CSV / JSON + prints**. It also **creates** `_AuditTrail` datapoints
(always NGA-archived, archive group like Para), reassigns their group and
deletes them — all via the existing **PARA REST** endpoints. View state is
persisted in a DP **`AuditTrail_Config`**. This is a **Tier 1**: **frontend
only** (no backend module, no manager). **Self-contained source** distribution:
the shared kit is **vendored** under `audit-trail/_vendor/`, and the page is
**compiled against the target's runtime workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. No backend or manager required. `module.json.frontend.npmDeps` is empty: the installer adds no npm dependency to the workspace.

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <project-root>
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
The installer:
1. copies the **source** (vendored kit) → `<workspace>/…/standalone-pages/`;
2. inserts the **menu entry** → the workspace's `menuconfig.jsonc` (idempotent by `routeId`);
3. runs **`build:pages`** (OUT_DIR=`<project>/data/dashboard-wc`).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → the **"Audit Trail"** entry appears in the menu, `/audit-trail` loads the page.
2. Click **"Gérer"** (manage) → create a DP (e.g. `AuditTrail_Production`) with an **active archive group**. It is created of type `_AuditTrail` and archiving is enabled on every element.
3. Select the DP in the toolbar. Default view = **last 24 h live**; toggle live off to pick a **start/end** interval. Once audit records exist (written by OA's audit mechanism), they appear as table rows.
4. **CSV / JSON / Imprimer** (print) export/print the displayed log; the view config is persisted in the DP **`AuditTrail_Config`**.

## Notes / security
- **Frontend-only** page: no `/api/*` route of its own; it reuses the **PARA REST** endpoints (`/api/para/dp/*`) — these must be mounted (the `wui-para` backend / webserver), otherwise create/archive/delete fall back to read-only.
- The menu entry is `permission: ["connected"]` → visible to any logged-in user; restrict via the menu fragment's `permission` if needed.
- Creating a DP requires at least one **active `_NGA_Group`** archive group. Audit **records** are written by WinCC OA's audit subsystem / panels / scripts, not by this page.
