// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Build a self-contained, printable HTML document for one thermal report
 * (opened in a new window for "Imprimer / PDF"). Kept separate from the view
 * component so the rendering stays a pure string builder.
 */
import type { CycleSummary } from './engine.js';
import { MSG, localize, printCycleSummaryMsg, printValidatedByMsg } from './i18n.js';
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
    [localize(MSG.print.fReportNo), r.reportNo],
    [localize(MSG.print.fCharge), r.charge],
    [localize(MSG.print.fOrder), r.orderNo],
    [localize(MSG.print.fPart), r.part],
    [localize(MSG.print.fMaterial), r.material],
    [localize(MSG.print.fQuantity), String(r.quantity)],
    [localize(MSG.print.fTreatment), localize(TREATMENT_LABELS[r.treatment])],
    [localize(MSG.print.fAtmosphere), r.atmosphere],
    [localize(MSG.print.fQuench), localize(QUENCH_LABELS[r.quench])],
    [localize(MSG.print.fFurnace), r.machineName],
    [localize(MSG.print.fOperator), r.operator],
    [localize(MSG.print.fStart), fmt(r.startTime)],
    [localize(MSG.print.fEnd), fmt(r.endTime)],
    [localize(MSG.print.fStatus), localize(STATUS_LABELS[r.status])]
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
      const verdict =
        ok === null ? '—' : (ok ? localize(MSG.print.ok) : localize(MSG.print.outOfTolerance));
      return `<tr><td>${esc(res.label)}</td><td>${res.value} ${esc(res.unit)}</td><td>${res.min ?? '—'}</td><td>${res.max ?? '—'}</td><td>${esc(verdict)}</td></tr>`;
    })
    .join('');
}

function summaryLine(summary: CycleSummary | null, simulated: boolean): string {
  if (!summary) return '';
  return printCycleSummaryMsg(
    summary.inBandPct,
    summary.maxDeviation,
    summary.minTemp,
    summary.maxTemp,
    simulated
  );
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
    ? `<p>${esc(printValidatedByMsg(r.validatedBy, r.validatedAt ? fmt(r.validatedAt) : ''))}</p>`
    : '';
  const notes = r.notes ? `<h2>${esc(localize(MSG.print.secNotes))}</h2><p>${esc(r.notes)}</p>` : '';
  const chart = image
    ? `<img src="${image}" alt="${esc(localize(MSG.print.chartAlt))}"/>`
    : `<p>${esc(localize(MSG.print.chartUnavailable))}</p>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(r.reportNo || localize(MSG.print.docTitleFallback))} — ${esc(r.charge)}</title>
<style>${PRINT_CSS}</style></head><body>
<h1>${esc(localize(MSG.print.docHeading))}</h1>
<table class="facts">${factTable(r)}</table>
<h2>${esc(localize(MSG.print.secRecipe))}</h2>
<table><thead><tr><th>#</th><th>${esc(localize(MSG.print.colStep))}</th><th>${esc(localize(MSG.print.colSetpoint))}</th><th>${esc(localize(MSG.print.colDuration))}</th><th>${esc(localize(MSG.print.colTolerance))}</th><th>${esc(localize(MSG.print.colAtmosphere))}</th></tr></thead><tbody>${stepRows(r)}</tbody></table>
<h2>${esc(localize(MSG.print.secCurve))}</h2>
${chart}
${summaryLine(summary, simulated)}
<h2>${esc(localize(MSG.print.secQuality))}</h2>
<table><thead><tr><th>${esc(localize(MSG.print.colControl))}</th><th>${esc(localize(MSG.print.colValue))}</th><th>${esc(localize(MSG.print.colMin))}</th><th>${esc(localize(MSG.print.colMax))}</th><th>${esc(localize(MSG.print.colVerdict))}</th></tr></thead><tbody>${resultRows(r)}</tbody></table>
<p class="verdict">${esc(localize(MSG.print.conformityLabel))} : ${esc(localize(CONFORMITY_LABELS[r.conformity]))}</p>
${validation}
${notes}
${PRINT_SCRIPT}
</body></html>`;
}
