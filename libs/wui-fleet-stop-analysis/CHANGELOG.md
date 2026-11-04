<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-fleet-stop-analysis

## 0.2.0 — 2026-11-04 (SDS 2.2)

**Upgrade.** Requires **fleet-closures** (its `/api/fleet` backend, deployed headless when not
selected); machine-fleet-3d is optional (user settings).

- The stop analysis of wui-fleet-core 0.2.0: every non-producing state counts, off-opening
  states and stops shorter than the machine's minimum stop are left out, causes planned or
  unplanned.
- The page's selections follow the user in their WinCC OA user settings.
- The Fleet's writes go through `/api/fleet`, checked on the server by role.

Earlier versions: see the git history (`libs/wui-fleet-stop-analysis`).
