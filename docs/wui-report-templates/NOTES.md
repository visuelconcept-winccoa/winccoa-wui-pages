# wui-report-templates — business & architecture notes

## Domain / object

Standalone **Report Templates** page (route `/report-templates`): editor for reusable, configurable **report templates**. It is the *generic, parameterizable* version of the hardcoded TTD page (thermal-reports).

- Element `wui-report-templates`, class `WuiReportTemplates`, entry `report-templates.ts`. Sub-component prefix: `rb-`.
- Displays a template list + an in-place modal editor `rb-template-editor`. Editing is gated by `canPublish`.
- A template describes the structure of a report: a sequence of **parameterized sections** + a **multi-level signature workflow**. It holds no operational data: it is the `Report` *instances* (Reports page `/report-builder`, separate package) that snapshot the template's `sections`+`workflow` at their creation and carry the entered data.
- Reports / Templates split into **two independent pages**: historically a single component with a segmented Reports|Templates switch shared a single `deleting` state → phantom "delete template undefined" bug on view switch. Each component now has its own `deletingId: string|null`.

## Data model (DPs)

Tier 1: frontend-only persistence (PARA-REST + offline fallback), **no backend manager**. 1 DP per entity, Struct `name`+`json`.

- **`ReportTemplate`** — DP type `ReportBuilder_Template`, prefix `ReportBuilder_Template_`. Reusable entity, contains:
  - `sections: TemplateSection[]`
  - `workflow: WorkflowState[]`
- (For reference, an entity managed by the Reports page, outside this package: **`Report`** = type `ReportBuilder_Report`, which *snapshots* the template's `sections`+`workflow` at creation.)

On the shared-code side: generic base `DpJsonStore<T extends {id; dp}>` (`data/dp-json-store.ts`); `template-store.ts` is a thin subclass of it. Template helpers in `types.ts` (blank-structure factories, `instantiateReport`, `fieldConform`, `uid`, `nowLocal`).

### Section types (`TemplateSection.kind`, discriminated union)

- `text` — text block.
- `comment` — free comment.
- `fields` — key/value pairs (`FieldDef`) with optional numeric `min`/`max` → `fieldConform` produces an OK / Out-of-tolerance chip.
- `table` — configurable columns (`ColumnDef`), rows entered by the operator in the instance.
- `dataset` — `DatasetDef` = a DP + a list of aggregation operations `ops[]`. In the instance, "Refresh" reads the archives over the report's period and freezes the aggregations; optional chart `rb-dataset-chart` (echarts line, self-contained, `getImageDataUrl()` for printing).
- `checklist` — items; those marked `required` gate the signature.

## Key algorithms / formulas

- **Field conformity**: `fieldConform` → OK if `min ≤ value ≤ max` (optional bounds), otherwise Out-of-tolerance.
- **Multi-level workflow** (the core feature): ordered `WorkflowState[]`. Each non-final state carries `advance: SignOff { toStateId, actionLabel, roleLabel, level, requirePermission, requireChecklist }` → one signature level, arbitrary number of levels.
  - Default workflow: `Draft →[L1 Operator]→ Verified →[L2 Manager, requireChecklist]→ Approved`, plus a `Rejected` state.
  - Helpers (`engine.ts`, shared): `currentState`, `isLocked`, `checklistComplete`, `canAdvance`, `applySignature`, `applyReject`. `canAdvance` is gated by `canPublish` (+ checklist if `requireChecklist`). The final state ⇒ `isLocked` ⇒ read-only report.
- **Dataset aggregation** (instance side, shared): `computeDataset` → `readSeries` via `dpGetPeriod(... ':_original.._value')` then aggregate in a loop: avg / min / max / sum / last / count / stddev. Computed **client-side** from the archives (like TTD), no server task.

## Pitfalls / good to know

- **Editing gated by `canPublish`**: the logged-in user and their rights come from `WuiUserService` (`.name` / `.id` / `.canPublish`, `user$` subscription) — same mechanism as fleet / ai-assistant permissions. Signatures = name + ISO timestamp + permission (no cryptographic signature).
- **Action column revealed on hover**: in `rb-template-table`, the per-row icons (edit / duplicate / trash) are in `.actions-col`, hidden by default (`opacity:0; pointer-events:none`), visible and clickable only on `tr:hover` / `:focus-within` (`table-styles.ts`). Accidental-deletion fix: previously, clicking to the right of a row to open it could land on the always-visible trash and trigger the delete confirmation; now those clicks "fall through" to the open action.
- **Snapshot at report creation**: later edits to a template never alter an already-created/signed report (the instance freezes `sections`+`workflow`). Keep this in mind for any evolution of the data model.
- **Reused shared components**: `rb-template-editor` is tabbed (Sections | Workflow), reuses `mf-dp-input` (from machine-fleet-3d) to enter a dataset's DP, and a `move()` / patch-by-index pattern for add/remove/reorder. Shared styles `dialog-styles.ts` / `table-styles.ts`.
- **Not done / known limits**: i18n of the FR labels; scheduled server-side aggregation; PDF / email export; cryptographic electronic signature.

## Application Security (roles — added 2026-07)

The page declares 2 roles (self-registration in `report-templates.ts`
`connectedCallback` + mirrored in the app-security manifest): `view`, `edit`.
All OPEN until an admin assigns groups in `/app-security`
(docs/wui-app-security/INTEGRATION.md).

- **`view`** — gates the page body: without the grant the header stays but the
  body is replaced by a muted forbidden notice (`MSG.roleForbidden`, i18n.ts);
  the editor modal and delete dialog are not rendered either.
- **`edit`** — gates the template mutations: hides the toolbar **Import** and
  **New template** buttons and the empty-state **Generate demo** button, and
  composes with the existing `canPublish` permission into the `canEdit` prop of
  `rb-template-table` (duplicate/delete actions, edit icon becomes view-only)
  and `rb-template-editor` (read-only editor, no Save). JSON **export** and the
  Reports navigation stay open — they only read. A live revocation closes a
  new-template editor and any pending delete confirmation.
- Tier 1 module (no backend manager) → UI gating only; persistence goes through
  the shared PARA REST DP-JSON API, which is deliberately not gated per-module
  (see docs/wui-para/NOTES.md).
