# wui-report-builder — business & architecture notes

Generic, configurable version of the thermal-reports (TTD) page, whose mechanisms it
reuses (1-DP persistence, client-side archive reading, printing). Tier 1: no
dedicated backend or manager (see `module.json`). npm dep: `@siemens/ix-echarts`.
Sub-component prefix: `rb-`.

## Domain / object

Build configurable reports from parameterizable **templates**, then
fill in **reports** (instances) with a **multi-level signature** workflow locked
by a checklist.

**Two independent routed pages** (deliberately separated, see Pitfalls):
- **Reports** — entry `report-builder.ts`, element `wui-report-builder`, class `WuiReportBuilder`.
  Routes `/report-builder` (list) + `/report-builder/:reportid` (detail). **Each report has its
  own URL**: `@property({attribute:'reportid'}) reportId` drives `selectedReport()`; opening a
  report emits `RouterEvent('/report-builder/<id>')`, back = `RouterEvent('/report-builder')`,
  creation → navigation to the new id (same routed pattern as the remote-vnc / `connectionid`
  page). Reads templates read-only for the creation dialog.
- **Templates** — entry `report-templates.ts`, element `wui-report-templates`, class
  `WuiReportTemplates`. Route `/report-templates`. List + `rb-template-editor` modal (editing gated
  by `canPublish`).
- Menu: two entries (Reports `/report-builder` icon `document`; Report Templates
  `/report-templates` icon `list`) + hidden route `/report-builder/:reportid`. Cross-links between
  the two pages via `RouterEvent` toolbar buttons.

**Section kinds** (`TemplateSection.kind`, discriminated union):
- `text` — free text.
- `comment` — comment.
- `fields` — key/value pairs (`FieldDef`) with optional numeric min/max → `fieldConform`
  returns an OK / Out-of-tolerance chip.
- `table` — configurable columns (`ColumnDef`), rows entered by the operator.
- `dataset` — `DatasetDef = dp + ops[]`; the **"Actualiser"** (refresh) button reads the archives over `report.period`
  and freezes the aggregations; optional echarts line chart `rb-dataset-chart` (self-contained, exposes
  `getImageDataUrl()` for printing).
- `checklist` — items; `required` items gate the signature.

## Data model (DPs)

**Two persisted entities**, each 1 DP (Struct `name` + `json`, PARA-REST + offline fallback —
mechanism identical to thermal-reports).

- **`ReportTemplate`** — DP type `ReportBuilder_Template`, prefix `ReportBuilder_Template_`.
  Reusable: `sections: TemplateSection[]` + `workflow: WorkflowState[]`.
- **`Report`** — DP type `ReportBuilder_Report`, prefix `ReportBuilder_Report_`. An instance.
  **Snapshots** the template's `sections` + `workflow` at creation (`instantiateReport`), so that
  later edits to the template never alter a signed report. Contains
  `data: Record<sectionId, SectionData>`, `currentStateId`, `signatures: SignatureRecord[]`, `period`.

Generic storage: `data/dp-json-store.ts` = base `DpJsonStore<T extends {id;dp}>`;
`template-store.ts` / `report-store.ts` = thin subclasses; `io.ts` = JSON ± CSV import/export.

## Key algorithms / formulas

- **Dataset aggregation** (`engine.ts > computeDataset`): `readSeries` reads the archive via
  `dpGetPeriod(... ':_original.._value')` over the report's `period`, then aggregates in a loop:
  `avg` / `min` / `max` / `sum` / `last` / `count` / `stddev`. **Client-side**, from the archives
  (like TTD) — no server-side aggregation.
- **Field conformity**: `fieldConform(value, min, max)` → OK / Out-of-tolerance.
- **Multi-level workflow + signatures** (the core of the requirement): ordered `WorkflowState[]`;
  each non-final state defines a signature level via
  `advance: SignOff {toStateId, actionLabel, roleLabel, level, requirePermission, requireChecklist}`
  → arbitrary number of levels. Default workflow:
  "Brouillon" (Draft) →[L1 "Opérateur" (Operator)]→ "Vérifié" (Verified) →[L2 "Responsable" (Manager), `requireChecklist`]→ "Approuvé" (Approved), + "Rejeté" (Rejected).
  Helpers: `currentState` / `isLocked` / `checklistComplete` / `canAdvance` / `applySignature` /
  `applyReject`. `canAdvance` is gated by `canPublish` (+ checklist); `applySignature` records
  **the logged-in user** (`WuiUserService.name`/`id`) + ISO timestamp + comment (via
  `rb-signature-dialog`) then advances. **Final state ⇒ `isLocked` ⇒ read-only report.**

## Pitfalls / good to know

- **Two separate components, not a toggle.** The former single page with a segmented
  Reports|Templates toggle shared a single `deleting` state, which produced a spurious
  "delete template undefined" on view switch. Splitting into two components, each with
  its own `deletingId: string | null`, fixed the bug.
- **Row actions revealed on hover.** The per-row icons (edit/duplicate/trash) live in
  `.actions-col`, hidden by default (`opacity:0; pointer-events:none`) and made visible/clickable
  only on `tr:hover` / `:focus-within` (`table-styles.ts`). Without this, a click on the right part
  of a row (to open it) could land on the always-visible trash and trigger an accidental
  deletion. Now those clicks fall through to "open".
- **Snapshot at creation.** A report freezes the template's `sections` + `workflow`; never assume
  a report reflects the template's current state.
- **User / permission** resolved from `WuiUserService` (`.name` / `.id` / `.canPublish`,
  `user$` subscription) — same mechanism as ai-assistant / fleet permissions. Template editing and
  workflow advancement are gated by `canPublish`.
- **Printing** (`print.ts`): HTML per kind + signatures block + chart PNGs; reuses TTD's
  `PRINT_SCRIPT` fix (print **after** images have decoded).
- **`mf-dp-input` reused** from machine-fleet-3d for dataset DP entry (`move()` /
  patch-by-index pattern in `rb-template-editor`).
- **Not (yet) done**: i18n of the FR labels; scheduled server-side aggregation; PDF / email;
  cryptographic electronic signature (signatures = name + timestamp + permission, with no
  cryptographic proof).
