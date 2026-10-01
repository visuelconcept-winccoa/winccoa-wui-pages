# Integrate the Fleet Closures page (`@visuelconcept-winccoa/wui-fleet-closures`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** for managing the fleet's **non-working days**
on **`/fleet-closures`**: year / workshop / machine filters, JSON import-export,
and overlap handling (replace / ignore / cancel). This is a **Tier 1**:
**frontend only** (no backend module, no manager).
Distributed as the npm package `@visuelconcept-winccoa/wui-fleet-closures`, deployed with
**wui-toolkit** (`wui` CLI): the shared kits (kit / fleet-core) are npm dependencies,
and the page is **compiled against the target's own import map** (bundle = correct version).

## Prerequisites
1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was equipped once with `npx wui init target prod`.
2. No webserver / backend prerequisite (frontend-only page).

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use fleet-closures   # npm-installs @visuelconcept-winccoa/wui-fleet-closures (+ its kits, three), selects it
npx wui build prod           # compiles the page, upserts its menu entry
npx wui check prod
```
`wui build`:
1. compiles the page (its npm dependencies, `three`, bundled) → `<project>/data/dashboard-wc/pages/`;
2. upserts the **menu entry** (`menu.fragment.jsonc`) into `menuconfig.json` (idempotent).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → the **`/fleet-closures`** page loads (the "Jours non travaillés" (non-working days) entry is `hidden`, reached from the fleet overview).
2. The year / workshop / machine filters work, and JSON import-export opens.

## Notes / security
- **No backend module or manager**: nothing to deploy, nothing to start, no `acl` to harden.
- The menu entry is `hidden` (navigation from the fleet overview) — not a regression, it is intentional.
