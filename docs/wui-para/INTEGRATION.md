# Integrate the PARA page (`@visuelconcept/wui-para`) — source mode

**Standalone WinCC OA WebUI page** (Type→DP→element tree + edit/create/
rename/delete). Distributed as **source**: it is **compiled against the target's
runtime workspace**, so the bundle always matches the runtime version (a page
bundle is coupled to the shell's import map — that's the pitfall we hit: a
pre-built `.js` from another version won't work).

## Prerequisites
1. The target has a **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) that builds its dashboard — that's the `--workspace`. (cf. the official process, `dist-packages/README.md`.)
2. **`@visuelconcept/wui-webserver`** is installed in the project (provides `/api/para` via backend module auto-discovery).

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet-winccoa>
```
Example (WebDemo2 case):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
The installer:
1. copies the page's **source** → `<workspace>/libs/default-components/src/lib/standalone-pages/`;
2. inserts the menu entry → `<workspace>/apps/dashboard-wc/config/menuconfig.jsonc` (idempotent);
3. copies the **backend module** → `<projet>/javascript/customer-webserver/src/modules/para/`;
4. runs **`build:pages`** in the workspace with `OUT_DIR=<projet>/data/dashboard-wc` → `para.js` compiled **against the correct runtime** + `menuconfig.json` redeployed.

## After install (mandatory)
1. **Backend**: `cd <projet>/javascript/customer-webserver && npm run build`, then **restart** the webserver manager (it compiles and auto-mounts the `/api/para` module).
2. **Browser**: DevTools → Application → Storage → **`Clear site data`**, then reload (**logged in**).
   ⚠️ The service worker caches `menuconfig.json` → **`Ctrl+Shift+R` is NOT enough**, only `Clear site data` purges it. (This is what blocked us.)

## Verify
1. Logged in → the **"Paramétrage"** entry appears, `/para` loads the type tree.
2. `GET https://<dashboard>/api/para/health` → `{ ok, service:"para" }`.
3. Edit a value / create a DP → `POST /api/para/dp/set` (or `/dp/create`) 200.

## Security
The module mounts `/api/para/*` as `fullAccess` (demo). Before prod, restrict the `acl`
in `backend/modules/para/index.ts` (e.g. `{ allowUsers: ['root','engineer'] }`).
The page is `permission: ["connected"]` (reserved for logged-in users).
