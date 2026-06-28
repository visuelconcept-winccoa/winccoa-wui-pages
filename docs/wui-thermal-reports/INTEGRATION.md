# Integrate the Thermal Treatment Reports page (`@visuelconcept/wui-thermal-reports`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** for **thermal treatment reports**
(`/thermal-reports`): one report per load, with recipe steps + a tolerance band
overlaid on the **actual furnace temperature curve** (`dpGetPeriod`),
quality/conformity evaluation, echarts chart (band) and printing. Storage:
**1 DP per report**. This is a **Tier 1**: **frontend only** (no backend module,
no Node manager). **Self-contained source** distribution: the shared kit is
**vendored** under `_vendor/` (no `@visuelconcept/wui-kit` prerequisite), and the
page is **compiled against the target's runtime workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. The frontend npm deps declared in `module.json` (`@siemens/ix-echarts ~3.0.0`, `three ^0.169.0`) are **installed automatically** into the workspace by the installer — nothing to add by hand.

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <project-root>
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
The installer:
1. copies the **source** (vendored kit under `_vendor/`) → `<workspace>/libs/default-components/src/lib/standalone-pages/`;
2. inserts the **menu entry** → the workspace's `menuconfig.jsonc` (idempotent);
3. installs the **frontend npm deps** (`@siemens/ix-echarts`, `three`) into the workspace (so that `build:pages` bundles them);
4. runs **`build:pages`** (OUT_DIR=`<project>/data/dashboard-wc`).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

No webserver to recompile and no manager to start: this module is **frontend only**.

## Verify
1. Logged in → the **"Rapports traitement thermique"** (thermal treatment reports) entry appears in the menu.
2. `/thermal-reports` loads the report list; opening/creating a report shows the actual furnace curve (read via `dpGetPeriod`) overlaid on the recipe's tolerance band, with the quality/conformity verdict and printing.

## Notes / security
- **Pure frontend** module: no network surface added (no `/api/*` route, no exposed manager). Nothing to harden on the backend side.
- The page reads/writes DPs via the standard WebUI channel (one DP per report); the rights are those of the dashboard's logged-in user.
