# Integrate the Report Builder page (`@visuelconcept-winccoa/wui-report-builder`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** for building **reports from templates**:
pages `/report-builder` (list) + `/report-builder/:reportid` (detail).
You fill in the data, **recompute dataset aggregations from the archives**,
sign according to a **multi-level workflow gated by a checklist**, then lock +
print. Each report is stored in a `ReportBuilder_Report` DP. This is a **Tier 1**:
**frontend only** (no backend module, no manager). Distributed as the npm
package `@visuelconcept-winccoa/wui-report-builder`, deployed with **wui-toolkit** (`wui` CLI):
the shared kit is an npm dependency, and the page is **compiled against the
target's own import map** (bundle = correct version).

## Prerequisites
1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was
   equipped once with `npx wui init target prod`.
2. No backend or manager required. `echarts` is a peer dependency of the package,
   expected from the WebUI platform.

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use report-builder   # npm-installs @visuelconcept-winccoa/wui-report-builder (+ its kit) and selects it
npx wui build prod           # compiles the page, upserts its menu entries
npx wui check prod
```
`wui build`:
1. compiles the page → `<project>/data/dashboard-wc/pages/`;
2. upserts the **2 menu entries** (`menu.fragment.jsonc`) into `menuconfig.json` (idempotent by `routeId`).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → the **"Rapports"** (Reports) entry appears in the menu, `/report-builder` loads the report list.
2. Open/create a report → `/report-builder/:reportid` loads the detail (data entry, dataset recompute from the archives, multi-level signature, lock, print).

## Notes / security
- **Pure frontend** page: no `/api/*` route nor exposed manager → no network surface added by this module.
- Reports are persisted in **`ReportBuilder_Report`** DPs (one DP per report); read/write rights therefore follow the usual WinCC OA ACLs on these DPs.
- The multi-level signature is gated by the checklist on the UI side; the final lock freezes the report. To be hardened on the project side if a server-side guarantee is required (no backend validation manager in this module).
