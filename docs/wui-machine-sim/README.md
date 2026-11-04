# @visuelconcept-winccoa/wui-machine-sim — optional simulator module

The **production simulator** of the [Machine Fleet 3D](../wui-machine-fleet-3d/README.md)
ateliers, as a module of its own: select it on a demo, training or commissioning project
to see the fleet move; leave it out everywhere else. It is to `machine-fleet-3d` what
[`fleet-kpi-analysis`](../wui-fleet-kpi-analysis/README.md) is for the live KPIs: a
complementary module, never deployed with the 3D page.

> **Not for a production system.** The `machineSim` manager creates a `MachineSim` datapoint
> type and one `MachineSim_<machine>` datapoint per atelier machine, and writes their values
> continuously (state and stop cause every 30 s, parameters every 500 ms).

What it ships:

- the **`machineSim` manager** (`managers/machineSim/`, WinCC OA JavaScript manager, no REST
  route), registered in `config/progs` as **`manual`**: deploying the module never starts it;
- a small **hidden status page** (`/machine-sim`, role `view`): the warning above, how AUTO_MAP
  is turned on, and the simulated machines with their live state and communication bit. A
  wui-toolkit module needs a page to be selected and deployed (a lib without `src/<id>.ts` is a
  kit, whose managers nothing deploys); this one writes nothing.

## AUTO_MAP — off by default

With AUTO_MAP the manager **rewrites the ateliers**: every machine that has no state binding yet
(`stateDp` empty) is wired to its `MachineSim_<machine>` elements (state, cause, work order,
operation, communication, the parameters of its process family) and the atelier is saved back;
a `basculeur`'s tilt is pointed at its `.angle` even when it is bound. A machine the user
already bound keeps its bindings.

It is **opt-in**, so that installing the simulator never re-links real ateliers silently:

- add `--auto-map` to the manager's options in the WinCC OA console — the `config/progs` line
  becomes `node | manual | 30 | 2 | 2 |machineSim/index.js --auto-map`;
- or set `MACHINE_SIM_AUTO_MAP=1` in the manager's environment.

Without it the manager only creates and drives its own datapoints: bind a machine by hand in
the 3D page's machine dialog (state `MachineSim_<id>.state`, cause `MachineSim_<id>.cause`,
parameters `MachineSim_<id>.<element>`). The manager logs which mode it runs in at startup.
The ateliers are read once, at startup: restart the manager after adding machines.

## Install
In the WinCC OA project's site (`<project>/web`), once the target is equipped
(`npx wui init target prod`):
```powershell
npx wui use machine-sim
npx wui build prod
npx wui check prod
```
`wui build` (1) compiles the status page, (2) adds its hidden menu entry, (3) deploys the
**`machineSim` manager** → `<project>/javascript/machineSim/` and appends
`node | manual | … |machineSim/index.js` to `config/progs` when missing.

## After install
1. **Manager:** start **`machineSim`** in the WinCC OA console (add `--auto-map` first if you
   want the ateliers wired for you — see above). Set it to `always` if the simulation should
   come back up with the project.
2. **Browser:** DevTools → Application → Storage → **`Clear site data`**, then reload (logged in).
   ⚠️ The service worker caches `menuconfig.json` — **`Ctrl+Shift+R` is NOT enough**.
3. Open `/machine-sim` to check that the simulated machines are listed, then the 3D page.

## Remove
`npx wui remove machine-sim` then `npx wui build prod`: the page and its menu entry go; the
manager is **left in place and listed** with its `config/progs` line — stop it and remove the
line in the console. The `MachineSim_*` datapoints and any AUTO_MAP bindings stay: delete the
datapoints (PARA) and re-bind the machines to their real datapoints.

## Prerequisites
- A **wui-toolkit site** for the target project (`npx wui init target prod` done once).
- Ateliers to simulate: `MachineFleet3D_Config` datapoints, created by the
  [Machine Fleet 3D](../wui-machine-fleet-3d/README.md) page. The simulator does not require
  that page to be selected on the same site, but it has nothing to drive without ateliers.
- **Requires** the `para` and `app-security` backends (`wuiPage.requires`, the status page's role
  registration — deployed headless when those pages are not selected), see
  [module dependencies](../module-dependencies.md).
- `winccoa-manager`, **provided by the WinCC OA runtime** (not in the manager's `package.json`).

## Upgrading from machine-fleet-3d 0.2

`machine-fleet-3d` up to 0.2.0 deployed `machineSim` itself (and started it, `always`). From 0.3.0
it does not: a site that used the simulation selects this module (`npx wui use machine-sim`).
An existing `config/progs` line is kept as it is (`always`, without `--auto-map`): the 0.1.0
manager then runs **without AUTO_MAP** — the ateliers it already wired stay wired; add
`--auto-map` to that line only if new machines must be wired automatically.

## Contents
```
package.json                         npm package; wuiPage (hidden page /machine-sim, manager machineSim, progs manual)
src/machine-sim.ts                   status page (read-only)
src/machine-sim/i18n.ts              its strings (en / fr / de)
src/app-security.roles.json          role view
menu.fragment.jsonc                  menu entry (/machine-sim, hidden)
managers/machineSim/index.js         the manager: DP type + DPs, AUTO_MAP when asked, simulation loop
managers/machineSim/model.js         its pure part: parameters, AUTO_MAP opt-in, atelier wiring
test/model.spec.mjs                  unit tests of model.js (not published, not deployed)
mock/fixtures.json                   wui dev: three simulated machines
```

Design notes: [NOTES.md](NOTES.md).
