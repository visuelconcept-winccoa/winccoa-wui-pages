<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# @visuelconcept/wui-warehouse

Warehouse Management System — a standalone WinCC OA WebUI page (Lit + Siemens iX)
to configure storage zones and locations, maintain a product catalog, visualise
stock on a 2D plan and in tables, and run stock-count inventory campaigns.

Auto-discovered as the page `warehouse` (`libs/wui-<page>/src/<page>.ts`
convention): route `/warehouse`, component `wui-warehouse`, served at
`/data/dashboard-wc/pages/warehouse.js`. The menu entry
(`menu.fragment.jsonc`) and the Application-Security role fragment
(`src/app-security.roles.json`) are merged automatically by the dev-wiring
plugins — no central registration.

## Tabs

| Tab           | What it does                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------- |
| **Plan**      | 2D map **or** procedural 3D scene of zones/locations coloured by occupancy (grey → green → amber → red). Click a location to inspect its contents. In edit mode you can move and (in 3D) resize racks in all three dimensions via on-object handles; each location also has its own 3D model **type** and **colour**. A **Fullscreen** button expands the 2D/3D scene. |
| **Stock**     | KPI tiles (stocked SKUs · total units · products below minimum · empty locations), zone filter + search, and the stock table with add / adjust / remove. |
| **Zones**     | CRUD of zones and their locations, including the plan layout rectangle (grid units) and capacity.  |
| **Products**  | CRUD of the product catalog: reference, name, category, unit, min/max thresholds.                  |
| **Inventory** | Stock-count campaigns: snapshot the stock of a zone (or the whole warehouse), enter the physical count per line, review the variance, then **validate** — the counted quantities are written back to stock and the campaign is closed. |

## Data model & persistence

Everything lives in real WinCC OA datapoints, provisioned on first use via the
PARA REST API (`/api/para/*` — the `para` backend module is a prerequisite, as
for every JSON-store page). There is a **hybrid** granularity by design:

- **Configuration & records** — one JSON-in-DP datapoint per entity via the kit
  `DpJsonStore` (Struct type with `name` + `json` String leaves):
  - `WMS_Zone_*` — zones (`id, name, code, color, description, x, y, w, h`)
  - `WMS_Location_*` — locations (`id, zoneId, code, label, type, capacity, x, y, w, h`; x/y/w/h are **relative to the zone**)
  - `WMS_Product_*` — product catalog
  - `WMS_Inventory_*` — inventory campaigns (with their count lines)
- **Stock quantities** — a **dedicated `WMS_Stock` datapoint type**, one DP per
  product×location (`WMS_Stock_<location>__<product>`), so a quantity is a real
  DPE that can be archived, trended and alarmed on its `minQty`/`maxQty` —
  `{ quantity:Float, product:String, location:String, minQty:Float, maxQty:Float }`.

When the backend is read-only or unreachable, every store transparently falls
back to an in-memory **demo dataset** and shows a banner — the UI stays fully
usable; changes just aren't persisted. On a writable, empty project the same
dataset is **seeded once** so the page is populated on first open. The demo set
ships **five demonstration sites** with distinct configurations: *Nord* (mixed
racks / cold / floor), *Sud* (picking shelves + return bins), *Est* (tall,
coloured high-bay pallet racks — showcases the per-location 3D height/colour),
*Ouest* (cold chain: cold rooms + refrigerated dock) and *Atelier* (a compact
mixed store), with seeded stock exercising the full occupancy palette and a few
under-min / over-max cells.

> Existence of a possibly-missing DP is always probed with `dpNames` (never
> `dpGet`/`dpConnect`, which throw uncatchably in the webserver CTRL layer for a
> non-existent DPE).

## Run without WinCC OA (standalone demo)

To open and **use** the Warehouse page in your browser with the built-in demo
dataset — no WinCC OA, no login, no `/api/para` backend — use the launcher:

```bash
node tools/warehouse-standalone.mjs        # add --no-open to skip auto-opening the browser
```

It starts the Vite dev server with a dead `BASE_URL` (so every backend call fails
fast and the stores engage their in-memory demo fallback), mounts `<wui-warehouse>`
through a minimal harness (iX theme + DI, no shell/router/login), prints the URL
(`http://127.0.0.1:4300/warehouse-standalone.html`) and keeps running until
`Ctrl+C`. All five tabs, the 2D/3D plan, dialogs and inventory campaigns work;
edits stay in memory for the session. The "offline" banner confirms demo mode.

Prerequisite: a wired runtime workspace (`apps/dashboard-wc/` present). If it is
missing, the launcher prints the one-time setup commands — see
[DEVELOPMENT.md](../../DEVELOPMENT.md) §1. For non-interactive screenshots of the
same offline mode, see [`tools/screenshot-warehouse-demo.mjs`](../../tools/screenshot-warehouse-demo.mjs).

## Application Security (module id `warehouse`)

| Role           | Gates                                                        |
| -------------- | ----------------------------------------------------------- |
| `view`         | Opening the page's data at all.                             |
| `edit-config`  | Create/edit/delete zones, locations and products.           |
| `adjust-stock` | Add / adjust / remove stock quantities.                     |
| `inventory`    | Create campaigns, enter counts, validate (writes to stock). |

Roles are **open until an admin assigns groups** in `/app-security`. The page
self-registers its roles (`registerModuleRoles`) and gates the affordances with
`hasRole$`. There is **no module-specific backend route**: all writes go through
the shared PARA REST endpoints, so server-side enforcement rides on PARA's own
ACL rather than a per-route `requireRole` guard. If a future revision adds a
dedicated backend route for a sensitive action, wrap it with `requireRole` +
`appSecurityGuard.ts` per `docs/wui-app-security/INTEGRATION.md`.

## File layout

```
libs/wui-warehouse/
  menu.fragment.jsonc                 # nav entry (auto-merged)
  package.json                        # + wuiPage manifest
  project.json                        # Nx (tags: package, standalone-page)
  src/
    warehouse.ts                      # page entry (wui-warehouse) — tabs + orchestration
    app-security.roles.json           # role declaration (auto-merged + self-registered)
    warehouse/
      types.ts  i18n.ts  model.ts  forms.ts
      data/  stores.ts  stock-store.ts
      ui/    wh-entity-dialog.ts  wh-plan.ts  wh-plan3d.ts  plan3d-textures.ts
             wh-stock.ts  wh-zones.ts  wh-products.ts  wh-inventory.ts
```
