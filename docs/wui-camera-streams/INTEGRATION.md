# Integrate the Camera Streams page (`@visuelconcept/wui-camera-streams`) — source mode, Tier 3

**Standalone WinCC OA WebUI page** to view **RTSP cameras** in the
browser (JSMpeg) without a plugin. This is a **complete Tier 3**: frontend + backend
module `/api/rtsp` (HTTP **+ WebSocket relay** via `registerRaw`) + a **Node
manager `rtspProxy`** (ffmpeg). **Self-contained source** distribution: the shared kit
is **vendored** under `_kit/` (no `@visuelconcept/wui-kit` prerequisite), and the
page is **built against the target's runtime workspace** (bundle = correct version).

## Prerequisites
1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. **`@visuelconcept/wui-webserver`** installed in the project: it hosts the `/api/rtsp` route AND the **raw ws relay** on the uWebSockets app (it also provides `ws`). Its loader automatically mounts `routes` **and** `registerRaw`.

## Install (one command)
```bash
node install.mjs --workspace <workspace-runtime> --project <project-root> --register-pmon
```
Example (WebDemo2):
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2 --register-pmon
```
The installer:
1. copies the **source** (vendored kit) → `<workspace>/…/standalone-pages/`;
2. inserts the **2 menu entries** → the workspace's `menuconfig.jsonc` (idempotent);
3. installs **`@cycjimmy/jsmpeg-player`** in the workspace (so that `build:pages` bundles it);
4. drops the **backend module** → `customer-webserver/src/modules/camera-streams/`;
5. deploys the **`rtspProxy` manager** → `<project>/javascript/rtspProxy/` + `npm install` (ffmpeg-static, rtsp-relay); with `--register-pmon`, adds the line to `config/progs`;
6. runs **`build:pages`** (OUT_DIR=`<project>/data/dashboard-wc`).

## After install (mandatory)
1. **Webserver**: `cd <project>/javascript/customer-webserver && npm run build`, then **restart** the webserver manager (it auto-mounts `/api/rtsp` + the `/api/rtsp/ws` relay).
2. **Manager**: start **`rtspProxy`** in the WinCC OA console (listens on `127.0.0.1:9999`). Check the manager order/number if pmon was edited.
3. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**.

## Verify
1. Logged in → **"Flux caméras (RTSP)"** (camera streams) entry, `/camera-streams` loads the list.
2. `GET https://<dashboard>/api/rtsp/health` → `{ ok, service:"rtsp", manager:"127.0.0.1:9999" }`.
3. Manager: `http://127.0.0.1:9999/health` → `{ ok, service:"rtsp", port:9999 }`.
4. Add a camera (creates `RtspCamera_<id>`), open the stream → the video appears (the `/api/rtsp/ws` relays to rtspProxy, a single shared RTSP connection).

## Notes / security
- The manager listens on **127.0.0.1 only** (never exposed to the network); the browser names only a **known id**, never a raw `rtsp://` URL (no SSRF / open proxy).
- The module mounts `/api/rtsp/*` as `fullAccess` (demo) → restrict the `acl` in `backend/modules/camera-streams/index.ts` before production.
- Manager port/host configurable via `RTSP_PROXY_PORT` / `RTSP_PROXY_HOST` (must match `RtspController`).
- `winccoa-manager` is provided by the WinCC OA runtime (not in the manager's package.json).
