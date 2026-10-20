# wui-alarms — business & architecture notes

WinCC OA WebUI page module, **Tier 1** (no backend route, no manager).
Route `/alarms`, component `wui-alarms`. The whole view lives in the shared kit
**`@visuelconcept-winccoa/wui-alarms-core`**, which other pages embed.

Ported from the alarms screen of the `winccoa-ng-scada` reference product
(`wui-scada/screens/sc-alarms.ts` + `wui-scada-core/alarms/*`): the reading of the
domain (severity bands, criticality ordering, EEMUA-191 flood histogram, bad
actors, "296 of 2,727" server-side-style query) is kept; the mock gateway is
replaced by the real WinCC OA alert stream, and the mock-only notions
(shelving / suppression, plant & area hierarchy) are dropped — see
[Deliberate gaps](#deliberate-gaps).

Since **0.2.0** the view's LAYOUT is the one of the _Alarmes_ module of the
`winccoa-fra-msp-stma` project (counter tiles that double as filters, a filter bar
with minimum severity / class / search / unacknowledged, level badges, came/went and
to-acknowledge/acknowledged badges, quick periods and CSV export of the history),
with this module's statistics kept (EEMUA histogram, recurring alarms, occurrence
window), and it is customised by **profiles**, **extensions** and **design tokens** —
see [Customisation](#customisation--profiles-extensions-tokens).

## Domain / purpose

The plant's alarm list, in **two snapshots that share one shape**:

- **Active** — the standing alarms, live, from `AlertService.connect()`.
- **History** — the alarm archive over a **period**, from
  `AlertService.getAlertArchive(start, end)`.

Because both produce `Alarm[]`, one component renders both, and an embedded panel
can flip between them without the host doing anything.

## Data model

One `Alarm` is **one occurrence**, not one alert event. WinCC OA reports a CAME
event and, later, a WENT event for the same occurrence; `mergeAlerts` pairs them
on `atime` (the occurrence stamp) into a single row with `raised` + `cleared`.

Three encodings drive the mapping, and each one silently inverts the list if read
the wrong way round (all three are unit-tested in `alarms.spec.ts`):

| Fact              | Reading                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Alert.direction` | `true` = **CAME** (standing), `false` = **WENT** (cleared). The opposite of the intuition.                                               |
| `Alert.ackState`  | `AckState.DpAttrActTypeNot` (`0`) = **NOT** acknowledged; any other value = acknowledged. Same reading as the runtime's own alert table. |
| `Alert.atime`     | Identifies the OCCURRENCE (came-time + count), so CAME and WENT share it.                                                                |

### Priority ranges (configurable)

WinCC OA carries an alert-class priority (`Alert.prior`) plus the class' colour and
abbreviation. Those stay AUTHORITATIVE and are shown as the engineering configured
them, in the **Class** column, next to the raw **Prior.** number.

On top of that the module groups priorities into **ranges** — the P1…P4 of the
list — and those belong to the PROJECT: each range carries an id, an
**abbreviation**, a **colour** and the priority it starts at (`minPrior`,
inclusive, read from the highest down). They are edited in the page (cogwheel,
role `configure`) and stored as JSON in the **`Alarms_Config`** datapoint.

```
prior >= 60 → P1  #E5484D      seed values only —
prior >= 40 → P2  #F5A524      the project edits them,
prior >= 20 → P3  #00A0D2      adds or removes ranges,
prior >=  0 → P4  #8B939C      and picks its own labels/colours
```

Design rules that matter:

- **No infinite bound.** The configuration is JSON in a datapoint and
  `JSON.stringify(-Infinity)` is `null`; instead, a priority below every range
  falls into the LOWEST one (`rangeFor`). An alarm the configuration did not
  foresee is shown at the least urgent level, never dropped from every counter.
- **`Alarm.rank`** is the derived position (1 = most urgent), and it is what the
  counters key on and the ordering compares. Editing the ranges re-maps the
  snapshot (the view reloads), so a rank is never read against the wrong table.
- **Where each colour is used**: the LEVEL colour carries the severity badge and
  the counter tile (the project's severity scale); the ALERT CLASS colour stays on
  the class pill; the row's left edge marks an UNACKNOWLEDGED row
  (`--wui-alarm-unacknowledged`), whatever its level.
- **A level may carry no colour** (`color: ""`): it then takes the theme's colour
  for its rank, the `--wui-alarm-level-<n>` token — how a site's charter colours
  the levels instead of the datapoint. A level may also carry a `label` (`Danger`,
  `Alarme`…), shown on the badge, the tile and the severity filter.
- **Read once, shared**: `loadAlarmConfig()` caches the datapoint read for the
  whole session, and a save announces itself on `window` (`wui:alarmconfig`), so
  a dozen embedded views re-rank immediately without the page wiring anything.

## The state machine

An alarm leaves the **Active** list when it is cleared **AND** acknowledged —
never on the clearing alone:

| Came          | Acknowledged | In "Active" | Badges                        |
| ------------- | ------------ | ----------- | ----------------------------- |
| yes           | no           | ✔           | `came` · `to acknowledge`     |
| yes           | yes          | ✔           | `came` · `acknowledged`       |
| **no (went)** | **no**       | **✔**       | `went` · **`to acknowledge`** |
| no            | yes          | ✘ (history) | `went` · `acknowledged`       |

A condition that came and went while nobody took it over is precisely the one an
operator must still answer for. It also stays in `unacknowledged` (the "target 0"
card) and keeps its _to acknowledge_ badge and its unacknowledged edge even though
the gone row is greyed — losing those is how a pending acknowledgement gets
overlooked.

## Acknowledging — WinCC OA's own API, under the OPERATOR's name

`<dpe>:_alert_hdl.._ack = 2`, one `dpSet` for the whole selection, issued by the
**browser on the operator's own WinCC OA session** (`OaRxJsApi.dpSet`). WinCC OA
records the operator's name itself and enforces the user's **write permission**
itself — the WebUI login token carries that permission as `canWrite`, and a user
without it gets _"User is not permitted to use dpSet"_.

The rule that follows (decided 2026-09-15): **no write permission → no acknowledge
affordance at all.** The view reads `canWriteDatapoints$()` (`wui-kit`,
`WuiUserService.canWrite` re-emitted on `user$`) and, when it is false, renders
neither the checkbox column nor the buttons (`ackDisabled = noAck || (!canWrite &&
no acknowledgement override)`, see below), instead of offering a write the runtime
would refuse. The Application-Security
role `acknowledge` folds into the same flag through the host's `no-ack`.

History: an earlier version routed the write through a backend endpoint
(`POST /api/alarms/ack`) that impersonated the session user with `setUserId`, so a
project withholding the WebUI write permission could still acknowledge under the
operator's name. It was removed in favour of the native API: it doubled the
attack surface (a server-side write with the webserver's rights), depended on the
webserver running as `root` and on the WebUI users existing in `_Users`, and
projects that had not redeployed it refused acknowledgements with a stale
validation rule. Deployments that still carry `src/modules/alarms/` in their
webserver can delete it; nothing calls it any more.

Whether a row can be acknowledged at all is `Alert.ackable`, the backend's own
verdict — it already folds in the alert class' acknowledgement type, so a class
configured without acknowledgement reports false and the checkbox is disabled with
a tooltip saying why. It is read defensively (`isAckable`): the flag travels in an
alert tuple, and a backend sending `1` instead of `true` used to disable the action
for the whole plant; an ABSENT flag falls back to "an unacknowledged alert is
acknowledgeable", because a refused write reports itself while an action the
operator cannot even attempt does not. A selection with nothing acknowledgeable in
it returns `ok: false`, never a silent success.

### Acknowledgement overrides (extensions)

A module may own some alarms whose acknowledgement is MORE than `_ack = 2`: the MSP
project acknowledges its SPC alarms with a **cause and an action**, written in the
same `alertSet` as the acknowledgement (one atomic write on the server). An
extension's `acknowledge` handler claims those alarms (`applies`), asks what it
needs (its own dialog — `confirms: true` skips the view's confirmation) and writes
by its own means; the view splits every selection with `partitionAck` — the
claimed alarms go to their handler, the others to the kit's `dpSet`. The handler is
addressed to the OCCURRENCE (`Alarm.atime`: its time, count and alert element),
not to every pending alarm of the element as `_ack` is.

The kit's own write keeps the rule above (no WinCC OA write permission → withheld);
an override is the module's own business — its backend checks its own role. So the
affordance shows when at least one of them can act, and the alarms the kit could
not acknowledge are left out with a notice saying why.

## Customisation — profiles, extensions, tokens

What a page, a module or a dashboard widget changes in the view, without forking it:

- **Profile** (`profile.ts`) — plain JSON: the columns (active, history, panel; a
  built-in id or an additional column `{ id, label, field }` reading
  `Alarm.extra[field]`), the filters (minimum severity, class, search,
  unacknowledged, additional selects over a field), the counter tiles, the
  statistics, the acknowledgement buttons and confirmation, the CSV export, the
  starting filter values, and the registered extensions to activate. Layers, later
  wins (`mergeProfiles`): the kit's defaults → the host's `.profile` (code) → the
  profile stored in `Alarms_Config.profiles` and named by `profile-name`
  (engineering: edited as JSON in the page, role `configure`; picked by name in the
  dashboard widget). Lists are REPLACED, switches merge. A stored profile is parsed
  before it is saved (`parseProfile`), so what the view would not understand is
  reported, never stored.
- **Starting filters** (`filters`, `filtersFromSearch`) — not a profile: what a
  link opens the list on (`#/alarms?dp=stma/*&class=OOS,AOS&unack=1`). The operator
  may clear them (_Clear the filters_). That is how another module opens the
  Alarms page on ITS alarms instead of keeping a list of its own.
- **Extension** (`extensions.ts`) — code: `classify` (a module's own reading of a
  row: re-rank it from the alert class, add `extra` values such as an origin or a
  work order), `keep` (the rows the module shows at all — its collection rules,
  before any filter the operator sees), `columns` (how an additional column is
  drawn), `filters`, `acknowledge` (above). A view re-maps its snapshot when the
  `classify` / `keep` FUNCTIONS change (by identity): a module whose model changes
  hands the view a rebuilt extension. Handed to the view (`.extensions`) or registered by id on
  `globalThis` (`registerAlarmExtension`; the kit is copied into several bundles,
  a module-level registry would not be shared) and named by a profile.
- **Design tokens** (`ui/alarm-tokens.ts`) — every colour, surface and radius is a
  public `--wui-alarm-*` property with a Siemens iX default, READ through private
  `--_*` properties declared on each component's host. A site sets the public ones
  on `:root` from its charter; declaring them on `:host` would shadow the site's
  values (an element's own declaration beats an inherited one) — which is also why
  0.1's `--wui-alarm-severity-1`, used but declared nowhere, left the
  unacknowledged card uncoloured.

## Scoping

Scoping is **client-side by design**:

- `AlertService.connect(filter)` forwards its filter to the backend, which
  **rejects glob patterns** (documented in the wui-alert-data README);
- the service shares one server subscription across consumers
  (`shareReplay` + ref-count), so N embedded panels on one page still open **one**
  subscription — passing per-panel filters would break that.

A scope entry is a plain name (matches the element **and its subtree**, so
`Press01` catches `System1:Press01.temp`) or a glob (`Line1_*`, `Press0?`).
`scopeFromDpes()` turns a machine's bound datapoint **elements** into one entry per
**datapoint**, because an alarm may sit on an element the host does not read.

`strict-scope` refuses the "empty scope = whole system" fallback: an embedded panel
must set it, otherwise a machine with no bound datapoint would present every alarm
of the project as its own.

### The `?dp=` scope is pushed in, not pulled

A drill-down opens `#/alarms?dp=System1%3APress01`, and the page takes that scope from Vaadin
Router's **`onBeforeEnter`** hook into reactive state — never by asking the router facade
while rendering.

Pulling it was wrong twice over, and both failures wear the same disguise, _"it only works
after a reload"_:

- the facade reads the router's own `location`, which the router assigns **late in its
  navigation cycle** (it fires `location-changed` and only then attaches the element), and the
  pull sat inside a `try`/`catch` that degrades silently to "no scope" — so whether the first
  paint is filtered depended on what else happened to be loaded first;
- and when only the **query string** changes — a second asset's drill-down, `?dp=A` → `?dp=B`
  — the router **reuses the same element** rather than building a new one (its `__skipAttach`
  path, which calls `onBeforeEnter` again and nothing else). A value pulled once during render
  is then never pulled again, and the list keeps the first scope for good.

The facade pull survives as the fallback for a host that renders the page **outside** the
router, where the hook never fires. Decoding lives in `scopeFromSearch` (`wui-alarms-core`),
tested there: a drill-down percent-encodes the `:` of the system prefix, and a scope entry
still carrying `%3A` matches no datapoint at all.

## Statistics: state vs. occurrences

Two different questions, two different sets — the banner shows both side by side:

- **The counters** (unacknowledged, per range, cleared) describe the rows of the
  TAB: the state right now. The range chips double as the range filter, so they
  count exactly what clicking them would reveal.
- **The histogram and the bad actors** describe the OCCURRENCES of a window: what
  happened over it. Counting those in the live set is wrong by construction — the
  live subscription is a snapshot of what is active NOW, so an alarm that clears
  leaves the set and its occurrence disappears from the tally, then reappears when
  the condition comes back. The window is therefore seeded from the **archive**
  (the past exists nowhere else) and kept up to date by the live stream;
  `mergeOccurrences` is that rule — same occurrence, keep the fresher row, drop
  whatever aged out.

The histogram's title and caption are derived from the histogram itself, never
hard-coded: over the **archived tab it spans the SELECTED PERIOD**, with buckets
scaled up in whole ten-minute steps (`bucketFor`) and the EEMUA threshold scaled
with them (`thresholdFor`), so the ceiling keeps its meaning at any width. Buckets
are aligned on the bucket size so the chart does not shift between refreshes, and
the current bucket always extends past `now` — otherwise the alarm that just came
is dropped when the clock sits on a boundary. Hovering a bar shows its count and
its interval.

## Live list under an operator's cursor

A live list re-orders itself while an operator is clicking checkboxes. So as soon
as there is a selection, incoming updates are **held** (the status dot turns amber)
and applied when the selection is released. Same idea as the runtime's own alert
table pause, without a button to forget to press.

## Acknowledging (mechanics)

`dpSet('<dpe>:_alert_hdl.._ack', 2)` — the documented WinCC OA mechanism. One write
for the whole selection (the API accepts a DPE list), so the operator's action is
atomic server-side instead of half-applied across N round-trips. It needs WinCC OA
**write permission**, which also hides the affordance when missing; the
Application-Security role `acknowledge` gates the UI too, it does not replace that
permission.

## Architecture / integration

```
libs/wui-alarms-core/src/          the KIT (shared, vendored into each host bundle)
  types.ts        Alarm / counters / histogram / bad actors / severity bands
  mapping.ts      Alert → Alarm, CAME/WENT pairing, ack DPE, the classifier hook
  profile.ts      display profiles: layering, validation, link filters
  extensions.ts   classifiers, column renderers, filters, acknowledgement overrides
  columns.ts      column headers, sort fields and cell text (table + CSV)
  scope.ts        datapoint scoping (subtree + glob), scopeFromDpes
  query.ts        applyQuery: filter + sort + paginate (one definition)
  severity.ts     criticality ordering, stable tie-break on the id
  statistics.ts   counters, EEMUA histogram, bad actors
  period.ts       period vocabulary shared with the fleet dashboards
  occurrences.ts  the occurrence-window merge (archive + live)
  data/alarm-store.ts        live subscription / archive query / acknowledge
  data/alarm-config-store.ts the Alarms_Config datapoint (ranges + profiles), shared read
  ui/alarm-tokens.ts     the --wui-alarm-* design tokens and the colour rules
  ui/wui-alarm-view.ts   THE embeddable component (page | panel)
  ui/wui-alarm-table.ts  dumb table (one page of a query, the profile's columns)
  ui/wui-alarm-stats.ts  histogram + recurring alarms (+ the panel's compact strip)
  ui/wui-alarm-ranges.ts the level editor (role `configure`)
  ui/wui-alarm-profiles.ts the display profile editor (role `configure`)
  ui/period-bar.ts       the archived tab's period controls
libs/wui-alarms/src/alarms.ts      the page: header, role gate, what the URL carries
libs/wui-alarms/src/widgets/wui-alarms.ts   the dashboard widget (see below)
```

The kit's components use **guarded `customElements.define`** (not `@customElement`)
because the kit is vendored into several page bundles that share one registry per
SPA session.

## Deliberate gaps

- **No shelving / suppression.** The reference product's "put aside 60 min" and
  "suppressed by design" are mock-only concepts there; over WinCC OA they would
  need their own persistence (a config datapoint) and a policy about who may
  silence what. Out of scope here, and counted nowhere so the numbers stay honest.
- **No plant / area hierarchy.** The reference product groups by site and zone; the
  equivalent here is the datapoint scope (and, for the fleet, the machine's
  datapoints). A CNS-based hierarchy would be the natural next step.
- **The runtime's own `wui-alert-table` is not reused.** It is a capable table
  (virtualised, mobile variant, its own filters) but it does not carry the analysis
  layer this module is about (bands, EEMUA histogram, bad actors, criticality
  ordering). The DATA layer is shared with it (`AlertService`), the presentation is
  not.

## Dashboard widget (`libs/wui-alarms/src/widgets/wui-alarms.ts`)

`<wui-alarms-widget>` wraps `<wui-alarm-view>` for the WinCC OA dashboard editor.
What is specific to the widget contract (the rest is the view's own):

- **It is BUILT, not served from source.** A dashboard widget is an ES module loaded
  from a `/data/…` URL that may only import shared-bundle specifiers; the alarms kit
  is not in the import map. The pages build discovers
  `libs/wui-<page>/src/widgets/<widget>.ts` (`discoverWidgetLibs`, same externals as
  the pages) and emits `<outDir>/widgets/<widget>.js`. The bundle imports the kit
  through `../pages/chunks/*.js` shared with `pages/alarms.js` — a **pages-only
  deploy that prunes bundles must keep the alarms page** or those chunks go with it.
- **Inputs arrive as attributes** (`setAttribute`, lower-cased) or properties:
  strings → attributes, booleans → presence, objects → properties. The `variables`
  block (`sTimeRange`) is spread onto the widget by `wui-widget-wrapper`, hence the
  plain `sTimeRange` property. The atelier configuration arrives as a JSON STRING
  (ContextControl `data` → dpconnect), parsed on every render.
- **Scope**: the atelier arrives through a `DataPointControl` restricted with
  `allowedDpt: ["MachineFleet3D_Config"]` (the settings picker lists ateliers only)
  inside a `VerticalGroup`, so the widget gets `atelier = { value: <json>, datapoint }`.
  The **machine list is a runtime `ix-select`** in the widget (the settings form
  cannot offer dynamic options): entries = the atelier's machines + _Whole atelier_,
  preselected by the `machineId` setting, hidden by `lockMachine`; the choice is
  session-only. Scope = `scopeFromDpes` over the selected machine's (or every
  machine's) `stateDp / commDp / stopCauseDp / workOrderDp / operationDp / kpis[].dp`
  (typed structurally — no dependency on the fleet kit) plus the `dpFilter` series
  (`SeriesGroup` of `DatapointSelectorControl`, `selectionMode: "dp"`, each item a
  `{ dp }` group). Empty + strict → `[]` (nothing); empty + not strict → `null`
  (whole system, like the page).
- **Period — History tab only.** The view already reads the active tab from the
  live subscription (no time bound) and the archive over `range()`; but `from`/`to`
  are in its `RELOAD_KEYS`, so a host that keeps updating them restarts the live
  subscription on the active tab for nothing, and a range button shown above the
  active tab reads as if the period applied. The widget therefore follows the
  view's **reflected `source` attribute** with a `MutationObserver` (no event is
  emitted on a tab switch) and, only while it is `history`: passes
  `parseTimeRange(sTimeRange)` as `from`/`to` (`hide-period`), shows the range
  button, and ticks every 60 s while the range is live so `to` follows the clock.
  On the active tab it passes zeros. Without the range button, zeros hand the
  period back to the view's own period bar.
- **Roles**: `registerModuleRoles` is called again (idempotent), so a project that
  ships the widget without the page still lists the module in `/app-security`.
- The element is defined with a **guarded `customElements.define`** (the widget
  bundle and the page bundle share one registry).
