# Embedding a VNC session in another module — `<wui-vnc-viewer>`

Since **0.2.0**, `@visuelconcept-winccoa/wui-remote-vnc` exports the viewer of its
`/remote-vnc/:connectionid` page as a public custom element, so another module's page
(a workcenter sheet, a machine tab…) can show one of the VNC connections declared in
Remote VNC. The connections stay declared and managed **only** in Remote VNC: the host
stores a connection **id**, nothing else — never a host, a port or a password.

## 1. Declare the dependency (host module)

In the host module's `package.json`:

```jsonc
"dependencies": {
  "@visuelconcept-winccoa/wui-remote-vnc": "^0.3.1" // ^0.2.0 without `label`, ^0.3.0 without `hide-endpoint`
},
"wuiPage": {
  // remote-vnc's backend (/api/vnc + relay + vncProxy) is used when deployed,
  // the host page works without it (the element then shows "relay unavailable").
  "optional": ["remote-vnc"]
}
```

Use `requires` instead of `optional` if the host page is useless without VNC: wui-toolkit
then deploys remote-vnc **headless** (backend, relay and `vncProxy` manager, no page, no
menu entry) when the site does not select its page. See
[module-dependencies.md](../module-dependencies.md). After changing the dependencies,
run `npx wui tsconfig` in the repository that holds the host module.

The connections themselves are created in the Remote VNC page: a site that only embeds
sessions still needs someone to manage the list, so it usually selects the page too
(its menu entry can be restricted with the `edit` role, see below).

## 2. Import the element

```ts
import '@visuelconcept-winccoa/wui-remote-vnc/vnc-viewer.js';
```

This path is stable (the file is `libs/wui-remote-vnc/src/vnc-viewer.ts`). The element is
defined with a guard (`customElements.get` first): the Remote VNC page bundle and a host
bundle may both import it — no menu-URL trick, no double `define`. The page and every
host share one implementation.

## 3. Use it

```ts
html`<wui-vnc-viewer
  connection-id=${tab.vncConnectionId}
  label=${`${workcenter.name} · ${tab.name}`}
  fill
  @ended=${(e: CustomEvent<VncViewerEndedDetail>) => this.onVncEnded(e.detail)}
></wui-vnc-viewer>`
```

| Attribute | Default | Meaning |
| --- | --- | --- |
| `connection-id` | — | The connection to open — its only input. Changing it closes the session and opens the new one. |
| `fill` | off | Take the whole width **and** height of the container (give the container a size; in a flex column, `flex: 1; min-height: 0`). Without it the element is `height: var(--wui-vnc-viewer-height, 100%)`. |
| `scale` | `fit` | `fit`: scale the remote screen to the element (noVNC `scaleViewport`); `none`: native resolution with scrollbars. |
| `back` | off | Show a "Back" button that emits `wui:back` (the Remote VNC page uses it; a host normally does not). |
| `label` | — | Since 0.3.0. Plain text naming the remote screen (e.g. `WC_SOUDAGE_1 · Écran poste`), set by the host and not interpreted by the element. Shown as an overlay on the remote screen (see below) and used as the screen's accessible name. Without it, nothing changes. Also a property (`.label`). |
| `label-mode` | `fullscreen` | Since 0.3.0. `fullscreen`: the overlay shows only while the viewer is full screen (out of full screen the host page shows its own context); `always`: the overlay shows all the time. |
| `hide-endpoint` | off | Since 0.3.1. Hide the connection's `host:port` (toolbar and connecting card) — for a host that names the screen itself and does not want to show the address to operators. The name, states and controls stay. |

Event **`ended`** (bubbles, composed), `detail: { connectionId, reason, message }`, when
a session ends or cannot start — `reason` is one of:

| `reason` | When |
| --- | --- |
| `manual` | The user pressed Disconnect. |
| `clean` | The VNC server closed the session normally. |
| `lost` | The connection dropped and the reconnect policy gave up (or is off). |
| `auth` | The VNC server refused the stored password (or offers no security type the relay supports). |
| `forbidden` | The user lacks the `connect` role (client or server check). |
| `not-found` | The id is unknown (deleted connection). |
| `unavailable` | The remote-vnc backend does not answer, or the relay is not mounted. |

It is **not** fired when the host removes the element. Types:
`import type { VncViewerEndedDetail, VncEndReason } from '@visuelconcept-winccoa/wui-remote-vnc/vnc-viewer.js'`.

**Label overlay.** When the viewer goes full screen (its own full-screen button), the host
page's title bar and tabs are hidden and several sessions can look alike: with a `label`,
the element then draws it in the top-left corner of the remote screen — small, on a
semi-transparent background from the theme (`--theme-color-1`, `--theme-color-std-text`),
inside the element that goes full screen. It never takes input (`pointer-events: none`:
clicks, keys and the noVNC cursor go through), and it dims after about 3 s, back to full
opacity on mouse move or touch over the screen. The element follows `fullscreenchange`:
it counts as full screen when the full-screen element is the viewer or one of its
ancestors (a host that puts its own container full screen gets the overlay too). Since
0.3.1 this also holds when the viewer sits inside other components' shadow roots (a tab
of a page module): `document.fullscreenElement` only names the outermost host there, so
the element checks each enclosing root's `fullscreenElement`, walking up the hosts. The
label is the screen's `aria-label` (role `group`); the overlay itself is `aria-hidden`,
so screen readers announce it once.

The element shows its states itself, without opening a session: no `connect` role,
connection not found, relay unavailable (with a Retry button), then connecting /
connected / reconnecting with the connection's own timeout and reconnect policy. The
toolbar (name, endpoint label, Ctrl+Alt+Del, full screen, disconnect / reconnect) is
part of the element.

## 4. One session per visible element

- The session **opens on `connectedCallback` and closes on `disconnectedCallback`**.
  Mount the element only while it is visible: render it in the active tab only, not in
  every tab hidden with CSS. One tab = one connection; several connections = several
  tabs, one mounted at a time.
- Each session holds one WebSocket to `/api/vnc/ws`. Browsers open at most **6 HTTP/1.1
  connections per server** (a WebSocket counts): a page that keeps several sessions open
  starves its own REST calls and the dashboard's data connection. Behind HTTP/2 the
  limit is higher, but every session still costs a TCP connection to the VNC server.

## 5. Roles and listing

The element and the routes behind it enforce Remote VNC's Application Security roles
(module `remote-vnc`) **server-side**; they are open until an admin assigns groups:

| Role | Grants |
| --- | --- |
| `view` | `GET /api/vnc/connections`, `GET /api/vnc/status`, the favourite star |
| `connect` | `GET /api/vnc/connection/:id`, `POST /api/vnc/session` and the relay — what the element needs; also the listing |
| `edit` | `POST` / `PUT` / `DELETE /api/vnc/connection[/:id]` |

A host that lets its user pick a connection (e.g. when configuring a tab) reads the list
from `GET /api/vnc/connections` — `{ ok, connections: [{ id, name, host, port, group,
description, viewOnly, hasPassword, … }] }`, never a password — with the user's WebUI
token (`Authorization: Bearer <TokenService.getStoredToken()>`, as the element does).
Do not read the `RemoteVnc_*` datapoints.

## 6. `wui dev`

The package ships `mock/api.mjs`, merged by `wui dev` for every module the site selects
or deploys headless (a `requires`, not an `optional` one): select remote-vnc in the
host's site (`npx wui use remote-vnc`) and its `wui dev` serves the four demo connections (`vnc-demo-hmi-ligne1`, `vnc-demo-poste-supervision`,
`vnc-demo-four-nitruration`, `vnc-demo-robot-soudage`) from the connection routes. The
session itself (a WebSocket to a VNC server) is not mocked: `POST /api/vnc/session`
answers 503 and the element shows "relay unavailable" under the connection's name.
