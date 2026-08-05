# @visuelconcept/wui-alarms — source module (Tier 1)

**Alarms** page for a WinCC OA WebUI dashboard, on **`/alarms`**: the plant's alarm
list either **live** (the standing alarms) or over an **archived period**, with the
**unacknowledged** counter, the **P1–P4 severity bands** doubling as a filter, the
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
- No backend module and no manager — **frontend-only Tier 1** page.
- `module.json.frontend.npmDeps` is empty: no extra npm dependency is added to the workspace.

## Prerequisites (runtime)
- **Alarms configured in the project** (`_alert_hdl` on the datapoint elements) — the
  page displays what WinCC OA raises, it does not configure alarms (the PARA page's
  *Alarming* tab does).
- **Acknowledging** writes `<dpe>:_alert_hdl.._ack` and therefore requires WinCC OA
  **write permission** for the logged-in user.
- For the **History** tab: the alarm archive must be available (standard alert
  archiving), otherwise the archived period comes back empty.

## Usage
- **Active / History** — the two tabs switch snapshot. `History` shows the period
  selector (today, 24 h, 7 d, 30 d, current week, current month, custom) with
  previous/next-period arrows.
- **P1…P4 chips** — click to filter; each chip reads `total (n ack)`.
- **Unacknowledged only**, free-text search (datapoint, text, description, class),
  click-to-sort headers, paging.
- **Acknowledge** — tick the rows, then *Acknowledge (n)*. While a selection is open
  the live list is **held** so rows do not move under the cursor (the status dot
  turns amber); releasing the selection applies the pending updates.
- **Scope by URL** — `#/alarms?dp=System1:Press01` opens the list on one datapoint
  (comma-separated, globs allowed: `?dp=Line1_*`).

## Application Security
Module id `alarms`, roles `view` and `acknowledge` (open until groups are assigned).
`acknowledge` hides the acknowledge affordance; the WinCC OA write permission is
still what the server enforces.

## Contents
```
module.json                                   manifest (mode: source, tier 1)
install.mjs                                   installer
frontend/standalone-pages/alarms.ts           page entry SOURCE
frontend/standalone-pages/alarms/             page SOURCE (kits vendored in alarms/_vendor/)
  └─ app-security.roles.json                  the module's role catalog
frontend/standalone-pages/alarms/_vendor/@visuelconcept/wui-alarms-core/
  ├─ types.ts / mapping.ts / scope.ts / query.ts / severity.ts / statistics.ts / period.ts
  ├─ data/alarm-store.ts                      live subscription, archive query, acknowledge
  └─ ui/wui-alarm-view.ts + wui-alarm-table.ts + wui-alarm-stats.ts
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
  .from=${range.start.getTime()}
  .to=${range.end.getTime()}
  .scope=${scopeFromDpes([machine.stateDp, ...machine.kpis.map((k) => k.dp)])}
></wui-alarm-view>
```
See [INTEGRATION.md](./INTEGRATION.md) for the full property list and
[NOTES.md](./NOTES.md) for the domain reading (CAME/WENT, ack state, severity bands).
