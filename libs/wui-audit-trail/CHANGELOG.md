<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-audit-trail

## 0.2.0 — 2026-11-12

- **Range pickers** (#77): the start / end of the custom interval use the standard Siemens iX
  `ix-datetime-input` (calendar + time popup, format `yyyy/LL/dd HH:mm:ss`, week numbers,
  weeks from Monday) instead of the browser's `datetime-local` fields. The start cannot be
  picked after the end's day and conversely; an inverted range is put back in order.
- Seconds are kept: `rangeStart` / `rangeEnd` are stored as local `YYYY-MM-DDTHH:mm:ss`.
  No change of shape of `AuditTrail_Config`: bounds saved without seconds are still read, and
  older bundles read the new ones.

## 0.1.1

- Earlier versions: see the git history.
