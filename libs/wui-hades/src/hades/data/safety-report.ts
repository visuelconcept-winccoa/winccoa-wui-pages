// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Safety-file report ("dossier de sécurité") — one click turns the living
 * configuration into a dated, printable document: tunnel identity and
 * regulatory profile, geometry per tube, equipment inventory (with binding
 * status), the compliance advisor's findings with their clause references,
 * the operating modes, and the incident record from the logbook (drills
 * marked as such). Generated as a fully self-contained HTML page (inline CSS,
 * print button → the browser's PDF export) so it can be archived or attached
 * to the periodic inspection file as-is. The disclaimer states it supports —
 * not replaces — the safety officer's assessment.
 */
import { download, timestampSlug } from '@visuelconcept/wui-kit/data/io.js';
import { checkCompliance, profileLabel, type ComplianceIssue } from './compliance.js';
import { kindLabel } from './catalog.js';
import { localize, ml } from '../i18n.js';
import type { Incident, LogbookData } from './logbook.js';
import {
  pkLabel,
  tubeEquipment,
  tubeLengthM,
  type EquipmentDef,
  type Tunnel,
  type TubeDef
} from '../types.js';

/** Closed incidents listed in the report (newest first). */
const MAX_REPORT_INCIDENTS = 20;

const T = {
  title: ml('Tunnel safety file', 'Dossier de sécurité du tunnel', 'Sicherheitsdossier des Tunnels'),
  generated: ml('Generated on', 'Généré le', 'Erstellt am'),
  by: ml('by', 'par', 'von'),
  profile: ml('Regulatory profile', 'Référentiel réglementaire', 'Regelwerk'),
  traffic: ml('Traffic (veh/day/lane)', 'Trafic (véh/j/voie)', 'Verkehr (Fz/Tag/Spur)'),
  shadow: ml(
    'Observation (read-only) mode — no command is sent by this system.',
    'Mode observation (lecture seule) — aucune commande n’est émise par ce système.',
    'Beobachtungsmodus (nur lesend) — dieses System sendet keine Befehle.'
  ),
  geometry: ml('Geometry', 'Géométrie', 'Geometrie'),
  tube: ml('Tube', 'Tube', 'Röhre'),
  direction: ml('Direction', 'Sens', 'Verkehrsführung'),
  uni: ml('unidirectional', 'unidirectionnel', 'Richtungsverkehr'),
  bidi: ml('bidirectional', 'bidirectionnel', 'Gegenverkehr'),
  lanes: ml('lanes', 'voies', 'Fahrstreifen'),
  segment: ml('Segment', 'Segment', 'Segment'),
  length: ml('Length (m)', 'Longueur (m)', 'Länge (m)'),
  gradient: ml('Gradient (%)', 'Pente (%)', 'Neigung (%)'),
  radius: ml('Radius (m)', 'Rayon (m)', 'Radius (m)'),
  clearance: ml('Clearance (m)', 'Gabarit (m)', 'Lichtraum (m)'),
  zone: ml('Lighting zone', 'Zone d’éclairage', 'Beleuchtungszone'),
  inventory: ml('Equipment inventory', 'Inventaire des équipements', 'Anlageninventar'),
  bound: ml('bound', 'lié', 'verknüpft'),
  unbound: ml('NOT bound', 'NON lié', 'NICHT verknüpft'),
  compliance: ml('Compliance findings', 'Constats de conformité', 'Konformitätsbefunde'),
  noIssue: ml(
    'No deviation from the selected profile.',
    'Aucun écart par rapport au référentiel sélectionné.',
    'Keine Abweichung vom gewählten Regelwerk.'
  ),
  severity: ml('Severity', 'Criticité', 'Schwere'),
  finding: ml('Finding', 'Constat', 'Befund'),
  reference: ml('Reference', 'Référence', 'Referenz'),
  sevError: ml('Deviation', 'Écart', 'Abweichung'),
  sevWarning: ml('Warning', 'Avertissement', 'Warnung'),
  sevInfo: ml('Note', 'Note', 'Hinweis'),
  modes: ml('Operating modes', 'Modes d’exploitation', 'Betriebsarten'),
  commandCount: ml('command(s)', 'commande(s)', 'Befehl(e)'),
  incidents: ml('Incident record', 'Registre des incidents', 'Ereignisregister'),
  noIncident: ml('No incident recorded.', 'Aucun incident enregistré.', 'Kein Ereignis erfasst.'),
  ongoing: ml('ONGOING', 'EN COURS', 'LAUFEND'),
  opened: ml('opened', 'ouvert', 'eröffnet'),
  closed: ml('closed', 'clos', 'geschlossen'),
  print: ml('Print / PDF', 'Imprimer / PDF', 'Drucken / PDF'),
  disclaimer: ml(
    'This report is generated from the live Hades configuration as a working aid for the safety documentation. It supports — and does not replace — the assessment of the tunnel safety officer and the applicable regulatory procedures.',
    'Ce rapport est généré depuis la configuration Hadès comme aide de travail pour la documentation de sécurité. Il appuie — et ne remplace pas — l’appréciation de l’agent de sécurité du tunnel et les procédures réglementaires applicables.',
    'Dieser Bericht wird aus der laufenden Hades-Konfiguration als Arbeitshilfe für die Sicherheitsdokumentation erzeugt. Er unterstützt — und ersetzt nicht — die Beurteilung des Sicherheitsbeauftragten und die geltenden Verfahren.'
  )
};

const SEVERITY_LABEL: Record<ComplianceIssue['severity'], () => string> = {
  error: () => localize(T.sevError),
  warning: () => localize(T.sevWarning),
  info: () => localize(T.sevInfo)
};

function esc(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function segmentRows(tube: TubeDef): string {
  return tube.segments
    .map(
      (s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.lengthM}</td><td class="num">${s.gradientPct}</td>
        <td class="num">${s.curveRadiusM || '—'}</td><td class="num">${s.clearanceM}</td><td>${esc(s.lightingZone)}</td></tr>`
    )
    .join('');
}

function boundCount(equipment: EquipmentDef): { bound: number; total: number } {
  const values = Object.values(equipment.bindings).filter((dpe) => dpe.trim() !== '');
  return { bound: values.length, total: Object.keys(equipment.bindings).length || values.length };
}

function inventorySection(tunnel: Tunnel, tube: TubeDef): string {
  const byKind = new Map<string, EquipmentDef[]>();
  for (const e of tubeEquipment(tunnel, tube.id)) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }
  const rows = [...byKind.entries()]
    .map(([kind, list]) => {
      const units = list
        .map((e) => {
          const b = boundCount(e);
          const state = b.bound > 0 ? localize(T.bound) : localize(T.unbound);
          return `${esc(e.name)} (${pkLabel(e.pkM)}, ${state})`;
        })
        .join(' · ');
      return `<tr><td>${esc(kindLabel(kind as EquipmentDef['kind']))}</td><td class="num">${list.length}</td><td>${units}</td></tr>`;
    })
    .join('');
  return rows || `<tr><td colspan="3">—</td></tr>`;
}

function complianceSection(issues: ComplianceIssue[]): string {
  if (issues.length === 0) return `<p class="ok">✓ ${esc(localize(T.noIssue))}</p>`;
  const rows = issues
    .map(
      (i) => `<tr class="${i.severity}"><td>${esc(SEVERITY_LABEL[i.severity]())}</td>
        <td>${esc(i.message)}</td><td>${esc(i.ref)}</td></tr>`
    )
    .join('');
  return `<table><thead><tr><th>${esc(localize(T.severity))}</th><th>${esc(localize(T.finding))}</th>
    <th>${esc(localize(T.reference))}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function incidentLine(incident: Incident): string {
  const opened = new Date(incident.openedTs).toLocaleString();
  const status = incident.closedTs
    ? `${localize(T.closed)} ${new Date(incident.closedTs).toLocaleString()}`
    : localize(T.ongoing);
  const pk = incident.pkM !== undefined ? ` — ${pkLabel(incident.pkM)}` : '';
  return `<li><b>${esc(incident.title)}</b> (${esc(incident.severity)})${pk} — ${esc(localize(T.opened))} ${opened} ${esc(localize(T.by))} ${esc(incident.openedBy)} — ${esc(status)}</li>`;
}

/** Build the self-contained report page for one tunnel. */
export function buildSafetyReportHtml(tunnel: Tunnel, logbook?: LogbookData, generatedBy = '—'): string {
  const issues = checkCompliance(tunnel);
  const incidents = (logbook?.incidents ?? []).slice(0, MAX_REPORT_INCIDENTS);
  const tubes = tunnel.tubes
    .map(
      (tube) => `
      <h3>${esc(tube.name)} — ${Math.round(tubeLengthM(tube))} m ·
        ${esc(localize(tube.direction === 'bidirectional' ? T.bidi : T.uni))} · ${tube.lanes} ${esc(localize(T.lanes))}</h3>
      <table><thead><tr><th>${esc(localize(T.segment))}</th><th>${esc(localize(T.length))}</th>
        <th>${esc(localize(T.gradient))}</th><th>${esc(localize(T.radius))}</th>
        <th>${esc(localize(T.clearance))}</th><th>${esc(localize(T.zone))}</th></tr></thead>
        <tbody>${segmentRows(tube)}</tbody></table>
      <h4>${esc(localize(T.inventory))}</h4>
      <table><tbody>${inventorySection(tunnel, tube)}</tbody></table>`
    )
    .join('');

  const modes = tunnel.modes
    .map((m) => `<li><b>${esc(m.name)}</b> (${esc(m.severity)}) — ${m.actions.length} ${esc(localize(T.commandCount))} — ${esc(m.description)}</li>`)
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(localize(T.title))} — ${esc(tunnel.name)}</title>
<style>
  body { font: 13px/1.5 'Segoe UI', system-ui, sans-serif; color: #1a1f29; margin: 2rem auto; max-width: 55rem; padding: 0 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.2rem; }
  h2 { font-size: 1.1rem; margin-top: 1.6rem; border-bottom: 2px solid #1a1f29; padding-bottom: 0.2rem; }
  h3 { font-size: 0.95rem; margin-top: 1.1rem; }
  h4 { font-size: 0.85rem; margin: 0.7rem 0 0.3rem; }
  .meta { color: #5a6474; margin-bottom: 0.4rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th, td { border: 1px solid #c9cfd9; padding: 0.3rem 0.5rem; text-align: left; vertical-align: top; }
  th { background: #eef1f5; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.error td:first-child { color: #b3261e; font-weight: 600; }
  tr.warning td:first-child { color: #9a6b00; font-weight: 600; }
  .ok { color: #1b7f4d; font-weight: 600; }
  .shadow { background: #fff6e0; border: 1px solid #e0c060; padding: 0.5rem 0.8rem; }
  .disclaimer { margin-top: 2rem; padding-top: 0.6rem; border-top: 1px solid #c9cfd9; color: #5a6474; font-size: 0.78rem; }
  .print { position: fixed; top: 1rem; right: 1rem; padding: 0.5rem 1rem; }
  @media print { .print { display: none; } body { margin: 0; } }
</style></head><body>
<button class="print" onclick="window.print()">${esc(localize(T.print))}</button>
<h1>${esc(localize(T.title))}</h1>
<div class="meta">${esc(tunnel.name)} — ${esc(localize(T.profile))} : ${esc(profileLabel(tunnel.profile))} —
  ${esc(localize(T.traffic))} : ${tunnel.trafficPerLane}</div>
<div class="meta">${esc(localize(T.generated))} ${new Date().toLocaleString()} ${esc(localize(T.by))} ${esc(generatedBy)}</div>
${tunnel.shadowMode ? `<p class="shadow">${esc(localize(T.shadow))}</p>` : ''}
<h2>${esc(localize(T.geometry))}</h2>
${tubes}
<h2>${esc(localize(T.compliance))}</h2>
${complianceSection(issues)}
<h2>${esc(localize(T.modes))}</h2>
<ul>${modes || '<li>—</li>'}</ul>
<h2>${esc(localize(T.incidents))}</h2>
${incidents.length === 0 ? `<p>${esc(localize(T.noIncident))}</p>` : `<ul>${incidents.map((i) => incidentLine(i)).join('')}</ul>`}
<p class="disclaimer">${esc(localize(T.disclaimer))}</p>
</body></html>`;
}

/** Open the report in a new tab AND offer it as a download. */
export function openSafetyReport(tunnel: Tunnel, logbook?: LogbookData, generatedBy = '—'): void {
  const html = buildSafetyReportHtml(tunnel, logbook, generatedBy);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  download(`dossier-securite-${tunnel.id || 'tunnel'}-${timestampSlug()}.html`, html, 'text/html');
}
