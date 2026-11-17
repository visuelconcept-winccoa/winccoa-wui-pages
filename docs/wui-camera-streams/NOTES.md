# wui-camera-streams — business & architecture notes

Standalone WebUI page **Flux caméras (RTSP)** (camera streams) (`/camera-streams`, entry `wui-camera-streams`, class `WuiCameraStreams`, sub-component prefix `cs-`). Tier **3** (frontend + backend module `/api/rtsp` + dedicated manager `rtspProxy`). Modeled on the **remote-vnc** page (same store / table / dialog / viewer / io structure).

## Domain / purpose

Manage a catalog of **RTSP** IP cameras and view a stream **directly in the browser** via the embedded **JSMpeg** player.

The key business point: **a browser cannot read RTSP** (unlike VNC, which is end-to-end RFB over a simple TCP tunnel). A **server-side transcode** is therefore required. The chosen solution: a dedicated JS manager built on the npm lib `rtsp-relay` + `ffmpeg`, and a **JSMpeg** client (MPEG1-TS stream).

Two menu entries: the list, and a hidden entry `/camera-streams/:streamid` (attribute `streamid`). menuconfig icon `video-camera`, permission `connected`.

## Data model (DPs)

- **DP type** `RtspCamera_Stream` (Struct: `name` + `json`), instance prefix `RtspCamera_`. One camera = one DP (`RtspCamera_<id>.json`). Creation/reading via the PARA REST API, with an offline **DEMO** fallback (`DEMO_STREAMS`).
- **`CameraStream` model**: `kind` (`'rtsp'` | `'local'`, absent before 0.2.0 → rtsp), `name`, `group`, `description`, `url`, `username`, `password`, `transport` (`'tcp'` | `'udp'`), `audio`, `maxWidth`, `frameRate`, `videoBitrate`, `localResolution` (`'default'` | `'480p'` | `'720p'` | `'1080p'`, local only), `autoReconnect`, `reconnectDelaySec`, `favorite`, `lastViewedAt`.
- The store is an exact copy of the remote-vnc `ConnectionStore`.
- **Credentials (username/password) are stored in clear text in the DP** (warning shown in the dialog). They are never exposed to the browser: the manager injects them into the RTSP URL server-side.

## 3-tier architecture, SAME ORIGIN

Everything goes through the dashboard webserver to eliminate the HTTPS **mixed-content** problem (no extra port/certificate, inherits the dashboard's TLS + auth):

```
Browser (JSMpeg)
  → wss://<dashboard>/api/rtsp/ws?id=<id>      (SAME ORIGIN, dashboard's TLS+auth)
  → webserver ws↔ws relay
  → ws://127.0.0.1:9999/api/rtsp/stream/<id>   (loopback only)
  → rtspProxy manager (rtsp-relay + ffmpeg)
  → RTSP source
```

- The manager **owns the allow-list** (resolves `id → RTSP URL` from the DP): no SSRF, the client only sends an `id`.
- The manager **binds 127.0.0.1 only**: unreachable from the network, accessible only by the webserver.
- Frontend-side URL: `streamWsUrl()` builds the same-origin URL `${ws|wss}://${location.host}/api/rtsp/ws?id=`. `streamHost()` extracts the host from the URL by regex.

## Key algorithms / mechanisms

- **A single RTSP pull, broadcast to N clients**: `rtsp-relay` indexes incoming streams **by URL** → a single ffmpeg per URL, **reference-counted** (lazy start on the 1st client, `SIGTERM` on the last). This is what realizes "a single RTSP connection fanned out to N clients" and "stream start on the first consumer". Verified E2E: 2 clients → still a single ffmpeg.
- **Options → ffmpeg flags mapping** (`buildFlags`): `-r` (frameRate), `-vf scale='min(w,iw)':-2` (maxWidth), `-b:v` (videoBitrate), audio `mp2` or `-an`. Credentials injected into the URL by regex (`withCredentials`).
- **Live connected-client counter**: since the webserver relay is the same-origin entry point for each viewer, it counts there (`Map<id,count>`, increment after URL validation in `startRelay`, decrement in the uWS `close`, `counted` guard). Exposed via `GET /api/rtsp/clients` → `{ "<id>": <n> }`. The page polls it every 4 s and shows it in a "Clients" column (pulsing green dot + count if >0). Degrades to "0" if the endpoint replies 404.
- **Reachability indicator ("State")**: the manager runs a **cyclic ffmpeg probe** independent of clients (`-rtsp_transport <t> -i <url> -t 1 -an -f null -`, kill 8 s, cycle 25 s, concurrency 6) on **all** cameras (`dpNames('*','RtspCamera_Stream')`). Measures the real reachability of the stream, not just the port. Result in `statusById`, exposed by `GET /api/rtsp/status` (manager); the webserver relays it. The page folds it into the same 4 s refresh; `cs-stream-table` shows a "State" LED (🟢/🔴/⚪ + tooltip).
- **Viewer state machine** (`cs-viewer`): `new JSMpeg.Player(streamWsUrl(c), {...})`; idle/connecting/connected/reconnecting/disconnected/error states driven by a **liveness timer on decoded frames** (JSMpeg has no native "connect" event) + a connection timeout. Toolbar: back / fullscreen / stop / restart.

## Backend / managers

**Manager `rtspProxy`** (`manager/rtspProxy/`, pmon `node | always`):
- Has its **own `package.json` + local `node_modules`**: `express`, `express-ws`, **`rtsp-relay@1.9.0`** (which bundles **`ffmpeg-static`** → ffmpeg.exe, **no system ffmpeg required**). `winccoa-manager` is resolved via WinCC OA's `NODE_PATH` (no local copy).
- `require('rtsp-relay')(app)` → `proxy({url,transport,additionalFlags})(ws)`.
- Reads `RtspCamera_<id>.json`, injects the creds, maps the options to ffmpeg flags.
- Env variables: `RTSP_PROXY_PORT` (9999), `RTSP_PROXY_HOST` (127.0.0.1).

**Backend module `/api/rtsp`** (hosted by the dashboard webserver that `wui init target` installs, TS, uWS):
- Relay **`rtspRelay.ts`**: `registerRtspRelay(app)` → `app.uwsApp.ws('/api/rtsp/ws', behavior)`. Like remote-vnc's `vncRelay.ts` but **ws↔ws** (not ws↔TCP): opens an upstream `ws` client to the manager, pipes both ways, handles backpressure (pauses the upstream `_socket` based on uWS `getBufferedAmount`). Requires the `ws` dep.
- `rtspController.ts`: builds the `127.0.0.1:9999` URL (regex guard on the `id`), `health`, client counter (`incrClient`/`decrClient`/`getClientCounts`), `fetchManagerStatus` (proxies the manager's `GET /status` via `http.get`).
- `rtspRoute.ts`: `GET /health`, `GET /api/rtsp/clients`, `GET /api/rtsp/status`.

## Audit trail (GxP) — `AuditTrailWriter`

Every camera **edit** is traced into a dedicated `_AuditTrail` datapoint
**`AuditTrail_CameraStreams`**, following the DP model of the Audit-trail page
(`@visuelconcept-winccoa/wui-audit-trail`). The reusable primitive lives in the **shared
kit** (`@visuelconcept-winccoa/wui-kit/data/audit-trail.ts` → `AuditTrailWriter` +
`auditSnapshot`/`auditDiff`) so other modules can trace their own edits the same
way (each module owns one `AuditTrail_<Module>` DP).

- **Auto-provisioning**: the DP is created of type `_AuditTrail` on first use via
  PARA REST (`/api/para/dp/create`). NGA value-archiving is enabled best-effort on
  every leaf when an **active, non-alert** `_NGA_Group` exists; when none does (or
  the Audit-trail page / PARA backend isn't installed) the DP is **still
  provisioned, just unarchived** — by design.
- **Traced operations** (`camera-streams.ts` → `trace()`): CREATE, UPDATE (incl.
  favourite toggle), DELETE, IMPORT (per camera) and demo generation. The
  passive **last-viewed** stamp is *not* audited (it's a view side-effect, not an
  edit). Writes are gated on `!offline` (no audit in the in-memory demo fallback).
- **Record** = the fixed `_AuditTrail` leaves written atomically in one
  `dp/set` (one source timestamp → one viewer row): `time` (epoch ms), `username`
  + `uinum` (from `WuiUserService`), `host` (`location.hostname`), **`item` = the
  impacted DPE** (the camera's backing DP `RtspCamera_<id>`, via `dpeOf()`),
  `itemtype` (`RtspCamera`), `action`, `oldval`→`newval`, `reason`.
- **Secrets**: the camera `password` is **redacted** (`••••`) in old/new
  snapshots — never written to the audit log in clear text (`REDACTED_FIELDS`).

## USB camera of this PC — `kind: 'local'` (0.2.0)

A second source kind, captured **by the browser** from a camera of its own PC
(`getUserMedia`, video only) — no proxy, no relay, no ffmpeg. Same entry list,
same DP type, same route `/camera-streams/<id>`; `camera-streams.ts` renders
`cs-local-viewer` instead of `cs-viewer` for it.

- **Storage split** (the design choice): the DP holds what is shared — name,
  group, description, `kind`, `localResolution`. The **device** is per browser:
  `deviceId`s are random per origin and browser profile, so a value written by
  one PC means nothing on another. It is kept in `localStorage`
  (`wui-camera-streams.local-device.<cameraId>` → `{ deviceId, label }`), chosen
  in the viewer toolbar. `pickDevice` matches by id, then by label (ids rotate
  when site data is cleared), then takes the first input. The dialog clears
  `url` / credentials when saving a local entry.
- **Pure helpers** in `data/local-camera.ts` (unit-tested in
  `local-camera.spec.ts`): `captureSupport` (insecure context first — there
  `navigator.mediaDevices` is undefined), `classifyMediaError` (spec names +
  legacy aliases; Firefox reports a busy camera as `AbortError`),
  `videoInputs` / `labelsHidden` / `pickDevice`, `buildVideoConstraints`
  (device `exact`, resolution `ideal`, `audio: false`), load/save of the choice
  (never throw — storage may be blocked), `stopMediaStream`.
- **Viewer state machine** (`ui/cs-local-viewer.ts`): idle → (labels hidden or
  no input listed → `permission`, "Allow camera access" button; else) `starting`
  → `live` | `error` (cause: insecure / unsupported / denied / notFound / busy /
  overconstrained / unknown / ended) ; Stop → `stopped`. A `generation` counter
  drops a getUserMedia result that arrives after a release (prompt still open
  when the user leaves) and stops its tracks. `OverconstrainedError` on the
  chosen device → forget it, retry once **without** a device (the browser
  picks). `devicechange` re-lists the inputs (USB plug/unplug); a track `ended`
  event (unplugged while live) → error "camera stopped".
- **No camera left on**: `release()` (all tracks stopped, `srcObject` null) on
  `disconnectedCallback` (route change, page left, Back), Stop, and before any
  new start (other entry, device or resolution — `updated()` compares
  `id|localResolution`).
- `muted` is bound as attribute **and** property: autoplay policies read the
  property, which a cloned template's attribute does not reliably set.
- **Table**: endpoint "USB camera of this PC", a USB chip, a camera icon instead
  of the reachability LED, "—" for clients (not relayed, not counted).
- **Manager**: `rtspProxy` `resolveStream` returns null for `kind: 'local'`
  and the probe skips it (no "configuration invalide" status).
- **Mosaic**: a local entry is listed by the Mosaic camera catalog like any
  `RtspCamera_Stream` DP and embedded as `/camera-streams/<id>` in a
  same-origin iframe — camera capture is allowed there by the default
  Permissions Policy (`camera` allowlist `self`). The tile is read-only
  (toolbar hidden, no pointer events), so it relies on the device remembered
  and on a permission granted earlier on the page itself.
- **Not verifiable in CI**: real capture needs a browser with a camera; the
  unit tests cover the pure parts only.

## Pitfalls / things to know

- **Do NOT pass `-rw_timeout` before `-i`** for an RTSP input → ffmpeg "Error opening input files: Option not found". Rely on the process kill timeout instead.
- **JSMpeg + rtsp-relay quirk**: rtsp-relay sends an 8-byte `jsmp` header before the mpegts; modern JSMpeg skips it. A transient `ETIMEDOUT` on a 1st connection can occur under fast test cycles (residual ffmpeg) — the viewer's auto-reconnect covers it.
- **JSMpeg player**: `@cycjimmy/jsmpeg-player` v6 ships no types → ambient decl. `jsmpeg.d.ts` (default export `JSMpeg` with `.Player` / `.VideoElement`).
- **Keyframe probe**: with a GOP of 50 at 25 fps (keyframe every 2 s), an ffmpeg `-t 1` test shows 0 frames; use `-t 3`.
- **Known limitation**: if the manager keeps the ws open after ffmpeg stops (source loss), the viewer stays stuck in "reconnecting" with no WS close → no JSMpeg reconnection. Lead: have the manager close the client ws when ffmpeg exits.
- **Liveness check under Windows/Git Bash**: `tasklist` intermittently returns bogus process counts of 0 — use `netstat -ano | grep LISTENING` and the logs as the source of truth.
- **ACL**: the `/api/rtsp/*` routes are currently `fullAccess` like the other bridges (to be tightened).
- **Audit trail unarchived on WebDemo2**: that project's only `_NGA_Group` is `_NGA_G_ALERT` (`isAlert` set), so there's no usable value-archive group → `AuditTrail_CameraStreams` is provisioned **unarchived**. Records are written as live values but **won't appear in the Audit-trail page's history table** until value archiving is enabled (the table reads NGA history via `dpGetPeriod`). Create a non-alert NGA group and re-enable archiving on the DP to capture history.
- **Local test source**: MediaMTX (`bluenviron/mediamtx`) in RTSP-only mode (`rtspTransports:[tcp]`, `:8554`, `paths: { all_others: }`, `user: any`) + publishing a test pattern via the embedded ffmpeg (`testsrc2 ... -c:v libx264 -tune zerolatency -g 50 -f rtsp`). The public streamlock BigBuckBunny stream is **dead** (ffmpeg reads 0 bytes).

## Application Security (roles — added 2026-07)

The page declares 2 roles (self-registration in `camera-streams.ts` + mirrored
in the app-security manifest): `view` and `edit`. Both OPEN until an admin
assigns groups in `/app-security` (docs/wui-app-security/INTEGRATION.md).

- **`view`** gates the page body: without the grant the header renders as usual
  but the body (camera table AND viewer) is replaced by a muted forbidden
  notice (`MSG.page.roleForbidden`).
- **`edit`** ("Manage cameras and stream options") hides the mutations: the
  "New camera" and "Import" toolbar buttons, the empty-state "Generate demo
  cameras" button, and the per-row edit/delete actions (`cs-stream-table`
  subscribes `hasRole$('camera-streams','edit')` itself — para-type-editor
  pattern). If the grant drops while the editor dialog / delete confirm is
  open, it closes. Viewing/opening a stream and export (all / per-row) stay
  open — they only read.
- **USB camera of this PC (0.2.0)**: no new role. Creating / editing a local
  entry goes through the same dialog, hence `edit`; viewing it is `view`. A
  dedicated role was not added: the video never leaves the viewer's own PC,
  and the browser's camera permission prompt already guards the device.
- No server-side guard yet: the camera CRUD goes through the SHARED PARA
  persistence API (deliberately not gated per module — see the para notes);
  the `/api/rtsp/*` bridge is read/relay only.

## `wui dev` mock — `mock/api.mjs`

The package ships a mock of the HTTP side of `/api/rtsp`, merged by wui-toolkit into any site that
selects the module (`wui dev`, screenshots; wui-toolkit ≥ 0.20). `clients` answers that nobody is
watching, `status` gives the four RTSP demo cameras (`DEMO_STREAMS`) a fresh probe result — three reachable,
the nitriding oven unreachable ("délai dépassé") — and `health` names the manager endpoint. The fifth demo
entry, "Webcam de ce PC" (`kind: 'local'`), has no status, like the manager: it opens the webcam of the PC
running `wui dev` (localhost is a secure context).

Not mocked: the stream itself, a WebSocket (`/api/rtsp/ws`) relayed to ffmpeg — the viewer reports that
it cannot connect. The camera list still comes from the page's in-memory demo: the para mock knows no
`RtspCamera_Stream` type unless the site's fixtures declare it, hence the offline-mode notice.
