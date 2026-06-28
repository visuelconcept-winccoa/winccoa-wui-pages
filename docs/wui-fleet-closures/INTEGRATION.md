# Integrate the Fleet Closures page (`@visuelconcept/wui-fleet-closures`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** for managing the fleet's **non-working days**
on **`/fleet-closures`**: year / workshop / machine filters, JSON import-export,
and overlap handling (replace / ignore / cancel). This is a **Tier 1**:
**frontend only** (no backend module, no manager).
**Self-contained source** distribution: the shared kit (kit / fleet-core / ai-kit)
is **vendored** under `_vendor/` (no `@visuelconcept/wui-kit` prerequisite), and the
page is **compiled against the target's runtime workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. No webserver / backend prerequisite (frontend-only page).

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <project-root>
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
The installer:
1. copies the **source** (kit vendored under `_vendor/`) → `<workspace>/…/standalone-pages/`;
2. inserts the **menu entry** → the workspace's `menuconfig.jsonc` (idempotent);
3. installs the page's **npm dependencies** (`three`) into the workspace (so `build:pages` bundles them);
4. runs **`build:pages`** (OUT_DIR=`<project>/data/dashboard-wc`).

## After install (mandatory)
1. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**; only `Clear site data` purges it.

## Verify
1. Logged in → the **`/fleet-closures`** page loads (the "Jours non travaillés" (non-working days) entry is `hidden`, reached from the fleet overview).
2. The year / workshop / machine filters work, and JSON import-export opens.

## Notes / security
- **No backend module or manager**: nothing to deploy, nothing to start, no `acl` to harden.
- The menu entry is `hidden` (navigation from the fleet overview) — not a regression, it is intentional.
