# Integrate the Alarms page (`@visuelconcept-winccoa/wui-alarms`) — source mode, Tier 1

**Standalone WinCC OA WebUI page** on **`/alarms`**: the plant's alarms, live or over
an archived period (counters, configurable priority ranges, EEMUA-191 flood histogram,
bad actors, search, sort, paging, acknowledge). **Tier 1**: frontend only — no
backend route, no manager; acknowledging uses WinCC OA's own API.

Distributed as the npm package **`@visuelconcept-winccoa/wui-alarms`**, deployed with
**wui-toolkit** (the `wui` CLI): the shared kits it imports (`wui-kit`,
`wui-alarms-core`, `wui-app-security`) are its npm dependencies, and the page is
**compiled against the target's own import map** (bundle = correct version).

## Prerequisites

1. A **wui-toolkit site** for the project (`<project>/web`) whose `prod` target was
   equipped once with `npx wui init target prod` (WebUI shell + dashboard webserver).
2. For **acknowledging**: the WebUI users who may acknowledge need the **WinCC OA
   write permission** (the `canWrite` flag of the WebUI login token) — the page
   writes `<dpe>:_alert_hdl.._ack` through WinCC OA's own API on the operator's
   session, so WinCC OA records the operator itself. Users without that permission
   see the list without the acknowledge checkboxes and button.
3. In the project: **alarms configured** (`_alert_hdl`) and, for the History tab, the
   **alert archive** available.

## Install
In the project's site (`<project>/web`):
```powershell
npx wui use alarms     # npm-installs @visuelconcept-winccoa/wui-alarms (+ its kits) and selects it
npx wui build prod     # page + menu entry
npx wui check prod
```
`wui build`:
1. compiles the page against the target's import map → `<project>/data/dashboard-wc/pages/`;
2. upserts the **menu entry** (`menu.fragment.jsonc`) into `menuconfig.json` (idempotent by `routeId`).

The module owns **no backend route**: acknowledging goes through WinCC OA's own API,
so there is no webserver module to deploy and nothing to restart.

Not handled by wui-toolkit: merging the module's **role catalog** into
`app-security-manifest.json`. The roles still self-register at page load
(`registerModuleRoles`), so the module shows up in `/app-security` once the page
has been opened.

## After install

1. **Browser**: reload logged in (**F5**). The build bumps `index.html`, so the
   service worker purges its caches by itself; a second reload may be needed for the
   purge to show.

## Verify

1. Logged in → the **Alarms** menu entry opens `/alarms`.
2. The **Active** tab lists the standing alarms with their WinCC OA class colour and
   abbreviation; the status line reads `Live · updated at HH:mm:ss` and the dot is green.
3. Clicking a range chip filters the list; the counters follow.
4. The cogwheel (role `configure`) opens **Priority ranges**: change an
   abbreviation, a colour or a threshold, save → the list re-colours at once and
   `Alarms_Config` holds the JSON.
5. The **History** tab with period _Last 24 h_ returns the archived alarms of the day
   (empty = no alert archive, or genuinely no alarm).
6. Tick a row → the dot turns **amber** (live updates held) → _Acknowledge (1)_ →
   the row shows `ACTIVE - ACK` **and the operator's own username** in _Ack. by_.
   No checkbox and no button at all → the logged-in WebUI user has no WinCC OA
   write permission (or the `acknowledge` role is denied).

## Embed the view in another page

The page is a thin shell around **`<wui-alarm-view>`** — the component to reuse. It
is already embedded in the **Machine Fleet** machine dashboard (`Suivi Alarmes`, the
bottom-left half of the dashboard); the same three lines drop it anywhere.

```ts
import '@visuelconcept-winccoa/wui-alarms-core/ui/wui-alarm-view.js';
import { scopeFromDpes } from '@visuelconcept-winccoa/wui-alarms-core/scope.js';
```

| Property                    | Attribute                     | Default        | Meaning                                                                                                   |
| --------------------------- | ----------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `source`                    | `source`                      | `active`       | `active` = standing alarms (live) · `history` = the archive of the period                                 |
| `lockSource`                | `lock-source`                 | `false`        | Hide the Active/History tabs (the host decides)                                                           |
| `period`                    | `period`                      | `today`        | `today` · `24h` · `7d` · `30d` · `week` · `month` · `custom`                                              |
| `shift`                     | `shift`                       | `0`            | Whole periods back (1 = the previous one)                                                                 |
| `customStart` / `customEnd` | `custom-start` / `custom-end` | `''`           | `YYYY-MM-DD` bounds for `custom`                                                                          |
| `from` / `to`               | `from` / `to`                 | `0`            | Explicit epoch-ms bounds; **win over `period`** — the case where the host already owns a period selector  |
| `dps`                       | `dps`                         | `''`           | Datapoint scope as an attribute: `dps="Press01,System1:Oven*"`                                            |
| `scope`                     | —                             | `null`         | Datapoint scope as a property (wins over `dps`)                                                           |
| `strictScope`               | `strict-scope`                | `false`        | **Set it when embedding**: an empty scope shows nothing instead of the whole system                       |
| `layout`                    | `layout`                      | `page`         | `panel` = embedded density (fewer columns, compact statistics strip)                                      |
| `hideStats`                 | `hide-stats`                  | `false`        | Hide the counters / histogram / bad actors                                                                |
| `hideToolbar`               | `hide-toolbar`                | `false`        | Hide the toolbar entirely (read-only tile)                                                                |
| `hidePeriod`                | `hide-period`                 | `false`        | Hide the period controls (the host drives `from`/`to`)                                                    |
| `noAck`                     | `no-ack`                      | `false`        | Read-only: no selection, no acknowledge                                                                   |
| `pageSize`                  | `page-size`                   | `25`           | Rows per page                                                                                             |
| `maxResults`                | `max-results`                 | `5000`         | Archive query ceiling (a truncated answer is signalled in the view)                                       |
| `ranges`                    | —                             | project config | Priority ranges. Left unset, the view reads the project's own from `Alarms_Config` and follows edits live |
| `statsWindowMs`             | `stats-window`                | 3 h            | How far back the occurrence statistics look on the active tab                                             |

Events (all `bubbles` + `composed`): `wui:counters` (the scoped `AlarmCounters` — for
a badge in the host), `wui:select` (the clicked `Alarm`).
Method: `acknowledgeAll()` acknowledges every row the current filters select, page or
not.

### Machine-scoped panel (the Machine Fleet case)

<!-- prettier-ignore -->
```html
<wui-alarm-view
  layout="panel"
  hide-period
  strict-scope
  .from=${start.getTime()}
  .to=${end.getTime()}
  .scope=${scopeFromDpes([m.stateDp, m.commDp, ...(m.kpis ?? []).map((k) => k.dp)])}
></wui-alarm-view>
```

The host's period governs the History tab; the operator flips Active/History inside
the panel. `scopeFromDpes` scopes on the **datapoints** behind the bound elements, so
an alarm on an element the host does not read is still the machine's alarm.

## Notes / security

- **No backend module or manager**: nothing to deploy, nothing to start, no `acl` to harden.
- **Acknowledging** is a plain WinCC OA `dpSet` of `<dpe>:_alert_hdl.._ack = 2`
  from the browser, on the operator's own session: WinCC OA enforces the user's
  **write permission** itself and records the operator's name. The page hides the
  acknowledge affordance when that permission is missing (`canWrite` of the login
  token), so a user is never offered a write the runtime would refuse. The
  Application-Security role `acknowledge` hides it too, but the WinCC OA
  permission is the one that is enforced.
- **Application Security**: module `alarms`, roles `view` / `acknowledge` / `configure`,
  open until groups are assigned (same convention as the other modules).
- One embedded panel or twenty share **one** server alert subscription (the runtime's
  `AlertService` caches it) — scoping is client-side, see [NOTES.md](./NOTES.md).
