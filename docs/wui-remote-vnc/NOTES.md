# wui-remote-vnc — business & architecture notes

Standalone WebUI page **Connexions VNC distantes** (remote VNC connections) (`/remote-vnc`, entry `wui-remote-vnc`, class `WuiRemoteVnc`, sub-component prefix `rv-`). **Tier 3** module: frontend + backend module `/api/vnc` + manager `vncProxy`.

## Domain / purpose

Manage a **catalog of VNC access points** and open a VNC session **directly in the browser** thanks to the embedded **noVNC** client. Design choices made: in-browser noVNC + 1 DP per connection + stored password + "last connection" status (no fleet link, no groups/search to start with).

**Master/detail navigation driven by the shell router** (same principle as `/fleet-3d/:atelier`):
- `/remote-vnc` = the **list** (table: favorite star, endpoint, mode, last connection, "State" LED column; connect/edit/delete actions).
- `/remote-vnc/:connectionid` = the public **`<wui-vnc-viewer connection-id back fill>`** element (noVNC) for that connection — per-connection deep-linkable route, marked `hidden:true` in the menu (both routes point to `wui-remote-vnc`). The same element is what other modules embed ([EMBEDDING.md](EMBEDDING.md)).

The parameter arrives via the `connectionid` attribute → `@property({attribute:'connectionid'}) connectionId`; when set, the page renders the viewer with that id (the element itself loads the connection and shows "not found"). Connect → `dispatchEvent(new RouterEvent('/remote-vnc/<id>'))`; back / deletion of the current one → `RouterEvent('/remote-vnc')`, and the list is reloaded. `lastConnectedAt` is stamped **server-side by the relay** when a session opens (since 0.2; the page used to write it, which would now need the `edit` role).

## Data model (DPs)

- **1 DP per connection**, type `RemoteVnc_Connection` (Struct: `name` + `json`). DP name `RemoteVnc_<id>` on `System1`.
- **Read and written by the backend** (`backend/vncStore.ts`, through `WsjServerGlobal.winccoa`), behind this module's routes — since 0.2. The page's `data/connection-store.ts` is an HTTP client of those routes, with the same offline fallback as before (in-memory `DEMO_CONNECTIONS`, `offline` notice) when `/api/vnc` does not answer. Until 0.1 it was a wui-kit `DpJsonStore` writing over `/api/para`. The type is still auto-created on first creation; the DP format (`name` + `json` holding the whole record, `id` and `dp` included) is unchanged.
- `VncConnection` model (`types.ts`): `name`/`host`/`port`/`password`/`description`/`group`/`viewOnly`/`shared`/`favorite`/`lastConnectedAt`, plus the timeout/reconnect parameters: `connectTimeoutSec`/`autoReconnect`/`reconnectDelaySec`/`maxReconnectAttempts` (defaults **15 s / true / 5 s / 3**; `maxReconnectAttempts:0` = unlimited). `blankConnection()` supplies the default values. On the client `password` is **write-only** (`password?`: sent to set or remove it, absent = keep) and `hasPassword` is what the backend answers.
- **Import / export** (`data/io.ts`): common envelope `{kind:'remote-vnc-connections',version,connections}` for both the full catalog and a single connection. `parseConnections` accepts a bare array, the envelope, or a single connection object; import merges by `id` (update if existing, otherwise create). `io.normalize` fills in the defaults of old records. Exports carry **no password** since 0.2 (the browser never has it); an imported record sets the password only when the file holds one (0.1 exports do), else the stored one is kept.

## 3-tier architecture (raw binary relay)

End-to-end chain:
```
viewer (browser)
  → POST /api/vnc/session {id}            role `connect` → one-shot ticket (30 s, bound to id + user)
noVNC RFB (browser)
  → WebSocket wss://<dashboard>/api/vnc/ws?id=<connId>&ticket=<ticket>   (same origin)
  → webserver relay: consumes the ticket, re-checks `connect` for the ticket's user
  → resolves id → host:port via the VncProxy manager (vRPC)
  → TCP socket to the VNC server
  → RFB handshake brokered by the relay: VNC auth answered with the password read server-side,
    the browser is offered security type None
  → then bytes relayed both ways
```
Keeping the `id → host:port` resolution server-side means the browser can only reach **known** connections (no open proxy / SSRF). Since 0.2 the **VNC authentication is done by the relay** (`backend/rfbBroker.ts` + `backend/vncAuth.ts`): the password never leaves the webserver. Before, the relay was a pure byte pipe and noVNC sent the password, read from the DP by the browser.

**Relay-side VNC authentication** (`rfbBroker.ts`): the relay greets the browser as an RFB 3.8 server offering only None (1), and in parallel talks to the VNC server as a client (3.3 / 3.7 / 3.8, same version table as noVNC 1.4): it picks VNC Authentication (2) when a password is stored, None when the server offers it, else VNC auth with an empty password; answers the 16-byte challenge with DES (`vncAuth.ts` — a small FIPS 46-3 implementation, since OpenSSL 3 in the webserver's Node refuses `des-ecb`; checked against OpenSSL's legacy provider and noVNC's `des.js`); then sends the browser SecurityResult OK, or failed + the server's reason (noVNC raises `securityfailure` with it, the viewer shows it and does not retry). Other server security types (VeNCrypt-only, RealVNC RA2, Apple ARD, UltraVNC MS-Logon) are **refused with a clear reason** — such servers must offer "VNC password" authentication; before 0.2 noVNC could negotiate some of them itself (with the stored password only). Handshake timeout 20 s.

## Backend / manager (Tier 3)

**Manager `vncProxy`** (`manager/vncProxy`, pmon `node | always`, idx 19 in WebDemo1) — vRPC service **`VncProxy`** based on `winccoa-manager` Vrpc (`ServiceBase` + `registerFunction`, `ServiceContainer.startAllServices`, same mold as the productInfo manager). Two methods:
- **`Resolve(id)`** → JSON `{ok,host,port,name}`: validates `id` (`^[A-Za-z0-9_-]{1,64}$`), reads `System1:RemoteVnc_<id>.json`, returns host/port (port 1..65535).
- **`Status()`** → JSON `{id:{reachable,checkedAt,detail}}`: exposes the cache of the **cyclic TCP reachability test** (see below).

**Reachability test** (in the manager, independent of open sessions): `net.connect host:port` (timeout 4 s, cycle 25 s, concurrency 8) on **all** connections enumerated by `winccoa.dpNames('*','RemoteVnc_Connection')`. Only answers "does the configured socket respond?" — **no RFB handshake**. Result cached in `statusById`.

**Webserver module `/api/vnc`** (`remote-vnc` backend module, hosted by the customer webserver, idx 13 in WebDemo1):
- `vncController`: `resolveVncTarget(id)` (vRPC stub to `VncProxy.Resolve`, hidden stub recreated on error) + `fetchVncStatus()` (to `Status()`) + `health`/`resolve` diagnostics, plus (0.2) the connection handlers over `vncStore` and the session-ticket handler.
- `vncRoute` (roles in brackets, `vncGuard.requireVncRole`): `GET /health` (open; reports `relay`), `GET /status` [view|connect], `GET /connections` [view|connect], `GET /connection/:id` [connect], `POST /connection` · `PUT /connection/:id` · `DELETE /connection/:id` [edit, audited], `POST /connection/:id/favorite` [view], `POST /session` [connect], `GET /resolve?id=` [connect].
- `vncStore`: the `RemoteVnc_<id>` DPs (list / get / create / update / delete / favourite / stamp), `publicConnection` (every answer: no `password`, `hasPassword` instead), `readSecret` (relay only), and the audit rows into `AuditTrail_RemoteVnc` (created of type `_AuditTrail` when missing, NGA archiving enabled best-effort like wui-kit did): CREATE / UPDATE (field diff) / DELETE, itemtype `VncConnection`, password masked `••••`, `lastConnectedAt` ignored, **user = the verified caller**, host = the client's address (the kit wrote `location.hostname`, i.e. the dashboard's).
- `vncTickets`: one-shot tickets for the relay (random 24 bytes, 30 s, single use, bound to id + user, at most 1000 outstanding).
- `vncGuard`: who calls = the user of the request's **WebUI token** (`Authorization: Bearer`, verified by the CTRL `WssJwksKeyStore::decodeToken` as wui-auth-badge does), else the passport session (`identityOf`); roles through `appSecurityGuard.ts` (`roleAssignments` + `roleGranted`, copied at deploy time via `wuiPage.backend.shared`). Unlike `requireRole`, a caller **without identity is refused when the role is assigned** — `requireRole` lets it through, which here would let anyone omit the header and open a session. Guard failures fail open (logged), like `requireRole`.
- **`vncRelay` = the websockify**: `registerVncRelay(app)` calls `app.uwsApp.ws('/api/vnc/ws', relayBehavior())`. UltimateExpress (on uWebSockets.js) exposes the raw uWS app via **`app.uwsApp`** → native uWS binary WS, same port/TLS, **no `ws` npm dependency**. Cycle: `upgrade` consumes the ticket into userData (a browser cannot read a refused upgrade's HTTP status, so a refused session is upgraded then closed with a code: 1008 missing id, **4401** no valid ticket, **4403** role `connect` missing, 1011 resolve/TCP/handshake failure, **4001** VNC auth refused, 4408 handshake timeout); `open` re-checks the role, resolves, `net.connect`, runs the brokered handshake over two `ByteQueue`s, then pipes (flushing what each side sent meanwhile) and stamps `lastConnectedAt`; `message` **copies** the ArrayBuffer (`Buffer.from(new Uint8Array(message))` — the uWS message is only valid during the callback) then `tcp.write`; TCP `data` → `ws.send(buf,true)` with backpressure handling (`getBufferedAmount` > 8 MB → `sock.pause()`, resume on `drain`); `close`/errors tear everything down. **`registerVncRelay` must be called before `listen`** (in `defineRoutes()`); without the uWS app it does not register and `POST /session` answers 503 `relay-unavailable`.

## Frontend

`novnc.d.ts` = ambient module `declare module '@novnc/novnc/core/rfb.js'` (noVNC ships no types). **`<wui-vnc-viewer>`** (`src/vnc-viewer.ts`, public, defined with a guard — it replaced the page-private `rv-viewer` in 0.2) takes only `connection-id`: `GET /api/vnc/connection/:id` (no password) → `POST /api/vnc/session` (ticket) → `new RFB(div, wss://…/api/vnc/ws?id=&ticket=, {shared})` — no credentials; handles `viewOnly`/`scaleViewport` (`scale="fit|none"`) and the connect/disconnect/credentialsrequired/securityfailure events; toolbar = (Back with `back`) / Ctrl+Alt+Delete / fullscreen / disconnect / reconnect; `fill` takes the container's width and height; `ended` event. Since 0.3, optional `label` (+ `label-mode="fullscreen|always"`, default `fullscreen`): an `aria-hidden`, `pointer-events: none` overlay in the stage's top-left corner (inside the element that goes full screen — `.stage.requestFullscreen()`), shown while `document.fullscreenElement` is the viewer or an ancestor (tracked on `fullscreenchange`, listener removed on disconnect), dimmed after `LABEL_DIM_DELAY_MS` (3 s) and woken by pointer move / touch over the stage (capture phase: noVNC stops its own mouse events); the stage takes the label as `aria-label` (role `group`). The page passes the connection name (from its list) as `label`. States without a session: no `connect` role (live `hasRole$`, also a 403), not found (404 from the route), unavailable (no JSON answer, network error, 5xx, 503 `relay-unavailable`). Every call carries the WebUI token (`data/api.ts`, `TokenService`). Embedding guide: [EMBEDDING.md](EMBEDDING.md).

**Reconnect state machine**: a `connectTimer` aborts a stuck connection → `scheduleReconnect`; `disconnect` event with `clean===false` → reconnect (each attempt asks a new ticket), `clean===true` / manual / auth failure → stop. **Stale-rfb guard**: compare the `rfb` captured in the event against `this.rfb` (teardown sets `this.rfb` to null first to ignore its own `disconnect`); a `generation` counter drops async continuations (fetches) of a session that was stopped meanwhile (disconnectedCallback, id change, role revoked). The bar shows "Disconnect" during activity (connecting/connected/reconnecting), otherwise "Reconnect"; the banner shows the retry countdown.

**State polling**: `WuiRemoteVnc` queries `GET /api/vnc/status` every 5 s (connected/disconnectedCallback, `refreshStatus`); `rv-connection-table` shows a "State" LED column (🟢 ok / 🔴 ko / ⚪ unknown + reason tooltip + time).

## Pitfalls / things to know

- **noVNC pinned to 1.4.0** (npmDep `@novnc/novnc: 1.4.0`, bundled in `remote-vnc.js`) — DO NOT bump to 1.7.0:
  1. 1.7.0 uses a **top-level await** (WebCodecs H264 detection) that the pages vite target (es2020 / chrome87) rejects → broken build; 1.4.0 has no TLA.
  2. **Version-dependent import path**: 1.7.0 has `exports:"./core/rfb.js"` (bare `@novnc/novnc`); **1.4.0 has NEITHER `exports` NOR `main`** → import the file directly `@novnc/novnc/core/rfb.js` (the module name in the `.d.ts` must match).
- **The uWS message is only valid during the callback**: always copy (`Buffer.from(new Uint8Array(message))`) before any async use (`tcp.write`).
- **Backpressure mandatory** on the relay: watch `ws.getBufferedAmount()`, pause the TCP socket above the threshold (8 MB), resume on `drain` — otherwise memory blowup on dense sessions.
- **`registerVncRelay` before `listen`**; the uWS interaction (`app.uwsApp.ws`) vs UltimateExpress (`any('/*')`) is a risk to verify first when doing a new integration.
- **Security**: `/api/vnc/*` is mounted `fullAccess` like the other bridges, but since 0.2 every route except `/health` checks its role server-side (`vncGuard`) and the WS upgrade requires a ticket from a role-checked route. The **password is still stored in clear text** in the DP: no route or export serves it any more, but anyone who can read DPs (`OaRxJsApi.dpGet` over the dashboard's data connection, `/api/para`, a CTRL panel) can read `RemoteVnc_<id>.json`. Restrict read access to the `RemoteVnc_*` DPs (WinCC OA DP-level permissions) on sites where that matters — see the migration note below.
- The reachability test validates **only the TCP socket**, not the auth or the RFB handshake: a 🟢 does not guarantee a session will succeed.
- Resolved-parameter helpers = **private methods, not getters** (typescript-eslint member-ordering forbids private accessors after public methods).
- The dialog's `willUpdate` back-fills the defaults of old records via `{...blankConnection(), ...clone}`.
- After modifying the manager: restart `vncProxy`. To activate or refresh `/api/vnc/*` (relay, `/health`, `/status`): the customer webserver must be restarted (the backend module only serves its routes after a restart).

## Application Security (roles — added 2026-07)

The page declares 3 roles (self-registration in `remote-vnc.ts` + mirrored in
the app-security manifest): `view`, `connect`, `edit`. All OPEN until an admin
assigns groups in `/app-security` (docs/wui-app-security/INTEGRATION.md).

- **`view`** gates the page body: without it the header/context-generator stays
  but the body is replaced by the `roleForbidden` notice (also when the server
  answers 403 to the list).
- **`connect`** ("Open sessions") gates OPENING a session: the row click and the
  play button in `rv-connection-table` (subscribed inside the child), the deep-link
  `lastConnectedAt` stamping, and the direct viewer on `/remote-vnc/:id` — when
  denied the `connectForbidden` notice renders instead of `rv-viewer`.
- **`edit`** (manage the connection list) hides New connection, Import,
  Generate-demo, and the per-row edit/delete buttons; a revoke while an
  edit/delete dialog is open closes it. Export (all / one) and the favourite
  star stay open — export only reads, the star is a personal preference.
- **Enforced server-side since 0.2** (`backend/vncGuard.ts`, see the route list
  above): `view` (or `connect`) for the list and the status, `connect` for one
  connection, a session ticket and the relay upgrade, `edit` for create / update
  / delete, `view` for the star. A write the server refuses shows the
  `writeForbidden` notice. The UI gating stays (UX).

## Migration 0.1 → 0.2

- **Data**: none. The `RemoteVnc_<id>` DPs (type `RemoteVnc_Connection`) and
  `AuditTrail_RemoteVnc` keep their format.
- **Deploy**: `npx wui build prod`, then **restart the webserver** (new routes,
  relay with tickets and VNC authentication; `appSecurityGuard.ts` is now copied
  next to the module). The `vncProxy` manager is unchanged. A page 0.2 against a
  webserver not restarted shows the offline notice (no `/api/vnc/connections`)
  and the viewer "relay unavailable".
- **Writes** go through `POST/PUT/DELETE /api/vnc/connection[/:id]` (role `edit`,
  audited server-side) instead of the generic `/api/para` routes. The DPs
  themselves stay writable by whoever can call PARA's `dp/set` (not role-guarded)
  or write DPs otherwise: restrict that too where it matters.
- **Roles** are checked server-side, open until an admin assigns groups. The
  caller is identified by the WebUI token the page sends; a client without it is
  refused once a role is assigned.
- **Password**: never served to a browser; the relay authenticates to the VNC
  server. Consequences: the browser's noVNC no longer negotiates the security
  type — servers must offer "None" or "VNC password" (VNC Authentication);
  exports no longer contain passwords (keep a 0.1 export if you relied on it as
  a backup, it holds them in clear); editing a connection leaves the password
  field empty ("leave empty to keep it", or "Remove the stored password").
  **Residual risk**: the password is still readable in the DP by whoever can
  read DPs — restrict read access to `RemoteVnc_*`.
- **`lastConnectedAt`** is stamped by the relay (webserver local time) when a
  session is established, not when the page is opened.
- **Embedding**: other modules use `<wui-vnc-viewer>` — [EMBEDDING.md](EMBEDDING.md).

## `wui dev` mock — `mock/api.mjs`

The package ships a mock of the HTTP side of `/api/vnc`, merged by wui-toolkit into any site that
selects the module or deploys it headless (`wui dev`, screenshots; wui-toolkit ≥ 0.20). The connection
routes serve the four demo connections (`DEMO_CONNECTIONS`, the HMI one with a password, never answered)
in memory — writes last until `wui dev` restarts; `status` gives them a fresh TCP test result — three
reachable, the welding robot refused (`ECONNREFUSED`) — `resolve` answers their host:port (502 for any
other id) and `health` reports the MSA client and `relay: false`. The mock knows no roles.

Not mocked: the RFB session, a WebSocket (`/api/vnc/ws`) relayed to the VNC server — `POST /session`
answers 503 `relay-unavailable` and the viewer shows "relay unavailable" under the connection's name.
