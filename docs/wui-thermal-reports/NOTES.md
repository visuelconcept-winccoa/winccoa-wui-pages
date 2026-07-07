# wui-thermal-reports — business & architecture notes

Standalone WebUI page **Thermal Treatment Reports (TTD)** (`/thermal-reports`).
Entry custom element `wui-thermal-reports` (class `WuiThermalReports`), sub-component prefix `tt-`. Required permission: `connected`. Tier 1 (pure frontend, no dedicated backend or manager).

## Domain / object

Thermal treatment cycle reports **per load** (furnace). Each report documents:

- **Identity**: reportNo / load / orderNo (work order) / part / material / quantity.
- **Treatment**: `TreatmentType` (cementation, carbonitruration, nitruration, trempe, revenu, recuit, detente, normalisation, autre) + `QuenchMedium` (quench medium) + `atmosphere` (free text).
- **Recipe**: `steps: ThermalStep[]`, each step = setpoint (`setpoint` °C) / `durationMin` / tolerances `tolMinus`/`tolPlus` / `atmosphere` / `label`.
- **Furnace link**: atelierId/Name, machineId/Name + `tempDp` (temperature DPE) + cycle window `startTime`/`endTime` (format `YYYY-MM-DDTHH:mm`).
- **Quality**: `results: QualityResult[]` (label/value/unit/min/max), `conformity` (pending / conform / nonconform).
- **Lifecycle**: `status` (draft / running / completed / validated / rejected) + operator / validatedBy / validatedAt / notes.

Model in `types.ts`: label+color maps, helpers `blankReport` / `blankStep` / `blankResult`, `resultConform`, `sanitizeId`, `tempDpForMachine`.

**Master/detail** view: the entry switches between the list (`tt-report-table` + `tt-kpi-bar` + toolbar) and the detail view via `selectedId`. The KPI bar is computed **locally in the browser** (no server manager).

## Data model (DPs)

**1 DP per report** (assumed choice), type **`ThermalReport_Report`** (Struct: String `name` + String `json`), prefix `ThermalReport_`.

- Auto-creation of the type and the DPs via PARA REST (`/api/para/dptype|dp/create`, `/api/para/dp/set`, `DELETE /api/para/dp/:name?dpType=`) — exact copy of the asset-lifecycle page's `AssetStore`. The type is **not pre-created via MCP**: auto-creation on first load is enough.
- Reading via `WuiDpeService.listDatapoints` + `OaRxJsApi.dpGet`.
- **Transparent offline fallback** (`mem()`): seeds `buildDemoReports([])` → 4 offline demo reports.
- Persistence in `data/report-store.ts`; JSON export/import (envelope `{kind:'thermal-reports', version, reports}`) + CSV export in `data/io.ts`.

## Key algorithms / formulas

Core in `engine.ts`:

- **Data source = furnace archives** (explicit choice). The report reads the **actual temperature curve** from the furnace's archived DPE over `[startTime, endTime]`:
  `readActualCurve` = `api.dpGetPeriod(start, end, 0, tempDp + ':_original.._value')` (same mechanism as the audit-trail page / the fleet engine).
- **Default temperature DPE** auto-filled in the dialog from the selected furnace = **`MachineSim_<sanitize(machineId)>.temperature`** (the machineSim manager simulates the furnace temperature under `MachineSim_<id>.temperature`).
- `synthesizeActual`: when no archived data is found (offline / non-archived DPE), it builds a plausible **deterministic** curve (first-order lag toward the setpoint staircase + sinusoidal oscillation, **no RNG**); the detail then shows "simulated curve".
- `buildProfile`: setpoint staircase + tolerance band (2 points/step, `step:'end'`).
- `evaluateCycle`: → `inBandPct` / `maxDeviation` / min-max.

**Chart** (`tt-temp-chart.ts`, echarts): actual line (smooth) + dashed setpoint staircase + tolerance band via the **stacked confidence-band trick** (invisible low series `bandBase` stacked under a filled-thickness series `Tolérance`). `getImageDataUrl()` exposes a PNG for printing.

## Pitfalls / good to know

- **Printing — white curve (fixed 2026-06-20)**: `win.print()` was called **synchronously** right after `document.write`, racing the decode of the PNG's data-URL `<img>`. Fix: `print.ts` injects a `PRINT_SCRIPT` that calls `window.print()` **only after all `document.images` have loaded**; `tt-report-detail.print()` now only does `document.write` + `close`. Belt-and-braces in `tt-temp-chart.ts`: `getImageDataUrl()` runs `chart.resize()` before `getDataURL` (eliminates the stale screen size — the reason zoom "sometimes helped"), and the chart option pins `animation: false` (never a mid-draw capture).
- **echarts**: imported as `import * as echarts` (externalized via the shared-bundle import-map, like po-gantt / fleet-stop) — it is NOT a chunk.
- **Validation/rejection**: the buttons emit `wui:status`; `applyStatus` (in the entry) stamps `validatedBy`/`validatedAt` and derives conformity from `pending`.
- **Printing** = `print.ts buildPrintHtml` (pure, embeds the chart PNG) → self-contained HTML document in a new window.
- **Demo** (`data/demo-reports.ts`): `buildDemoReports(ateliers)` builds 4 reports (cementation / nitriding / quenching / stress relief, mixed statuses+conformities) on real furnaces from the fleet (type `four`); fabricates 2 placeholder furnaces if the fleet has none. Used by the empty-state button AND the offline seed.

## Not done / leads

- **Live `dpConnect`** refresh of the curve while a load is running (currently a one-shot read on open/edit).
- DE/EN i18n of the in-component FR labels.
- Richer auto-derivation of conformity (today a manual field + computed indicators).
- NGA archiving of report DPs for trending.

## Application Security (roles — added 2026-07)

The page declares 2 roles (self-registration in `thermal-reports.ts` +
mirrored in the app-security manifest): `view`, `edit`. All OPEN until an
admin assigns groups in `/app-security` (docs/wui-app-security/INTEGRATION.md).

- **`view`** — gates the page BODY: without the grant the header stays but the
  list/detail is replaced by a "role missing" notice.
- **`edit`** (create/validate treatment reports) — hides every mutation
  affordance (`hasRole$`, subscribed per component): the "New report" +
  "Import JSON" buttons and the demo-generation empty-state button
  (`thermal-reports.ts` — a revoke also closes an open editor dialog / pending
  delete confirm), the row edit/delete icon buttons (`tt-report-table`), and
  the Edit / Reject / Validate actions (`tt-report-detail`). Viewing, opening
  a report, printing and JSON/CSV **export stay open** (read-only).
- Tier 1 module (no dedicated backend routes) → no server-side `requireRole`
  guard; persistence goes through the shared PARA REST API, which is
  deliberately not gated per-module (see docs/wui-para/NOTES.md).
