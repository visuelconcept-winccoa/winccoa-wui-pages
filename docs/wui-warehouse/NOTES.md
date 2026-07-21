<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Warehouse — design notes & caveats

## Why this shape

- **Hybrid persistence.** Zones/locations/products/campaigns are configuration —
  JSON-in-DP via the shared `DpJsonStore` idiom. Stock quantities are *process
  values*: they get a dedicated `WMS_Stock` DPType (one DP per product×location)
  so they remain archivable/trendable/alarmable DPEs instead of opaque JSON.
- **One generic entity dialog** (`wh-entity-dialog`, schema-driven via
  `forms.ts`) instead of five near-identical modals.
- **Presentational sub-components** (`wh-plan`, `wh-stock`, …) that only emit
  `wui:*` events; all store access and role gating stays in the page
  (`warehouse.ts`), following the page-orchestrator pattern of the other modules.
- **Existence probes use `dpNames`**, never `dpGet`/`dpConnect` on a
  possibly-missing DP (those throw uncatchably in the webserver CTRL layer).

## Offline pitfall: live in-memory arrays vs Lit change detection

In offline/demo mode the stores mutate and return the **same array instance**
on every `list()`. Assigning that unchanged reference to a Lit `@state` property
does **not** trigger a re-render, so CRUD looked like a no-op offline. The page
therefore copies every list in `reload()` (`this.zones = [...config.zones]`,
etc.). Online this cost is irrelevant (fresh arrays anyway).

> The same pitfall exists for every other page that pairs `DpJsonStore` with
> in-place reassignment; a defensive copy inside `DpJsonStore.list()` /
> `StockStore.list()` (shared kit) would fix it for all pages — deliberately NOT
> done here to keep this change local to the warehouse module.

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
with a dead `BASE_URL`, shell-less harness, Playwright captures).

## Known rendering issues (screenshot review, pending arbitration)

From the 2026-07 capture set (`docs/images/manual/warehouse*.png`):

1. **Plan: zone labels are hidden** — drawn before (under) the location cells,
   so "A · Réception" etc. are clipped by the first row of locations; SVG text
   at sub-pixel font sizes also renders with odd letter-spacing.
2. **Plan reads almost all red** — the demo quantities vastly exceed the
   location capacity (100), so 7 of 10 stocked cells cap at 100% "Full";
   thresholds lose meaning. Demo data and capacities should be coherent.
3. **Uncapped locations always show "Full"** — `occupancy()` maps *any* stock
   on a capacity-0 (floor) location to ratio 1 → red, which reads as an alarm.
4. **Stock dialog selects show "Select an option"** although the draft already
   holds the preselected first product/location (`.selectedIndices` binding
   doesn't take on `ix-select`; the saved values are correct nonetheless).
5. **Custom tab strip** — plain `ix-button`s instead of iX `ix-tabs`.
6. **Zones tab: occupancy is capped at 100%** — a 1620-unit rack of capacity
   100 shows "1,620 (100%)" with no over-capacity cue; zone D (uncapped) shows
   no percentage at all, inconsistent with the other zone headers.
7. **"Total units" KPI sums heterogeneous units** (pcs + bidon + boîte).
