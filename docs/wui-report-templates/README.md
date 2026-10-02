# @visuelconcept-winccoa/wui-report-templates — source module (Tier 1)

Standalone WinCC OA WebUI page (`/report-templates`) to author **configurable
report templates**: parameterised sections (text / comment / fields / table /
DP-dataset + aggregation / checklist) with a **multi-level signature workflow**.
Templates are stored as `ReportBuilder_Template` DPs.

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared
report-builder code it reuses (`@visuelconcept-winccoa/wui-report-builder`) and the kit come
as its npm dependencies, and the page is built against the target's own import map
so the bundle always matches that runtime version (a page bundle is
coupled to the shell's import map).

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use report-templates   # npm-installs @visuelconcept-winccoa/wui-report-templates with its dependencies, selects it
npx wui build prod             # compiles the page into <project>/data/dashboard-wc/, upserts its menu entry
npx wui check prod
```

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- No backend module and no manager of its own — a pure frontend (Tier 1) page that talks to WinCC OA through the runtime.
- **Requires** the `para` and `app-security` backends (`wuiPage.requires` — deployed headless when those pages are not selected), see [module dependencies](../module-dependencies.md).
- No npm dependency beyond the `@visuelconcept-winccoa/wui-*` libs it reuses.

## Contents
```
package.json                                        npm package; wuiPage (route, tier 1)
src/report-templates.ts                             page entry (shared report-builder code imported from @visuelconcept-winccoa/wui-report-builder)
src/i18n.ts, src/app-security.roles.json            strings, the module's role catalog
menu.fragment.jsonc                                 1 menu entry (/report-templates, permission: connected)
```
