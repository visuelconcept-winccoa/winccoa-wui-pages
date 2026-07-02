# Poseidon — design notes

## Why a simulator manager (Tier 3)

Poseidon was requested with **simulated data** and **equipment control**. The
`poseidon` JavaScript manager plays both roles: it owns the data model (so the
page has something live to read on a bare project) and it closes the control
loop (it reads the `.mode`/`.cmd` an operator writes and reacts). This mirrors
the `machineSim` pattern already used by the Machine Fleet page.

Control is routed through `/api/poseidon/control` (server-side `dpSetWait`)
rather than a direct browser `dpSet`, matching the repo convention that browser
clients mutate datapoints through a backend module (see `paraController`).

## Process coupling (what makes the simulation "believable")

The sensors are not independent random walks — they are coupled to the running
equipment, so operator actions and faults visibly change the process:

- **Aeration → dissolved oxygen**: running blowers pull `bio.do` toward a
  setpoint (~2 mg/L, blower load modulated by the DO error); stop them and DO
  decays and `redox` goes negative (anoxic).
- **DO + separation → effluent quality**: `outlet.tss/turbidity/cod/nh4` degrade
  when DO is unhealthy or when the clarifier separation is lost (RAS pump or
  scraper stopped). Nitrification (`nh4`↓, `no3`↑) tracks DO health.
- **Inflow**: a diurnal pattern (low at night, morning/evening peaks) drives
  loads; the number of lift pumps auto-mode wants tracks the inflow.
- **Energy**: `energy.power` is the sum of running-device draw scaled by load;
  `energy.energyToday` integrates it.

Faults are injected with a small per-tick probability on running devices and
auto-clear after a while, so the Alarms and Equipment tabs have live faults to
show without any manual poking.

## Alarm engine (client-side)

Alarms are derived in `src/poseidon/alarms.ts` from the live snapshots, not
stored. `firstSeen` (onset time) and `acked` (acknowledged ids) live in the shell
so an alarm keeps its onset/ack across refreshes; ids that clear are pruned so a
re-occurrence starts fresh. A legal discharge-limit breach is **high** severity;
an operating-band drift (e.g. DO) is a **warning**.

## Units & i18n

All sensor labels/units and equipment names are declared once in
`src/poseidon/model.ts` (labels are `MultiLangString`, EN/FR/DE) and reused by
every view, so the DP wiring, units and conformity limits stay consistent. UI
strings are in `src/poseidon/i18n.ts`.

## Icons

iX icon names are restricted to ones already used elsewhere in the repo
(`cogwheel`, `refresh`, `list`, `export`, `star-filled`, …). An unknown iX icon
renders blank (non-fatal) but was avoided. The menu/tile icon is `droplet`.

## Not done yet / possible next steps

- **Regulatory report over a period**: `/api/poseidon/report` currently returns a
  live snapshot balance. A true time-averaged bilan would read `dpGetPeriod`
  server-side (or reuse the Report Builder module).
- **Setpoint control**: the equipment DP has a `setpoint`, but the UI exposes
  only start/stop/auto-manual today; a slider (e.g. blower airflow / DO setpoint)
  would be the natural extension.
- **Per-plant scaling**: the model is a single `Poseidon_Station`. Multiple
  plants would key the DPs per site and add a plant selector.
