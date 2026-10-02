# Machine Fleet dashboard widgets — `machine-fleet-gantt` & `machine-fleet-dt-analysis`

Two **WinCC OA dashboard widgets** (the built-in `/dashboard` editor's palette,
folder **Machine Fleet**) that lift the two analysis bands of the fleet's built-in
machine dashboard (`mf-machine-dashboard` of `wui-machine-fleet-3d`) into
freely placeable dashboard widgets:

| Widget                                                      | Tag                     | What it shows                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Machine state Gantt** (`machine-fleet-gantt`)             | `mf-widget-gantt`       | The proportional, coloured state timeline of ONE machine over the dashboard time range; each stop segment carries its stop cause (hover bubble); legend from the machine's state mapping; time axis; CSV export to the second.                                          |
| **Machine downtime analysis** (`machine-fleet-dt-analysis`) | `mf-widget-dt-analysis` | The same machine's downtime decomposed by stop cause: KPI strip (availability, unplanned/planned downtime, failures, MTBF, MTTR), Pareto chart (downtime or frequency, cumulative % line), optional table, CSV export. Stop class / metric / Top N are switchable live. |

Both are **pure widgets**: no backend, no manager, no fetch. The dashboard's
`data-point` contexts fetch the archived histories over the widget's time range
and hand them to the widget; the widget only computes and draws.

## Files (deployed under `<project>/data/WebUI/`)

```
widgets-v2/MachineFleet/
  machine-fleet-core.js                                  shared engine (intervals, causes, formatting)
  machine-fleet-gantt/machine-fleet-gantt.js             + .widget.json
  machine-fleet-dt-analysis/machine-fleet-dt-analysis.js + .widget.json
svg/machine-fleet-gantt.svg, svg/machine-fleet-dt-analysis.svg   palette icons
msg/{en_US,fr_FR,de_AT}.utf8/WUI_Widget_MachineFleetGantt.json
msg/{en_US,fr_FR,de_AT}.utf8/WUI_Widget_MachineFleetDtAnalysis.json
msg/{en_US,fr_FR,de_AT}.utf8/WUI_General.json            folder name "Machine Fleet"
```

Source of truth in this repo:
[`libs/wui-machine-fleet-3d/oa-data/WebUI/`](../../libs/wui-machine-fleet-3d/oa-data/WebUI/),
published with the `@visuelconcept-winccoa/wui-machine-fleet-3d` package.

## Install / deploy

**wui-toolkit 0.6.0 deploys no dashboard widget** — the module contract has no slot
for one. Copy the tree by hand, keeping its layout:

```powershell
# <project>/data/WebUI/ ← the module's oa-data/WebUI/
Copy-Item -Recurse -Force node_modules\@visuelconcept-winccoa\wui-machine-fleet-3d\oa-data\WebUI\* <project>\data\WebUI\
```

`WUI_General.json` carries only this module's palette-folder name, so it must be
**deep-merged** with any `WUI_General.json` already in the project (the Alarms widget
ships its own). No webserver
build or manager restart is needed: widget definitions are served as static
`/data/…` files. Then, in the browser, **DevTools → Application → Clear site
data** and reload (the service worker caches the widget list), open a dashboard in
edit mode: the two widgets appear in the palette under **Machine Fleet**.

Prerequisites on the WinCC OA side (the same as for the fleet's own dashboard):

- the machine's **state** and **stop-cause** DPEs are **NGA-archived** (machineSim
  DPs are not archived by default — enable it in the machine dialog / NGA config);
- the fleet pages have been installed at least once (they create the
  `MachineFleet3D_<atelier>` and `MachineFleet3D_StopCauses` DPs the widgets bind).

## Configure a widget (both widgets share the same bindings)

1. **Time range** tab — the dashboard time range (`now/d`, `now/w`, `24h`…). Both
   histories are fetched over it; the range button in the widget lets the viewer
   change it live when _Range selectable_ is on.
2. **Content → Machine state (archived)**: pick the machine's state DPE
   (`System1:MachineSim_<machine>.state`).
3. **Content → Stop cause (archived)**: pick `System1:MachineSim_<machine>.cause`
   (optional for the Gantt — without it segments have no cause; required for a
   meaningful downtime analysis).
4. **State mapping and stop causes**
   - _State mapping_: data source **dpconnect** on the atelier configuration
     `System1:MachineFleet3D_<atelier>.json`, then either the **Machine id** (the
     machine's own mapping is used, exactly like the fleet dashboard) or a **State
     mapping id**. Leave everything empty for the fleet standard
     (0 = stop, 1 = production, 2 = fault, 3 = maintenance). A pasted mapping JSON
     (`{ "rules": [...], "fallback": "stop", "colors": {...} }`) also works
     (data source _static_).
   - _Stop-cause catalog_: **dpconnect** on `System1:MachineFleet3D_StopCauses.json`.
     It gives each code its label and its **planned / unplanned** classification —
     the downtime widget classifies with it; without it every stop is unplanned.
5. **Formatting** (Gantt): legend, time axis, range button, tooltip.
   **Analysis defaults** (downtime): stop class, metric, Top N; **Formatting**: KPI
   strip, table, range button.

Both catalog and mapping are read **live** (dpconnect): editing the stop-cause
catalog or a mapping colour in the fleet pages updates the widgets at once.

## What the widgets compute

Identical rules to the fleet's `mf-machine-dashboard` / `fleet-stop-analysis`
(ported from `libs/wui-fleet-core/src/engine.ts`), on one machine, without
closures:

- **Segments**: one per state run; a stop segment's cause is the code active at
  its start, resolved through the catalog (`code — description`, unknown codes →
  the catalog's default entry).
- **Downtime**: non-production = every state ≠ `ok`; adjacent stops merge; each
  stop is partitioned by active cause with **back-fill** of a leading no-cause span
  to the first cause and **carry-forward** across later gaps. Per cause:
  `assignedMs` (partition, sums to the stop time), `downtimeMs` (whole stops the
  cause appears in — the Pareto's _downtime_ metric), `occurrences`.
- **KPIs** (kpiCalc formulas on the covered window): required = opening − planned;
  availability = (required − unplanned) / required; MTBF = (opening − unplanned) /
  N_failures; MTTR = unplanned / N_failures; a failure = a stop with unplanned time.

The state **before the first archived sample** of the window is unknown to the
widget and is drawn hatched (never invented). See [NOTES.md](./NOTES.md).
