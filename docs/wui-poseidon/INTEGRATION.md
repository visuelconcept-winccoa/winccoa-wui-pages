# Poseidon — integration

How the frontend page, the `/api/poseidon` backend module and the `poseidon`
manager fit together.

## Components

| Piece | Location | Role |
|-------|----------|------|
| Page (WebComponent) | `libs/wui-poseidon/src/poseidon.ts` (+ `poseidon/**`) | The `wui-poseidon` standalone page: shell + 5 tabs. |
| Simulator manager | `backend/managers/poseidon/index.js` | Creates the DP model and animates it; reacts to operator commands. |
| Backend module | `backend/routes/poseidon{Controller,Route}.ts` | `/api/poseidon` — equipment control + server-side KPI / report. |
| Manifest / registration | `libs/wui-poseidon/package.json` (`wuiPage`), `menu.fragment.jsonc`, `tools/specs.json` | Route, icon, permission, backend + manager wiring. |

## Data flow

```
                         dpConnect (live)               dpGetPeriod (history)
   Poseidon_Station  ───────────────────────►  wui-poseidon  ◄──────────────────
   Poseidon_Equipment_*                          (5 tabs)
        ▲   ▲                                        │
        │   │ dpSet (simulation)                     │ POST /api/poseidon/control
        │   └───────────── poseidon manager          ▼
        │                    ▲                    PoseidonController.control
        │  reads .mode/.cmd  │  dpSetWait(.mode/.cmd)      │
        └────────────────────┴─────────────────────────────┘
```

- **Live values**: the page issues two `OaRxJsApi.dpConnect` subscriptions (all
  station sensor DPEs, and every equipment DPE). The shell owns them and shares
  the snapshots to the tabs — one subscription set for the whole page.
- **History**: the Trends tab queries `OaRxJsApi.dpGetPeriod` per selected signal.
- **Control**: the Equipment tab emits `wui:control {equipment, action}`; the
  shell calls `POST /api/poseidon/control`, which writes `.mode` / `.cmd` with a
  confirmed `dpSetWait`. The manager reads those back each tick and drives the
  device (manual → `cmd`; auto → its process rule). The command is traced to the
  `AuditTrail_Poseidon` `_AuditTrail` DP.

## `/api/poseidon` endpoints

| Method | Path | Body / query | Returns |
|--------|------|--------------|---------|
| GET | `/health` | — | `{ ok, service }` |
| GET | `/kpi` | — | `{ ok, kpi, values }` (efficiencies, conformity, specificEnergy) |
| GET | `/report` | — | `{ ok, loads, efficiencies, conformity, compliant }` (live snapshot balance) |
| POST | `/control` | `{ equipment, action }` | `{ ok, equipment, action }` |

`action` ∈ `start | stop | auto | manual`. `equipment` must be one of the known
ids (validated server-side against the equipment whitelist).

## Backend registration

The controller/route are mirrored into the webserver's `src/modules/poseidon/`
and mounted automatically at `/api/poseidon` by `webserver/src/wui-module-routes.ts`
(no edit to `customerRoutes.ts`). The module descriptor `index.ts` (with
`{ mount: '/api/poseidon', routes: () => PoseidonRoute.routes() }`) is created
once by the page installer; `deploy-backend.mjs` refuses to copy the route
sources until that descriptor exists.

## Keeping the model in sync

The equipment inventory and the sensor/threshold model are declared **twice on
purpose** (frontend `src/poseidon/model.ts`, manager `index.js`, controller
whitelist) because the three run in different runtimes. When you add or rename a
device or a sensor, update all three.
