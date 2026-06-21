# Integrate the Report Builder page (`@visuelconcept/wui-report-builder`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** for building **reports from templates**:
pages `/report-builder` (list) + `/report-builder/:reportid` (detail).
You fill in the data, **recompute dataset aggregations from the archives**,
sign according to a **multi-level workflow gated by a checklist**, then lock +
print. Each report is stored in a `ReportBuilder_Report` DP. This is a **Tier 1**:
**frontend only** (no backend module, no manager). **Self-contained source**
distribution: the shared kit is **vendored** under `report-builder/_vendor/` (no
`@visuelconcept/wui-kit` prerequisite), and the page is **compiled against the
target's runtime workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. No backend or manager required. The npm dependency `@siemens/ix-echarts` (`~3.0.0`)
   declared in `module.json` is **installed automatically into the workspace**
   by the installer (so that `build:pages` bundles it).

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
2. inserts the **2 menu entries** → the workspace's `menuconfig.jsonc` (idempotent by `routeId`);
3. installs **`@siemens/ix-echarts`** into the workspace (so that `build:pages` bundles it);
4. runs **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → the **"Rapports"** entry appears in the menu, `/report-builder` loads the report list.
2. Open/create a report → `/report-builder/:reportid` loads the detail (data entry, dataset recompute from the archives, multi-level signature, lock, print).

## Notes / security
- **Pure frontend** page: no `/api/*` route nor exposed manager → no network surface added by this module.
- Reports are persisted in **`ReportBuilder_Report`** DPs (one DP per report); read/write rights therefore follow the usual WinCC OA ACLs on these DPs.
- The multi-level signature is gated by the checklist on the UI side; the final lock freezes the report. To be hardened on the project side if a server-side guarantee is required (no backend validation manager in this module).
