# Integrate the Report Templates page (`@visuelconcept-winccoa/wui-report-templates`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** (`/report-templates`) for creating **configurable
report templates**: parameterizable sections (text / comment / fields / table /
DP dataset + aggregation / checklist) with a **multi-level signature workflow**.
Templates are stored in `ReportBuilder_Template` DPs. This is a **Tier 1** (pure
frontend, no backend or manager). Distributed as the npm package
`@visuelconcept-winccoa/wui-report-templates`, deployed with **wui-toolkit** (`wui` CLI): the
reused report-builder code and the shared kit are npm dependencies
(`@visuelconcept-winccoa/wui-report-builder`, `@visuelconcept-winccoa/wui-kit`), and the page is
**compiled against the target's own import map** (bundle = correct version).

## Prerequisites
1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was equipped once with `npx wui init target prod`.
2. No backend module or manager required: the page communicates with WinCC OA via the runtime. The dashboard webserver is **not** needed for this module.

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use report-templates   # npm-installs @visuelconcept-winccoa/wui-report-templates (+ report-builder, kit), selects it
npx wui build prod             # compiles the page, upserts its menu entry
npx wui check prod
```
`wui build`:
1. compiles the page → `<project>/data/dashboard-wc/pages/`;
2. upserts the **menu entry** (`menu.fragment.jsonc`) into `menuconfig.json` (idempotent).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → the **"Modèles de rapports"** (Report Templates) entry appears in the menu.
2. `/report-templates` loads and displays the template list (`ReportBuilder_Template`).
3. Create / edit a template (parameterizable sections + signature workflow) → saving creates/updates a `ReportBuilder_Template` DP.

## Notes / security
- **Pure frontend** module: no `/api/*` endpoint exposed, no Node manager to start — nothing to harden on the ACL/network side for this package.
- Persistence goes through `ReportBuilder_Template` DPs (generic `DpJsonStore` base); access rights rely on the project's existing WinCC OA / WebUI ACLs.
- The menu entry is at `connected` permission; restrict the permission in `menu.fragment.jsonc` if access must be limited.
