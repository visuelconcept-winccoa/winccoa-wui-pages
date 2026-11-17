# @visuelconcept-winccoa/wui-camera-streams — source module (Tier 3)

View **RTSP IP cameras** in the WinCC OA WebUI dashboard (JSMpeg, no plugin),
over a **same-origin `ws↔ws` relay** to a dedicated **`rtspProxy` manager**
(ffmpeg pulls each stream once and fans MPEG1-TS out to N clients).

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared kit comes as
its npm dependency, and the page is built against the target's own import map (so
the bundle matches its runtime).

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use camera-streams
npx wui build prod
npx wui check prod
```
`wui use` npm-installs the package with its kit and `@cycjimmy/jsmpeg-player`;
`wui build` (1) compiles the page into `<project>/data/dashboard-wc/`, (2) adds the
menu entries, (3) deploys the `/api/rtsp` backend module into the webserver and
rebuilds it, (4) deploys + `npm install`s the **rtspProxy manager** and appends it
to `config/progs` when missing.

## After install (required)
1. **Webserver:** restart the webserver manager (already rebuilt by `wui build`; it auto-mounts `/api/rtsp` + the `/api/rtsp/ws` relay).
2. **Manager:** start **`rtspProxy`** in the WinCC OA console (listens on `127.0.0.1:9999`).
3. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**.

## Prerequisites
- A **wui-toolkit site** for the project (`npx wui init target prod` done once).
- The **dashboard webserver** installed by `npx wui init target prod` (hosts the route + the raw uWS WebSocket relay; provides `ws`).

## Architecture
```
browser (JSMpeg) ──wss://<dashboard>/api/rtsp/ws?id=<id>──▶ customer-webserver  (relay, same origin: TLS+auth)
                                                          └─ ws://127.0.0.1:9999/api/rtsp/stream/<id> ─▶ rtspProxy
                                                                       └─ reads RtspCamera_<id>.json → ffmpeg → MPEG1-TS (1 pull, N clients)
```
Cameras are stored 1 DP each (`RtspCamera_<id>`, type `RtspCamera_Stream`); the browser only ever names a known id (no raw rtsp:// → no SSRF). The manager binds `127.0.0.1` only.

## USB camera of this PC (local mode, ≥ 0.2.0)
Besides RTSP, a camera entry can be a **USB camera / webcam plugged into the PC that runs the
browser** — "Source → USB camera of this PC (webcam)" in the camera dialog. The browser captures
it itself (`navigator.mediaDevices.getUserMedia`, **video only**) into a
`<video autoplay muted playsinline>` in the usual viewer (`/camera-streams/<id>`, so also in a
Mosaic camera tile). Nothing goes through the server: no `/api/rtsp/ws`, no rtspProxy, no ffmpeg;
the video never leaves the browser.
```
browser ──getUserMedia──▶ USB camera of the same PC   (nothing sent to the server)
```
**How it is stored.** Like any camera: one `RtspCamera_<id>` DP, holding `kind: "local"`, the
name/group/description and a **resolution preset** (`localResolution`: default, 640 × 480,
1280 × 720, 1920 × 1080 — asked as an `ideal`, so a camera that cannot do it still opens). It has
no URL nor credentials. **Which physical device** to open is **not** in the DP: device ids are
per PC, per browser profile and per origin, so every browser picks its own camera in the viewer
toolbar (shown when it has more than one) and remembers it in `localStorage`, key
`wui-camera-streams.local-device.<cameraId>` → `{ deviceId, label }` (the label finds the same
camera again when the browser rotates its ids, e.g. after site data is cleared). One shared entry
"Webcam" therefore opens each viewer's own webcam.

**Requirements and states shown by the viewer**
- **Secure context**: browsers allow camera capture on **HTTPS** or **http://localhost** only. On
  plain HTTP the viewer says so (nothing else can be done from the page).
- **Permission**: until access was granted once, browsers hide the cameras' names. The viewer then
  shows **"Allow camera access"**: one click asks the browser, opens the camera and lists the
  devices by name. Once granted (remembered by the browser), it opens at once.
- **Denied**: explains how to allow it — camera / padlock icon of the address bar → Camera:
  Allow → Retry; and the OS privacy settings (camera access for the browser).
- **No camera found**, **camera busy** (used by another application or browser —
  `NotReadableError`), **selected camera gone** (the viewer forgets it and opens the browser's
  default), **camera unplugged while live**.
- The camera is **released** (every track stopped, LED off) on Back, Stop, leaving the page, and
  when another entry / device / resolution is opened.
- **Mosaic tile**: the tile embeds the same viewer (same-origin iframe, toolbar hidden,
  read-only). It opens the camera this browser remembered; grant the permission once on the
  Camera Streams page first (a click in a read-only tile cannot do it).

The table shows "USB camera of this PC" as endpoint, a **USB** chip, and no reachability LED /
client count (the server never sees the stream). The rtspProxy manager ignores `kind: "local"`
entries (no pull, no relay, no probe). Roles: creating/editing one is the existing **`edit`**
role, viewing it the existing **`view`** role (no new role: nothing leaves the viewer's PC, and the
browser's own permission prompt guards the device).

## Snapshot (≥ 0.3.0)
`GET /api/rtsp/snapshot/<id>` → one JPEG frame of an **RTSP** camera, pulled by the rtspProxy
manager (ffmpeg, first decoded frame, 10 s limit) and relayed by the webserver. Role
`camera-streams/view`. 404 for an unknown or USB camera, 502 no frame, 503 manager not running.
City Drive's photo booth uses it; any page can (declare `camera-streams` in its
`wuiPage.requires` or `optional`).

## Contents
```
package.json                                                    npm package; wuiPage.backend (mount, routes, relayFn registerRtspRelay, manager)
src/camera-streams.ts + camera-streams/                         (page source; ui/cs-local-viewer.ts + data/local-camera.ts = USB camera mode)
CHANGELOG.md                                                    versions and upgrade notes
menu.fragment.jsonc                                             (2 entries: list + /:streamid detail)
backend/                                                        rtspController/Route/Relay (the index.ts descriptor is generated by wui build)
managers/rtspProxy/                                             index.js + package.json (express, express-ws, ffmpeg-static, rtsp-relay)
```
