# @visuelconcept/wui-remote-vnc — source module (Tier 3)

Manage **VNC connections** (1 DP each) in the WinCC OA WebUI dashboard and open
them **in-browser with bundled noVNC** — no plugin. The RFB stream rides a
**same-origin `/api/vnc/ws` WebSocket↔TCP relay** to the **`vncProxy` manager**,
which resolves a connection *id* → `host:port` from the `RemoteVnc_` DPs (the
id→host:port map stays server-side, so the browser never names a raw socket).

Self-contained **source** distribution: the shared kit is **vendored** under
`_vendor/` (no separate `@visuelconcept/wui-kit` prerequisite), and the page is
built on the target's runtime workspace (so the bundle matches its version).

## Install (one command)
```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root> --register-pmon
```
It (1) copies the page source (vendored kit) into the workspace, (2) adds the
menu entries, (3) installs `@novnc/novnc@1.4.0` in the workspace (so `build:pages`
bundles it), (4) drops the `/api/vnc` backend module into the webserver, (5)
deploys + `npm install`s the **`vncProxy` manager** (and, with `--register-pmon`,
adds it to `config/progs`), then (6) runs `build:pages` into `<project>/data/dashboard-wc/`.

## After install (required)
1. **Webserver:** `cd <project>/javascript/customer-webserver && npm run build`, then restart the webserver manager (it auto-mounts `/api/vnc` + the `/api/vnc/ws` relay).
2. **Manager:** start **`vncProxy`** in the WinCC OA console (vRPC service that resolves connection id → host:port).
3. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**; only `Clear site data` purges it.

## Prerequisites
- A **WebUI Runtime workspace** (the `--workspace`).
- **`@visuelconcept/wui-webserver`** in the project (hosts the `/api/vnc` route **and** the raw uWS WebSocket relay; provides `ws`). See `dist-packages/README.md` for the ordered chain.
- The npm dep in `module.json` (`@novnc/novnc@1.4.0`) is **auto-installed** into the workspace by the installer.

## Contents
```
module.json / install.mjs
frontend/standalone-pages/remote-vnc.ts + remote-vnc/   (page SOURCE; kit vendored in remote-vnc/_vendor/)
frontend/menu.fragment.jsonc                            (2 entries: list + /:connectionid detail, hidden)
backend/modules/remote-vnc/                             index.ts (mount /api/vnc + acl + routes + raw ws relay) + vncController/Route/Relay
manager/vncProxy/                                       index.js + package.json (vRPC: id → host:port resolver)
```
