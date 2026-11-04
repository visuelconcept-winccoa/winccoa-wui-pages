<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-fleet-kpi-analysis

## 0.2.0 — 2026-11-04 (SDS 2.2)

**Upgrade.** Requires **fleet-closures** (its `/api/fleet` backend, deployed headless when not
selected); machine-fleet-3d is optional (user settings).

- Opening time = window − closures (global, atelier, machine) − time in off-opening states;
  availability follows the state's producing flag; stops shorter than a machine's minimum
  stop count as production (SL-TRS-01, SL-TRS-02) — in the page and in the `kpiCalc` manager.
- The page's selections follow the user in their WinCC OA user settings.
- The Fleet's writes go through `/api/fleet`, checked on the server by role.

Earlier versions: see the git history (`libs/wui-fleet-kpi-analysis`).
