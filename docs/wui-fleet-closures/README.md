# @visuelconcept-winccoa/wui-fleet-closures — source module (Tier 1)

Manage **non-working days** for the fleet on the **`/fleet-closures`** page:
year / workshop / machine filters, JSON import-export, and overlap handling
(replace / ignore / cancel). Frontend-only — no backend module, no manager.

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared kit /
fleet-core come as its npm dependencies, and the page is built against the target's
own import map so the bundle always matches that runtime version (a page bundle is coupled to the shell's import map).

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use fleet-closures   # npm-installs @visuelconcept-winccoa/wui-fleet-closures with its kits, selects it
npx wui build prod           # compiles the page into <project>/data/dashboard-wc/, upserts its menu entry
npx wui check prod
```

## After install (required)
1. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- No webserver / backend prerequisite (frontend-only page).
- npm deps (`three`, via `@visuelconcept-winccoa/wui-fleet-core`) are installed by npm with the package and bundled by `wui build`.

## Contents
```
package.json                                         npm package; wuiPage (route, tier 1)
src/fleet-closures.ts                                page entry
src/i18n.ts, src/app-security.roles.json             strings, the module's role catalog
menu.fragment.jsonc                                  menu entry (1 entry, hidden — reached from the fleet overview)
```
