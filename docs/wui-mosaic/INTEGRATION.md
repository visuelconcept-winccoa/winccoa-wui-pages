# Integrate the Mosaic page (`@visuelconcept-winccoa/wui-mosaic`) — source mode, Tier 1

**Standalone WinCC OA WebUI page**: a free-form **display wall** (drag/resize)
that embeds other dashboard views as **same-origin chromeless iframes**.
This is a **Tier 1 frontend-only** page (no backend module, no manager).
Each wall is stored in a DP (`Mosaic_Board`) + a preview list.
Distributed as the npm package `@visuelconcept-winccoa/wui-mosaic`, deployed with
**wui-toolkit** (`wui` CLI): the shared kit is an npm dependency, and the page is
**compiled against the target's own import map** (bundle = correct version).

## Prerequisites
1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was equipped once with `npx wui init target prod`.
2. No backend prerequisite (frontend-only page), no npm dependency beyond `@visuelconcept-winccoa/wui-kit`.
3. The shell's **`?embed` (chromeless) flag** — see [NOTES.md](./NOTES.md). It is a patch of the
   WebUI shell, **not applied by wui-toolkit** (`wui init target` deploys the pristine shell):
   without it the tiles show the embedded views with the full shell chrome (header + menu).

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use mosaic     # npm-installs @visuelconcept-winccoa/wui-mosaic (+ its kit) and selects it
npx wui build prod     # compiles the page, upserts its menu entries
npx wui check prod
```
`wui build`:
1. compiles the page against the target's import map → `<project>/data/dashboard-wc/pages/`;
2. upserts the **menu entries** (`menu.fragment.jsonc`) into `menuconfig.json` (idempotent).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

No webserver to recompile and no manager to start (frontend-only page).

## Verify
1. Logged in → the **"Mosaic"** entry appears in the menu, `/mosaic` loads the list of walls.
2. Create a wall (creates a `Mosaic_Board` DP), add tiles → the embedded views display as same-origin chromeless iframes.

## Notes / security
- **Frontend-only** page: no `/api/*` route, no manager — nothing to harden on the backend side.
- The iframes are **same-origin** only (views of the same dashboard, chromeless): no arbitrary external URL embedded.
- Nothing stores a secret on the page side: walls only contain references to internal views (DP `Mosaic_Board`).
