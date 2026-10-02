# Integrate the Camera Streams page (`@visuelconcept-winccoa/wui-camera-streams`) — source mode, Tier 3

**Standalone WinCC OA WebUI page** to view **RTSP cameras** in the
browser (JSMpeg) without a plugin. This is a **complete Tier 3**: frontend + backend
module `/api/rtsp` (HTTP **+ WebSocket relay** via `registerRaw`) + a **Node
manager `rtspProxy`** (ffmpeg). Distributed as the npm package
`@visuelconcept-winccoa/wui-camera-streams`, deployed with **wui-toolkit** (`wui` CLI): the
shared kit and `@cycjimmy/jsmpeg-player` are npm dependencies, and the page is
**built against the target's own import map** (bundle = correct version).

## Prerequisites
1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was equipped once with `npx wui init target prod`.
2. The **dashboard webserver** that `npx wui init target prod` installs (`javascript/customer-webserver`): it hosts the `/api/rtsp` route AND the **raw ws relay** on the uWebSockets app (it also provides `ws`). Its loader automatically mounts `routes` **and** `registerRaw`.

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use camera-streams   # npm-installs @visuelconcept-winccoa/wui-camera-streams (+ kit, jsmpeg-player), selects it
npx wui build prod           # pages + menu, /api/rtsp backend, rtspProxy manager
npx wui check prod
```
`wui build`:
1. compiles the page (`@cycjimmy/jsmpeg-player` bundled) → `<project>/data/dashboard-wc/pages/`;
2. upserts the **2 menu entries** into `menuconfig.json` (idempotent by `routeId`);
3. deploys the **backend module** → `<project>/javascript/customer-webserver/src/modules/camera-streams/` and rebuilds the webserver (tsc);
4. deploys the **`rtspProxy` manager** → `<project>/javascript/rtspProxy/` + `npm install` (ffmpeg-static, rtsp-relay), and appends its line to `config/progs` when missing.

## After install (mandatory)
1. **Webserver**: **restart** the webserver manager (already rebuilt by `wui build`; it auto-mounts `/api/rtsp` + the `/api/rtsp/ws` relay).
2. **Manager**: start **`rtspProxy`** in the WinCC OA console (listens on `127.0.0.1:9999`). Check the manager order/number in the console (`wui build` appended its `config/progs` line).
3. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**.

## Verify
1. Logged in → **"Flux caméras (RTSP)"** (camera streams) entry, `/camera-streams` loads the list.
2. `GET https://<dashboard>/api/rtsp/health` → `{ ok, service:"rtsp", manager:"127.0.0.1:9999" }`.
3. Manager: `http://127.0.0.1:9999/health` → `{ ok, service:"rtsp", port:9999 }`.
4. Add a camera (creates `RtspCamera_<id>`), open the stream → the video appears (the `/api/rtsp/ws` relays to rtspProxy, a single shared RTSP connection).

## Notes / security
- The manager listens on **127.0.0.1 only** (never exposed to the network); the browser names only a **known id**, never a raw `rtsp://` URL (no SSRF / open proxy).
- The module mounts `/api/rtsp/*` as `fullAccess` (demo) → restrict the `acl` in `<project>/javascript/customer-webserver/src/modules/camera-streams/index.ts` before production (written once by `wui build`: a hand-tightened acl survives redeploys).
- Manager port/host configurable via `RTSP_PROXY_PORT` / `RTSP_PROXY_HOST` (must match `RtspController`).
- `winccoa-manager` is provided by the WinCC OA runtime (not in the manager's package.json).
