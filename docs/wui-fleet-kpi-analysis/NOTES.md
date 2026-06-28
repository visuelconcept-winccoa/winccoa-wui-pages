# wui-fleet-kpi-analysis — business & architecture notes

Standalone WebUI page **KPI Analysis** (route `/fleet-kpi`, hidden in the menu). Tier 3: frontend + server manager `kpiCalc`, no `/api` module and no ws relay.

## Domain / purpose

Computation of per-machine performance indicators (OEE based on availability, and on the manager side MTBF/MTTR), over a time window, from NGA archive history. Two uses:

- **The `/fleet-kpi` page**: after-the-fact analysis over a chosen period. Access via the "Analyse des KPI" (KPI analysis) button of the 3D view (`mf-atelier-overview` → `wui:kpi` event → `RouterEvent('/fleet-kpi')` on the shell side). Start/end date filters (default: last month) + workshop/machine multi-select, "Jours non travaillés" (non-working days) button. **Table** tab (1 row/machine: OEE bar colored by threshold, unplanned stop, planned stop; footer = weighted fleet OEE) and **Chart** tab (echarts: 1 bar/machine). Machines with no archived history show "—" (`hasData=false`), never a misleading 100%.
- **The live OEE/KPI per machine in the 3D view**: computed continuously on the server side by the `kpiCalc` manager, archived for trending, shown in the bubble. (Note: this **replaced** the old client-side live OEE; do not reintroduce `showTrs`/`trsWindow`/`refreshTrs`.)

The page shares the algorithmic **single source of truth** with the stop-analysis page: it reuses `fleet-stop-analysis/engine.ts` (`queryHistory`, `nonProductionIntervals`, `partitionByCause`, `resolveGroup`) and the `fleet-stop-analysis/styles`.

## Data model (DPs)

- **`MachineFleet3D_Closures`** — a single JSON DP holding the non-working days/periods (operating time). Shape: `ClosureConfig { ateliers: {atelierId: Range[]}, machines: {machineId: Range[]} }`, `Range {start, end}` as local datetime `yyyy-MM-ddTHH:mm`. The effective set for a machine = its workshop's ranges ∪ machine ranges (the workshop level applies to all its machines). The `FleetStore` handles it as an opaque blob (`unknown`); the page owns the shape via `closures.ts` (`normaliseClosures`). Edited in `mf-kpi-closures-dialog`.
- **`MachineFleet3D_Kpi`** — DP type created by the `kpiCalc` manager (`dpTypeCreate` at startup). Elements: `value` (Float, NGA-archived) + Strings `kpiType, machineId, machineName, window, unit, updatedAt`. One instance per configured KPI, named `MachineFleet3D_Kpi_<sanitize(machineId)>_<sanitize(kpiId)>` (sanitize = `[^A-Za-z0-9_] → _`).
- **KPI config model** (on the `MachineDef.kpiCalcs?: MachineKpi[]` side): `KpiType = 'TRS'|'MTBF'|'MTTR'`; `MachineKpi {id, type, window, refreshMin, label?, showInBubble?, thresholdId?, archive?, archiveGroup?}`. Per-KPI archiving: `archive` toggle (default true) + NGA group `archiveGroup`. No KPI configured by default → the manager stays idle and the bubble shows nothing until a user adds a KPI in the machine dialog.

## Algorithms / key formulas

**OEE (page, availability only)**:
- operating time = window − non-working periods (closures)
- required time = operating − planned stops
- **Availability = (required − unplanned) / required**; performance and quality fixed at 100%.

Classification of each stop sub-segment via the cause catalog (`resolveGroup().classification`): `planned` → planned bucket, `production` → considered available (ignored), everything else (`unplanned` / unknown cause / no cause) → unplanned. **A stop that overlaps a non-working period is NOT counted.**

**MTBF / MTTR (manager, in minutes)** — computed over **unplanned time only**; planned stops are ignored (counted as running time, do not degrade the metric):
- MTBF = (operating − unplanned) / N_failures
- MTTR = unplanned / N_failures
- a "failure" = a stop containing at least some unplanned time.

**Assignment of causes over time** (`partitionByCause` / `causeBoundaries`): a stop's initial segment with no cause is back-filled up to the first assigned cause, then carried forward. As long as no cause is assigned the time counts as **unplanned**; as soon as a cause is assigned, the whole stop is reclassified planned/unplanned from its start. `classify(code)`: `''`/null → unplanned, otherwise `causeClass[code] || __default || unplanned`. Only `planned` is subtracted from the required time.

OEE color thresholds: ≥ 90% green, ≥ 75% amber, otherwise red (workshop config `trsThresholds` / `resolveTrsColor`, kept as reference by the OEE KPI).

## Backend / manager (`kpiCalc`)

Manager `manager/kpiCalc` (`kpiCalc/index.js`, plain JS, winccoa-manager; pmon `node | always | 30 | 3 | 1`).

- At startup: `dpTypeCreate` of `MachineFleet3D_Kpi`.
- Per configured KPI: ensures a DP `MachineFleet3D_Kpi_<machineId>_<kpiId>`, enables NGA archiving on `.value` (`_archive.._type=45`, `.1._type=15`, `.1._class=<NGA group>`, `.._archive=true`), computes over the KPI's sliding window, writes value + metadata, all gated by `refreshMin`.
- Honors the per-KPI archiving toggle: `archive===false` → `disableArchived` (sets `_archive.._archive=false`); otherwise `ensureArchived(valueDpe, archiveGroup || <first discovered>)`. The `archived` Set is keyed `"<dpe>|<group>"` / `"<dpe>|off"` to re-apply on toggle.
- Honors **closures** (`MachineFleet3D_Closures`, subtracted from each interval) AND cause assignment (`partitionByCause` logic ported from the stop-analysis page).
- Cadence: re-reads config catalog + closures + KPI list every 60 s; base tick 15 s.

**Archive groups = ACTIVE only**: `FleetStore.listArchiveGroups()` returns only the `_NGA_Group` DPs whose `.active === true`. Used by the Archiving tab and by the per-KPI archive group selector.

**3D bubble wiring**: the page subscribes to each KPI's `…_<kpiId>.value` DP (kind `DpTarget` `'kpiCalc'`); `applyDpValue` stores into `machine.kpiCalcValues` and pushes via `updateMachineLive`. `label-manager.kpiCalcLines()` renders the `showInBubble` KPIs. The view-side `KPI_CALC_PREFIX` / `sanitizeKpiId` **must exactly mirror** the manager's DP naming.

## Pitfalls / things to know

- **Runtime prerequisite**: requires the NGA history `.state` (stops) and `.cause` (planned/unplanned split). On this project `.cause` is currently NOT archived → the whole stop counts as unplanned and planned = 0.
- **Unified "Display" tab** (machine dialog): single source of truth `MachineDef.display?: DisplayEntry[]` (`{ref, inBubble, inPopup}`, order = index). `ref` = `state | stopCause | workOrder | operation | param:<key> | kpi:<id>`. `resolveDisplaySlots(m)` builds the ordered catalog; items absent from `display` are appended at the end (new params/KPIs appear automatically). The old per-tab visibility toggles have been REMOVED.
- **Opaque closures on the store side**: the `FleetStore` keeps `MachineFleet3D_Closures` as an `unknown` blob to avoid a back-dependency on the page; any shape change happens in `closures.ts`, not in the store.
- **Machines with no data**: show "—" (`hasData=false`), never 100%.
