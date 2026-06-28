// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Export / print helpers for the audit-trail log. The page passes already
 * formatted display rows (`string[][]`, one cell per `AUDIT_FIELDS` column, in
 * order); these helpers add the headers/keys and trigger the download or open a
 * print-friendly window. CSV/JSON download primitives come from the shared kit.
 */
import { CSV_BOM, JSON_INDENT, csvCell, download, timestampSlug } from '@visuelconcept/wui-kit/data/io.js';
import { AUDIT_FIELDS } from './types.js';

const HEADERS = AUDIT_FIELDS.map((f) => f.label);
const KEYS = AUDIT_FIELDS.map((f) => f.key);

/**
 * Print column widths (% of page width). With `table-layout: fixed` these are
 * authoritative — content wraps inside the column instead of widening it, so
 * long `oldval`/`newval`/`reason` values never blow the table past the page.
 */
const PRINT_COL_WIDTH: Record<string, string> = {
  time: '10%',
  username: '8%',
  action: '9%',
  item: '12%',
  itemtype: '7%',
  oldval: '12%',
  newval: '12%',
  reason: '13%',
  batchid: '6%',
  uinum: '4%',
  host: '7%'
};

function fileBase(dpName: string): string {
  const safe = dpName.replaceAll(/[^\w.-]+/g, '_') || 'audit';
  return `audit-${safe}-${timestampSlug()}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Download the rows as a `;`-separated CSV (UTF-8 BOM for Excel). */
export function exportAuditCsv(dpName: string, rows: string[][]): void {
  const header = HEADERS.map((h) => csvCell(h)).join(';');
  const lines = rows.map((r) => r.map((c) => csvCell(c)).join(';'));
  download(`${fileBase(dpName)}.csv`, CSV_BOM + [header, ...lines].join('\r\n'), 'text/csv;charset=utf-8');
}

/** Download the rows as a JSON document keyed by the `_AuditTrail` element names. */
export function exportAuditJson(dpName: string, rows: string[][]): void {
  const records = rows.map((r) => Object.fromEntries(KEYS.map((k, i) => [k, r[i] ?? ''])));
  const payload = { datapoint: dpName, exportedAt: new Date().toISOString(), count: records.length, rows: records };
  download(`${fileBase(dpName)}.json`, JSON.stringify(payload, null, JSON_INDENT), 'application/json');
}

/** Open a print-friendly window with the audit table and trigger the print dialog. */
export function printAudit(dpName: string, subtitle: string, rows: string[][]): void {
  const win = window.open('', '_blank');
  if (!win) return;
  const cols = AUDIT_FIELDS.map((f) => `<col style="width:${PRINT_COL_WIDTH[f.key] ?? 'auto'}" />`).join('');
  const head = HEADERS.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('');
  win.document.write(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8" />` +
      `<title>Audit Trail — ${escapeHtml(dpName)}</title><style>` +
      `@page{size:A4 landscape;margin:10mm}` +
      `body{font-family:Arial,Helvetica,sans-serif;margin:1.5rem;color:#111}` +
      `h1{font-size:1.2rem;margin:0 0 .2rem}.sub{color:#555;font-size:.85rem;margin:0 0 1rem}` +
      // table-layout:fixed + the colgroup widths keep the table inside the page;
      // word-break makes long values wrap rather than widen their column.
      `table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:.72rem}` +
      `th,td{border:1px solid #999;padding:.25rem .4rem;text-align:left;vertical-align:top;` +
      `word-break:break-word;overflow-wrap:anywhere}` +
      `thead th{background:#eee}tbody tr:nth-child(even){background:#f6f6f6}` +
      `@media print{body{margin:0}}</style></head><body>` +
      `<h1>Audit Trail — ${escapeHtml(dpName)}</h1>` +
      `<p class="sub">${escapeHtml(subtitle)} · ${rows.length} enregistrement(s)</p>` +
      `<table><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
      `</body></html>`
  );
  win.document.close();
  win.focus();
  win.print();
}
