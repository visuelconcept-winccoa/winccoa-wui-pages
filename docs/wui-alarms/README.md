# @visuelconcept-winccoa/wui-alarms — source module (Tier 1)

**Alarms** page for a WinCC OA WebUI dashboard, on **`/alarms`**: the plant's alarm
list either **live** (the standing alarms) or over an **archived period**, with
**counter tiles** (standing, unacknowledged, one per level) doubling as filters, the
**EEMUA-191 flood histogram**, the **recurring alarms**, a filter bar (minimum
severity, class, search, unacknowledged), click-to-sort headers, paging,
**acknowledge** and a **CSV export** of the history.

Each integration customises it without a fork: a **link** carries starting filters,
a **display profile** (code or stored, by name) sets the columns, filters, counters
and acknowledgement, an **extension** adds a module's own reading of the rows and its
own acknowledgement, and **design tokens** (`--wui-alarm-*`) take the site's charter.

The whole view is the shared component **`<wui-alarm-view>`** of
`@visuelconcept-winccoa/wui-alarms-core`, so the same view **embeds in other pages** — the
Machine Fleet machine dashboard shows a machine's alarms with it.

npm package, deployed with **wui-toolkit** (the `wui` CLI): the shared kits come as
its npm dependencies, and the page is built against the target's own import map (so
the bundle matches its runtime).

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use alarms     # npm-installs @visuelconcept-winccoa/wui-alarms with its kits, selects it
npx wui build prod     # compiles the page and upserts its menu entry
npx wui check prod
```
The page lands in `<project>/data/dashboard-wc/`, its menu entry in `menuconfig.json`.
Nothing to restart: the page owns no backend.

## After install

1. **Browser:** reload (logged in). The build touches `index.html`, which makes the
   service worker purge its runtime caches, so a plain **F5** is enough.

## Prerequisites

- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- **No backend route and no manager** — the page reads and acknowledges through the
  dashboard's own WinCC OA connection.
- No npm dependency beyond the `@visuelconcept-winccoa/wui-*` kits.

## Prerequisites (runtime)

- **Alarms configured in the project** (`_alert_hdl` on the datapoint elements) — the
  page displays what WinCC OA raises, it does not configure alarms (the PARA page's
  _Alarming_ tab does).
- **Acknowledging** writes `<dpe>:_alert_hdl.._ack = 2` through **WinCC OA's own
  API** — the browser's `dpSet`, on the operator's own session — so WinCC OA
  records the acknowledgement under the operator's name itself, with no backend in
  between. It needs the WebUI user's **WinCC OA write permission** (the `canWrite`
  flag of the login token; a project that withholds it answers _"User is not
  permitted to use dpSet"_). **Without that permission the acknowledge checkboxes
  and button are not shown at all.** The Application-Security role `acknowledge`
  hides them as well.
- For the **History** tab: the alarm archive must be available (standard alert
  archiving), otherwise the archived period comes back empty.

## Usage

- **Active / History** — the two tabs switch snapshot. `History` shows the quick
  periods (1 h, 8 h, 24 h, 7 days, 30 days), the period selector (also today,
  current week, current month, custom) with previous/next-period arrows, and
  _Export CSV_ (the filtered rows, `;` separated, for Excel).
- **Counter tiles** — _Standing_ resets the filters, _Unacknowledged_ toggles the
  unacknowledged-only filter, a level tile keeps that level. The levels themselves
  (abbreviation, name, colour — their own or the theme's — and priority threshold)
  are the project's own: _Configure the ranges_ stores them in `Alarms_Config`.
- **Filter bar** — minimum severity, class, search (every word, accents ignored:
  datapoint, text, description, class, value, additional columns), unacknowledged
  only, _Clear the filters_; click-to-sort headers, paging.
- **Acknowledge** — tick the rows, then _Acknowledge the selection (n)_, or
  _Acknowledge all (n)_ (every acknowledgeable row the filters keep), after a
  confirmation. While a selection is open the live list is **held** so rows do not
  move under the cursor (the status dot turns amber); releasing the selection
  applies the pending updates.
- **By URL** — `#/alarms?dp=System1:Press01` opens the list on one datapoint
  (comma-separated, globs allowed: `?dp=Line1_*`); `class`, `rank`, `q`, `unack`,
  `source`, `f.<filter>` and `profile` add starting filters and a profile (see
  [INTEGRATION.md](./INTEGRATION.md#customise-the-view)).
- **Display profiles** (role `configure`) — the named profiles a page, a link or a
  widget picks, edited as JSON and validated before they are saved.

## Application Security

Module id `alarms`, roles `view`, `acknowledge` and `configure` (open until groups
are assigned). `acknowledge` hides the acknowledge affordance (the WinCC OA write
permission is what WinCC OA enforces on the write itself — and the affordance is
hidden on its own when that permission is missing); `configure` hides the level and
profile editors — without it they are read-only, because seeing how the levels are
set explains the list even to someone who may not change them.

## Contents

```
package.json                                  npm package; wuiPage (route, tier 1)
menu.fragment.jsonc                           menu entry
src/alarms.ts                                 page entry
src/app-security.roles.json                   the module's role catalog
src/widgets/wui-alarms.ts                     the Alarms dashboard widget
@visuelconcept-winccoa/wui-alarms-core (npm dependency, libs/wui-alarms-core/src/)
  ├─ types.ts / mapping.ts / scope.ts / query.ts / severity.ts / statistics.ts
  ├─ period.ts / occurrences.ts               period vocabulary, occurrence-window merge
  ├─ profile.ts / extensions.ts / columns.ts  profiles, extensions, columns (table + CSV)
  ├─ data/alarm-store.ts                      live subscription, archive query, acknowledge
  ├─ data/alarm-config-store.ts               the Alarms_Config datapoint (levels + profiles)
  ├─ ui/alarm-tokens.ts                       the --wui-alarm-* design tokens
  └─ ui/wui-alarm-view.ts + wui-alarm-table.ts + wui-alarm-stats.ts
     + wui-alarm-ranges.ts + wui-alarm-profiles.ts
README.md / INTEGRATION.md / NOTES.md         this documentation
```

## Embedding the view in another page

```ts
import '@visuelconcept-winccoa/wui-alarms-core/ui/wui-alarm-view.js';
import { scopeFromDpes } from '@visuelconcept-winccoa/wui-alarms-core/scope.js';
```

<!-- prettier-ignore -->
```html
<wui-alarm-view
  layout="panel"
  hide-period
  strict-scope
  .from=${range.start.getTime()}
  .to=${range.end.getTime()}
  .scope=${scopeFromDpes([machine.stateDp, ...machine.kpis.map((k) => k.dp)])}
></wui-alarm-view>
```

See [INTEGRATION.md](./INTEGRATION.md) for the full property list and
[NOTES.md](./NOTES.md) for the domain reading (CAME/WENT, ack state, priority ranges).

## Dashboard widget — `wui-alarms` (added 2026-09)

The same view also exists as a **WinCC OA dashboard widget** (palette folder
**Alarms**, widget _Alarms_, tag `wui-alarms-widget`): the "Suivi Alarmes" band of
the Machine Fleet machine dashboard, freely placeable on any `/dashboard`.

- **Source**: `libs/wui-alarms/src/widgets/wui-alarms.ts`. Definition, icon and
  catalogs: `libs/wui-alarms/oa-data/WebUI/widgets-v2/Alarms/wui-alarms/`,
  `libs/wui-alarms/oa-data/WebUI/svg/wui-alarms.svg`,
  `libs/wui-alarms/oa-data/WebUI/msg/*/WUI_Widget_WuiAlarms.json`.
  **wui-toolkit 0.6.0 neither bundles a widget nor deploys `oa-data/`**: bundle the
  widget source to `<project>/data/dashboard-wc/widgets/wui-alarms.js` (the alarms kit
  is not in the dashboard import map, so it must be bundled like a page) and copy the
  `oa-data/WebUI/` tree into `<project>/data/WebUI/`, deep-merging `WUI_General.json`
  with what is already there. Both steps are manual until the toolkit grows a slot.
- **Scope** (settings → _Alarm scope_): pick the **atelier** with the datapoint
  selector (restricted to the `MachineFleet3D_Config` type, element `.json`). The
  widget then shows a **machine list** (every machine of the atelier + _Whole
  atelier_); the chosen machine's bound datapoints become the scope, as in the
  fleet dashboard (`scopeFromDpes`). _Preselected machine (id)_ fixes the machine
  shown at opening, _Lock the machine_ hides the list. A **datapoint filter**
  (datapoint selector, one entry per datapoint) adds or replaces scope entries.
  _Strict scope_ (default on) shows nothing when nothing is scoped.
- **Period**: the dashboard time range (_Time range_ tab) applies to the
  **History** tab only — the **Active** tab always shows every standing alarm of
  the scope. With _Range selectable_ on, the range button appears while the
  History tab is shown and drives the view's `from`/`to` (the view's own period
  controls are hidden); off, the History tab shows the view's own period bar.
- **Formatting**: display profile (by name), default tab (active / history),
  density (panel / page), rows per page, lock the tab, hide the statistics,
  read-only. _Alarm classes_ (scope) starts the list on some alert classes
  (`OOS, AOS`), which the operator may clear.
- **Roles and rights**: the alarms module's own — `view` gates the widget body,
  `acknowledge` folds into read-only. Acknowledging goes through WinCC OA's own
  API (browser `dpSet`), so the checkboxes and the button are also hidden when the
  user lacks the WinCC OA write permission.

Deploy: bundle the widget into `<project>/data/dashboard-wc/widgets/` and copy
`oa-data/WebUI/` into `<project>/data/WebUI/` (definition, icon, catalogs) — both by
hand, see above — then _Clear site data_ in the browser.
