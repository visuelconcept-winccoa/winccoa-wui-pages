# @visuelconcept/wui-alarms — source module (Tier 1)

**Alarms** page for a WinCC OA WebUI dashboard, on **`/alarms`**: the plant's alarm
list either **live** (the standing alarms) or over an **archived period**, with the
**unacknowledged** counter, the project's **priority ranges** doubling as a filter, the
**EEMUA-191 flood histogram**, the **recurring bad actors**, a free-text search,
click-to-sort headers, paging and **acknowledge**.

The whole view is the shared component **`<wui-alarm-view>`** of
`@visuelconcept/wui-alarms-core`, so the same view **embeds in other pages** — the
Machine Fleet machine dashboard shows a machine's alarms with it.

Self-contained **source** distribution: the shared kits are **vendored** under
`alarms/_vendor/` (no `@visuelconcept/wui-*` prerequisite), and the page is built on
the target's runtime workspace (so the bundle matches its version).

## Install (one command)

```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root>
```

- `--workspace` = the `@wincc-oa/webui-runtime` workspace that builds this project's dashboard (e.g. `…/WebDemo2/webui-workspace`).
- `--project` = the WinCC OA project root (its `data/dashboard-wc/` is the deploy target).

It copies the page source (kits vendored) into the workspace, adds the menu entry to
the workspace's `menuconfig.jsonc`, and runs `build:pages` (deploying into
`<project>/data/dashboard-wc/`).

## After install

1. **Browser:** reload (logged in). The build touches `index.html`, which makes the
   service worker purge its runtime caches, so a plain **F5** is enough.

## Prerequisites

- A **WebUI Runtime workspace** for the target project (the `--workspace`).
- **No backend module and no manager** — the page reads and acknowledges through the dashboard's own WinCC OA connection.
- `module.json.frontend.npmDeps` is empty: no extra npm dependency is added to the workspace.

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

- **Active / History** — the two tabs switch snapshot. `History` shows the period
  selector (today, 24 h, 7 d, 30 d, current week, current month, custom) with
  previous/next-period arrows.
- **Range chips** — click to filter; each chip reads `total (n ack)`. The ranges
  themselves (abbreviation, colour, priority threshold) are the project's own:
  the cogwheel opens the editor and stores them in the `Alarms_Config` datapoint.
- **Unacknowledged only**, free-text search (datapoint, text, description, class),
  click-to-sort headers, paging.
- **Acknowledge** — tick the rows, then _Acknowledge (n)_. While a selection is open
  the live list is **held** so rows do not move under the cursor (the status dot
  turns amber); releasing the selection applies the pending updates.
- **Scope by URL** — `#/alarms?dp=System1:Press01` opens the list on one datapoint
  (comma-separated, globs allowed: `?dp=Line1_*`).

## Application Security

Module id `alarms`, roles `view`, `acknowledge` and `configure` (open until groups
are assigned). `acknowledge` hides the acknowledge affordance (the WinCC OA write
permission is what WinCC OA enforces on the write itself — and the affordance is
hidden on its own when that permission is missing); `configure` hides the range editor —
without it the dialog is read-only, because seeing how the ranges are set explains
the list even to someone who may not change them.

## Contents

```
module.json                                   manifest (mode: source, tier 1)
install.mjs                                   installer
frontend/standalone-pages/alarms.ts           page entry SOURCE
frontend/standalone-pages/alarms/             page SOURCE (kits vendored in alarms/_vendor/)
  └─ app-security.roles.json                  the module's role catalog
frontend/standalone-pages/alarms/_vendor/@visuelconcept/wui-alarms-core/
  ├─ types.ts / mapping.ts / scope.ts / query.ts / severity.ts / statistics.ts
  ├─ period.ts / occurrences.ts               period vocabulary, occurrence-window merge
  ├─ data/alarm-store.ts                      live subscription, archive query, acknowledge
  ├─ data/alarm-config-store.ts               the Alarms_Config datapoint (priority ranges)
  └─ ui/wui-alarm-view.ts + wui-alarm-table.ts + wui-alarm-stats.ts + wui-alarm-ranges.ts
README.md / INTEGRATION.md / NOTES.md         this documentation
```

## Embedding the view in another page

```ts
import '@visuelconcept/wui-alarms-core/ui/wui-alarm-view.js';
import { scopeFromDpes } from '@visuelconcept/wui-alarms-core/scope.js';
```

```html
<wui-alarm-view
  layout="panel"
  hide-period
  strict-scope
  .from="${range.start.getTime()}"
  .to="${range.end.getTime()}"
  .scope="${scopeFromDpes([machine.stateDp,"
  ...machine.kpis.map((k)=""
>
  k.dp)])} ></wui-alarm-view
>
```

See [INTEGRATION.md](./INTEGRATION.md) for the full property list and
[NOTES.md](./NOTES.md) for the domain reading (CAME/WENT, ack state, priority ranges).

## Dashboard widget — `wui-alarms` (added 2026-09)

The same view also exists as a **WinCC OA dashboard widget** (palette folder
**Alarms**, widget _Alarms_, tag `wui-alarms-widget`): the "Suivi Alarmes" band of
the Machine Fleet machine dashboard, freely placeable on any `/dashboard`.

- **Source**: `libs/wui-alarms/src/widgets/wui-alarms.ts`, **built** by
  `npm run build:pages` into `<project>/data/dashboard-wc/widgets/wui-alarms.js`
  (the alarms kit is not in the dashboard import map, so the widget is bundled like
  a page). Definition, icon and catalogs: `oa-data/WebUI/widgets-v2/Alarms/wui-alarms/`,
  `oa-data/WebUI/svg/wui-alarms.svg`, `oa-data/WebUI/msg/*/WUI_Widget_WuiAlarms.json`
  (deployed by `npm run deploy:oa-data`).
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
- **Formatting**: default tab (active / history), density (panel / page), rows per
  page, lock the tab, hide the statistics, read-only.
- **Roles and rights**: the alarms module's own — `view` gates the widget body,
  `acknowledge` folds into read-only. Acknowledging goes through WinCC OA's own
  API (browser `dpSet`), so the checkboxes and the button are also hidden when the
  user lacks the WinCC OA write permission.

Deploy: `OUT_DIR=<project>/data/dashboard-wc npm run build:pages` (the widget
bundle) + `npm run deploy:oa-data` (definition, icon, catalogs), then _Clear site
data_ in the browser.
