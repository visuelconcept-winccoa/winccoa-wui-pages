# Integrate the Report Templates page (`@visuelconcept/wui-report-templates`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** (`/report-templates`) for creating **configurable
report templates**: parameterizable sections (text / comment / fields / table /
DP dataset + aggregation / checklist) with a **multi-level signature workflow**.
Templates are stored in `ReportBuilder_Template` DPs. This is a **Tier 1** (pure
frontend, no backend or manager). **Self-contained source** distribution: the
reused shared report-builder code is **vendored** under `_vendor/` (no
`@visuelconcept/wui-kit` prerequisite), and the page is **compiled against the
target's runtime workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. No backend module or manager required: the page communicates with WinCC OA via the runtime. `@visuelconcept/wui-webserver` is **not** needed for this module.

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet>
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
The installer:
1. copies the **source** (vendored kit under `_vendor/`) → `<workspace>/…/standalone-pages/`;
2. inserts the **menu entry** → the workspace's `menuconfig.jsonc` (idempotent);
3. runs **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → the **"Modèles de rapports"** entry appears in the menu.
2. `/report-templates` loads and displays the template list (`ReportBuilder_Template`).
3. Create / edit a template (parameterizable sections + signature workflow) → saving creates/updates a `ReportBuilder_Template` DP.

## Notes / security
- **Pure frontend** module: no `/api/*` endpoint exposed, no Node manager to start — nothing to harden on the ACL/network side for this package.
- Persistence goes through `ReportBuilder_Template` DPs (generic `DpJsonStore` base); access rights rely on the project's existing WinCC OA / WebUI ACLs.
- The menu entry is at `connected` permission; restrict the permission in `menu.fragment.jsonc` if access must be limited.
