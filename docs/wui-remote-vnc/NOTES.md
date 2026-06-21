# wui-remote-vnc — business & architecture notes

Standalone WebUI page **Connexions VNC distantes** (`/remote-vnc`, entry `wui-remote-vnc`, class `WuiRemoteVnc`, sub-component prefix `rv-`). **Tier 3** module: frontend + backend module `/api/vnc` + manager `vncProxy`.

## Domain / purpose

Manage a **catalog of VNC access points** and open a VNC session **directly in the browser** thanks to the embedded **noVNC** client. Design choices made: in-browser noVNC + 1 DP per connection + stored password + "last connection" status (no fleet link, no groups/search to start with).

**Master/detail navigation driven by the shell router** (same principle as `/fleet-3d/:atelier`):
- `/remote-vnc` = the **list** (table: favorite star, endpoint, mode, last connection, "State" LED column; connect/edit/delete actions).
- `/remote-vnc/:connectionid` = the `rv-viewer` (noVNC) **viewer** for that connection — per-connection deep-linkable route, marked `hidden:true` in the menu (both routes point to `wui-remote-vnc`).

The parameter arrives via the `connectionid` attribute → `@property({attribute:'connectionid'}) connectionId`; `selectedConnection()` is derived from `connectionId` + `connections` (no internal "selected id" state). Connect → `dispatchEvent(new RouterEvent('/remote-vnc/<id>'))`; back / deletion of the current one → `RouterEvent('/remote-vnc')`. Opening (click or deep-link) timestamps `lastConnectedAt` client-side via the store.

## Data model (DPs)

- **1 DP per connection**, type `RemoteVnc_Connection` (Struct: `name` + `json`). DP name `RemoteVnc_<id>` on `System1`.
- Store pattern identical to AssetStore (asset-lifecycle / thermal-reports): auto-creation via PARA REST + offline fallback seeded with `DEMO_CONNECTIONS`.
- `VncConnection` model (`types.ts`): `name`/`host`/`port`/`password`/`description`/`group`/`viewOnly`/`shared`/`favorite`/`lastConnectedAt`, plus the timeout/reconnect parameters: `connectTimeoutSec`/`autoReconnect`/`reconnectDelaySec`/`maxReconnectAttempts` (defaults **15 s / true / 5 s / 3**; `maxReconnectAttempts:0` = unlimited). `blankConnection()` supplies the default values.
- **Import / export** (`data/io.ts`): common envelope `{kind:'remote-vnc-connections',version,connections}` for both the full catalog and a single connection. `parseConnections` accepts a bare array, the envelope, or a single connection object; import merges by `id` (update if existing, otherwise create). `io.normalize` fills in the defaults of old records.

## 3-tier architecture (raw binary relay)

End-to-end chain:
```
noVNC RFB (navigateur)
  → WebSocket wss://<dashboard>/api/vnc/ws?id=<connId>   (même origine)
  → relais webserver (websockify)
  → résout id → host:port via le manager VncProxy (vRPC)
  → socket TCP vers le serveur VNC, octets relayés dans les deux sens
```
The **RFB protocol and VNC auth are end-to-end**: the relay is just a byte pipe, and the **password is sent client-side by noVNC** (read from the DP). Keeping the `id → host:port` resolution server-side means the browser can only reach **known** connections (no open proxy / SSRF).

## Backend / manager (Tier 3)

**Manager `vncProxy`** (`manager/vncProxy`, pmon `node | always`, idx 19 in WebDemo1) — vRPC service **`VncProxy`** based on `winccoa-manager` Vrpc (`ServiceBase` + `registerFunction`, `ServiceContainer.startAllServices`, same mold as the productInfo manager). Two methods:
- **`Resolve(id)`** → JSON `{ok,host,port,name}`: validates `id` (`^[A-Za-z0-9_-]{1,64}$`), reads `System1:RemoteVnc_<id>.json`, returns host/port (port 1..65535).
- **`Status()`** → JSON `{id:{reachable,checkedAt,detail}}`: exposes the cache of the **cyclic TCP reachability test** (see below).

**Reachability test** (in the manager, independent of open sessions): `net.connect host:port` (timeout 4 s, cycle 25 s, concurrency 8) on **all** connections enumerated by `winccoa.dpNames('*','RemoteVnc_Connection')`. Only answers "does the configured socket respond?" — **no RFB handshake**. Result cached in `statusById`.

**Webserver module `/api/vnc`** (`remote-vnc` backend module, hosted by the customer webserver, idx 13 in WebDemo1):
- `vncController`: `resolveVncTarget(id)` (vRPC stub to `VncProxy.Resolve`, hidden stub recreated on error) + `fetchVncStatus()` (to `Status()`) + `health`/`resolve` diagnostics.
- `vncRoute`: `GET /health`, `GET /resolve?id=`, `GET /status`.
- **`vncRelay` = the websockify**: `registerVncRelay(app)` calls `app.uwsApp.ws('/api/vnc/ws', behavior)`. UltimateExpress (on uWebSockets.js) exposes the raw uWS app via **`app.uwsApp`** → native uWS binary WS, same port/TLS, **no `ws` npm dependency**. Cycle: `upgrade` stores `{id}` in userData; `open` resolves + `net.connect` + flushes queued client bytes; `message` **copies** the ArrayBuffer (`Buffer.from(new Uint8Array(message))` — the uWS message is only valid during the callback) then `tcp.write`; TCP `data` → `ws.send(buf,true)` with backpressure handling (`getBufferedAmount` > 8 MB → `sock.pause()`, resume on `drain`); `close`/errors tear everything down. **`registerVncRelay` must be called before `listen`** (in `defineRoutes()`).

## Frontend

`novnc.d.ts` = ambient module `declare module '@novnc/novnc/core/rfb.js'` (noVNC ships no types). **rv-viewer** builds the ws URL (`wss:`/`ws:` depending on `location.protocol`), `new RFB(div, url, {shared, credentials:{password}})`, handles `viewOnly`/`scaleViewport` and the connect/disconnect/credentialsrequired/securityfailure events; toolbar = Ctrl+Alt+Delete / fullscreen / disconnect / reconnect.

**Reconnect state machine**: a `connectTimer` aborts a stuck connection → `scheduleReconnect`; `disconnect` event with `clean===false` → reconnect, `clean===true` / manual / auth failure → stop. **Stale-rfb guard**: compare the `rfb` captured in the event against `this.rfb` (teardown sets `this.rfb` to null first to ignore its own `disconnect`). The bar shows "Disconnect" during activity (connecting/connected/reconnecting), otherwise "Reconnect"; the banner shows the retry countdown.

**State polling**: `WuiRemoteVnc` queries `GET /api/vnc/status` every 5 s (connected/disconnectedCallback, `refreshStatus`); `rv-connection-table` shows a "State" LED column (🟢 ok / 🔴 ko / ⚪ unknown + reason tooltip + time).

## Pitfalls / things to know

- **noVNC pinned to 1.4.0** (npmDep `@novnc/novnc: 1.4.0`, bundled in `remote-vnc.js`) — DO NOT bump to 1.7.0:
  1. 1.7.0 uses a **top-level await** (WebCodecs H264 detection) that the pages vite target (es2020 / chrome87) rejects → broken build; 1.4.0 has no TLA.
  2. **Version-dependent import path**: 1.7.0 has `exports:"./core/rfb.js"` (bare `@novnc/novnc`); **1.4.0 has NEITHER `exports` NOR `main`** → import the file directly `@novnc/novnc/core/rfb.js` (the module name in the `.d.ts` must match).
- **The uWS message is only valid during the callback**: always copy (`Buffer.from(new Uint8Array(message))`) before any async use (`tcp.write`).
- **Backpressure mandatory** on the relay: watch `ws.getBufferedAmount()`, pause the TCP socket above the threshold (8 MB), resume on `drain` — otherwise memory blowup on dense sessions.
- **`registerVncRelay` before `listen`**; the uWS interaction (`app.uwsApp.ws`) vs UltimateExpress (`any('/*')`) is a risk to verify first when doing a new integration.
- **Security**: `/api/vnc/*` is unauthenticated (`fullAccess`) like the other bridges, and the WS upgrade bypasses the Express ACL anyway → to be hardened before production. The **password is stored in clear text** in the DP (and **exported in clear text** in import/export files) — warned in the dialog.
- The reachability test validates **only the TCP socket**, not the auth or the RFB handshake: a 🟢 does not guarantee a session will succeed.
- Resolved-parameter helpers = **private methods, not getters** (typescript-eslint member-ordering forbids private accessors after public methods).
- The dialog's `willUpdate` back-fills the defaults of old records via `{...blankConnection(), ...clone}`.
- After modifying the manager: restart `vncProxy`. To activate or refresh `/api/vnc/*` (relay, `/health`, `/status`): the customer webserver must be restarted (the backend module only serves its routes after a restart).
