# wui-mosaic — business & architecture notes

## Domain / purpose

Standalone **Mosaic** page (`/mosaic`, custom element `wui-mosaic`, class `WuiMosaic`, sub-component prefix `mo-`). It is a configurable **display wall**: each mosaic is a canvas of *tiles*, each tile embeds a source in an `<iframe>`.

- **Multiple mosaics**, 1 DP each + a preview list (shell router pattern, like machine-fleet-3d / remote-vnc).
- **Free-form layout**: floating tiles positioned/sized freely (not a fixed grid), with drag + resize.
- **Read-only by default**: a display wall does not forward pointer/keyboard events unless a tile is explicitly marked interactive.

**Source types** (`TileKind`, open set):
- `fleet-3d` — workshop id (`''` = overview view).
- `remote-vnc` — VNC connection id, **always forced read-only** (interactive toggle disabled/forced-off in the dialog).
- `camera` — RTSP stream id (embeds `/camera-streams/<id>`), DP type `RtspCamera_Stream` / prefix `RtspCamera_`, selection forced from the catalog like VNC, **forced read-only**.
- `url` — **same origin only** (external URL refused).

VNC and camera are **always** `!isInteractive` (excluded by `isInteractive`) → their toolbars are hidden by the read-only injection.

**Adding a new "picked from a catalog, read-only" type** = add to `TileKind` + `KIND_LABELS` + `tileSrc` + `isInteractive`, plus a `SourceCatalog.listX()` and a list `@property` propagated mosaic.ts → mo-tile-dialog (`renderPickSource` is generic over options/label/pageName).

## Data model (DPs)

- **1 DP per mosaic**, type **`Mosaic_Board`** (Struct: String `name` + String `json`), prefix `Mosaic_`.
- The store (`data/mosaic-store.ts`) is an **exact copy of the remote-vnc ConnectionStore pattern**:
  - PARA REST: `/api/para/dptype/create`, `/dp/create`, `/dp/set`, `DELETE /dp/:name`.
  - List via `WuiDpeService.listDatapoints`.
  - Read via `OaRxJsApi.dpGet` (`extractJsonString` digs through raw / array / `{value}`).
  - **In-memory offline fallback**, seeded by `DEMO_MOSAICS`.
- `persist()` stamps `updatedAt`; mutations persist immediately.

**Object model** (`types.ts`):
- `Tile`: kind / title / ref / url + **x/y/w/h as percentages of the canvas (0–100)** + interactive / refresh.
- `Mosaic`: id / dp / name / description / tiles / updatedAt.
- Helpers: `blankTile`, `blankMosaic`, `tileSrc`, `isInteractive`, `tileKindLabel`, tile size MIN/DEFAULT constants, `APP_SHELL`.

**Source catalog** (`data/source-catalog.ts`) — read-only selection helper: lists workshops (`MachineFleet3D_Config`, stripping the `MachineFleet3D_` prefix) and VNC connections (`RemoteVnc_Connection`, stripping `RemoteVnc_`) by `.name`. Best-effort: `[]` if offline → the dialog falls back to a manual id field.

## Key algorithms / mechanisms

### Embed URL (hash routing)
The dashboard SPA uses **hash routing**: the deployed bootstrap redirects `/` → `/data/dashboard-wc/index.html` **while preserving `location.hash`**. Any internal view is therefore embedded as `…/index.html#/<route>`.

`tileSrc()` (in `types.ts`) builds the URL via `embeddedViewUrl(route)` = `` `${APP_SHELL}${EMBED_QUERY}#${route}` `` with `APP_SHELL='/data/dashboard-wc/index.html'` and `EMBED_QUERY='?embed=1'`:
- `?embed=1#/fleet-3d/<id|>`
- `?embed=1#/remote-vnc/<id>`
- `?embed=1#/camera-streams/<id>`
- the raw URL as-is for the `url` type.

### Chromeless / embed mode — split across TWO layers
User constraint: "don't change the WebUI Runtime source code, only options for my page".
1. **Menu/header hidden by ONE shell flag** (one line) in the project's override file `webui-app-ix.ts` (compiled into `entry/wui.js`): `isEmbedded()` = `new URLSearchParams(location.search).has('embed')`; `renderTemplate()` returns only a `<div id="outlet" class="embed-outlet">` when embedded (no `wui-ix-template` / header / menu / `ix-application`). Robust because the Vaadin outlet only needs an element with `id="outlet"`. Backward compatible (no `?embed` → full chrome).
2. **Everything else on the page side** in `mo-canvas.ts` (no other runtime change), via **same-origin** iframe manipulation on `@load` + a bounded poll (`FRAME_POLL_MS` / `MAX`, since the routed page and its nested components render async):
   - **theme**: the chromeless loses the theme controller (it lived in `wui-ix-template`), so `syncTheme()` copies all `data-ix*` attributes from the host `<html>` to the iframe's `<html>` + injects `customstyles.css`; a `MutationObserver` on the host `<html>` re-propagates on theme switch.
   - **hide the page name**: `injectHideStyles()` creates a `CSSStyleSheet` **in the iframe's realm** (`doc.defaultView.CSSStyleSheet` — cross-realm sheets are rejected) and **adopts it recursively** into the document + each open shadow root (`adoptInto`), rule `wui-content-header,wui-context-generator{display:none}`.
   - **read-only**: the same sheet also hides `.toolbar{display:none}` (catches rv-viewer + mf-atelier-view + page bars through the nested shadow roots).
   - Cross-origin frames throw on `contentDocument` access → ignored. No need for an `ro` parameter in the URL: read-only is decided on the page side from `isInteractive(tile)`.

### Read-only guarantee
`isInteractive(tile)` = `tile.interactive && kind !== 'remote-vnc'` → VNC is **never** interactive. Applied purely at the wall level via the iframe's `pointer-events`: `none` unless interactive; always `none` in edit mode; `.canvas.dragging iframe{pointer-events:none!important}` during drag. Does **not** touch the remote-vnc page or its `viewOnly`.

### Grid snap (48×48)
- `GRID_DIVISIONS=48`, `GRID_PCT=100/48≈2.08%`. 48 divides by 2/3/4/6/8/12/16/24 → halves/thirds/quarters/sixths/eighths snap cleanly. To retune: change the single `GRID_DIVISIONS` constant.
- **A single `snapToGrid(v)=round(v/GRID_PCT)*GRID_PCT`** snaps both edge positions AND sizes onto the grid **lines** (live in `computeBox` before clamp; committed in `onUp` without rounding to keep an exact tiling).
- Defaults expressed in cells so physical sizes survive a `GRID_DIVISIONS` change: `DEFAULT_CELLS=12` → 50%, `MIN_CELLS=4` → ≈16.7%. `blankTile` x/y=0; cascade offset `=(n%6)*GRID_PCT`.
- **Visible grid = very light thin lines** (in `.canvas.editing` mode only): two 1px `linear-gradient`s (vertical + horizontal) with `background-size:${GRID_PCT}%` inline, `background-position:0 0` (no offset → avoids the background-position % formula). Color `--mo-grid = color-mix(... soft-text 28%, transparent)`.

### Same-origin URL validation
`isInternalUrl()` (`types.ts`) = `new URL(u, location.origin).origin === location.origin`: accepts relative (`/…`, `#/…`, `page.html`) + same-origin absolute; rejects external host, `//host`, `data:` / `javascript:`. Applied in the tile dialog (inline error + save disabled) AND in `tileSrc` (external → empty src → the tile shows "URL externe refusée" (external URL refused)).

### Import / export
`mosaic/data/io.ts` (copy of the remote-vnc pattern): `exportJson(all)` / `exportMosaic(one)` download the envelope `{kind:'mosaic-boards',version:1,mosaics:[…]}`. **`parseMosaics(text)` accepts a bare array, the envelope, OR a single mosaic object** (import of one or several), coercing each mosaic and its tiles against the blank defaults (validates `kind` against a Set, reassigns a `t-<i>` id to tiles without an id). Import: if the id exists → update, otherwise `createMosaic`.

## Components / files

`standalone-pages/mosaic.ts` + `mosaic/` folder:
- `types.ts` — model + helpers (see above).
- `data/mosaic-store.ts`, `data/demo-mosaics.ts` (2 demo walls), `data/source-catalog.ts`, `data/io.ts`.
- `ui/`: `dialog-styles.ts` (shared overlay/panel), `mo-confirm-dialog`, `mo-mosaic-table` (preview list: name / source chips / tile count / updated; open/rename/delete), `mo-mosaic-dialog` (name + description), `mo-tile-dialog` (kind select + catalog dropdown OR manual id + url + interactive/refresh; VNC toggle disabled), **`mo-canvas`** (the core: absolute `%` tiles, drag via pointer-capture on the header + resize via bottom-right gripper, commit of the rounded layout via `wui:layout`; per-tile auto-reload via `setInterval` → `iframe.src=iframe.src`).

**Routing / shell**: `/mosaic` = overview (`mo-mosaic-table`); **`/mosaic/:mosaicid`** = display of one mosaic (`hidden:true` in menuconfig, param → `mosaicid` attribute → `@property({attribute:'mosaicid'})`), with an in-place edit toggle **"Modifier / Terminer"** (Edit / Done). Navigation via `RouterEvent` (`@wincc-oa/wui-models/events/router-event.js`). Menuconfig: icon `tiles`, permission `connected`.

## Pitfalls / things to know

- **Tier 1, no backend or manager** (cf. `module.json`): all the logic is on the frontend side. No `/api` module, no ws relay, no manager specific to this page. (The embedded sources — VNC, RTSP — have their own backends, but they belong to their respective pages.)
- **CSP / external URL iframes**: this is NOT a mosaic limitation. The `WuiCspService` (in `wui.js`) injects a restrictive `<meta>` CSP (`default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:`, without `frame-src`) when the WebUI option `allowExternalResources` is false (read from `/WebUI_Settings`; also forced if the server's CSP header is restrictive). **Fix** = set `allowExternalResources` in the WebUI server config (`config/config`), then restart — it's a server option, not code. **Hard caveat**: public sites (google) send their own `X-Frame-Options` / `frame-ancestors` → refuse embedding no matter what; only intranet/own sites without these headers embed (watch out for the self-signed cert and mixed-content). Internal (same-origin) tiles are never blocked. A webserver reverse-proxy (same origin + strip X-Frame-Options, with an anti-SSRF allow-list) remains a possible follow-up but won't make the big public sites work.
- **Cross-realm CSSStyleSheet rejected**: create the stylesheet in the iframe's realm (`doc.defaultView.CSSStyleSheet`), never from the host document.
- **Hide / read-only must traverse shadow roots**: `adoptInto` adopts the sheet recursively into every open shadow root (otherwise nested components keep their header/toolbar visible).
- **Async render of routed pages**: use a bounded poll (`FRAME_POLL_MS`/`MAX`) after `@load`, not a single pass.
- **Chromeless mode touches the shared bundle** (`webui-app-ix.ts` → `entry/wui.js`): any change to this flag requires a coherent app+SW rebuild and a **hard-refresh (Ctrl+F5) / service worker clear** on the client side after deployment, since `entry/wui.js` has changed.
- **Edge auth**: an unauthenticated embedded iframe would show the login inside the tile, then `handleLogin` may redirect to `POST_LOGIN_HOME`, losing the deep-link. OK for the normal logged-in case.
- **Repo lint rules** (same as machine-fleet-3d): CustomEvent names as string literals `^wui:[a-z]{3,}$` (so separate `emitEdit`/`emitRemove`, no variable event name); public `disconnectedCallback` before protected `updated` (member-ordering); avoid the `[...map.keys()]` spread (delete during Map iteration is safe); extract duplicated strings into consts (`KIND_FLEET`/`KIND_VNC`/`KIND_URL`).

## Application Security (roles — added 2026-07)

Mosaic declares 2 roles (self-registration in `mosaic.ts` + mirrored in the
app-security manifest): `view` and `edit`. All OPEN until an admin assigns
groups in `/app-security` (docs/wui-app-security/INTEGRATION.md).

- **`view`** gates the page body: without the grant the header stays but the
  body is replaced by a "role missing" notice (`MSG.page.roleForbidden`).
- **`edit`** (compose display walls) hides every composition affordance:
  overview toolbar **Import** + **New mosaic** and the empty-state
  **Generate demo mosaics** button (mosaic.ts), the rename/delete row actions
  of `mo-mosaic-table` (`?disabled`, subscribed in the child), and the detail
  view's **Edit** toggle — which also removes tile add/edit/delete/move/resize
  since `mo-canvas` only shows them in edit mode. A live revocation drops an
  open edit session and closes the mosaic/tile/delete dialogs. Display,
  **Export all** / per-row export and tile viewing stay open (read-only).
- No backend gating: the page is tier 1, frontend-only (persistence goes
  through the shared PARA REST API, deliberately not gated per-module — see
  docs/wui-para/NOTES.md).
