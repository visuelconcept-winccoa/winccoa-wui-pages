# wui-production-orders — business & architecture notes

Standalone **Production Orders** WebUI page (`/production-orders`, custom element `wui-production-orders`, class `WuiProductionOrders`). Tier 3 (frontend + backend manager). Page prefix `wui-`, sub-component prefix `po-`. Menu permission `connected`, icon `capacity`.

## Domain / object

Management of **production orders (OF)**: sortable CRUD table, status workflow, indicator bar (KPIs), Gantt planning view and a link to the 3D machine fleet.

`ProductionOrder` model (`types.ts`):
- **Identity / product**: `orderNo`, `product`, `article`, `qtyOrdered` / `qtyProduced`.
- **Assignment**: `atelierId/Name`, `machineId/Name`.
- **Planning**: `planned`/`actual` start/end, stored as local `YYYY-MM-DDTHH:mm` strings.
- **Status**: `planned | running | paused | done | cancelled`.
- **Other**: `priority`, `progress`, `notes`.
- The status and priority label+color maps live in `types.ts`.

Features: table (`po-order-table`) with workflow buttons + edit/delete + progress bar; KPI bar (total / upcoming / running / done / late); create/edit dialog (`po-order-dialog`, `<input type=datetime-local>` for dates); JSON+CSV export / JSON import (`data/io.ts`, envelope `{kind:'production-orders', version, orders}`); Table / Planning view toggle.

## Data model (DPs)

**Persistence differs from the other pages**: the **entire list is ONE single DP** (explicit business choice "1 single DP = JSON list"), and NOT one DP per record.

- Type `ProductionOrders_List`: Struct with a single String element `json`; single instance `ProductionOrders_List`.
- `OrderStore.load()` reads `<DP>.json` (helper `extractJsonString` that spots a string starting with `[`); `saveAll(orders)` rewrites the whole array via PARA REST `/api/para/dp/set`.
- Auto-creates type+DP via `/api/para/dptype/create` + `/api/para/dp/create`; transparent in-memory fallback in offline mode.

KPI DP (computed server-side, see Backend):
- Type `ProductionOrders_Kpi`: Struct, Float `total / planned / running / paused / done / cancelled / late / avgProgress` + String `updatedAt`; single instance.

## Key algorithms / formulas

- **Status workflow** (`workflow.ts`): `actionsFor(status)` returns the allowed transitions with their icon (play/pause/check/cancel). `applyTransition` stamps `actualStart`/`actualEnd` + adjusts `progress`. The table's inline icon-buttons emit `wui:status {id, target}`.
- **Gantt planning** (`po-gantt.ts`): echarts custom-series, one row per order, time x-axis, bar colored by status. echarts externalized via the shared-bundle import-map (same scheme as fleet-stop-analysis).
- **KPI**: counts by status + `late` (planned-end exceeded) + `avgProgress`, computed manager-side (see below).

## Backend / manager

WinCC OA manager `productionOrdersKpi` (`manager/productionOrdersKpi/index.js`, plain JS, winccoa-manager). The indicator bar at the top of the page is **NOT computed in the browser**: the manager owns it.

- At startup it `dpTypeCreate`s the `ProductionOrders_Kpi` type + its DP, then **polls** `ProductionOrders_List.json` every ~5 s (deliberate polling, not `dpConnect`, so that the `late` counter refreshes as planned-ends go by), computes the counts and `dpSet`s the fields — **guarded by a JSON signature** to write only on change.
- On the front side, `po-kpi-bar.ts` resolves `OaRxJsApi` (tsyringe) and `dpConnect`s the `ProductionOrders_Kpi.<field>` DPEs live; it keeps the in-memory computation from `.orders` as a **fallback** (`live === null` → local) to keep numbers in offline mode.
- pmon: `node | always | 30 | 3 | 1 | productionOrdersKpi/index.js`.

## Fleet link (Machine Fleet 3D)

- The page instantiates Machine Fleet 3D's `FleetStore` (`./machine-fleet-3d/data/fleet-store.js`) to populate the dialog's cascading workshop→machine selects and to seed the demo orders against the **real** fleet (`data/demo-orders.ts buildDemoOrders(ateliers)`).
- On status → `running`, best-effort push of `orderNo`/`product` to the assigned machine's `workOrderDp`/`operationDp` fields (these MachineDef fields drive the OF/Op display of the 3D bubble); cleared on `done`/`cancelled` (`data/fleet-link.ts`, REST `/api/para/dp/set`, all in silent try/catch).
- Shares the rollup chunk `chunks/fleet-store.js` with the other fleet pages.

## Pitfalls / things to know

- **DPE field extraction in `po-kpi-bar`**: from the normalized dp emission via a local `fieldOf` (strip `System1:`, `:_online.._value` and the trailing dot, take the part after the last `.`).
- **ix icons**: `play`/`pause`/`check`/`cancel` exist; `floppy-disk`/`chart-bar`/`save` do NOT → use `check`/`barchart-horizontal`/`table`.
- **Lint**: `no-magic-numbers` non-blocking; `unicorn/consistent-function-scoping` flags the internal `pad`/`fmt` arrows → hoist them to module scope.
- **Labels**: currently hard-coded in FR in the components (no FR/DE i18n yet).
- **Not done yet**: order import from ERP/MES, archiving of the order history (the Kpi DP could be NGA-archived for trending), live binding of `qtyProduced` from the machine counters.

## Application Security (roles — added 2026-07)

The page declares 2 roles (self-registration in `production-orders.ts` +
mirrored in the app-security manifest): `view` and `edit`. All OPEN until an
admin assigns groups in `/app-security` (docs/wui-app-security/INTEGRATION.md).

- **`view`** — gates the page BODY: without the grant the header renders as
  usual but the body is replaced by a "role forbidden" notice (`MSG.notice.roleForbidden`).
  KPI bar, table, Gantt and exports all live inside the body, so they follow.
- **`edit`** (description: manage orders and their workflow) — hides every
  order CRUD affordance: "New order" + "Import JSON" toolbar buttons and the
  empty-state "Generate demo orders" button (`production-orders.ts`), and the
  per-row actions cell — status-workflow buttons (start/pause/resume/complete/
  cancel) + edit/delete icon-buttons (`po-order-table.ts`, own `hasRole$`
  subscription, para-type-editor pattern). Revoking the grant live also closes
  an open `po-order-dialog` / delete confirm. Viewing (table, Gantt, KPIs) and
  the JSON/CSV exports stay open — they only read.
- No server-side guard: the page persists through the SHARED PARA REST API
  (`/api/para/dp/set`), which is deliberately not gated with module roles
  (see the PARA notes) — gating is UI-level, like the other DP-JSON pages.
