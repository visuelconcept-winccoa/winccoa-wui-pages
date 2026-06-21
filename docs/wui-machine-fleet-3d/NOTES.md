# wui-machine-fleet-3d — business & architecture notes

Standalone **Machine Fleet 3D** WebUI page: a 3D digital twin (Three.js) of a
multi-machine / multi-workshop fleet, with per-machine status and KPI bubbles, a stop-cause
catalog, a contextualized machine dashboard (Gantt + Pareto) and an AI assistant.

Tier: **hub** (central fleet page, default entry point at login). `three`
(`^0.169.0`) is a real npm dependency bundled into the page (no CDN).

## Domain / object

- **Router shell**:
  - `/machine-fleet-3d` (`/fleet-3d`) = **overview** (`mf-atelier-overview`, grid of
    workshop cards + SVG mini-plan).
  - `/machine-fleet-3d/:atelier` = **3D view** of a workshop (`mf-atelier-view`).
  - The route param `:atelier` arrives as the `atelier` **attribute**; navigation via
    `RouterEvent` (`@wincc-oa/wui-models/events/router-event.js`, accepts a string;
    event is `bubbles`+`composed` so it escapes the shadow DOM of the overlays).
- **Landing page at login**: redirect `/` → `/fleet-3d` (post-login landing forced
  onto the fleet view unless there is an explicit deep-link).
- **Machine model**:
  - **Process families** `MachineProcess` = `generic | usinage | soudage`
    (`MachineDef.process?`). `resolveProcess(m)` = explicit `process`, otherwise derived from
    the `type` (tour/fraiseuse/brocheuse/scie → `usinage`, otherwise `generic`). The family drives
    the simulated and bound domain parameters.
  - **Render types**: "geometric" machines (furnace, robot, tour, basculeur,
    `portique-table` = gantry + rotary table with `tableDiameter`…), **GLB** objects
    (`type:'glb'`, ref `glbUrl`) and **billboards** (`type:'billboard'`, ref `billboardUrl`,
    screen-aligned textured plane).
- **States**: per-machine state mapping (`StateMapping`) with configurable colors
  (`StateMapping.colors`, `StateColorKey` = state | `disconnected`). Defaults:
  warn=red `#ef4444`, stop=yellow `#f59e0b`, maint=blue, disconnected=purple.

## Data model (DPs)

DP and type provisioning/CRUD via the backend's **PARA REST API** (see Backend), because
`OaRxJsApi` can **only read/write values** (it cannot create DP/type). `FleetStore`
(`data/fleet-store.ts`) centralizes everything, with an **in-memory (offline) mode** seeded by
`DEMO_ATELIER` if the backend/rights are missing (warning banner).

| DP type | Shape | Content |
|---|---|---|
| `MachineFleet3D_Config` | Struct (`name` String, `json` String) | 1 workshop per DP; `json` = the serialized `Atelier` (machines, mappings, KPIs, display…). |
| `MachineFleet3D_StopCauses` | 1 JSON DP | Stop-cause catalog (serialized array). |
| `MachineFleet3D_Glb` | Struct (`name` String, `data` String base64) | 1 imported GLB 3D object. Ref `dp:<dpName>`. |
| `MachineFleet3D_Billboard` | Struct (`name` String, `data` String base64) | 1 imported billboard image. Ref `dp:<dpName>`. |
| `MachineFleet3D_Closures` | 1 JSON DP | Non-working days / closures (consumed by kpiCalc). |
| `MachineFleet3D_Kpi` | See kpiCalc | One DP per computed KPI (1 per machine×KPI). |
| `MachineSim` (1 per machine) | See machineSim | Simulation DPs (state + cause + parameters). |
| `AI_Assistant_Config` | Struct String (`provider`, `model`, `token`, `mcpServers` JSON) | AI assistant config (token stored here, never shipped). |

- **Workshop persistence**: **debounced** save (`wui:save`) from the 3D view. DP value
  writes via **REST `/api/para/dp/set`** (the WebSocket `dpSet` of `OaRxJsApi` is
  read-only).
- **Graphic resources**: generic API `listResources(kind)`,
  `importResource(kind,name,dataUrl)`, `deleteResource(kind,ref)`, `readResourceDataUrl(ref)`
  (`kind` = `glb | billboard`, identical model). The scene-controller has a single resolver
  (`setResourceResolver`); GLB → `GLTFLoader.parse(ArrayBuffer)` (never `.load()` on a
  `data:`), billboard → `applyBillboardTexture` (SVG **and** raster). **Fallback**: if a
  `dp:` no longer resolves, the object is replaced by a 3D cabinet (`swapToFallback`).
- **Unified display**: single source of truth `MachineDef.display?: DisplayEntry[]`
  (`{ref, inBubble, inPopup}`, order = index). `ref` ∈ `state | stopCause | workOrder |
  operation | param:<key> | kpi:<id>`. `resolveDisplaySlots(m)` builds the ordered
  catalog; items missing from `display` are auto-added (new params/KPIs
  appear on their own). The old scattered visibility toggles have been removed.

## Key algorithms / formulas

### Real-time KPI (kpiCalc manager) — TRS / MTBF / MTTR
Computed **server-side** over a sliding window, DPs archived for trending, value
pushed into the 3D bubble. `KpiType = 'TRS'|'MTBF'|'MTTR'` (TRS in `%`, MTBF/MTTR in `min`).

- Required = opening − planned stops.
- **TRS** = (required − unplanned) / required × 100.
- **MTBF/MTTR on UNPLANNED time only** (planned stops count as
  operating time and do NOT reduce the metrics):
  - MTBF = (opening − unplanned) / N_failures
  - MTTR = unplanned / N_failures
  - a "failure" = a stop that contains unplanned time.
- **Temporal categorization**: honors **closures** (`MachineFleet3D_Closures`,
  subtracted from each interval) AND the **cause assignment**: the start of a stop with no cause is
  back-filled to the 1st assigned cause then carried forward (`partitionByCause` /
  `causeBoundaries`). As long as no cause is assigned the time counts as **unplanned**;
  once assigned, the whole stop is reclassified as planned/unplanned from its start.
  `classify(code)`: ''/null → unplanned, otherwise `causeClass[code] || __default || unplanned`;
  only `planned` is subtracted from required.

### Stop causes (catalog + fallback)
- `StopCause` = `code` / `description` / `classification` / `isDefault?` ("Default" toggle,
  radio: only one default, `setDefault`). Full JSON persistence → any new field
  persists automatically.
- `formatStopCause(catalog, code)` → `"code — description"` for a known code; for an
  **unknown** code, falls back to the `isDefault` entry (demo catalog: `{code:"NC",
  description:"Non catégorisé / hors catalogue", isDefault:true}`), otherwise the raw code. Used
  by the bubble, the machine popup and the stop-analysis engine.

### Contextualized machine dashboard (built-in, no echarts)
- Full-screen overlay `mf-machine-dashboard`: Process parameters · period bar ·
  Alarm tracking (placeholder) · KPI = **state Gantt** + **unplanned-stop Pareto**
  (SVG/DOM, no echarts).
- **Real-time = `dpConnect`** (no polling); a change of the state DP reloads
  (debounced) the archived history to keep the Gantt live.
- Gantt: segments from the state DP's archived history (`resolveState` + `STATE_COLORS`),
  each segment carries its cause (via the cause DP's history + `causeAt` + `formatStopCause`)
  and a bubble on hover.
- Pareto: `analyseStopCauses` (single-machine) → unplanned → sort by downtime/frequency,
  Top 5/10/All, cumulative/frequency metric, planned/unplanned class, CSV export (`;`+BOM),
  print CSS. "Analyze" button → opens `/fleet-stops` (new tab) with the
  workshop+machine filter in the **URL hash** (`#/fleet-stops?atelier=&machine=`).
- Dashboard choice: `MachineDef.dashboardMode?: 'default'|'oa'` (`resolveDashboardMode`:
  explicit, otherwise `oa` if `dashboardId` is present, otherwise `default`). `mode=oa` →
  `RouterEvent('/dashboard/<id>')`, otherwise the built-in overlay.
- Custom links: `MachineDef.dashboardLinks?` (`{label,icon,url}`, max 3) → extra
  buttons in the popup, opened in a new tab (`noopener,noreferrer`).

### 3D bubble layout
Gutter callout: `setBuildingBounds` pushes the building footprint;
each frame `projectBuildingRect` projects the 8 corners → screen AABB, and `placeBubbles`
pushes each bubble into the left/right gutter **beyond** the building (depending on the side
of the machine), stacked vertically, with a leader from the dot to the inner edge. Fallback
`placeBubblesAbove` if there are no bounds. Multiple KPIs stacked one per row.

## Backend / manager

**Tier hub** page: backend module `backend/modules/machine-fleet-3d` + **4 managers**.

- **Backend module `/api/para`** (REST PARA): the only way to **create DP/type** and to **write
  values** (`POST /api/para/dptype/create`, `/api/para/dp/create`, `/api/para/dp/set`,
  `DELETE /api/para/dp/:name?dpType=`). The `/api/para/dp/set` route must accept large
  bodies (base64 GLB/billboard objects): `json({limit:'8mb'})` — the default limit ~100 KB
  would break the import. Reading goes through `OaRxJsApi.dpGet/dpNames` and `dpConnect`.
- **machineSim** (WCCOAjavascript manager, `always`): fleet simulator. Creates the
  `MachineSim` DPs, does the **non-destructive AUTO_MAP** (only maps machines without `stateDp`,
  never overwrites a user config) and writes state/cause/parameters at intervals.
  - `cause` is a **String** (not Int) so any catalog code can be emitted; it
    **reloads the catalog before each state tick**; `pickCause()` emits a valid code
    ~90% of the time and an **out-of-catalog (erroneous) code** ~10% (`ERRONEOUS_CAUSE_PROB`).
  - `PARAM_SETS` per family: generic `[cadence,temperature,vitesse,charge]`, usinage
    `[programme,outil,broche,avance]`, soudage `[tension,intensite,vitesseSoudage]`; **every**
    machine simulates `ALL_PARAMS` (union) so that a KPI binding always resolves. Discrete
    (`programme`/`outil`) = String, analog = Float. `avance = broche × feedPerRev`.
    `basculeur.angle` = triangle 0→90° in 30 s, its `vitesse` KPI = angular velocity °/s.
- **kpiCalc** (manager, `always`): creates the `MachineFleet3D_Kpi` type (`value` Float
  **archived** + Strings `kpiType,machineId,machineName,window,unit,updatedAt`); one DP per KPI
  named `MachineFleet3D_Kpi_<sanitize(machineId)>_<sanitize(kpiId)>` (sanitize:
  `[^A-Za-z0-9_]→_`). Per-KPI NGA archiving driven by `MachineKpi.archive`/`archiveGroup`
  (`disableArchived` / `ensureArchived`). Re-reads config+closures+KPIs every 60 s,
  base tick 15 s. 3D bubble subscribed to `…_<kpiId>.value` via `DpTarget` kind `kpiCalc`.
- **aiAssistant** (manager, `always`): hosts the **vRPC service `AiAssistant`** (`Chat`
  function). 3-tier architecture: WebUI `mf-ai-prompt` → `POST /api/ai/chat` (webserver,
  same origin) → vRPC stub → `AiAssistant` service → provider via `fetch`. The WebUI runtime
  has no MSA/vRPC client, hence the mandatory HTTP bridge. Raw fetch providers (Anthropic
  `/v1/messages`, OpenAI/Mistral `/v1/chat/completions`, Gemini `:generateContent`);
  **no sampling parameter** sent (opus-4-x returns 400 on temperature/top_p);
  `max_tokens` required by Anthropic (set to 8192). **Local MCP** tool loop: the manager is
  itself the MCP client (`gatherMcpTools` + local execution via `mcp.callTool`), so the
  cloud provider never reaches the MCP server → `localhost` works.
- **mcpServer** (manager, `always`): WinCC OA MCP server (Streamable-HTTP) consumed by
  aiAssistant (default URL/token in the `mcpServers` of `AI_Assistant_Config`).

**Security**: the AI provider tokens are read from `AI_Assistant_Config` — **none
are shipped**.

## Pitfalls / things to know

- **OaRxJsApi (read/binding)**:
  - `dpGet` returns the **raw value** (`unknown | unknown[]`), NOT `{ value: [] }` — do not
    read `.value[0]` blindly, extract recursively.
  - List a type's DPs via `WuiDpeService.listDatapoints(typeName)` (command
    `etm.model.type.listDps`), **not** `dpNames('*', type)` (it does not filter as expected).
  - `dpConnect(dps,true)` emits `{ dp, value }` but the `dp` names are **server-normalized**
    (`System1:` prefix, `:_original.._value` suffix, trailing dot) → map the targets by a
    **normalized** name (`normDp`), otherwise the lookup fails and the state/KPI never updates.
  - `resolveState`: provide a fallback to the 1st mapping if the machine has no
    `stateMappingId`.
  - `OaRxJsApi` does not create DP/type → go through the PARA REST API.
- **Writing**: WebSocket `dpSet` = read-only → any value write goes through
  **REST `/api/para/dp/set`**.
- **Permissions**: `data/permissions.ts` (`canEditFleet()`/`canEditFleet$()`) relies on
  `WuiUserService.canPublish` (resolved via tsyringe; `@wincc-oa/wui-iam-data` externalized so
  the runtime singleton is resolved; `canPublish` is **async** → subscribe to the Observable). In
  view-only: edit button → eye, all mutations (rename/delete/move/import/
  save-view/GLB) hidden.
- **Archiving**: on this project the `MachineSim.state` DPE **is** NGA-archived but `.cause`
  **is NOT** (the `dpTypeChange` Int→String probably lost its archive config) →
  no cause history until `.cause` archiving is re-enabled.
  `FleetStore.listArchiveGroups()` only returns the **active** `_NGA_Group` groups
  (`.active === true`).
- **Legacy "0–5" causes**: old data from the Int era (codes 1–5 + ''→0) may
  remain; the current simulator no longer emits fictitious numeric codes (`causeCodes` starts
  **empty** → emits `''` if the catalog does not load; `isDefault` entries are **excluded**
  from the emittable set — the default is a fallback bucket, not an active cause).
- **Dynamic iX icons in a button**: an `<ix-icon slot="icon" name=${dynamique}>`
  **does not render** (the deployed ix-icons read `name` only once). Use
  the **`icon=${x}`** attribute/property on `ix-button`/`ix-icon-button`. Static slotted
  names (`name="ontology"`) work. Valid icon names:
  `node_modules/@siemens/ix-icons/dist/ix-icons/svg/` (unknown name → "crossed-out rectangle").
  Deployment-safe list of link icons: `DASHBOARD_LINK_ICONS`.
- **iX shell**: components registered globally by the shell → bare tags, do not
  re-import `@siemens/ix`.
- **Strict lint (eslint)**: hex literals as `0xRR_GG_BB`; class member order
  (public < protected < private; arrow-function fields count as private → last);
  `CustomEvent` names = string literals `^wui:[a-z]{3,}$` (no hyphen); avoid
  a method named `flat` (collision `no-magic-array-flat-depth`).
  `no-magic-numbers` = warning only (OK for the 3D code).
- **Manager restart**: after editing a manager (machineSim / kpiCalc / aiAssistant /
  mcpServer) or the webserver backend, **restart the affected manager** to apply (mode
  `always` → pmon relaunches it; a manual `start-manager` right after a stop often returns
  "START not possible" but pmon brings it back in ~1 s). No KPI is configured by default →
  kpiCalc runs idle until a KPI is added in the machine dialog.
- **Service worker**: the page bundle has a stable name → a forced reload
  (Ctrl+Shift+R / Ctrl+F5) is often needed after redeployment. A pages-only deployment
  may leave the Siemens SW serving a stale snapshot → intermittent module/route resolution
  failures (blank page); the reliable fix = a full build that regenerates the SW.
