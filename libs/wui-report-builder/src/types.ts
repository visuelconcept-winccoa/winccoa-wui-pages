// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domain model for the configurable Report Builder.
 *
 * Two persisted entities:
 *  - {@link ReportTemplate} — a REUSABLE definition: an ordered list of
 *    parameterised {@link TemplateSection}s (text, comment, key/value fields,
 *    manual table, datapoint dataset+aggregation, checklist) plus a configurable
 *    state {@link WorkflowState} workflow whose transitions require signatures at
 *    given levels/roles.
 *  - {@link Report} — an INSTANCE created from a template: it snapshots the
 *    template structure (so later template edits never alter a signed report),
 *    holds the filled-in {@link SectionData}, the current workflow state and the
 *    collected {@link SignatureRecord}s.
 *
 * Both are persisted as one WinCC OA datapoint each (Struct name+json), mirroring
 * the thermal-reports / asset-lifecycle stores.
 */

export type SectionKind = 'text' | 'comment' | 'fields' | 'table' | 'dataset' | 'checklist';
export type FieldType = 'text' | 'number' | 'date';
export type AggOp = 'avg' | 'min' | 'max' | 'sum' | 'last' | 'count' | 'stddev';
export type StateKind = 'start' | 'intermediate' | 'final' | 'rejected';

export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  text: 'Texte libre',
  comment: 'Zone de commentaire',
  fields: 'Champs clé/valeur',
  table: 'Tableau manuel',
  dataset: 'Données (datapoints)',
  checklist: 'Checklist'
};

export const SECTION_KIND_ICONS: Record<SectionKind, string> = {
  text: 'document',
  comment: 'chat',
  fields: 'list',
  table: 'table',
  dataset: 'analysis',
  checklist: 'checkboxes'
};

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texte',
  number: 'Nombre',
  date: 'Date'
};

export const AGG_LABELS: Record<AggOp, string> = {
  avg: 'Moyenne',
  min: 'Minimum',
  max: 'Maximum',
  sum: 'Somme',
  last: 'Dernière valeur',
  count: 'Nombre de points',
  stddev: 'Écart-type'
};

export const AGG_OPS: AggOp[] = ['avg', 'min', 'max', 'sum', 'last', 'count', 'stddev'];

export const STATE_KIND_LABELS: Record<StateKind, string> = {
  start: 'Initial',
  intermediate: 'Intermédiaire',
  final: 'Final (verrouillé)',
  rejected: 'Rejeté'
};

export const STATE_COLORS: Record<StateKind, string> = {
  start: '#94a3b8',
  intermediate: '#0ea5e9',
  final: '#10b981',
  rejected: '#ef4444'
};

// --- template structure -----------------------------------------------------

/** A key/value field definition (with optional numeric conformity bounds). */
export interface FieldDef {
  id: string;
  label: string;
  unit: string;
  type: FieldType;
  min: number | null;
  max: number | null;
}

/** A manual-table column. */
export interface ColumnDef {
  id: string;
  label: string;
  type: FieldType;
}

/** A datapoint dataset: read its archived history over the report period and aggregate. */
export interface DatasetDef {
  id: string;
  label: string;
  dp: string;
  ops: AggOp[];
}

/** A checklist item; `required` ones gate signing when a transition demands it. */
export interface ChecklistItem {
  id: string;
  label: string;
  required: boolean;
}

/** One parameterised report section (discriminated by {@link SectionKind}). */
export interface TemplateSection {
  id: string;
  title: string;
  kind: SectionKind;
  /** text / comment placeholder. */
  placeholder?: string;
  /** fields. */
  fields?: FieldDef[];
  /** table. */
  columns?: ColumnDef[];
  /** dataset. */
  datasets?: DatasetDef[];
  chart?: boolean;
  /** checklist. */
  items?: ChecklistItem[];
}

/** Forward sign-off attached to a workflow state (defines a signature level). */
export interface SignOff {
  toStateId: string;
  actionLabel: string;
  roleLabel: string;
  level: number;
  requirePermission: boolean;
  requireChecklist: boolean;
}

/** Optional backward transition (reject / send back), no signature required. */
export interface RejectTransition {
  toStateId: string;
  actionLabel: string;
}

/** One configurable workflow state. */
export interface WorkflowState {
  id: string;
  label: string;
  color: string;
  kind: StateKind;
  advance?: SignOff;
  reject?: RejectTransition;
}

export interface ReportTemplate {
  id: string;
  dp: string;
  name: string;
  description: string;
  sections: TemplateSection[];
  workflow: WorkflowState[];
  updatedAt: string;
  updatedBy: string;
}

// --- report instance --------------------------------------------------------

/** Aggregated result for one dataset, snapshotted at compute time. */
export interface DatasetResult {
  agg: Partial<Record<AggOp, number>>;
  n: number;
  computedAt: string;
}

/** Filled-in data for one section (only the keys for its kind are used). */
export interface SectionData {
  content?: string;
  values?: Record<string, string>;
  rows?: Record<string, string>[];
  results?: Record<string, DatasetResult>;
  checked?: Record<string, boolean>;
}

export interface ReportPeriod {
  /** Local datetime `YYYY-MM-DDTHH:mm`. */
  start: string;
  end: string;
}

/** One recorded signature (connected user + role/level + timestamp + comment). */
export interface SignatureRecord {
  id: string;
  fromStateId: string;
  toStateId: string;
  level: number;
  roleLabel: string;
  signerName: string;
  signerId: string;
  /** ISO timestamp. */
  timestamp: string;
  comment: string;
}

export interface Report {
  id: string;
  dp: string;
  templateId: string;
  templateName: string;
  reportNo: string;
  title: string;
  subject: string;
  period: ReportPeriod;
  /** Snapshot of the template at creation — keeps signed reports immutable. */
  sections: TemplateSection[];
  workflow: WorkflowState[];
  /** Section data keyed by section id. */
  data: Record<string, SectionData>;
  currentStateId: string;
  signatures: SignatureRecord[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// --- id + time helpers ------------------------------------------------------

const ID_RADIX = 36;
let idCounter = 0;

/** Short unique id (session-stable, no crypto needed). */
export function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(ID_RADIX)}-${idCounter.toString(ID_RADIX)}`;
}

const PAD = 2;
function pad(n: number): string {
  return String(n).padStart(PAD, '0');
}

/** Local-datetime string (`YYYY-MM-DDTHH:mm`) for "now". */
export function nowLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SLUG_MAX = 28;
export function sanitizeId(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')
      .slice(0, SLUG_MAX) || 'report'
  );
}

// --- blank factories --------------------------------------------------------

export function blankSection(kind: SectionKind): TemplateSection {
  const base: TemplateSection = { id: uid('sec'), title: SECTION_KIND_LABELS[kind], kind };
  switch (kind) {
    case 'text':
    case 'comment': {
      return { ...base, placeholder: '' };
    }
    case 'fields': {
      return { ...base, fields: [blankField()] };
    }
    case 'table': {
      return { ...base, columns: [blankColumn(), blankColumn()] };
    }
    case 'dataset': {
      return { ...base, datasets: [blankDataset()], chart: true };
    }
    case 'checklist': {
      return { ...base, items: [blankChecklistItem()] };
    }
    default: {
      return base;
    }
  }
}

export function blankField(): FieldDef {
  return { id: uid('fld'), label: 'Champ', unit: '', type: 'text', min: null, max: null };
}

export function blankColumn(): ColumnDef {
  return { id: uid('col'), label: 'Colonne', type: 'text' };
}

export function blankDataset(): DatasetDef {
  return { id: uid('ds'), label: 'Mesure', dp: '', ops: ['avg', 'min', 'max'] };
}

export function blankChecklistItem(): ChecklistItem {
  return { id: uid('chk'), label: 'Point à vérifier', required: true };
}

/** A sensible default 4-state workflow with two signature levels + a reject path. */
export function defaultWorkflow(): WorkflowState[] {
  const draft = uid('st');
  const checked = uid('st');
  const approved = uid('st');
  const rejected = uid('st');
  return [
    {
      id: draft,
      label: 'Brouillon',
      color: STATE_COLORS.start,
      kind: 'start',
      advance: {
        toStateId: checked,
        actionLabel: 'Vérifier & signer',
        roleLabel: 'Opérateur',
        level: 1,
        requirePermission: true,
        requireChecklist: false
      }
    },
    {
      id: checked,
      label: 'Vérifié',
      color: STATE_COLORS.intermediate,
      kind: 'intermediate',
      advance: {
        toStateId: approved,
        actionLabel: 'Approuver & signer',
        roleLabel: 'Responsable',
        level: 2,
        requirePermission: true,
        requireChecklist: true
      },
      reject: { toStateId: rejected, actionLabel: 'Rejeter' }
    },
    { id: approved, label: 'Approuvé', color: STATE_COLORS.final, kind: 'final' },
    {
      id: rejected,
      label: 'Rejeté',
      color: STATE_COLORS.rejected,
      kind: 'rejected',
      reject: { toStateId: draft, actionLabel: 'Renvoyer en brouillon' }
    }
  ];
}

export function blankTemplate(): ReportTemplate {
  return {
    id: '',
    dp: '',
    name: '',
    description: '',
    sections: [],
    workflow: defaultWorkflow(),
    updatedAt: '',
    updatedBy: ''
  };
}

/** Build an empty {@link SectionData} shell matching a section's kind. */
export function emptySectionData(section: TemplateSection): SectionData {
  switch (section.kind) {
    case 'text':
    case 'comment': {
      return { content: '' };
    }
    case 'fields': {
      return { values: {} };
    }
    case 'table': {
      return { rows: [] };
    }
    case 'dataset': {
      return { results: {} };
    }
    case 'checklist': {
      return { checked: {} };
    }
    default: {
      return {};
    }
  }
}

/** Instantiate a fresh report from a template (snapshots structure + empty data). */
export function instantiateReport(template: ReportTemplate): Report {
  const sections = structuredClone(template.sections);
  const workflow = structuredClone(template.workflow);
  const data: Record<string, SectionData> = {};
  for (const section of sections) data[section.id] = emptySectionData(section);
  return {
    id: '',
    dp: '',
    templateId: template.id,
    templateName: template.name,
    reportNo: '',
    title: '',
    subject: '',
    period: { start: '', end: '' },
    sections,
    workflow,
    data,
    currentStateId: workflow[0]?.id ?? '',
    signatures: [],
    createdBy: '',
    createdAt: '',
    updatedAt: ''
  };
}

/** `true`/`false` conformity for a numeric field with bounds; `null` when N/A. */
export function fieldConform(field: FieldDef, raw: string | undefined): boolean | null {
  if (field.type !== 'number' || (field.min == null && field.max == null)) return null;
  const v = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(v)) return null;
  const belowMin = field.min != null && v < field.min;
  const aboveMax = field.max != null && v > field.max;
  return !belowMin && !aboveMax;
}
