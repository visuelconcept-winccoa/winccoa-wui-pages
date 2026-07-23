<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Warehouse — design notes & caveats

## Why this shape

- **Hybrid persistence.** Warehouses/zones/locations/products/campaigns are
  configuration — JSON-in-DP via the shared `DpJsonStore` idiom. Stock
  quantities are *process values*: they get a dedicated `WMS_Stock` DPType (one
  DP per product×location) so they remain archivable/trendable/alarmable DPEs
  instead of opaque JSON.
- **Master/detail routing (machine-fleet-3d pattern).** One warehouse = one
  "atelier": `/warehouse` overview cards, `/warehouse/:warehouseid` detail; the
  router recreates the element per route, `RouterEvent` navigates. The hidden
  detail route lives in `menu.fragment.jsonc` (`routeId: warehouse-detail`) and
  in `package.json` `wuiPage.routes`.
- **2D layout editor (ampère pattern).** `wh-plan` converts pointer positions
  with `svg.getScreenCTM().inverse()`, tracks the gesture with `globalThis`
  `pointermove`/`pointerup` listeners, previews with a local drag state (never
  mutates the stored entities), snaps to a 0.5-grid and emits one
  `wui:layout {kind,id,x,y,w,h}` on release. Resize = a SE corner handle
  (ampère has no resize precedent; the handle is this module's own addition).
  Locations are clamped inside their zone and below the reserved label band
  (`ZONE_LABEL_BAND`).
- **3D view (machine-fleet-3d pattern, fully procedural).** `wh-plan3d` owns a
  three.js scene where every location is BUILT from its type — no external
  assets (nothing to license, works offline): pallet-rack uprights on foot
  plates + orange beam levels + deck plates + X end-braces (`rack`), close-level
  shelving (`shelf`), cubby blocks (`bin`), translucent cold-room enclosures
  with rim/kick-plate + framed door (`cold`), painted floor markings with a
  border stripe and pallet stacks when occupied (`floor`). The structure body
  takes the location's **per-instance colour** (`color`, else the per-type
  default) and its **per-instance height** (`height`, else the per-type
  default); the fill gauge keeps the occupancy colour, so colour = the rack,
  gauge = the stock. Materials are tinted **procedural canvas textures**
  (`plan3d-textures.ts`: brushed/slotted steel, galvanised sheet, ribbed
  plastic, corrugated cardboard, planked wood, mottled concrete) — greyscale on
  a near-white base so the per-location colour multiplies through. Those
  textures are built ONCE per component (tagged `userData.shared`, disposed only
  on disconnect — `disposeContent` keeps them across rebuilds); sprite/label
  canvases are still disposed per rebuild. Each location also carries a **fill
  gauge**, a **billboard label** (`depthTest:false`), an **alert badge**
  (amber/red “!” when a cell is under-min/over-max) and an **enclosing
  highlight** — a translucent glass box + bright `EdgesGeometry` lines around
  the whole structure (replaced the old `BackSide` silhouette; it doubles as the
  live resize preview). **3D editing** now supports **move AND resize**: the
  selected location shows three handles (width +X, depth +Z, height +Y);
  dragging one runs a ray/axis closest-point solve, anchors the min corner and
  previews the new size on the highlight box, then commits one `wui:layout`
  `{x,y,w,h,height}` (same event as the 2D editor, plus `height`). Move-drag
  raycasts the ground `Plane`; a click without a move selects. Orbit is
  hand-rolled (θ/φ/radius — no OrbitControls). Lifecycle mirrors
  `mf-atelier-view`: absolute canvas in a sized viewport, `ResizeObserver`, full
  geometry/material/texture disposal + `forceContextLoss()` on disconnect.
  `three` is a direct bundled dependency (`external-dependencies.mjs`), never a
  shared bundle.
- **Fullscreen plan.** The Plan tab has a Fullscreen button that calls
  `requestFullscreen()` on the tab panel (works for both the 2D SVG and the 3D
  canvas — the 3D `ResizeObserver` adapts the viewport). `Esc` or the button
  (now labelled *Exit fullscreen*, tracked via a `fullscreenchange` listener)
  leaves it.
- **One generic entity dialog** (`wh-entity-dialog`, schema-driven via
  `forms.ts`) instead of six near-identical modals. `ix-select` preselection
  binds through `.value` — `.selectedIndices` does NOT reflect into the input.
- **Presentational sub-components** that only emit `wui:*` events; all store
  access and role gating stays in the shell (`warehouse.ts`).
- **Existence probes use `dpNames`**, never `dpGet`/`dpConnect` on a
  possibly-missing DP (those throw uncatchably in the webserver CTRL layer).

## Rendering rules learned from the screenshot review (2026-07)

The first capture set surfaced real issues; their fixes are now design rules:

1. **SVG text needs real-size units.** Grid units are scaled ×10 into SVG user
   units (`SCALE`); sub-pixel font sizes render with erratic letter-spacing.
2. **Zone labels get a reserved band** (`ZONE_LABEL_BAND`, kept free by the
   editor clamps) and are drawn *after* the location cells, with a
   `paint-order: stroke` backdrop for legibility.
3. **Uncapped (floor) locations never show the red "full" alarm** — any stock
   on them renders blue ("occupied, uncapped") with its own legend entry.
4. **Percentages never clamp**: an over-filled location reads 162%, in alarm
   colour; zone headers show the fill of their *capped* locations only (and
   nothing when the zone has no capacity at all).
5. **Never sum heterogeneous units** (pcs + bidons + boîtes): the stock KPI is
   the overall fill % of the capped locations instead of a "total units" count.
6. **Demo data must be coherent with capacities** so the occupancy palette
   actually demonstrates something (capacities by type: rack 1000, shelf 400,
   cold 250, bin 200, floor 0).
7. **Tabs are `ix-tabs`/`ix-tab-item`**, not hand-rolled buttons.

## Offline pitfall: live in-memory arrays vs Lit change detection

In offline/demo mode the stores mutate a memory array in place. Returning that
same reference from `list()` silently defeats Lit's change detection (CRUD
looked like a no-op offline). Fixed **in the shared kit**: `DpJsonStore.list()`
(and the local `StockStore.list()`) return a defensive copy on the offline
path — all `DpJsonStore` pages benefit. The page still copies on reload as a
second line of defense.

## Server-side enforcement

There is no module-specific backend route: all writes go through the shared
PARA REST endpoints, so server-side enforcement rides on PARA's ACL, not a
per-route `requireRole` guard. If a dedicated route is ever added (e.g. bulk
import), wrap it per `docs/wui-app-security/INTEGRATION.md`.

## Testing without WinCC OA

`npx nx test wui-warehouse` runs the suite in exactly the no-backend situation
(tsyringe resolves nothing, `fetch` to `/api/para/*` fails) — i.e. it tests the
*production* offline fallback path, not a mocked store.
`tools/screenshot-warehouse-demo.mjs` does the same at the UI level (dev server
with a dead `BASE_URL`, shell-less harness with a `navigateTo` router shim,
Playwright captures incl. the 3D WebGL scene and the layout-edit mode).

## Known limitations / candidate follow-ups

- No keyboard interaction on the plan editors (pointer only).
- Resize handles resize from the min corner only (no centre/opposite-corner
  anchor); good enough for layout, not a full transform gizmo.
- Textures are procedural canvases (no normal/roughness maps); realistic enough
  for the dark scene, but not PBR.
- Labels can crowd each other on dense plans at low zoom; an overlay-HTML
  label manager with collision fade (fleet-3d style) would be the next step.
- Optional "crates on levels" display (quantity-proportional `InstancedMesh`
  boxes on the rack decks) was considered and skipped — redundant with the
  fill gauge; revisit if operators ask for it.
