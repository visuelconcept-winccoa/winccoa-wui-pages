# @visuelconcept-winccoa/wui-report-builder — source module (Tier 1)

**Report Builder** pages (`/report-builder` + `/report-builder/:reportid`) for a
WinCC OA WebUI dashboard. Builds **report instances from templates**: fill data,
recompute dataset aggregations from archives, checklist-gated **multi-level
signing**, then lock + print. Each report is stored as a `ReportBuilder_Report` DP.

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared kit comes as its
npm dependency, and the page is built against the target's own import map so the
bundle matches its runtime.

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use report-builder   # npm-installs @visuelconcept-winccoa/wui-report-builder with its kit, selects it
npx wui build prod           # compiles the page into <project>/data/dashboard-wc/, upserts the two menu entries
npx wui check prod
```

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- No backend module and no manager ship with this page (pure frontend, Tier 1).
- **Requires** the `para` and `app-security` backends (`wuiPage.requires` — deployed headless when those pages are not selected), see [module dependencies](../module-dependencies.md).
- `echarts` is a peer dependency of the package, expected from the WebUI platform.

## Contents
```
package.json                                         npm package; wuiPage (routes, tier 1)
src/report-builder.ts                                page entry
src/                                                 page source (engine.ts, print.ts, types.ts, data/, ui/)
menu.fragment.jsonc                                  2 entries: /report-builder (Reports) + /report-builder/:reportid (hidden detail)
```
