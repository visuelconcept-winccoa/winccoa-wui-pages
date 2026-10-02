# Integrate the Remote VNC page (`@visuelconcept-winccoa/wui-remote-vnc`) — source mode, Tier 3

**Standalone WinCC OA WebUI page** to manage **VNC connections** (1 DP each)
and open them **in the browser with embedded noVNC** (no plugin). This is a
**complete Tier 3**: frontend + backend module `/api/vnc` (HTTP **+ WebSocket↔TCP
relay** `/api/vnc/ws` via `registerRaw`) + a **Node manager `vncProxy`**
(vRPC service that resolves a connection *id* → `host:port` from the `RemoteVnc_`
DPs). Distributed as the npm package `@visuelconcept-winccoa/wui-remote-vnc`,
deployed with **wui-toolkit** (`wui` CLI): the shared kit and `@novnc/novnc` are npm
dependencies, and the page is **built against the target's own import map** (bundle =
correct version).

## Prerequisites
1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was equipped once with `npx wui init target prod`.
2. The **dashboard webserver** that `npx wui init target prod` installs: it hosts the `/api/vnc` route AND the **raw ws relay** on the uWebSockets app (it also provides `ws`). Its loader automatically mounts `routes` **and** `registerRaw`.
3. The npm dep `@novnc/novnc@1.4.0` (in the package's `dependencies`) is installed by npm with the package.

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use remote-vnc   # npm-installs @visuelconcept-winccoa/wui-remote-vnc (+ kit, @novnc/novnc), selects it
npx wui build prod       # pages + menu, /api/vnc backend + relay, vncProxy manager
npx wui check prod
```
`wui build`:
1. compiles the page (`@novnc/novnc` bundled) → `<project>/data/dashboard-wc/pages/`;
2. upserts the **2 menu entries** (list + hidden detail `/:connectionid`) into `menuconfig.json` (idempotent by `routeId`);
3. deploys the **backend module** → `<project>/javascript/customer-webserver/src/modules/remote-vnc/` and rebuilds the webserver;
4. deploys the **`vncProxy` manager** → `<project>/javascript/vncProxy/` (+ `npm install` if it has dependencies), and appends its line to `config/progs` when missing.

## After install (mandatory)
1. **Webserver**: **restart** the webserver manager (already rebuilt by `wui build`; it auto-mounts `/api/vnc` + the `/api/vnc/ws` relay).
2. **Manager**: start **`vncProxy`** in the WinCC OA console (vRPC service that resolves id → host:port). Check the manager order/number (`wui build` appended its `config/progs` line).
3. **Browser**: DevTools → Application → Storage → **`Clear site data`**, reload (**logged in**).
   ⚠️ The SW caches `menuconfig.json` → **`Ctrl+Shift+R` is not enough**.

## Verify
1. Logged in → **"Connexions VNC distantes"** (remote VNC connections) entry, `/remote-vnc` loads the list.
2. `GET https://<dashboard>/api/vnc/health` → `{ ok, service:"vnc", … }`.
3. Add a connection (creates `RemoteVnc_<id>`, type `RemoteVnc_Connection`), open it → noVNC connects via `/api/vnc/ws?id=<id>` (the relay opens the TCP to the `host:port` resolved by `vncProxy`).

## Notes / security
- The browser names only a **known id**; `vncProxy` holds the id → `host:port` mapping (no raw URL/socket on the client side → no SSRF / open proxy).
- The module mounts `/api/vnc/*` as `fullAccess` (demo) → restrict the `acl` in `<project>/javascript/customer-webserver/src/modules/remote-vnc/index.ts` before production (written once by `wui build`: a hand-tightened acl survives redeploys).
- `winccoa-manager` is provided by the WinCC OA runtime (not in the manager's `package.json`).
