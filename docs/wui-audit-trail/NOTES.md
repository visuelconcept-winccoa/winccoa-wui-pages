# wui-audit-trail — business & architecture notes

Tier 1 module (pure front-end, no backend or manager, empty `npmDeps`). Route `/audit-trail`, element `wui-audit-trail`, visible in the menu.

## Domain / purpose

Standalone **Audit Trail** page: visualizes the archived (NGA) history of a datapoint as a **wide pivot table**.

- Columns = the structure elements (leaves) of the target DP.
- Rows = change timestamps (descending order).
- Each row carries the value of **all** columns by carry-forward: at a given instant `t`, for each column the last archived value ≤ `t` is displayed.

Configuration via a popup (gear button "Configure"): choice of target DP, period, displayed columns/elements and auto refresh.

## Data model (DPs)

- **Config persistence**: a single DP `AuditTrail_Config` (Struct, String field `json`) holding the serialized `AuditConfig`. Type + DP already created in the project.
- Access via `AuditConfigStore` (modeled on the `OrderStore` of production-orders):
  - lazy type/DP creation via REST `/api/para/dptype|dp/create`,
  - writes via `/api/para/dp/set`,
  - reads via `OaRxJsApi.dpGet`,
  - offline fallback.
- The **audited DP** is not created by the page: it must already exist and be **NGA archived** (otherwise "No history data").

`AuditConfig` holds: target DP, period (today / 24h / 7d / 30d / custom), `maxRows` (200 / 500 / 1000 / 5000), list of checked elements, auto refresh toggle.

### Target DP selector (search)

- The config popup picks the DP with the shared **`wui-dp-input`** (`@visuelconcept/wui-kit/ui/wui-dp-input.js`) — live `dpNames` autocomplete + magnifier, the same search field used by machine-fleet-3d / report-builder — instead of a plain text input.
- That component **appends a trailing dot** to a committed top-level DP (`MachineSim_machine_1.`). The page normalises it with `stripDpDot()` before the `dpNames('<dp>.*','')` query and before persisting `dpName` (so the toolbar/label and config stay clean).
- Committing a DP from the suggestions (value ends with `.`) **auto-loads its elements** and resets the column selection to the new DP; `lastLoadedDp` (seeded in `openConfig`) guards against a no-op re-commit on blur wiping the selection. The "Charger les éléments" button remains as a manual fallback for typed names.

## Key algorithms / formulas

Pure engine in `engine.ts`: `structLeaves`, `queryHistory`, `buildPivot`.

- **Element enumeration** (`fetchElements`, critical feasibility point):
  - `WuiDpeService.getDatapointTypes(name)` calls `etm.model.type.get` which expects a **TYPE** name → generally fails for a **DP** chosen by the user.
  - **Fallback**: `OaRxJsApi.dpNames('<dp>.*', '')` (type-agnostic), returns the DPE elements directly — ideal for flat DPs (e.g. MachineSim).
  - Leaf traversal: `structLeaves`, where a leaf = `typeof value === 'string'` (para-nav pattern).
- **History**: per column, `queryHistory(api, dpe, start, end)` = `api.dpGetPeriod(start, end, 0, dpe + ':_original.._value')` (same approach as the fleet-stop engine). Parses `{data, dataTime}` → samples.
- **Pivot** (`buildPivot`): union of all change timestamps (descending sort, capped at `maxRows`); each cell = last value ≤ `t` via **binary search** in the column's samples.

## Pitfalls / things to know

- `getDatapointTypes` expects a **type**, not a DP: don't rely on it to enumerate the elements of an arbitrary DP → use the `dpNames('<dp>.*','')` fallback.
- The audited DP **must be NGA archived**; without archiving, no history data is returned.
- **Live**: `dpConnect` on the displayed DPEs triggers a debounced re-query (3D view / dashboard pattern), gated by the refresh toggle.
- A structure leaf is detected by `typeof value === 'string'` (para-nav pattern) — non-string elements may be ignored by this criterion.
- Auto-discovered bundle (top-level `.ts` in standalone-pages) and **self-contained** (no shared chunk).
