# wui-machine-sim — design & architecture notes

Optional module that owns the **`machineSim` manager**, the production simulator of the
Machine Fleet 3D ateliers. Until `machine-fleet-3d` 0.2.0 the manager lived in that module and
was deployed and auto-started (`always`) with the 3D page: selecting the page on a production
site — only to embed `<wui-fleet-3d-view>` in another module — created `MachineSim_*`
datapoints, re-linked every atelier's machines to them and wrote values continuously. Hence a
module of its own (the `fleet-kpi-analysis` / `kpiCalc` pattern), a `manual` progs line, and
AUTO_MAP off by default.

## Why a page

A wui-toolkit module is a lib with a page entry (`src/<id>.ts`); without one the lib is a kit,
and a kit's managers are deployed only when a selected module lists them by name. The page is
therefore kept small, hidden (`/machine-sim`) and read-only: a warning, the AUTO_MAP opt-in,
and the simulated machines (`dpNames('MachineSim_*.state')` + one `dpConnect` on their `.state`
and `.comm`). It declares one role, `view` (registered by the page, open until an admin assigns
groups), and so requires `para` and `app-security` like every page using `wui-kit`'s role
registration.

## The manager (`managers/machineSim/`)

WinCC OA JavaScript manager (winccoa-manager), no REST route. progs: `manual`
(`wuiPage.backend.progs`), so a deployment never starts it.

- `model.js` — the pure part, unit-tested in `test/model.spec.mjs`: parameter sets per process
  family, `autoMapEnabled(argv, env)`, `planAtelier(atelier, autoMap)` (the machines to simulate
  and, with AUTO_MAP, the atelier wired to them).
- `index.js` — the WinCC OA side: the `MachineSim` type (created, else reconciled with
  `dpTypeChange`), one `MachineSim_<sanitize(machineId)>` DP per machine of every
  `MachineFleet3D_Config` atelier (read once, at startup), the atelier written back only when
  `planAtelier` changed it, then the two simulation loops.
- **AUTO_MAP** (opt-in: `--auto-map` in the progs options, or `MACHINE_SIM_AUTO_MAP=1|true|yes|on`):
  non-destructive — only machines without `stateDp` are wired (state, cause, work order,
  operation, comm, the KPIs of their family — `resolveFamily`: explicit `process`, else type,
  else existing KPI keys, else generic) and the `default` state mapping is added to the atelier
  when missing; a `basculeur` gets `tiltDp` → `.angle` and its `vitesse` unit `°/s` even when
  already bound. Off, no atelier is ever written.
- `cause` is a **String** (not Int) so any catalog code can be emitted; the catalog
  (`MachineFleet3D_StopCauses`) is **reloaded before each state tick**; `pickCause()` emits a
  valid code ~90 % of the time and an **out-of-catalog (erroneous) code** ~10 %
  (`ERRONEOUS_CAUSE_PROB`), so the page's "unknown code → default cause" is exercised.
  `isDefault` entries are excluded from the emittable set; `causeCodes` starts **empty** → `''`
  until the catalog loads (legacy numeric codes 1–5 from the Int era may remain in old history).
- Parameter sets: generic `[cadence, temperature, vitesse, charge]`, usinage
  `[programme, outil, broche, avance]`, soudage `[tension, intensite, vitesseSoudage]`;
  **every** machine simulates the union (`ALL_PARAMS`) so any KPI binding resolves. Discrete
  (`programme` / `outil`) = String, analog = Float. `avance = broche × feedPerRev`.
  `basculeur.angle` = triangle 0→90° in 30 s, its `vitesse` = angular velocity °/s.
- Cadence: state / cause / work order / operation / comm every 30 s, parameters every 500 ms.
  The 3D page's machine dashboard ignores the 30 s rewrites that do not change state or cause.

## Pitfalls

- **Archiving**: `MachineSim.state` **and** `.cause` must be NGA-archived for the Gantt, the
  Pareto and the stop / KPI analyses (`.cause` lost its config once after the `dpTypeChange`
  Int→String and had to be re-enabled on the demo project). Without `.cause` archiving there is
  no cause history.
- `--auto-map` reaches the manager through `process.argv` (the progs options after the script);
  the environment variable is the fallback.
- Other pages that know the simulator's naming: `thermal-reports` proposes
  `MachineSim_<machine>.temperature` as the default furnace curve, the `report-builder` demo
  binds `MachineSim_four1.temperature`, the `machine-fleet-*` dashboard widgets document
  `MachineSim_<machine>.state` / `.cause` as examples. All of them work on real datapoints too.
