<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-fleet-closures

## 0.2.0 — 2026-11-04 (SDS 2.2)

**Upgrade.** The module now has a **backend**, `/api/fleet`: `wui build` deploys it, restart
the webserver manager. machine-fleet-3d, fleet-kpi-analysis and fleet-stop-analysis
**require** it (deployed headless when the site does not select this page);
production-orders and thermal-reports use it when it is deployed.

- **The Fleet's writes checked on the server by role** (SL-NF-10, SL-MOD-18, SL-ARR-01):
  `/api/fleet` serves the same `dp/set`, `dp/create`, `DELETE dp/:name` and
  `dptype/create` as PARA, restricted to the Fleet's datapoints (`MachineFleet3D*`) and to
  the `_archive` config of a bound datapoint (anything else 403); each write is checked
  against the role it needs (`backend/fleetRules.ts`). Without a session identity the check
  is skipped and logged, as the shared `requireRole` guard does.
- **Global schedule**: a "Global — every machine" scope, listed first; new role
  **`edit-machine`**, which edits one machine's periods only (`edit` still manages all)
  (SL-TRS-02, SL-MOD-18).
- The page's selections follow the user in their WinCC OA user settings (optional module
  machine-fleet-3d, `/api/ai/fleet/settings`; without it, they are not kept).
- Dialogs no longer close when a text selection is released outside their panel (#54).

Earlier versions: see the git history (`libs/wui-fleet-closures`).
