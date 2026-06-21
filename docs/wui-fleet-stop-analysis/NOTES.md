# wui-fleet-stop-analysis — business & architecture notes

Standalone WebUI page **Stop-Cause Analysis** (`/fleet-stops`, hidden route), tier 1 (pure frontend, no backend or manager). Breaks down multi-machine stop time by cause over a period.

## Domain / purpose

- After-the-fact analysis of a machine fleet's stops: for each machine and each stop cause, it computes the assigned time, the total stop time, and the number of occurrences over a chosen period.
- Access from the **Machine Fleet 3D** view: the "Analyse des causes d'arrêts" button of the overview (`mf-atelier-overview`) emits `wui:analyze`, the `wui-machine-fleet-3d` shell triggers `RouterEvent('/fleet-stops')`. The page's Back button returns to `RouterEvent('/fleet-3d')`.
- **This is where the stop-cause catalog editor lives** (moved from the overview): toolbar button "Causes d'arrêt" (icon `alarm`) → `mf-stop-causes` dialog (`.store` / `.canEdit` / `@wui:close`). On close, the page reloads the catalog (`listStopCauses`) and **recomputes** the analysis, because the causes' classifications/labels affect the result. This is the main page of the "stop causes" function.

## Data model (DPs)

- No DP of its own for this page. Data comes from the **archived history** of the machines' DPEs:
  - `stateDp` (machine state) and `stopCauseDp` (cause code) of each machine, provided by the `FleetStore` workshop config (reused from machine-fleet-3d).
- The **cause catalog** is read via `FleetStore.listStopCauses()` (entries with label, classification, and an `isDefault` flag).
- Also reuses `types.ts` from machine-fleet-3d.

## Algorithms / key formulas

Core in `engine.ts` (`analyseStopCauses`, a pure history-query + interval algorithm function):

- For each machine, queries the archived history of `stateDp` and `stopCauseDp` via `OaRxJsApi.dpGetPeriod(start, end, 0, dpe + ':_original.._value')`. The **count `0` means ALL values in the period** (passed as-is to `dpGetPeriod` on the CTRL side).
- The query is widened by **one window width before `start`** to know the active state/cause at the start boundary.
- **Non-production** intervals = resolved state `!== 'ok'` (warn + stop + maint all count); adjacent intervals are merged.
- For each stop interval, partition by active cause:
  - **upstream back-fill**: a gap before the first cause → the first cause takes the start of the stop ("adjust to the start of the stop");
  - **carry-forward**: carry the last known cause forward;
  - **truncation** at the end of the stop (overlap handling).
- Per-cause aggregates: `assignedMs` (partitioned time, whose sum = total stop duration), `downtimeMs` (full duration of the interval per distinct cause present), `occurrences` (+1 per stop containing the cause).
- Unknown / off-catalog codes → folded onto the catalog's `isDefault` entry (same logic as `formatStopCause`). With no default and no code → "Sans cause assignée".
- **Filters**: workshop/machine multi-selections. An empty filter set **= "all"** (the engine treats an empty `Set` as no filter). Default period: last month.

## Pitfalls / things to know

- **Runtime prerequisite — NGA archiving**: the state/cause DPEs must be NGA-archived, otherwise `dpGetPeriod` returns nothing and the page shows "Aucune donnée d'historique". MachineSim DPs are **not** archived by default → enable via the per-machine archiving toggle (`FleetStore.setArchive`) or the NGA config.
- **echarts not bundled**: bare import `import * as echarts from 'echarts'`, externalized via the shared-bundle import map (in `export-echarts-entry`), resolved at runtime by the shell. `@siemens/ix-echarts` only exports theme helpers (`registerTheme`), not a component → the page initializes echarts directly in a `<div #chart>`.
- **Lit recreates `#chart` on tab change**: `renderChart()` must `dispose()` then re-initialize when `chart.getDom() !== host`, otherwise the chart re-attaches to a detached node.
- **Shared chunks**: the page reuses `FleetStore` / `types.ts` (and, via the `mf-stop-causes` dialog, `dialog-styles` / `router-event`) from machine-fleet-3d; rollup extracts **shared chunks** from them, imported by both pages. Their names are **content-derived and change between builds** → never hardcode them; check each deployed page's `./chunks/...` references. `three` is NOT in this page's bundle (present in `npmDeps` because shared/transitive via the fleet store).
