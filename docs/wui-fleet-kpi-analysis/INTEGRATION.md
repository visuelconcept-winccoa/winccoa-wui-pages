# Integrate the Fleet KPI Analysis page (`@visuelconcept/wui-fleet-kpi-analysis`) — source mode, Tier 3

**Standalone WinCC OA WebUI page** for **fleet KPI analysis** (`/fleet-kpi`):
**availability / OEE per machine** computed over operating time minus
non-working days (closures), rendered with **echarts**. The real-time OEE per
machine is produced by the **Node manager `kpiCalc`**; the page reads and
displays it. This is a Tier 3 **with no backend module**: frontend + manager only.
**Self-contained source** distribution: the shared kit (kit / fleet-core / ai-kit)
is **vendored** under `_vendor/` (no `@visuelconcept/wui-kit` prerequisite), and
the page is **compiled against the target's runtime workspace** (bundle = correct
version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. **No backend module**: the page goes through the standard WebUI runtime to
   talk to WinCC OA, so **`@visuelconcept/wui-webserver` is not required** by this
   page.
3. The **frontend npm dependencies** (`@siemens/ix-echarts`, `three`) declared
   in `module.json` are **installed automatically** into the workspace by the
   installer.

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <project-root> --register-pmon
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2 --register-pmon
```
The installer:
1. copies the **source** (kit vendored under `_vendor/`) → `<workspace>/…/standalone-pages/`;
2. inserts the **menu entry** (`/fleet-kpi`, hidden) → the workspace's `menuconfig.jsonc` (idempotent by `routeId`);
3. installs **`@siemens/ix-echarts`** and **`three`** into the workspace (so `build:pages` bundles them);
4. deploys the **`kpiCalc` manager** → `<project>/javascript/kpiCalc/` (+ `npm install` if a `package.json` is shipped); with `--register-pmon`, adds the line to `config/progs`;
5. runs **`build:pages`** (OUT_DIR=`<project>/data/dashboard-wc`).

## After install (mandatory)
1. **Manager**: start **`kpiCalc`** in the WinCC OA console (it computes the
   real-time OEE per machine that the page reads). Check the manager
   order/number if pmon was edited.
2. **Browser**: DevTools → Application → Storage → **`Clear site data`**,
   reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only
   `Clear site data` purges it.

## Verify
1. Logged in → the **"Analyse des KPI"** (KPI analysis) page (`/fleet-kpi`) loads (reached
   from the fleet overview — the menu entry is hidden).
2. The **`kpiCalc`** manager is running in the WinCC OA console and feeds the
   KPI DPs; the availability / OEE per machine curves are shown (echarts).

## Notes / security
- This page **mounts no `/api/*` route**: no backend surface to harden on the
  webserver side.
- The **`kpiCalc`** manager needs **`winccoa-manager`**, **provided by the
  WinCC OA runtime** (not in the manager's `package.json`).
- The OEE calculation depends on operating time and **non-working days
  (closures)** as well as the cause time categories: these data must be
  present in the project for the KPIs to be meaningful.
