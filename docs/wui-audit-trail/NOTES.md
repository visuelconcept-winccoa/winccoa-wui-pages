# wui-audit-trail — business & architecture notes

Tier 1 module (pure front-end, no backend or manager, empty `npmDeps`). Route `/audit-trail`, element `wui-audit-trail`, visible in the menu.

## Domain / purpose

Standalone **GxP Audit Trail** page over the **fixed `_AuditTrail`** datapoint type (WinCC OA system type). The page does **not** let the user point at an arbitrary DP / pick columns — the structure is fixed:

`time · username · uinum · batchid · item · itemtype · action · oldval · newval · reason · host`
(who / what / when / why / old → new — the standard GxP audit fields).

The page has two jobs:
1. **Manage** the project's `_AuditTrail` datapoints — create new ones (always NGA-archived), reassign the archive group, delete them — via the `at-manage-dialog` popup ("Gérer" button).
2. **View** the archived history of the selected `_AuditTrail` DP as a **log table** (one row per archived record, newest first). Default = rolling **last 24 h in live mode** (auto-refresh); a **start/end `datetime-local`** range selects an arbitrary interval. Export to **CSV / JSON** and **print**.

> Records are **written by WinCC OA's audit mechanism / panels / scripts**, not by this page. The page only creates/archives the DPs and visualizes them.

## Data model (DPs)

- **Audit DPs**: instances of the fixed type **`_AuditTrail`** (the system DP `_AuditTrail` plus user-created ones, prefixed `AuditTrail_…`). Listed via `OaRxJsApi.dpNames('*', '_AuditTrail')`.
- **Config persistence**: a single DP `AuditTrail_Config` (Struct, String `json`) holding the serialized `AuditConfig`, via `AuditConfigStore` → shared `DpSingleJsonStore` (object mode merges over defaults, so the config-shape change is backward-safe). `AuditConfig` holds: selected `dpName`, `live` flag, `rangeStart`/`rangeEnd` (`datetime-local`), `maxRows`.

## DP management & archiving (`dp-admin.ts`, `at-manage-dialog.ts`)

All through the existing **PARA REST** endpoints + `OaRxJsApi` — **no new backend** needed.

- **Create**: `POST /api/para/dp/create { dpName: 'AuditTrail_<suffix>', dpType: '_AuditTrail' }`, then **enable archiving** on **every** leaf (archiving is mandatory).
- **Enable archive** (mirrors `wui-para`'s `para-archive.ts`, verified DPCONFIG/DPATTR constants): `POST /api/para/dp/set` with
  `dpeNames=[ '<dpe>:_archive.._type', '<dpe>:_archive.1._type', '<dpe>:_archive.1._class', '<dpe>:_archive.._archive' ]`,
  `values=[ 45 /*DPCONFIG_DB_ARCHIVEINFO*/, 15 /*DPATTR_ARCH_PROC_VALARCH = NGA value archive*/, <group>, true ]`, per leaf.
- **Archive groups**: active `_NGA_Group` DPs — `dpNames('*', '_NGA_Group')` filtered by `.active` set, `.isAlert` unset, dropping `_2`-suffixed (same rule as Para). No active group ⇒ no creation possible (a warning is shown).
- **Status read**: `dpGet([ '<dpe>:_archive.._archive', '<dpe>:_archive.1._class' ])` on the representative `time` leaf.
- **Delete**: `DELETE /api/para/dp/:name?dpType=_AuditTrail` (type-guarded). The **system `_AuditTrail` DP is not deletable** from the UI.

## Key algorithms (`engine.ts`)

- **Columns** = the fixed `_AuditTrail` leaves of the selected DP (`<dp>.<field>` for each `AUDIT_FIELDS` entry). No type-structure traversal / element enumeration anymore.
- **History**: per column, `queryHistory` = `api.dpGetPeriod(start, end, 0, dpe + ':_original.._value')`. Parses `{data, dataTime}` → samples.
- **Pivot** (`buildPivot`): union of all change timestamps (descending, capped at `maxRows`); each cell = last value ≤ `t` via binary search. Because an audit record writes its elements atomically, every record yields one row; carry-forward correctly fills fields that didn't change that record.
- **Timestamp column**: rendered from the record's own `time` value (`toMsLoose` tolerant parse: epoch s/ms or date string), falling back to the archive change time `row.t`.

## Export / print (`export.ts`)

The page builds the already-formatted display rows (`string[][]`, one cell per `AUDIT_FIELDS` column) once via `displayRows()` and feeds them to:
- `exportAuditCsv` — `;`-separated, UTF-8 BOM (Excel), via the shared kit `download`/`csvCell`.
- `exportAuditJson` — `{ datapoint, exportedAt, count, rows: [{ time, username, … }] }`.
- `printAudit` — opens a print-friendly window (styled table) and calls `window.print()`.

## Pitfalls / things to know

- The audit DP **must be NGA archived** (the page enforces this on create); without archived data, the table is empty.
- **Live**: `dpConnect` on the fixed leaves triggers a debounced re-query (dashboard pattern), gated by the **Live 24 h** toggle. Turning live off seeds the range to the last 24 h.
- `datetime-local` values are **local time**; `new Date('YYYY-MM-DDTHH:mm')` parses them as local (matches the codebase pattern in report-builder / production-orders).
- The shared kit is a **dependency** (`@visuelconcept/wui-kit`): `dp-single-json-store` (config) and `io` (export) are used; `wui-confirm-dialog` for delete confirmation. The vendoring tool follows these imports, so they ship in the page's `_vendor/`.
- Auto-discovered bundle (top-level `.ts` in standalone-pages) and **self-contained** (no shared chunk).
