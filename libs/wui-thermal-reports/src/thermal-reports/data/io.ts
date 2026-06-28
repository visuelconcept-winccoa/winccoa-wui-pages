// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Import / export helpers for the thermal-report list.
 *
 * - JSON export/import round-trips the full {@link ThermalReport} list (canonical
 *   format; re-importing merges by `id`).
 * - CSV export is a flat, spreadsheet-friendly summary (one row per report,
 *   labels resolved, UTF-8 BOM so Excel renders accents). CSV is export-only.
 */
import {
  CONFORMITY_LABELS,
  QUENCH_LABELS,
  STATUS_LABELS,
  TREATMENT_LABELS,
  blankReport,
  type ThermalReport
} from '../types.js';
import { CSV_BOM, JSON_INDENT, csvCell, download, timestampSlug } from '@visuelconcept/wui-kit/data/io.js';

const CSV_COLUMNS: { key: string; label: string }[] = [
  { key: 'reportNo', label: 'N° rapport' },
  { key: 'charge', label: 'N° charge' },
  { key: 'orderNo', label: 'OF' },
  { key: 'part', label: 'Pièce' },
  { key: 'material', label: 'Matière' },
  { key: 'quantity', label: 'Quantité' },
  { key: 'treatmentLabel', label: 'Traitement' },
  { key: 'atmosphere', label: 'Atmosphère' },
  { key: 'quenchLabel', label: 'Trempe' },
  { key: 'atelierName', label: 'Atelier' },
  { key: 'machineName', label: 'Four' },
  { key: 'startTime', label: 'Début cycle' },
  { key: 'endTime', label: 'Fin cycle' },
  { key: 'statusLabel', label: 'Statut' },
  { key: 'conformityLabel', label: 'Conformité' },
  { key: 'operator', label: 'Opérateur' },
  { key: 'notes', label: 'Notes' }
];

/** Download the full report list as a JSON file. */
export function exportJson(reports: ThermalReport[]): void {
  const payload = { kind: 'thermal-reports', version: 1, reports };
  download(
    `thermal-reports-${timestampSlug()}.json`,
    JSON.stringify(payload, null, JSON_INDENT),
    'application/json'
  );
}

/** Download the report list as a CSV summary (labels resolved). */
export function exportCsv(reports: ThermalReport[]): void {
  const rows = [CSV_COLUMNS.map((c) => c.label).join(',')];
  for (const report of reports) {
    const enriched: Record<string, unknown> = {
      ...report,
      treatmentLabel: TREATMENT_LABELS[report.treatment],
      quenchLabel: QUENCH_LABELS[report.quench],
      statusLabel: STATUS_LABELS[report.status],
      conformityLabel: CONFORMITY_LABELS[report.conformity]
    };
    rows.push(CSV_COLUMNS.map((c) => csvCell(enriched[c.key])).join(','));
  }
  download(
    `thermal-reports-${timestampSlug()}.csv`,
    CSV_BOM + rows.join('\r\n'),
    'text/csv;charset=utf-8'
  );
}

/**
 * Parse imported JSON into a normalized report list. Accepts either a bare array
 * or an export envelope (`{ reports: [...] }`). Each field is coerced against
 * {@link blankReport} defaults so partial/foreign records stay valid. Throws when
 * the payload is not parseable JSON or holds no report array.
 */
export function parseReports(text: string): ThermalReport[] {
  const raw: unknown = JSON.parse(text);
  const list = Array.isArray(raw) ? raw : (raw as { reports?: unknown }).reports;
  if (!Array.isArray(list)) {
    throw new TypeError('Format invalide : tableau « reports » introuvable.');
  }
  return list.map((item) => normalize(item as Partial<ThermalReport>));
}

function normalize(item: Partial<ThermalReport>): ThermalReport {
  const base = blankReport();
  const out: ThermalReport = { ...base };
  for (const key of Object.keys(base) as (keyof ThermalReport)[]) {
    if (item[key] !== undefined && item[key] !== null) {
      (out as Record<string, unknown>)[key] = item[key];
    }
  }
  out.quantity = Number(out.quantity) || 0;
  if (!Array.isArray(out.steps)) out.steps = [];
  if (!Array.isArray(out.results)) out.results = [];
  return out;
}
