<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-fleet-core

## 0.2.1 — 2026-11-05

- `opening-view.ts` (#70): opening view types and bounds, the module settings
  (`MachineFleet3D_Settings`), the opening order (`resolveOpeningView`), and the pure framing of a
  box of symbols for a mode, a tilt, a front side and a margin (`frameOpeningView`, unit-tested).
- `Atelier.opening` (front side, own view); `FleetStore.readModuleSettings` /
  `saveModuleSettings` (through `/api/fleet`, traced in `AuditTrail_Fleet`).

## 0.2.0 — 2026-11-04 (SDS 2.2)

**Upgrade.** The pages using this kit move to `^0.2.0` together (machine-fleet-3d 0.4.0,
fleet-closures / fleet-kpi-analysis / fleet-stop-analysis 0.2.0, production-orders /
thermal-reports 0.1.2).

- **States**: a state mapping may declare its own states (key, label, colour, producing or
  not) — five-state supervisions (SL-ETA-01); a state may be taken **out of the opening
  time** (`outsideOpening`, SL-TRS-01). Without them, the four built-in states apply as before.
- **Minimum stop per machine** (`MachineDef.minStopSec`): shorter non-producing periods count
  as production (SL-TRS-01, SL-TDB-03/04).
- **Stop causes** are classified planned or unplanned; a cause already classified
  "production" keeps its class (data unchanged) (SL-ARR-01).
- **Closures**: a global set of non-worked periods (`ClosureConfig.global`), a machine's
  effective set being global ∪ atelier ∪ machine (SL-TRS-02).
- **Writes checked on the server**: `FleetStore` writes through `/api/fleet`
  (wui-fleet-closures) when it answers — each write checked against its role (SL-NF-10) —,
  else through `/api/para` as before.
- **User settings**: `user-settings.ts` / `fleet-settings-service.ts` keep each user's
  filters, bubbles, display toggles and selections in their WinCC OA user settings
  (`_usr_<id>_WUI_MF_*`, through `/api/ai/fleet/settings` of machine-fleet-3d); the choices a
  browser kept move to the account on first load. `user-views.ts`: personal viewpoints and
  default page (#60).
- **No work-centre notion** (#66): the tag dimensions Îlot / Workcenter are neither offered
  nor filtered on; `MachineDef.group` is gone.
- Dialogs no longer close when a text selection is released outside their panel (#54).

Earlier versions: see the git history (`libs/wui-fleet-core`).
