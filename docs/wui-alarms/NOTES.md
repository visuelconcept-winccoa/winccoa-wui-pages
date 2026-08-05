# wui-alarms — business & architecture notes

WinCC OA WebUI page module, **Tier 1** (pure frontend, no backend module, no manager).
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

### Severity vs. priority

WinCC OA carries an alert-class priority (`Alert.prior`, project-configurable) plus
the class' colour and abbreviation. **Colour and abbreviation are authoritative**
and displayed as the project configured them. `severity` (P1…P4) is a *derived
grouping* used by the counters, the band filter and the ordering, computed from
`prior` through `DEFAULT_PRIORITY_BANDS`:

```
prior >= 60 → P1    prior >= 40 → P2    prior >= 20 → P3    else → P4
```

> **This band table is an ASSUMPTION**, not a WinCC OA guarantee: it assumes a
> higher `_prior` is more urgent and that the project's alert classes spread over
> 0…80. It was NOT verified against the alert-class configuration of a live project
> (the `_AlertClass` priority attribute is not readable through the tooling used
> while writing this module). A project whose classes are numbered otherwise passes
> its own table via the view's `bands` property. A wrong table **mis-groups**
> alarms; it never mis-colours them — which is why the per-alarm colour is never
> derived from the band.

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

## Statistics

- **Counters** — standing / unacknowledged, per band, and how many of each band are
  already taken over (`P1 92 (12 ack)`: the parenthesis is the point — a global
  unacknowledged count cannot say at which band the backlog sits).
- **Flood histogram** — EEMUA 191: beyond ten alarms in ten minutes no operator
  keeps up. Buckets are aligned on the bucket size so the chart does not shift
  between refreshes, and the current bucket always extends past `now` (otherwise
  the alarm that just came is dropped when the clock sits on a boundary). Over a
  wide archived period the bucket is scaled up in whole ten-minute steps **and the
  threshold is scaled with it** (`thresholdFor`), so the line keeps its meaning.
- **Bad actors** — the recurring alarm texts, or the flooding datapoints.

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
  data/alarm-store.ts   live subscription / archive query / acknowledge
  ui/wui-alarm-view.ts  THE embeddable component (page | panel)
  ui/wui-alarm-table.ts dumb table (one page of a query)
  ui/wui-alarm-stats.ts counters + histogram + bad actors
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
