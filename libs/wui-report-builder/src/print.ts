// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Build a self-contained printable HTML document for one report instance
 * (opened in a new window). Renders every section by kind, the dataset charts
 * (PNG snapshots passed in by the detail view), the workflow state and the
 * signatures block. Pure string builder.
 *
 * Printing waits for the chart images to decode before calling window.print()
 * (see PRINT_SCRIPT) — calling it synchronously would print blank charts.
 */
import { AGG_LABELS, fieldConform, type Report, type TemplateSection } from './types.js';

function esc(s: string): string {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function verdictLabel(conform: boolean | null): string {
  if (conform === null) return '';
  return conform ? 'OK' : 'Hors tolérance';
}

function factTable(r: Report): string {
  const state = r.workflow.find((s) => s.id === r.currentStateId);
  const facts: [string, string][] = [
    ['N° rapport', r.reportNo],
    ['Titre', r.title],
    ['Objet', r.subject],
    ['Modèle', r.templateName],
    ['Période', `${r.period.start || '—'} → ${r.period.end || '—'}`],
    ['État', state?.label ?? '—'],
    ['Créé le', r.createdAt]
  ];
  return facts.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v || '—')}</td></tr>`).join('');
}

function fieldsSection(section: TemplateSection, r: Report): string {
  const values = r.data[section.id]?.values ?? {};
  const rows = (section.fields ?? [])
    .map((f) => {
      const v = values[f.id] ?? '';
      const conform = fieldConform(f, v);
      const verdict = verdictLabel(conform);
      return `<tr><th>${esc(f.label)}</th><td>${esc(String(v) || '—')} ${esc(f.unit)}</td><td>${verdict}</td></tr>`;
    })
    .join('');
  return `<table class="facts"><tbody>${rows}</tbody></table>`;
}

function tableSection(section: TemplateSection, r: Report): string {
  const cols = section.columns ?? [];
  const rows = r.data[section.id]?.rows ?? [];
  const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${cols.map((c) => `<td>${esc(String(row[c.id] ?? ''))}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function datasetSection(section: TemplateSection, r: Report, image: string | undefined): string {
  const results = r.data[section.id]?.results ?? {};
  const rows = (section.datasets ?? [])
    .map((d) => {
      const res = results[d.id];
      const aggs = res
        ? d.ops.map((op) => `${AGG_LABELS[op]}: ${res.agg[op] ?? '—'}`).join(' · ')
        : '—';
      return `<tr><th>${esc(d.label)}</th><td>${esc(aggs)}</td><td>${res?.n ?? '—'}</td></tr>`;
    })
    .join('');
  const chart = image ? `<img src="${image}" alt="Graphique ${esc(section.title)}"/>` : '';
  return `<table class="facts"><tbody>${rows}</tbody></table>${chart}`;
}

function checklistSection(section: TemplateSection, r: Report): string {
  const checked = r.data[section.id]?.checked ?? {};
  const items = (section.items ?? [])
    .map((it) => {
      const mark = checked[it.id] ? '☑' : '☐';
      const req = it.required ? ' (obligatoire)' : '';
      return `<li>${mark} ${esc(it.label)}${req}</li>`;
    })
    .join('');
  return `<ul class="checklist">${items}</ul>`;
}

function sectionHtml(section: TemplateSection, r: Report, images: Record<string, string>): string {
  let body = '';
  switch (section.kind) {
    case 'text':
    case 'comment': {
      body = `<p>${esc(r.data[section.id]?.content ?? '') || '—'}</p>`;
      break;
    }
    case 'fields': {
      body = fieldsSection(section, r);
      break;
    }
    case 'table': {
      body = tableSection(section, r);
      break;
    }
    case 'dataset': {
      body = datasetSection(section, r, images[section.id]);
      break;
    }
    case 'checklist': {
      body = checklistSection(section, r);
      break;
    }
    default: {
      body = '';
    }
  }
  return `<h2>${esc(section.title)}</h2>${body}`;
}

function signaturesHtml(r: Report): string {
  if (r.signatures.length === 0) return '';
  const rows = r.signatures
    .map((s) => {
      const when = new Date(s.timestamp);
      const ts = Number.isNaN(when.getTime()) ? s.timestamp : when.toLocaleString('fr-FR');
      return `<tr><td>${s.level}</td><td>${esc(s.roleLabel)}</td><td>${esc(s.signerName)}</td><td>${esc(ts)}</td><td>${esc(s.comment)}</td></tr>`;
    })
    .join('');
  return `<h2>Signatures</h2><table><thead><tr><th>Niveau</th><th>Rôle</th><th>Signataire</th><th>Date</th><th>Commentaire</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const PRINT_CSS = `
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-bottom: 8px; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; vertical-align: top; }
  .facts th { width: 180px; background: #f4f4f4; }
  img { max-width: 100%; border: 1px solid #ddd; margin-top: 6px; }
  ul.checklist { list-style: none; padding-left: 0; font-size: 13px; }
  ul.checklist li { padding: 2px 0; }
`;

/** Print after every image (chart PNG) has decoded — avoids blank charts. */
const PRINT_SCRIPT = `<script>
(function () {
  function go() { try { window.focus(); } catch (e) {} window.print(); }
  var pending = Array.prototype.slice.call(document.images).filter(function (im) { return !im.complete; });
  if (!pending.length) { go(); return; }
  var left = pending.length;
  function one() { if (--left <= 0) go(); }
  pending.forEach(function (im) { im.addEventListener('load', one); im.addEventListener('error', one); });
})();
</script>`;

export function buildPrintHtml(report: Report, images: Record<string, string>): string {
  const sections = report.sections.map((s) => sectionHtml(s, report, images)).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(report.reportNo || 'Rapport')} — ${esc(report.title)}</title>
<style>${PRINT_CSS}</style></head><body>
<h1>${esc(report.title || 'Rapport')}</h1>
<table class="facts"><tbody>${factTable(report)}</tbody></table>
${sections}
${signaturesHtml(report)}
${PRINT_SCRIPT}
</body></html>`;
}
