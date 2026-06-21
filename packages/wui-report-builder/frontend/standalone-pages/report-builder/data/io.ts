/**
 * JSON import/export for templates & reports + a flat CSV summary of the report
 * list. JSON round-trips the full objects (re-import merges by `id`); CSV is
 * export-only (UTF-8 BOM for Excel).
 */
import { defaultWorkflow, type Report, type ReportTemplate } from '../types.js';
import { CSV_BOM, JSON_INDENT, csvCell, download, timestampSlug } from '../_vendor/wui-kit/data/io.js';

export function exportTemplatesJson(templates: ReportTemplate[]): void {
  const payload = { kind: 'report-builder-templates', version: 1, templates };
  download(`report-templates-${timestampSlug()}.json`, JSON.stringify(payload, null, JSON_INDENT), 'application/json');
}

export function exportReportsJson(reports: Report[]): void {
  const payload = { kind: 'report-builder-reports', version: 1, reports };
  download(`reports-${timestampSlug()}.json`, JSON.stringify(payload, null, JSON_INDENT), 'application/json');
}

function normalizeTemplate(item: Partial<ReportTemplate>): ReportTemplate {
  return {
    id: String(item.id ?? ''),
    dp: String(item.dp ?? ''),
    name: String(item.name ?? 'Modèle importé'),
    description: String(item.description ?? ''),
    sections: Array.isArray(item.sections) ? item.sections : [],
    workflow: Array.isArray(item.workflow) && item.workflow.length > 0 ? item.workflow : defaultWorkflow(),
    updatedAt: String(item.updatedAt ?? ''),
    updatedBy: String(item.updatedBy ?? '')
  };
}

function normalizeReport(item: Partial<Report>): Report {
  return {
    id: String(item.id ?? ''),
    dp: String(item.dp ?? ''),
    templateId: String(item.templateId ?? ''),
    templateName: String(item.templateName ?? ''),
    reportNo: String(item.reportNo ?? ''),
    title: String(item.title ?? ''),
    subject: String(item.subject ?? ''),
    period: { start: item.period?.start ?? '', end: item.period?.end ?? '' },
    sections: Array.isArray(item.sections) ? item.sections : [],
    workflow: Array.isArray(item.workflow) ? item.workflow : [],
    data: item.data && typeof item.data === 'object' ? item.data : {},
    currentStateId: String(item.currentStateId ?? ''),
    signatures: Array.isArray(item.signatures) ? item.signatures : [],
    createdBy: String(item.createdBy ?? ''),
    createdAt: String(item.createdAt ?? ''),
    updatedAt: String(item.updatedAt ?? '')
  };
}

export function parseTemplates(text: string): ReportTemplate[] {
  const raw: unknown = JSON.parse(text);
  const list = Array.isArray(raw) ? raw : (raw as { templates?: unknown }).templates;
  if (!Array.isArray(list)) throw new TypeError('Format invalide : tableau « templates » introuvable.');
  return list.map((item) => normalizeTemplate(item as Partial<ReportTemplate>));
}

export function parseReports(text: string): Report[] {
  const raw: unknown = JSON.parse(text);
  const list = Array.isArray(raw) ? raw : (raw as { reports?: unknown }).reports;
  if (!Array.isArray(list)) throw new TypeError('Format invalide : tableau « reports » introuvable.');
  return list.map((item) => normalizeReport(item as Partial<Report>));
}

const CSV_COLUMNS: { key: string; label: string }[] = [
  { key: 'reportNo', label: 'N° rapport' },
  { key: 'title', label: 'Titre' },
  { key: 'subject', label: 'Objet' },
  { key: 'templateName', label: 'Modèle' },
  { key: 'stateLabel', label: 'État' },
  { key: 'signatureCount', label: 'Signatures' },
  { key: 'createdAt', label: 'Créé le' }
];

export function exportReportsCsv(reports: Report[]): void {
  const rows = [CSV_COLUMNS.map((c) => c.label).join(',')];
  for (const report of reports) {
    const stateLabel = report.workflow.find((s) => s.id === report.currentStateId)?.label ?? '';
    const enriched: Record<string, unknown> = {
      ...report,
      stateLabel,
      signatureCount: report.signatures.length
    };
    rows.push(CSV_COLUMNS.map((c) => csvCell(enriched[c.key])).join(','));
  }
  download(`reports-${timestampSlug()}.csv`, CSV_BOM + rows.join('\r\n'), 'text/csv;charset=utf-8');
}
