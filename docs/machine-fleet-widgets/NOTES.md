# machine-fleet-widgets — architecture notes & pitfalls

Two WinCC OA **dashboard widgets** (`libs/wui-machine-fleet-3d/oa-data/WebUI/widgets-v2/MachineFleet/`) — a
port of the Gantt and Pareto bands of the fleet's `mf-machine-dashboard` into the
dashboard's widget contract. Pure frontend, plain ES modules (no build step: the
files are served as-is from `/data/WebUI/…`), shared-bundle imports only.

## Data flow (widget contract, as verified in the installed runtime)

- The widget JSON binds two **historic `data-point` contexts** (state, cause) via
  `DataPointControl` inside two **`VerticalGroup`s** scoped to `#/properties/state`
  and `#/properties/cause`. A group renderer passes ITS schema to its children, so
  each `DataPointControl` derives `definedConfigs` (`value`, `name`) from the
  group's `properties` and the widget receives two independent objects
  `state = { value: { values, timestamps }, name }` / `cause = {…}` (objects are set
  as JS properties, strings as attributes, booleans as presence).
  Two `DataPointControl`s at the top level would both spread into the same `value`
  attribute — hence the groups.
- **Time range**: the widget-level `variables: { sTimeRange }` block is (a)
  substituted into the `DataPointControl` options (`"${sTimeRange}"`) by
  `replaceVariables`, and (b) **spread onto the widget as top-level attributes** by
  `wui-widget-wrapper` — so the component has a plain `sTimeRange` string property.
- **Range button**: `<wui-datetime-range-button .value @wui:rangeselected>` (from
  `@wincc-oa/wui-ui-elements`, in the import map; it ships default presets). On
  selection the widget dispatches the dashboard event **`wui:changedaterange`**
  (`detail: { sTimeRange, live }`, bubbles + composed); the **`data-point` contexts
  above the widget listen to it** and re-query — the widget never fetches. It also
  adopts the value locally so its window and the button label follow at once.
- **Window**: `parseTimeRange` from `@wincc-oa/wui-shared/parseTimeRange.js` — the
  very helper the historic context uses — turns `sTimeRange` into `[start, end,
live]`. Grammar: `now/d`, `now/w`, `24h`, `1w/w-1w/w`, ISO pairs.
- **Live**: a "now"-ending range makes the context use `historicConnect` (pushes
  new archived values); the widget adds a 30 s `requestUpdate` tick so the running
  segment / ongoing downtime keep growing between pushes. No query is issued by the
  tick.
- **Mapping & catalog** come as **JSON strings** through `ContextControl`
  (`contextInputType: "data"` → dpconnect / dpget / static) bound to the fleet's
  `MachineFleet3D_<atelier>.json` and `MachineFleet3D_StopCauses.json`. `parseMapping`
  accepts a whole `Atelier` (picks the machine's `stateMappingId` via `machineId`,
  else `stateMappingId`, else the first mapping), a mapping array, or one mapping.

## Boundary honesty

The historic context returns the values **inside** the range only (no look-back,
unlike `dpGetPeriod` in the fleet engine), so the state active at the window start
is unknown until the first sample. The Gantt draws that leading span **hatched**
("unknown"), the KPI strip's _covered_ time starts at the first sample, and
nothing is back-filled. A machine that holds one state for the whole window
therefore shows as unknown — the fleet dashboard's `dpGetPeriod` look-back does
not exist in the widget contract.

## Pitfalls

- **`.cause` must be NGA-archived** (same as the fleet pages), otherwise no cause
  on the segments and a Pareto with only the fallback bucket.
- **Import map, not CDN**: only bare specifiers exported by the shared bundles work
  (`lit`, `@wincc-oa/wui-ui-elements/...`, `@wincc-oa/wui-shared/parseTimeRange.js`,
  `@wincc-oa/wui-i18n-shared/localize-multilang.js` — check
  `apps/dashboard-wc/src/generated/shared-bundles/export-wui-entry.ts`).
  `@wincc-oa/wui-models` is NOT in the map → the `wui:changedaterange` event is a
  hand-built `CustomEvent`, not the `ChangeDateRangeEvent` class.
- **Tag names contain `widget`** (`mf-widget-gantt`): `wui-widget-wrapper` routes
  tags containing "widget" through the widget render path like the StandardLibrary.
- **Attribute casing**: `setAttribute('sTimeRange')` lowercases; Lit's default
  attribute for `sTimeRange` is also lowercase, so camelCase properties work as in
  the standard widgets — do not set custom `attribute:` names.
- **`SelectControl` + `oneOf`** (`stopClass`, `metric`, `topN` in the downtime
  widget) follows the JSON-Forms enum convention used by the StandardLibrary's
  `IconToggleButtonGroupControl`; if a select ever renders empty, switch those
  three to `IconToggleButtonGroupControl` with `x-icon`s or to a plain `Control`.
- **Folder translation**: the palette folder `MachineFleet` is named through a
  project-local `WUI_General.json` (`WidgetSelector.Folders.MachineFleet`), which the
  server deep-merges with the OA catalog.
- **Service worker**: after a deploy, `Clear site data` (not Ctrl+Shift+R) or the
  palette keeps the cached widget list.
- **Where they live**: the root `/oa-data/` is git-ignored (a leftover of the former
  runtime workspace), so the widgets are versioned inside the module that owns them,
  `libs/wui-machine-fleet-3d/oa-data/WebUI/`, and published with its package. Copying
  them into `<project>/data/WebUI/` is still a manual step — see README.
