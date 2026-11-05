<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-fleet-core

## 0.3.0 — 2026-11-05 (SDS 2.2)

**Upgrade.** The fleet pages move to `^0.3.0` together (machine-fleet-3d 0.5.0, fleet-closures,
fleet-kpi-analysis and fleet-stop-analysis 0.3.0).

- **Causes given by hand to stops** (`StopQualification`): to a stop without a cause, or in place
  of the one the machine sent, with a mandatory reason. Kept apart from the machine's history in
  `MachineFleet3D_StopQualifications` (`FleetStore.listQualifications` / `saveQualification`,
  traced in the audit trail with the old and new cause and the reason) and laid over that history
  by `applyQualifications`; `analyseStopCauses` takes them as a last argument and marks the stops
  concerned (`qualifiedBy`, `qualifiedAt`).

- **"Îlot" is a filter again**: the îlot (a location in the plant) is one of the filters the
  SDS 2.2 acceptance requires, beside UAP and activity (SL-ORG-01, SL-LOB-05). Only the
  "Workcenter" dimension stays out of the filters (#66).
- Stop causes window: import with the arrow down, export with the arrow up, as in Machine Fleet.

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
