<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-production-orders

## 0.1.2 — 2026-11-04

- On wui-fleet-core 0.2.0. **fleet-closures** is declared an optional module: when it is
  deployed, the Fleet store this page uses writes through its `/api/fleet`, each write checked
  on the server by role; otherwise through `/api/para` as before.

Earlier versions: see the git history (`libs/wui-production-orders`).
