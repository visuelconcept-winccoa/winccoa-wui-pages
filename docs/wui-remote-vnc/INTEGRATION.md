# Integrate the Remote VNC page (`@visuelconcept/wui-remote-vnc`) — source mode, Tier 3

**Standalone WinCC OA WebUI page** to manage **VNC connections** (1 DP each)
and open them **in the browser with embedded noVNC** (no plugin). This is a
**complete Tier 3**: frontend + backend module `/api/vnc` (HTTP **+ WebSocket↔TCP
relay** `/api/vnc/ws` via `registerRaw`) + a **Node manager `vncProxy`**
(vRPC service that resolves a connection *id* → `host:port` from the `RemoteVnc_`
DPs). **Self-contained source** distribution: the shared kit is
**vendored** under `_vendor/` (no `@visuelconcept/wui-kit` prerequisite), and the
page is **built against the target's runtime workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. **`@visuelconcept/wui-webserver`** installed in the project: it hosts the `/api/vnc` route AND the **raw ws relay** on the uWebSockets app (it also provides `ws`). Its loader automatically mounts `routes` **and** `registerRaw`.
3. The npm dep `@novnc/novnc@1.4.0` (declared in `module.json`) is **installed automatically** in the workspace by the installer.

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <project-root> --register-pmon
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2 --register-pmon
```
The installer:
1. copies the **source** (vendored kit under `_vendor/`) → `<workspace>/…/standalone-pages/`;
2. inserts the **2 menu entries** (list + hidden detail `/:connectionid`) → the workspace's `menuconfig.jsonc` (idempotent by `routeId`);
3. installs **`@novnc/novnc@1.4.0`** in the workspace (so that `build:pages` bundles it);
4. drops the **backend module** → `customer-webserver/src/modules/remote-vnc/`;
5. deploys the **`vncProxy` manager** → `<project>/javascript/vncProxy/` + `npm install`; with `--register-pmon`, adds the line to `config/progs`;
6. runs **`build:pages`** (OUT_DIR=`<project>/data/dashboard-wc`).

## After install (mandatory)
1. **Webserver**: `cd <project>/javascript/customer-webserver && npm run build`, then **restart** the webserver manager (it auto-mounts `/api/vnc` + the `/api/vnc/ws` relay).
2. **Manager**: start **`vncProxy`** in the WinCC OA console (vRPC service that resolves id → host:port). Check the manager order/number if pmon was edited.
3. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**.

## Verify
1. Logged in → **"Connexions VNC distantes"** (remote VNC connections) entry, `/remote-vnc` loads the list.
2. `GET https://<dashboard>/api/vnc/health` → `{ ok, service:"vnc", … }`.
3. Add a connection (creates `RemoteVnc_<id>`, type `RemoteVnc_Connection`), open it → noVNC connects via `/api/vnc/ws?id=<id>` (the relay opens the TCP to the `host:port` resolved by `vncProxy`).

## Notes / security
- The browser names only a **known id**; `vncProxy` holds the id → `host:port` mapping (no raw URL/socket on the client side → no SSRF / open proxy).
- The module mounts `/api/vnc/*` as `fullAccess` (demo) → restrict the `acl` in `backend/modules/remote-vnc/index.ts` before production.
- `winccoa-manager` is provided by the WinCC OA runtime (not in the manager's `package.json`).
