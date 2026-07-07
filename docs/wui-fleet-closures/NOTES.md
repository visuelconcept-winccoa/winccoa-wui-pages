# wui-fleet-closures — business & architecture notes

WinCC OA WebUI page module, **Tier 1** (pure frontend, no backend or manager). Route `/fleet-closures`, component `wui-fleet-closures`.

## Domain / purpose

Management of the machine fleet's **non-working days** (closure periods / *closures*). A closure period is an interval [start, end] attached to a **scope**: either a whole workshop, or a specific machine.

The page is a **fully standalone page** (no longer a dialog). It is reached from a button in the header of the Machine Fleet 3D overview. Historically this function lived in a `mf-kpi-closures-dialog` dialog opened from the KPI page; that dialog has been removed. The KPI page (`fleet-kpi-analysis`) still **loads** the closures, however, because they serve as the basis for the **denominator of the OEE calculation** (operating time).

Interface: a single editable table with one row per period:
- **scope**: an `ix-select` whose value is `a:<atelierId>` (workshop) or `m:<machineId>` (machine)
- **start** (date + time), **end** (date + time), **duration** (computed), delete button
- add-period button in the `tfoot`, with a scope select

Toolbar: Back, **Year** filter (default: current year; `ALL_YEARS = 0` = all), **Workshops** + **Machines** multi-select, **Import / Export** (JSON), **Save** (enabled only if `dirty`).

Editing happens on a **working copy** `working: ClosureConfig`; persistence goes through `store.saveClosures`.

## Data model

Closures are carried by a `ClosureConfig` object loaded/saved via the fleet store (`store.saveClosures`). A period's scope is encoded as a string: prefix `a:` for a workshop, `m:` for a machine, followed by the identifier.

Import/export format: **JSON** (union of periods).

## Algorithms / overlap handling

The overlap logic is centralized in `fleet-kpi-analysis/closures.ts`:
- `rangesOverlap(...)` — overlap test for two intervals
- `hasOverlap(existing, incoming)` — true if the import overlaps the existing data
- `mergeClosures(existing, incoming, mode)` with `mode` ∈ `'replace' | 'ignore'`:
  - `replace` — the incoming data wins (imported periods overwrite overlapping ones)
  - `ignore` — keep the existing data and add only the incoming periods **without overlap**

Behavior on import:
- if `hasOverlap` → conflict dialog offering **Replace / Ignore / Cancel**
- otherwise → silent union via `mergeClosures(..., 'ignore')`

## Architecture / integration

- The page reuses `pageStyles()` from `fleet-stop-analysis/styles.js`, supplemented by a local `extraStyles()`.
- The overview emits the `wui:closures` event; the shell (`machine-fleet-3d.ts`) triggers `RouterEvent('/fleet-closures')`. This is the same scheme as `wui:analyze` → `/fleet-stops` and `wui:kpi` → `/fleet-kpi`.
- Automatic discovery: standalone pages are auto-registered by directory scan (`discoverStandalonePages` in the build config). Dropping a `*.ts` into `standalone-pages/` is enough to create the page entry; no manual registration in the build.
- Route declared as `hidden: true` in the menu config.
- npm dependency declared in `module.json`: `three` (^0.169.0).

## Pitfalls / things to know

- **Page, not dialog**: do not confuse it with the old `mf-kpi-closures-dialog`. The KPI page now only uses the closures (OEE denominator), it no longer edits them.
- **Save button gated on `dirty`**: as long as no change has been made to the `working` copy, save stays inactive.
- **Scope encoding** as an `a:`/`m:` string: be sure to preserve the prefix when reading/writing the selectors.
- **Lint pitfalls encountered**:
  - `member-ordering`: `render` (public) must come before `firstUpdated` (protected)
  - `sonarjs/prefer-single-boolean-return`: combine the filter guards into a single boolean `return`
  - `unicorn/no-array-for-each`: prefer a `for...of` over `.entries()` (with index) rather than `.forEach`

## Application Security (roles — added 2026-07)

The page declares 2 roles (self-registration in `fleet-closures.ts`,
`module: 'fleet-closures'`): `view` and `edit`. Both are OPEN until an admin
assigns groups in `/app-security` (see docs/wui-app-security/INTEGRATION.md).

- **`view`** — gates the page body: without the grant, the header/context
  generator still renders but the body is replaced by the `roleForbidden`
  notice (muted, centered). No data is shown.
- **`edit`** ("manage non-working periods") — gates every mutation affordance:
  the **Import** (JSON) and **Save** toolbar buttons and the **Add a period**
  footer (button + scope select) are hidden; the per-row delete trashcan is
  hidden; the per-row scope select and start/end date/time inputs are
  `disabled`. **Export stays open** (read-only). A pending import-overlap
  dialog is dismissed live if the grant is revoked.

No backend to guard (Tier 1, frontend-only — persistence goes through the
shared fleet-store DP-JSON API, deliberately not gated per-module; see the
para NOTES for the rationale).
