# Integrate the Fleet Stop-Cause Analysis page (`@visuelconcept/wui-fleet-stop-analysis`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** for **stop-cause analysis** (`/fleet-stops`):
breakdown of stop time (`dpGetPeriod` + interval algorithm) split
**by cause**, in **table + ECharts** tabs. This is a **Tier 1**: **frontend
only** (no backend module, no manager). **Self-contained source**
distribution: the shared kit (`wui-kit`, `wui-fleet-core`) is **vendored** under
`fleet-stop-analysis/_vendor/` (no `@visuelconcept/wui-kit` prerequisite), and the page
is **compiled against the target's runtime workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. **No** backend module or manager. The frontend npm deps (`@siemens/ix-echarts`, `three`) are **installed automatically into the workspace** by the installer.

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
3. installs the **frontend npm deps** (`@siemens/ix-echarts`, `three`) into the workspace (so `build:pages` bundles them);
4. runs **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → the **`/fleet-stops`** page loads (entry "Analyse des causes d'arrêts", normally reached from the fleet overview — the menu entry is `hidden`).
2. Select a period → the per-cause breakdown shows in the **table** tab and the **ECharts** chart.

## Notes / security
- **Frontend-only** page: no `/api/*` route exposed, no manager to start. Data is read through the dashboard's existing WinCC OA connection.
- The menu entry is `hidden` (reached from the fleet overview); change this flag in `frontend/menu.fragment.jsonc` if you want to expose it directly.
