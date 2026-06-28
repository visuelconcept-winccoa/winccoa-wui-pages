// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable sonarjs/no-duplicate-string -- a translation catalog repeats short field/column labels (e.g. "Atmosphere", "Status") across UI areas by design */

/**
 * Internationalisation for the Thermal Treatment Reports page.
 *
 * All user-visible strings are {@link MultiLangString} maps resolved against the
 * active WebUI language via `lit-translate` (shared singleton — same instance as
 * the app shell, so the page reacts to the user's language). Use {@link localizeDir}
 * inside templates (reactive, re-renders on language change) and {@link localize}
 * for plain-string contexts (current language at call time).
 *
 * Locale keys use the base `.utf8` form (`en_US.utf8` / `fr.utf8` / `de.utf8`) so
 * any country variant (fr_FR, de_AT, de_CH, …) still resolves — the resolver
 * falls back to the language sub-tag.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Static UI strings, grouped by area. */
export const MSG = {
  page: {
    importJson: ml('Import JSON', 'Importer JSON', 'JSON importieren'),
    exportJson: ml('Export JSON', 'Export JSON', 'JSON exportieren'),
    exportCsv: ml('Export CSV', 'Export CSV', 'CSV exportieren'),
    newReport: ml('New report', 'Nouveau rapport', 'Neuer Bericht'),
    offline: ml(
      'Offline mode: changes are not persisted to datapoints (backend unavailable or missing write rights).',
      'Mode hors-ligne : modifications non persistées dans les datapoints (backend indisponible ou droits d’écriture manquants).',
      'Offline-Modus: Änderungen werden nicht in Datenpunkten gespeichert (Backend nicht verfügbar oder fehlende Schreibrechte).'
    ),
    empty: ml(
      'No thermal treatment reports yet.',
      'Aucun rapport de traitement thermique pour l’instant.',
      'Noch keine Wärmebehandlungsberichte.'
    ),
    generateDemo: ml(
      'Generate demonstration reports',
      'Générer des rapports de démonstration',
      'Demonstrationsberichte erzeugen'
    )
  },
  kpi: {
    reports: ml('Reports', 'Rapports', 'Berichte'),
    running: ml('Running', 'En cours', 'Laufend'),
    completed: ml('Completed', 'Terminés', 'Abgeschlossen'),
    validated: ml('Validated', 'Validés', 'Validiert'),
    nonconform: ml('Non-conform', 'Non conformes', 'Nicht konform')
  },
  table: {
    reportNo: ml('Report no.', 'N° rapport', 'Bericht-Nr.'),
    charge: ml('Charge', 'Charge', 'Charge'),
    partMaterial: ml('Part · material', 'Pièce · matière', 'Teil · Werkstoff'),
    treatment: ml('Treatment', 'Traitement', 'Behandlung'),
    furnace: ml('Furnace', 'Four', 'Ofen'),
    startTime: ml('Cycle start', 'Début cycle', 'Zyklusbeginn'),
    status: ml('Status', 'Statut', 'Status'),
    conformity: ml('Conformity', 'Conformité', 'Konformität'),
    openReport: ml('Open the report', 'Ouvrir le rapport', 'Bericht öffnen'),
    edit: ml('Edit', 'Modifier', 'Bearbeiten'),
    remove: ml('Delete', 'Supprimer', 'Löschen')
  },
  detail: {
    back: ml('‹ Back', '‹ Retour', '‹ Zurück'),
    report: ml('Report', 'Rapport', 'Bericht'),
    charge: ml('charge', 'charge', 'Charge'),
    print: ml('Print', 'Imprimer', 'Drucken'),
    edit: ml('Edit', 'Modifier', 'Bearbeiten'),
    reject: ml('Reject', 'Refuser', 'Ablehnen'),
    validate: ml('Validate', 'Valider', 'Validieren'),
    docTitle: ml('Thermal treatment report', 'Rapport de traitement thermique', 'Wärmebehandlungsbericht'),
    secRecipe: ml('Treatment recipe', 'Recette de traitement', 'Behandlungsrezept'),
    secCurve: ml(
      'Temperature curve (actual vs setpoint)',
      'Courbe de température (réel vs consigne)',
      'Temperaturkurve (Ist vs. Sollwert)'
    ),
    secQuality: ml('Quality control', 'Contrôle qualité', 'Qualitätskontrolle'),
    secNotes: ml('Observations', 'Observations', 'Anmerkungen'),
    fReportNo: ml('Report no.', 'N° rapport', 'Bericht-Nr.'),
    fCharge: ml('Charge no.', 'N° charge', 'Charge-Nr.'),
    fOrder: ml('Order', 'OF', 'Auftrag'),
    fPart: ml('Part', 'Pièce', 'Teil'),
    fMaterial: ml('Material', 'Matière', 'Werkstoff'),
    fQuantity: ml('Quantity', 'Quantité', 'Menge'),
    fTreatment: ml('Treatment', 'Traitement', 'Behandlung'),
    fAtmosphere: ml('Atmosphere', 'Atmosphère', 'Atmosphäre'),
    fQuench: ml('Quench', 'Trempe', 'Abschreckung'),
    fFurnace: ml('Furnace', 'Four', 'Ofen'),
    fWorkshop: ml('Workshop', 'Atelier', 'Werkstatt'),
    fOperator: ml('Operator', 'Opérateur', 'Bediener'),
    fCycleStart: ml('Cycle start', 'Début cycle', 'Zyklusbeginn'),
    fCycleEnd: ml('Cycle end', 'Fin cycle', 'Zyklusende'),
    noStep: ml('No step defined.', 'Aucun palier défini.', 'Keine Stufe definiert.'),
    colStep: ml('Step', 'Étape', 'Stufe'),
    colSetpoint: ml('Setpoint (°C)', 'Consigne (°C)', 'Sollwert (°C)'),
    colDuration: ml('Duration (min)', 'Durée (min)', 'Dauer (min)'),
    colTolerance: ml('Tolerance', 'Tolérance', 'Toleranz'),
    colAtmosphere: ml('Atmosphere', 'Atmosphère', 'Atmosphäre'),
    totalDuration: ml('total duration', 'durée totale', 'Gesamtdauer'),
    curveHint: ml(
      'Enter the cycle window (start) and at least one step to display the curve.',
      'Renseignez la fenêtre du cycle (début) et au moins un palier pour afficher la courbe.',
      'Geben Sie das Zyklusfenster (Beginn) und mindestens eine Stufe an, um die Kurve anzuzeigen.'
    ),
    noDatapoint: ml('(datapoint not specified)', '(datapoint non renseigné)', '(Datenpunkt nicht angegeben)'),
    validatedBy: ml('Validated by', 'Validé par', 'Validiert von'),
    validatedOn: ml('on', 'le', 'am'),
    simulatedPre: ml(
      'Simulated curve — no archived data found for',
      'Courbe simulée — aucune donnée archivée trouvée pour',
      'Simulierte Kurve — keine archivierten Daten gefunden für'
    ),
    simulatedPost: ml('over the period.', 'sur la période.', 'im Zeitraum.'),
    inTolerance: ml('within tolerance', 'dans la tolérance', 'innerhalb der Toleranz'),
    maxDeviation: ml('max deviation', 'écart max', 'max. Abweichung'),
    minMax: ml('min / max', 'min / max', 'min / max'),
    noResult: ml('No control result entered.', 'Aucun résultat de contrôle saisi.', 'Kein Kontrollergebnis erfasst.'),
    colControl: ml('Control', 'Contrôle', 'Kontrolle'),
    colValue: ml('Value', 'Valeur', 'Wert'),
    colMin: ml('Min', 'Min', 'Min'),
    colMax: ml('Max', 'Max', 'Max'),
    colVerdict: ml('Verdict', 'Verdict', 'Urteil'),
    ok: ml('OK', 'OK', 'OK'),
    outOfTolerance: ml('Out of tolerance', 'Hors tolérance', 'Außerhalb der Toleranz'),
    chargeConformity: ml('Charge conformity', 'Conformité de la charge', 'Konformität der Charge')
  },
  chart: {
    actual: ml('Actual temperature', 'Température réelle', 'Ist-Temperatur'),
    setpoint: ml('Setpoint', 'Consigne', 'Sollwert'),
    tolerance: ml('Tolerance', 'Tolérance', 'Toleranz')
  },
  dialog: {
    newReport: ml('New treatment report', 'Nouveau rapport de traitement', 'Neuer Behandlungsbericht'),
    editPrefix: ml('Edit', 'Édition', 'Bearbeitung'),
    secIdentity: ml('Identity & part', 'Identité & pièce', 'Identität & Teil'),
    secTreatment: ml('Treatment', 'Traitement', 'Behandlung'),
    secFurnace: ml('Furnace & data source', 'Four & source de données', 'Ofen & Datenquelle'),
    secRecipe: ml('Recipe (steps)', 'Recette (paliers)', 'Rezept (Stufen)'),
    secQuality: ml('Quality control', 'Contrôle qualité', 'Qualitätskontrolle'),
    secTracking: ml('Tracking & validation', 'Suivi & validation', 'Verfolgung & Validierung'),
    fReportNo: ml('Report no.', 'N° rapport', 'Bericht-Nr.'),
    fCharge: ml('Charge no.', 'N° charge', 'Charge-Nr.'),
    fOrder: ml('Order (linked)', 'OF (lié)', 'Auftrag (verknüpft)'),
    fPart: ml('Part designation', 'Désignation pièce', 'Teilebezeichnung'),
    fMaterial: ml('Material / grade', 'Matière / nuance', 'Werkstoff / Güte'),
    fQuantity: ml('Quantity', 'Quantité', 'Menge'),
    fTreatment: ml('Treatment type', 'Type de traitement', 'Behandlungsart'),
    fAtmosphere: ml('Atmosphere', 'Atmosphère', 'Atmosphäre'),
    fQuench: ml('Quench', 'Trempe', 'Abschreckung'),
    fWorkshop: ml('Workshop', 'Atelier', 'Werkstatt'),
    fFurnace: ml('Furnace', 'Four', 'Ofen'),
    fCycleStart: ml('Cycle start', 'Début du cycle', 'Zyklusbeginn'),
    fCycleEnd: ml('Cycle end', 'Fin du cycle', 'Zyklusende'),
    fTempDp: ml(
      'Temperature datapoint (archived history)',
      'Datapoint température (historique archivé)',
      'Temperatur-Datenpunkt (archivierter Verlauf)'
    ),
    tempDpPlaceholder: ml(
      'e.g. MachineSim_four1.temperature',
      'ex. MachineSim_four1.temperature',
      'z. B. MachineSim_four1.temperature'
    ),
    addStep: ml('Add a step', 'Ajouter un palier', 'Stufe hinzufügen'),
    addControl: ml('Add a control', 'Ajouter un contrôle', 'Kontrolle hinzufügen'),
    noStep: ml(
      'No step — add the cycle stages (setpoint, duration, tolerance).',
      'Aucun palier — ajoutez les étapes du cycle (consigne, durée, tolérance).',
      'Keine Stufe — fügen Sie die Zyklusschritte hinzu (Sollwert, Dauer, Toleranz).'
    ),
    noControl: ml(
      'No control — add the results (hardness, depth, …).',
      'Aucun contrôle — ajoutez les résultats (dureté, profondeur, …).',
      'Keine Kontrolle — fügen Sie die Ergebnisse hinzu (Härte, Tiefe, …).'
    ),
    colStep: ml('Step', 'Étape', 'Stufe'),
    colSetpoint: ml('Setpoint °C', 'Consigne °C', 'Sollwert °C'),
    colDuration: ml('Duration min', 'Durée min', 'Dauer min'),
    colTolMinus: ml('Tol. −', 'Tol. −', 'Tol. −'),
    colTolPlus: ml('Tol. +', 'Tol. +', 'Tol. +'),
    colAtmosphere: ml('Atmosphere', 'Atmosphère', 'Atmosphäre'),
    colControl: ml('Control', 'Contrôle', 'Kontrolle'),
    colValue: ml('Value', 'Valeur', 'Wert'),
    colUnit: ml('Unit', 'Unité', 'Einheit'),
    colMin: ml('Min', 'Min', 'Min'),
    colMax: ml('Max', 'Max', 'Max'),
    fStatus: ml('Status', 'Statut', 'Status'),
    fConformity: ml('Conformity', 'Conformité', 'Konformität'),
    fOperator: ml('Operator', 'Opérateur', 'Bediener'),
    fNotes: ml('Observations', 'Observations', 'Anmerkungen'),
    remove: ml('Remove', 'Retirer', 'Entfernen'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    save: ml('Save', 'Enregistrer', 'Speichern')
  },
  print: {
    docHeading: ml(
      'Thermal treatment report (TTD)',
      'Rapport de traitement thermique (TTD)',
      'Wärmebehandlungsbericht (TTD)'
    ),
    docTitleFallback: ml('Report', 'Rapport', 'Bericht'),
    secRecipe: ml('Recipe', 'Recette', 'Rezept'),
    secCurve: ml('Temperature curve', 'Courbe de température', 'Temperaturkurve'),
    secQuality: ml('Quality control', 'Contrôle qualité', 'Qualitätskontrolle'),
    secNotes: ml('Observations', 'Observations', 'Anmerkungen'),
    chartAlt: ml('Temperature curve', 'Courbe de température', 'Temperaturkurve'),
    chartUnavailable: ml('(chart unavailable)', '(graphique indisponible)', '(Diagramm nicht verfügbar)'),
    colStep: ml('Step', 'Étape', 'Stufe'),
    colSetpoint: ml('Setpoint °C', 'Consigne °C', 'Sollwert °C'),
    colDuration: ml('Duration min', 'Durée min', 'Dauer min'),
    colTolerance: ml('Tol.', 'Tol.', 'Tol.'),
    colAtmosphere: ml('Atmosphere', 'Atmosphère', 'Atmosphäre'),
    colControl: ml('Control', 'Contrôle', 'Kontrolle'),
    colValue: ml('Value', 'Valeur', 'Wert'),
    colMin: ml('Min', 'Min', 'Min'),
    colMax: ml('Max', 'Max', 'Max'),
    colVerdict: ml('Verdict', 'Verdict', 'Urteil'),
    ok: ml('OK', 'OK', 'OK'),
    outOfTolerance: ml('Out of tolerance', 'Hors tolérance', 'Außerhalb der Toleranz'),
    conformityLabel: ml('Conformity', 'Conformité', 'Konformität'),
    fReportNo: ml('Report no.', 'N° rapport', 'Bericht-Nr.'),
    fCharge: ml('Charge no.', 'N° charge', 'Charge-Nr.'),
    fOrder: ml('Order', 'OF', 'Auftrag'),
    fPart: ml('Part', 'Pièce', 'Teil'),
    fMaterial: ml('Material', 'Matière', 'Werkstoff'),
    fQuantity: ml('Quantity', 'Quantité', 'Menge'),
    fTreatment: ml('Treatment', 'Traitement', 'Behandlung'),
    fAtmosphere: ml('Atmosphere', 'Atmosphère', 'Atmosphäre'),
    fQuench: ml('Quench', 'Trempe', 'Abschreckung'),
    fFurnace: ml('Furnace', 'Four', 'Ofen'),
    fOperator: ml('Operator', 'Opérateur', 'Bediener'),
    fStart: ml('Start', 'Début', 'Beginn'),
    fEnd: ml('End', 'Fin', 'Ende'),
    fStatus: ml('Status', 'Statut', 'Status')
  },
  csv: {
    reportNo: ml('Report no.', 'N° rapport', 'Bericht-Nr.'),
    charge: ml('Charge no.', 'N° charge', 'Charge-Nr.'),
    orderNo: ml('Order', 'OF', 'Auftrag'),
    part: ml('Part', 'Pièce', 'Teil'),
    material: ml('Material', 'Matière', 'Werkstoff'),
    quantity: ml('Quantity', 'Quantité', 'Menge'),
    treatment: ml('Treatment', 'Traitement', 'Behandlung'),
    atmosphere: ml('Atmosphere', 'Atmosphère', 'Atmosphäre'),
    quench: ml('Quench', 'Trempe', 'Abschreckung'),
    workshop: ml('Workshop', 'Atelier', 'Werkstatt'),
    furnace: ml('Furnace', 'Four', 'Ofen'),
    startTime: ml('Cycle start', 'Début cycle', 'Zyklusbeginn'),
    endTime: ml('Cycle end', 'Fin cycle', 'Zyklusende'),
    status: ml('Status', 'Statut', 'Status'),
    conformity: ml('Conformity', 'Conformité', 'Konformität'),
    operator: ml('Operator', 'Opérateur', 'Bediener'),
    notes: ml('Notes', 'Notes', 'Notizen')
  },
  io: {
    importFailed: ml('Import failed.', 'Import échoué.', 'Import fehlgeschlagen.'),
    invalidFormat: ml(
      'Invalid format: “reports” array not found.',
      'Format invalide : tableau « reports » introuvable.',
      'Ungültiges Format: Array „reports“ nicht gefunden.'
    )
  }
} as const;

/** Treatment-type labels (user-facing). */
export const TREATMENT_MSG = {
  cementation: ml('Carburizing', 'Cémentation', 'Aufkohlen'),
  carbonitruration: ml('Carbonitriding', 'Carbonitruration', 'Carbonitrieren'),
  nitruration: ml('Nitriding', 'Nitruration', 'Nitrieren'),
  trempe: ml('Quenching', 'Trempe', 'Härten'), // TODO(de): review — "Härten" (hardening) vs "Abschrecken" (quenching as a process)
  revenu: ml('Tempering', 'Revenu', 'Anlassen'),
  recuit: ml('Annealing', 'Recuit', 'Glühen'),
  detente: ml('Stress relieving', 'Détensionnement', 'Spannungsarmglühen'), // TODO(de): review — confirm "Spannungsarmglühen" is the preferred term
  normalisation: ml('Normalizing', 'Normalisation', 'Normalglühen'),
  autre: ml('Other', 'Autre', 'Sonstiges')
} as const;

/** Quench-medium labels (user-facing). */
export const QUENCH_MSG = {
  none: ml('None', 'Aucune', 'Keine'),
  oil: ml('Oil', 'Huile', 'Öl'),
  water: ml('Water', 'Eau', 'Wasser'),
  polymer: ml('Polymer', 'Polymère', 'Polymer'),
  gas: ml('Gas (pressurized)', 'Gaz (sous pression)', 'Gas (unter Druck)'),
  air: ml('Air', 'Air', 'Luft'),
  salt: ml('Salt bath', 'Bain de sels', 'Salzbad')
} as const;

/** Report-status labels (user-facing). */
export const STATUS_MSG = {
  draft: ml('Draft', 'Brouillon', 'Entwurf'),
  running: ml('Running', 'En cours', 'Laufend'),
  completed: ml('Completed', 'Terminé', 'Abgeschlossen'),
  validated: ml('Validated', 'Validé', 'Validiert'),
  rejected: ml('Rejected', 'Refusé', 'Abgelehnt')
} as const;

/** Conformity-verdict labels (user-facing). */
export const CONFORMITY_MSG = {
  pending: ml('Pending', 'En attente', 'Ausstehend'),
  conform: ml('Conform', 'Conforme', 'Konform'),
  nonconform: ml('Non-conform', 'Non conforme', 'Nicht konform')
} as const;

/** Confirm-delete prompt for one report (plain string — transient dialog). */
export function confirmDeleteMsg(name: string): string {
  return localize(
    ml(`Delete report “${name}”?`, `Supprimer le rapport « ${name} » ?`, `Bericht „${name}“ löschen?`)
  );
}

/** Validation line for the print document (plain string). */
export function printValidatedByMsg(by: string, at: string): string {
  if (at) {
    return localize(
      ml(`Validated by ${by} on ${at}`, `Validé par ${by} le ${at}`, `Validiert von ${by} am ${at}`)
    );
  }
  return localize(ml(`Validated by ${by}`, `Validé par ${by}`, `Validiert von ${by}`));
}

/** Cycle summary line for the print document (plain string). */
export function printCycleSummaryMsg(
  inBandPct: number,
  maxDeviation: number,
  minTemp: number,
  maxTemp: number,
  simulated: boolean
): string {
  const sim = simulated
    ? localize(ml(' (simulated curve)', ' (courbe simulée)', ' (simulierte Kurve)'))
    : '';
  const label = localize(ml('Cycle:', 'Cycle :', 'Zyklus:'));
  const inBand = localize(ml('within tolerance', 'dans la tolérance', 'innerhalb der Toleranz'));
  const dev = localize(ml('max deviation', 'écart max', 'max. Abweichung'));
  return `<p><strong>${label}</strong> ${inBandPct}% ${inBand} · ${dev} ${maxDeviation} °C · min/max ${minTemp}/${maxTemp} °C${sim}</p>`;
}
