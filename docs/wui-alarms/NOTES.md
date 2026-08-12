# wui-alarms — business & architecture notes

WinCC OA WebUI page module, **Tier 3** (one small backend route, no manager).
Route `/alarms`, component `wui-alarms`. The whole view lives in the shared kit
**`@visuelconcept/wui-alarms-core`**, which other pages embed.

Ported from the alarms screen of the `winccoa-ng-scada` reference product
(`wui-scada/screens/sc-alarms.ts` + `wui-scada-core/alarms/*`): the reading of the
domain (severity bands, criticality ordering, EEMUA-191 flood histogram, bad
actors, "296 of 2,727" server-side-style query) is kept; the mock gateway is
replaced by the real WinCC OA alert stream, and the mock-only notions
(shelving / suppression, plant & area hierarchy) are dropped — see
[Deliberate gaps](#deliberate-gaps).

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

| Fact | Reading |
| --- | --- |
| `Alert.direction` | `true` = **CAME** (standing), `false` = **WENT** (cleared). The opposite of the intuition. |
| `Alert.ackState` | `AckState.DpAttrActTypeNot` (`0`) = **NOT** acknowledged; any other value = acknowledged. Same reading as the runtime's own alert table. |
| `Alert.atime` | Identifies the OCCURRENCE (came-time + count), so CAME and WENT share it. |

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
- **Where each colour is used**: the RANGE colour carries the row's left border
  and its range pill (the project's severity scale); the ALERT CLASS colour stays
  on the class pill and the state chip.
- **Read once, shared**: `loadAlarmConfig()` caches the datapoint read for the
  whole session, and a save announces itself on `window` (`wui:alarmconfig`), so
  a dozen embedded views re-rank immediately without the page wiring anything.

## The state machine

An alarm leaves the **Active** list when it is cleared **AND** acknowledged —
never on the clearing alone:

| Came | Acknowledged | In "Active" | State chip |
| --- | --- | --- | --- |
| yes | no | ✔ | `ACTIVE` |
| yes | yes | ✔ | `ACTIVE - ACK` |
| **no (went)** | **no** | **✔** | `CLEARED - UNACK` |
| no | yes | ✘ (history) | `CLEARED - ACK` |

A condition that came and went while nobody took it over is precisely the one an
operator must still answer for. It also stays in `unacknowledged` (the "target 0"
card) and keeps the alert colour in the list instead of the grey of a closed row —
greying it out is how a pending acknowledgement gets overlooked.

## Acknowledging — under the OPERATOR's name

`<dpe>:_alert_hdl.._ack = 2`, one write for the whole selection. WHO WinCC OA
records for it is the whole difficulty, because there are only two ways to write
and each fails at something:

| Write from | Recorded user | Fails when |
| --- | --- | --- |
| the **browser** (`dpSet`, the operator's own session) | the operator ✔ | the project does not grant WebUI users write permission → *"User is not permitted to use dpSet"* |
| the **webserver**, plainly (e.g. `/api/para/dp/set`) | the **webserver** ✘ | never — but the alarm list then shows a name that did not take the alarm over |

So the module has its own route, **`POST /api/alarms/ack`**, which does the
server-side write while IMPERSONATING the session user:
`winccoa.setUserId(<operator's OA user id>)` (the JS-manager counterpart of the
CTRL function), then `dpSetWait`, then the previous context is restored. The user
id is resolved server-side from the `_Users` directory through `identityOf(req)` —
**never** taken from the request body.

Three consequences worth knowing:

- **`setUserId` mutates the SHARED manager**, so the writes are serialised through
  a one-at-a-time queue: user A's acknowledgement must not land while the context
  is set to user B. The critical section is a single `dpSetWait`.
- **Only the datapoint elements travel.** The `:_alert_hdl.._ack` suffix is
  composed server-side and any name already carrying a config path (`:_`) is
  rejected — the endpoint writes with the webserver's rights, so it must be able
  to write one thing and nothing else. It is also role-gated there
  (`requireRole('alarms', 'acknowledge')`), unlike the shared PARA endpoint which
  is ungated by design.
- **A failed impersonation does not cancel the acknowledgement.** If the operator
  is unknown to `_Users`, or the webserver does not run as `root`, the write still
  happens (an alarm left standing over a directory mismatch is the worse risk) but
  the answer carries `attributed: false` and the page says so in clear rather than
  implying the operator's name is on it.

The fallback, when the module's backend is not deployed, is the BROWSER's write —
it also records the operator, it simply needs the WinCC OA right.

Whether a row can be acknowledged at all is `Alert.ackable`, the backend's own
verdict — it already folds in the alert class' acknowledgement type, so a class
configured without acknowledgement reports false and the checkbox is disabled with
a tooltip saying why. It is read defensively (`isAckable`): the flag travels in an
alert tuple, and a backend sending `1` instead of `true` used to disable the action
for the whole plant; an ABSENT flag falls back to "an unacknowledged alert is
acknowledgeable", because a refused write reports itself while an action the
operator cannot even attempt does not. A selection with nothing acknowledgeable in
it returns `ok: false`, never a silent success.

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

## Acknowledging

`dpSet('<dpe>:_alert_hdl.._ack', 2)` — the documented WinCC OA mechanism. One write
for the whole selection (the API accepts a DPE list), so the operator's action is
atomic server-side instead of half-applied across N round-trips. It needs WinCC OA
**write permission**; the Application-Security role `acknowledge` gates the UI, it
does not replace that permission.

## Architecture / integration

```
libs/wui-alarms-core/src/          the KIT (shared, vendored into each host bundle)
  types.ts        Alarm / counters / histogram / bad actors / severity bands
  mapping.ts      Alert → Alarm, CAME/WENT pairing, ack DPE
  scope.ts        datapoint scoping (subtree + glob), scopeFromDpes
  query.ts        applyQuery: filter + sort + paginate (one definition)
  severity.ts     criticality ordering, stable tie-break on the id
  statistics.ts   counters, EEMUA histogram, bad actors
  period.ts       period vocabulary shared with the fleet dashboards
  occurrences.ts  the occurrence-window merge (archive + live)
  data/alarm-store.ts        live subscription / archive query / acknowledge
  data/alarm-config-store.ts the Alarms_Config datapoint (ranges), shared read
  ui/wui-alarm-view.ts  THE embeddable component (page | panel)
  ui/wui-alarm-table.ts dumb table (one page of a query)
  ui/wui-alarm-stats.ts counters + histogram + bad actors
  ui/wui-alarm-ranges.ts the range editor (role `configure`)
  ui/period-bar.ts       the archived tab's period controls
backend/routes/alarms*.ts    POST /api/alarms/ack — the impersonated acknowledgement
libs/wui-alarms/src/alarms.ts      the page: header, role gate, `?dp=` scope
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
