# @visuelconcept/wui-camera-streams — source module (Tier 3)

View **RTSP IP cameras** in the WinCC OA WebUI dashboard (JSMpeg, no plugin),
over a **same-origin `ws↔ws` relay** to a dedicated **`rtspProxy` manager**
(ffmpeg pulls each stream once and fans MPEG1-TS out to N clients).

Self-contained **source** distribution: the shared kit is **vendored** under
`_kit/` (no `@visuelconcept/wui-kit` prerequisite), and the page is built on the
target's runtime workspace (so the bundle matches its version).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root> [--register-pmon]
```
It (1) copies the page source into the workspace, (2) adds the menu entries,
(3) installs `@cycjimmy/jsmpeg-player` in the workspace, (4) drops the `/api/rtsp`
backend module into the webserver, (5) deploys + `npm install`s the **rtspProxy
manager** (and, with `--register-pmon`, adds it to `config/progs`), then
(6) runs `build:pages` into `<project>/data/dashboard-wc/`.

## After install (required)
1. **Webserver:** `cd <project>/javascript/customer-webserver && npm run build`, then restart the webserver manager (it auto-mounts `/api/rtsp` + the `/api/rtsp/ws` relay).
2. **Manager:** start **`rtspProxy`** in the WinCC OA console (listens on `127.0.0.1:9999`).
3. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**.

## Prerequisites
- A **WebUI Runtime workspace** (the `--workspace`).
- **`@visuelconcept/wui-webserver`** in the project (hosts the route + the raw uWS WebSocket relay; provides `ws`). See `dist-packages/README.md` for the ordered chain.

## Architecture
```
browser (JSMpeg) ──wss://<dashboard>/api/rtsp/ws?id=<id>──▶ customer-webserver  (relay, same origin: TLS+auth)
                                                          └─ ws://127.0.0.1:9999/api/rtsp/stream/<id> ─▶ rtspProxy
                                                                       └─ reads RtspCamera_<id>.json → ffmpeg → MPEG1-TS (1 pull, N clients)
```
Cameras are stored 1 DP each (`RtspCamera_<id>`, type `RtspCamera_Stream`); the browser only ever names a known id (no raw rtsp:// → no SSRF). The manager binds `127.0.0.1` only.

## Contents
```
module.json / install.mjs
frontend/standalone-pages/camera-streams.ts + camera-streams/   (page SOURCE; kit vendored in camera-streams/_kit/)
frontend/menu.fragment.jsonc                                    (2 entries: list + /:streamid detail)
backend/modules/camera-streams/                                 index.ts (mount + acl + routes + registerRaw) + rtspController/Route/Relay
manager/rtspProxy/                                              index.js + package.json (express, express-ws, ffmpeg-static, rtsp-relay)
```
