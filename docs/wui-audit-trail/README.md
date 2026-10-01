# @visuelconcept-winccoa/wui-audit-trail — source module (Tier 1)

**GxP Audit Trail** page for a WinCC OA WebUI dashboard, built on the **fixed
`_AuditTrail` datapoint type** (time / username / item / action / oldval →
newval / reason / …). It **manages** the project's `_AuditTrail` datapoints
(create — always NGA-archived — reassign archive group, delete) and **views**
the archived history of the selected one as a **log table**: default rolling
**last 24 h live**, with a **start/end datetime** range, a **global search**,
**per-column filters + click-to-sort headers**, and **CSV / JSON export +
print** (of the filtered/sorted view). View state is persisted to an
**`AuditTrail_Config` DP** (search/filters/sort stay transient).

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared kit
(`@visuelconcept-winccoa/wui-kit`) comes as its npm dependency, and the page is built
against the target's own import map (so the bundle matches its runtime).

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use audit-trail   # npm-installs @visuelconcept-winccoa/wui-audit-trail with its kit, selects it
npx wui build prod        # compiles the page into <project>/data/dashboard-wc/, upserts its menu entry
npx wui check prod
```

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- No backend module and no manager — this is a **frontend-only Tier 1** page.
- No npm dependency beyond `@visuelconcept-winccoa/wui-kit`.

## Prerequisites (runtime)

- At least one **active NGA archive group** (`_NGA_Group` with `.active` set). Creating an audit DP requires it (archiving is mandatory); the manager shows a warning when none exist.
- Audit **records** are written by WinCC OA's audit mechanism / panels / scripts — this page only creates/archives the DPs and visualizes them.

## Contents
```
package.json                                        npm package; wuiPage (route, tier 1)
src/audit-trail.ts                                  page entry
src/app-security.roles.json                         the module's role catalog
src/audit-trail/                                    page sub-components
  ├─ types.ts            fixed _AuditTrail fields + AuditConfig
  ├─ engine.ts           NGA history query + pivot (one row per record)
  ├─ dp-admin.ts         list/create/archive/delete _AuditTrail DPs (PARA REST)
  ├─ at-manage-dialog.ts DP manager popup (create / archive group / delete)
  ├─ export.ts           CSV / JSON download + print view
  └─ config-store.ts     AuditTrail_Config persistence (DpSingleJsonStore)
menu.fragment.jsonc                                 menu entry (permission: connected)
```
