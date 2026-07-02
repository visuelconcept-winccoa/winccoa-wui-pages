# @visuelconcept/wui-poseidon — source module (Tier 3)

**Poseidon** — wastewater-treatment-plant (WWTP) supervision page for a WinCC OA
WebUI dashboard (page source + `poseidon` simulator manager + `/api/poseidon`
backend module). Distributed as **source** and built on the target's runtime
workspace, so the page bundle always matches the target runtime version (a page
bundle is coupled to the shell's import map).

It models a conventional **activated-sludge** plant:

- **Water line**: screening → lift station → aeration/biology → clarifier → UV
  disinfection → outfall.
- **Sludge line**: RAS recirculation, WAS extraction, dewatering.

## Features

- **Synoptic** tab — the process flow as a chain of stage cards (water + sludge
  lines), each with its key live sensor readouts and a status dot per equipment
  (green running / grey stopped / red fault). Read-only.
- **KPI** tab — headline tiles (in/out flow, dissolved O₂, specific energy,
  power, energy-today), **removal efficiencies** (COD / TSS / NH₄) and the
  **discharge-conformity** verdict against the regulatory limits.
- **Trends** tab — one archived signal over a selectable period (1 h / 8 h /
  24 h / 7 d), drawn with echarts from `dpGetPeriod` on the station DP.
- **Alarms** tab — the live list of **threshold breaches** (discharge limits +
  operating bands) and **equipment faults**, with acknowledgement. The tab
  header carries a badge with the unacknowledged count.
- **Equipment** tab — one control card per motorised device: live state / mode /
  load / current / run-hours, with **start / stop** (confirmed) and
  **auto / manual**. Permission-gated (`canEditFleet`); every command is traced
  to a GxP `_AuditTrail` datapoint (`AuditTrail_Poseidon`, with the session user).

## Data model

Created and animated by the **`poseidon`** JavaScript manager:

- **`Poseidon_Station`** — one DP, nested sensor structs: `inlet` (flow, pH, T°,
  COD, BOD, TSS, NH₄), `bio` (dissolved O₂, redox, MLSS, level, T°), `clarifier`
  (level, sludge blanket, turbidity), `outlet` (flow, pH, TSS, turbidity, NH₄,
  NO₃, COD), `sludge` (flow, dryness), `energy` (power, energy-today).
- **`Poseidon_Equipment_<id>`** — one DP per device (`state`, `mode`, `cmd`,
  `setpoint`, `feedback`, `current`, `runningHours`). Devices: `liftPump1..3`,
  `blower1..2`, `mixer1..2`, `rasPump`, `wasPump`, `scraper`, `uvReactor`,
  `centrifuge`.

The page reads all of this **live** over the dashboard WebSocket (`dpConnect`)
and derives KPIs / alarms client-side. Equipment commands and the server-side
KPI / regulatory-report summaries go through the **`/api/poseidon`** route.

## Discharge limits (conformity)

Secondary-treatment defaults used by the KPI conformity panel and the alarm
engine (edit them in `src/poseidon/model.ts` → `THRESHOLDS`):

| Parameter | Limit |
|-----------|-------|
| COD (DCO) | ≤ 125 mg/L |
| TSS (MES) | ≤ 35 mg/L |
| Ammonium (NH₄) | ≤ 10 mg/L |
| pH | 6 – 8.5 |
| Dissolved O₂ (operating band) | 1 – 4 mg/L |

## Deploy (backend + manager)

The backend module (`/api/poseidon`) and the `poseidon` manager are mirrored into
a WinCC OA project by the shared tool (source of truth: `tools/specs.json`):

```bash
node tools/scripts/deploy-backend.mjs --project <winccoa-project-root> --only poseidon
```

This copies `backend/routes/poseidon{Controller,Route}.ts` into the webserver's
`src/modules/poseidon/` (mounted automatically by the module loader — see
`webserver/src/wui-module-routes.ts`), copies `backend/managers/poseidon/` into
`<project>/javascript/poseidon/`, appends the manager line to `config/progs`,
and rebuilds the webserver.

## After deploy (required)

1. **Backend:** restart the webserver manager so the rebuilt `/api/poseidon`
   module loads.
2. **Manager:** start the **`poseidon`** manager in the WinCC OA console (pmon) —
   it creates the data model on first run and begins simulating.
3. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then
   reload (logged in). ⚠️ The service worker caches `menuconfig.json` —
   `Ctrl+Shift+R` is **not** enough; only `Clear site data` purges it.

## Notes

- **Tier 3** because it ships a backend (`/api/poseidon`) and a manager
  (`poseidon`). See `INTEGRATION.md` for the control flow and `NOTES.md` for the
  simulator design.
- The data is **simulated**. To drive Poseidon from a real plant, point the DP
  paths in `src/poseidon/model.ts` at the real datapoints (or map the real DPs to
  the `Poseidon_*` names) and stop the simulator manager.
