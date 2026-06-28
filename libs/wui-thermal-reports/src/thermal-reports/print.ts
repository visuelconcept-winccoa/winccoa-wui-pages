// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Build a self-contained, printable HTML document for one thermal report
 * (opened in a new window for "Imprimer / PDF"). Kept separate from the view
 * component so the rendering stays a pure string builder.
 */
import type { CycleSummary } from './engine.js';
import {
  CONFORMITY_LABELS,
  QUENCH_LABELS,
  STATUS_LABELS,
  TREATMENT_LABELS,
  resultConform,
  type ThermalReport
} from './types.js';

function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function fmt(value: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('fr-FR');
}

function factTable(r: ThermalReport): string {
  const facts: [string, string][] = [
    ['N° rapport', r.reportNo],
    ['N° charge', r.charge],
    ['OF', r.orderNo],
    ['Pièce', r.part],
    ['Matière', r.material],
    ['Quantité', String(r.quantity)],
    ['Traitement', TREATMENT_LABELS[r.treatment]],
    ['Atmosphère', r.atmosphere],
    ['Trempe', QUENCH_LABELS[r.quench]],
    ['Four', r.machineName],
    ['Opérateur', r.operator],
    ['Début', fmt(r.startTime)],
    ['Fin', fmt(r.endTime)],
    ['Statut', STATUS_LABELS[r.status]]
  ];
  return facts.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v || '—')}</td></tr>`).join('');
}

function stepRows(r: ThermalReport): string {
  return r.steps
    .map(
      (s, i) =>
        `<tr><td>${i + 1}</td><td>${esc(s.label)}</td><td>${s.setpoint}</td><td>${s.durationMin}</td><td>−${Math.abs(s.tolMinus)}/+${Math.abs(s.tolPlus)}</td><td>${esc(s.atmosphere)}</td></tr>`
    )
    .join('');
}

function resultRows(r: ThermalReport): string {
  return r.results
    .map((res) => {
      const ok = resultConform(res);
      const verdict = ok === null ? '—' : (ok ? 'OK' : 'Hors tolérance');
      return `<tr><td>${esc(res.label)}</td><td>${res.value} ${esc(res.unit)}</td><td>${res.min ?? '—'}</td><td>${res.max ?? '—'}</td><td>${verdict}</td></tr>`;
    })
    .join('');
}

function summaryLine(summary: CycleSummary | null, simulated: boolean): string {
  if (!summary) return '';
  const sim = simulated ? ' (courbe simulée)' : '';
  return `<p><strong>Cycle :</strong> ${summary.inBandPct}% dans la tolérance · écart max ${summary.maxDeviation} °C · min/max ${summary.minTemp}/${summary.maxTemp} °C${sim}</p>`;
}

const PRINT_CSS = `
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 20px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-bottom: 8px; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  .facts th { width: 130px; background: #f4f4f4; }
  img { max-width: 100%; border: 1px solid #ddd; }
  .verdict { font-size: 14px; font-weight: bold; margin-top: 8px; }
`;

/**
 * Trigger printing only once every image (the chart PNG) has finished decoding.
 * Calling window.print() before the data-URL image has loaded is what made the
 * curve print blank "sometimes".
 */
const PRINT_SCRIPT = `<script>
(function () {
  function go() { try { window.focus(); } catch (e) {} window.print(); }
  var pending = Array.prototype.slice.call(document.images).filter(function (im) { return !im.complete; });
  if (!pending.length) { go(); return; }
  var left = pending.length;
  function one() { if (--left <= 0) go(); }
  pending.forEach(function (im) {
    im.addEventListener('load', one);
    im.addEventListener('error', one);
  });
})();
</script>`;

export function buildPrintHtml(
  r: ThermalReport,
  summary: CycleSummary | null,
  simulated: boolean,
  image: string
): string {
  const validation = r.validatedBy
    ? `<p>Validé par ${esc(r.validatedBy)}${r.validatedAt ? ' le ' + esc(fmt(r.validatedAt)) : ''}</p>`
    : '';
  const notes = r.notes ? `<h2>Observations</h2><p>${esc(r.notes)}</p>` : '';
  const chart = image ? `<img src="${image}" alt="Courbe de température"/>` : '<p>(graphique indisponible)</p>';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(r.reportNo || 'Rapport')} — ${esc(r.charge)}</title>
<style>${PRINT_CSS}</style></head><body>
<h1>Rapport de traitement thermique (TTD)</h1>
<table class="facts">${factTable(r)}</table>
<h2>Recette</h2>
<table><thead><tr><th>#</th><th>Étape</th><th>Consigne °C</th><th>Durée min</th><th>Tol.</th><th>Atmosphère</th></tr></thead><tbody>${stepRows(r)}</tbody></table>
<h2>Courbe de température</h2>
${chart}
${summaryLine(summary, simulated)}
<h2>Contrôle qualité</h2>
<table><thead><tr><th>Contrôle</th><th>Valeur</th><th>Min</th><th>Max</th><th>Verdict</th></tr></thead><tbody>${resultRows(r)}</tbody></table>
<p class="verdict">Conformité : ${esc(CONFORMITY_LABELS[r.conformity])}</p>
${validation}
${notes}
${PRINT_SCRIPT}
</body></html>`;
}
