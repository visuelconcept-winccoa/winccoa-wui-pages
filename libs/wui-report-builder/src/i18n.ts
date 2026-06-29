// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable sonarjs/no-duplicate-string -- a translation catalog repeats short field/column labels (e.g. "Model", "Subject", "Status") across UI areas by design */

/**
 * Internationalisation for the Report Builder page.
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

// --- shared labels reused across several UI areas (hoisted to avoid duplicates) ---
const ML_MODEL = ml('Template', 'Modèle', 'Vorlage');
const ML_SUBJECT = ml('Subject', 'Objet', 'Betreff');
const ML_STATE = ml('State', 'État', 'Status');
const ML_REPORT_NO = ml('Report no.', 'N° rapport', 'Bericht-Nr.');
const ML_TITLE = ml('Title', 'Titre', 'Titel');
const ML_SIGNATURES = ml('Signatures', 'Signatures', 'Unterschriften');
const ML_CREATED_AT = ml('Created on', 'Créé le', 'Erstellt am');
const ML_CANCEL = ml('Cancel', 'Annuler', 'Abbrechen');
const ML_SAVE = ml('Save', 'Enregistrer', 'Speichern');
const ML_DELETE = ml('Delete', 'Supprimer', 'Löschen');
const ML_OPEN = ml('Open', 'Ouvrir', 'Öffnen');
const ML_PERIOD_START = ml('Period — start', 'Période — début', 'Zeitraum — Beginn');
const ML_PERIOD_END = ml('Period — end', 'Période — fin', 'Zeitraum — Ende');
const ML_LEVEL = ml('Level', 'Niveau', 'Stufe');
const ML_ROLE = ml('Role', 'Rôle', 'Rolle');
const ML_SIGNER = ml('Signer', 'Signataire', 'Unterzeichner');
const ML_DATE = ml('Date', 'Date', 'Datum');
const ML_COMMENT = ml('Comment', 'Commentaire', 'Kommentar');
const ML_OK = ml('OK', 'OK', 'OK');
const ML_OUT_OF_TOLERANCE = ml('Out of tolerance', 'Hors tolérance', 'Außerhalb der Toleranz');
const ML_REQUIRED = ml('required', 'obligatoire', 'erforderlich');
const ML_ACTION = ml('Action', 'Action', 'Aktion');
const ML_TARGET_STATE = ml('Target state', 'État cible', 'Zielstatus');
const ML_MEASURE = ml('Measure', 'Mesure', 'Messgröße');

/** Static UI strings, grouped by area. */
export const MSG = {
  page: {
    templates: ml('Templates', 'Modèles', 'Vorlagen'),
    import: ml('Import', 'Importer', 'Importieren'),
    newReport: ml('New report', 'Nouveau rapport', 'Neuer Bericht'),
    offline: ml(
      'Offline mode: changes are not persisted (backend unavailable or missing write rights).',
      "Mode hors-ligne : modifications non persistées (backend indisponible ou droits d'écriture manquants).",
      'Offline-Modus: Änderungen werden nicht gespeichert (Backend nicht verfügbar oder fehlende Schreibrechte).'
    ),
    empty: ml("No reports yet.", "Aucun rapport pour l'instant.", 'Noch keine Berichte.'),
    emptyNoTemplate: ml(
      'Create a template first (the "Templates" page), or generate the demonstration.',
      "Créez d'abord un modèle (page « Modèles »), ou générez la démonstration.",
      'Erstellen Sie zuerst eine Vorlage (Seite „Vorlagen“) oder erzeugen Sie die Demonstration.'
    ),
    generateDemo: ml(
      'Generate the demonstration',
      'Générer la démonstration',
      'Demonstration erzeugen'
    )
  },
  kpi: {
    reports: ml('Reports', 'Rapports', 'Berichte'),
    inProgress: ml('In progress', 'En cours', 'In Bearbeitung'),
    approved: ml('Approved', 'Approuvés', 'Genehmigt'),
    rejected: ml('Rejected', 'Rejetés', 'Abgelehnt')
  },
  reportTable: {
    reportNo: ML_REPORT_NO,
    titleSubject: ml('Title / subject', 'Titre / objet', 'Titel / Betreff'),
    model: ML_MODEL,
    state: ML_STATE,
    signatures: ML_SIGNATURES,
    untitled: ml('(untitled)', '(sans titre)', '(ohne Titel)'),
    open: ML_OPEN,
    remove: ML_DELETE
  },
  templateTable: {
    model: ML_MODEL,
    sections: ml('Sections', 'Sections', 'Abschnitte'),
    statesSignatures: ml('States / signatures', 'États / signatures', 'Status / Unterschriften'),
    updated: ml('Updated', 'Mis à jour', 'Aktualisiert'),
    unnamed: ml('(unnamed)', '(sans nom)', '(ohne Namen)'),
    statesLevels: ml('states', 'états', 'Status'),
    signatureLevels: ml('signature level(s)', 'niveau(x) de signature', 'Unterschriftsstufe(n)'),
    edit: ml('Edit', 'Éditer', 'Bearbeiten'),
    view: ml('View', 'Visualiser', 'Anzeigen'),
    duplicate: ml('Duplicate', 'Dupliquer', 'Duplizieren'),
    remove: ML_DELETE
  },
  reportDialog: {
    title: ml('New report', 'Nouveau rapport', 'Neuer Bericht'),
    noTemplate: ml(
      'No template available. Create a template first in the "Templates" tab.',
      "Aucun modèle disponible. Créez d'abord un modèle dans l'onglet « Modèles ».",
      'Keine Vorlage verfügbar. Erstellen Sie zuerst eine Vorlage im Reiter „Vorlagen“.'
    ),
    model: ML_MODEL,
    unnamed: ml('(no name)', '(sans nom)', '(kein Name)'),
    reportNo: ML_REPORT_NO,
    fTitle: ML_TITLE,
    subject: ML_SUBJECT,
    periodStart: ML_PERIOD_START,
    periodEnd: ML_PERIOD_END,
    periodHint: ml(
      'The period is used by the "Data" sections (reading the archives over this interval).',
      'La période sert aux sections « Données » (lecture des archives sur cet intervalle).',
      'Der Zeitraum wird von den Abschnitten „Daten“ verwendet (Lesen der Archive über dieses Intervall).'
    ),
    cancel: ML_CANCEL,
    create: ml('Create', 'Créer', 'Erstellen')
  },
  detail: {
    back: ml('Back', 'Retour', 'Zurück'),
    noNumber: ml('(no no.)', '(sans n°)', '(keine Nr.)'),
    save: ML_SAVE,
    print: ml('Print', 'Imprimer', 'Drucken'),
    lockedNote: ml(
      'Report locked (final state)',
      'Rapport verrouillé (état final)',
      'Bericht gesperrt (Endzustand)'
    ),
    model: ML_MODEL,
    subject: ML_SUBJECT,
    createdAt: ML_CREATED_AT,
    periodStart: ML_PERIOD_START,
    periodEnd: ML_PERIOD_END,
    ok: ML_OK,
    outOfTolerance: ML_OUT_OF_TOLERANCE,
    addRow: ml('Add a row', 'Ajouter une ligne', 'Zeile hinzufügen'),
    refreshData: ml('Refresh the data', 'Actualiser les données', 'Daten aktualisieren'),
    measure: ML_MEASURE,
    indicators: ml('Indicators', 'Indicateurs', 'Kennzahlen'),
    points: ml('Points', 'Points', 'Punkte'),
    computedAt: ml('Computed on', 'Calculé le', 'Berechnet am'),
    refreshHint: ml('— (click "Refresh")', '— (cliquez « Actualiser »)', '— (auf „Aktualisieren“ klicken)'),
    required: ML_REQUIRED,
    signatures: ML_SIGNATURES,
    colLevel: ML_LEVEL,
    colRole: ML_ROLE,
    colSigner: ML_SIGNER,
    colDate: ML_DATE,
    colComment: ML_COMMENT
  },
  signatureDialog: {
    fallbackTitle: ml('Sign', 'Signer', 'Unterschreiben'),
    roleLevel: ml('Role / level', 'Rôle / niveau', 'Rolle / Stufe'),
    level: ml('level', 'niveau', 'Stufe'),
    signer: ML_SIGNER,
    connectedUser: ml('Connected user', 'Utilisateur connecté', 'Angemeldeter Benutzer'),
    commentOptional: ml('Comment (optional)', 'Commentaire (optionnel)', 'Kommentar (optional)'),
    commentPlaceholder: ml('Approval, observations…', 'Visa, observations…', 'Sichtvermerk, Anmerkungen…'),
    hint: ml(
      'The signature records your name and the timestamp, then advances the report state.',
      "La signature enregistre votre nom et l'horodatage, puis fait avancer l'état du rapport.",
      'Die Unterschrift erfasst Ihren Namen und den Zeitstempel und bringt den Berichtsstatus voran.'
    ),
    cancel: ML_CANCEL,
    sign: ml('Sign', 'Signer', 'Unterschreiben')
  },
  editor: {
    template: ml('Template', 'Modèle', 'Vorlage'),
    newTemplate: ml('New template', 'Nouveau modèle', 'Neue Vorlage'),
    name: ml('Template name', 'Nom du modèle', 'Vorlagenname'),
    description: ml('Description', 'Description', 'Beschreibung'),
    tabSections: ml('Sections', 'Sections', 'Abschnitte'),
    tabWorkflow: ml('Workflow & signatures', 'Workflow & signatures', 'Workflow & Unterschriften'),
    cancel: ML_CANCEL,
    close: ml('Close', 'Fermer', 'Schließen'),
    save: ML_SAVE,
    reportSections: ml('Report sections', 'Sections du rapport', 'Berichtsabschnitte'),
    addSection: ml('Add a section', 'Ajouter une section', 'Abschnitt hinzufügen'),
    noSection: ml('No section.', 'Aucune section.', 'Kein Abschnitt.'),
    sectionTitlePlaceholder: ml('Section title', 'Titre de la section', 'Abschnittstitel'),
    moveUp: ml('Move up', 'Monter', 'Nach oben'),
    moveDown: ml('Move down', 'Descendre', 'Nach unten'),
    remove: ML_DELETE,
    placeholderHelp: ml(
      'Help text (placeholder)',
      "Texte d'aide (placeholder)",
      'Hilfetext (Platzhalter)'
    ),
    fieldLabel: ml('Label', 'Libellé', 'Bezeichnung'),
    fieldUnit: ml('Unit', 'Unité', 'Einheit'),
    addField: ml('Add a field', 'Ajouter un champ', 'Feld hinzufügen'),
    columnsHint: ml(
      'Table columns (rows are entered in the report).',
      'Colonnes du tableau (les lignes sont saisies dans le rapport).',
      'Tabellenspalten (die Zeilen werden im Bericht erfasst).'
    ),
    column: ml('Column', 'Colonne', 'Spalte'),
    addColumn: ml('Add a column', 'Ajouter une colonne', 'Spalte hinzufügen'),
    boundMin: ml('min', 'min', 'Min'),
    boundMax: ml('max', 'max', 'Max'),
    showChart: ml('Show a chart', 'Afficher un graphique', 'Diagramm anzeigen'),
    measureLabelPlaceholder: ml(
      'Measure label',
      'Libellé de la mesure',
      'Bezeichnung der Messgröße'
    ),
    datapoint: ml('Datapoint', 'Datapoint', 'Datenpunkt'),
    addMeasure: ml('Add a measure', 'Ajouter une mesure', 'Messgröße hinzufügen'),
    checklistItemPlaceholder: ml('Item to check', 'Point à vérifier', 'Zu prüfender Punkt'),
    mandatory: ml('Mandatory', 'Obligatoire', 'Erforderlich'),
    addItem: ml('Add an item', 'Ajouter un point', 'Punkt hinzufügen'),
    statesSignatures: ml('States & signatures', 'États & signatures', 'Status & Unterschriften'),
    addState: ml('Add a state', 'Ajouter un état', 'Status hinzufügen'),
    workflowHint: ml(
      'Each "advance" transition defines a signature level: role, level, required permission and checklist requirement.',
      'Chaque « transition » (avancer) définit un niveau de signature : rôle, niveau, permission requise et exigence de checklist.',
      'Jeder „Übergang“ (Vorrücken) definiert eine Unterschriftsstufe: Rolle, Stufe, erforderliche Berechtigung und Checklisten-Anforderung.'
    ),
    stateLabelPlaceholder: ml("State label", "Libellé de l'état", 'Status-Bezeichnung'),
    advanceToggle: ml(
      '"Advance" transition (signature)',
      'Transition « avancer » (signature)',
      'Übergang „Vorrücken“ (Unterschrift)'
    ),
    action: ML_ACTION,
    roleLevel: ml('Role / level', 'Rôle / niveau', 'Rolle / Stufe'),
    level: ML_LEVEL,
    targetState: ML_TARGET_STATE,
    requirePermission: ml(
      'Permission required (canPublish)',
      'Permission requise (canPublish)',
      'Berechtigung erforderlich (canPublish)'
    ),
    requireChecklist: ml(
      'Checklist mandatory',
      'Checklist obligatoire',
      'Checkliste erforderlich'
    ),
    rejectToggle: ml(
      '"Reject / send back" transition',
      'Transition « rejeter / renvoyer »',
      'Übergang „Ablehnen / Zurücksenden“'
    )
  },
  chart: {
    empty: ml(
      'No archived data over the period.',
      'Aucune donnée archivée sur la période.',
      'Keine archivierten Daten im Zeitraum.'
    )
  },
  print: {
    fallbackTitle: ml('Report', 'Rapport', 'Bericht'),
    reportNo: ML_REPORT_NO,
    title: ML_TITLE,
    subject: ML_SUBJECT,
    model: ML_MODEL,
    period: ml('Period', 'Période', 'Zeitraum'),
    state: ML_STATE,
    createdAt: ML_CREATED_AT,
    signatures: ML_SIGNATURES,
    colLevel: ML_LEVEL,
    colRole: ML_ROLE,
    colSigner: ML_SIGNER,
    colDate: ML_DATE,
    colComment: ML_COMMENT,
    chartAlt: ml('Chart', 'Graphique', 'Diagramm'),
    ok: ML_OK,
    outOfTolerance: ML_OUT_OF_TOLERANCE,
    mandatory: ml('mandatory', 'obligatoire', 'erforderlich')
  },
  csv: {
    reportNo: ML_REPORT_NO,
    title: ML_TITLE,
    subject: ML_SUBJECT,
    model: ML_MODEL,
    state: ML_STATE,
    signatures: ML_SIGNATURES,
    createdAt: ML_CREATED_AT
  },
  io: {
    importFailed: ml('Import failed.', 'Import échoué.', 'Import fehlgeschlagen.'),
    invalidTemplates: ml(
      'Invalid format: "templates" array not found.',
      'Format invalide : tableau « templates » introuvable.',
      'Ungültiges Format: Array „templates“ nicht gefunden.'
    ),
    invalidReports: ml(
      'Invalid format: "reports" array not found.',
      'Format invalide : tableau « reports » introuvable.',
      'Ungültiges Format: Array „reports“ nicht gefunden.'
    ),
    importedTemplate: ml('Imported template', 'Modèle importé', 'Importierte Vorlage')
  },
  engine: {
    noTransition: ml(
      'No transition from this state.',
      'Aucune transition depuis cet état.',
      'Kein Übergang aus diesem Status.'
    ),
    permissionRequired: ml(
      'Publish permission required to sign.',
      'Permission de publication requise pour signer.',
      'Veröffentlichungsberechtigung zum Unterschreiben erforderlich.'
    ),
    checklistIncomplete: ml(
      'Checklist incomplete: check all the mandatory items.',
      'Checklist incomplète : cochez tous les points obligatoires.',
      'Checkliste unvollständig: Haken Sie alle Pflichtpunkte ab.'
    ),
    fallbackUser: ml('User', 'Utilisateur', 'Benutzer')
  }
} as const;

// --- enum-keyed label maps (user-facing; consumed by templates + editor + print) ---

/** Section-kind labels (user-facing). Rendered in the editor select + used as a default section title. */
export const SECTION_KIND_MSG = {
  text: ml('Free text', 'Texte libre', 'Freitext'),
  comment: ml('Comment area', 'Zone de commentaire', 'Kommentarbereich'),
  fields: ml('Key/value fields', 'Champs clé/valeur', 'Schlüssel/Wert-Felder'),
  table: ml('Manual table', 'Tableau manuel', 'Manuelle Tabelle'),
  dataset: ml('Data (datapoints)', 'Données (datapoints)', 'Daten (Datenpunkte)'),
  checklist: ml('Checklist', 'Checklist', 'Checkliste')
} as const;

/** Field-type labels (user-facing). */
export const FIELD_TYPE_MSG = {
  text: ml('Text', 'Texte', 'Text'),
  number: ml('Number', 'Nombre', 'Zahl'),
  date: ml('Date', 'Date', 'Datum')
} as const;

/** Aggregation-operation labels (user-facing). */
export const AGG_MSG = {
  avg: ml('Average', 'Moyenne', 'Mittelwert'),
  min: ml('Minimum', 'Minimum', 'Minimum'),
  max: ml('Maximum', 'Maximum', 'Maximum'),
  sum: ml('Sum', 'Somme', 'Summe'),
  last: ml('Last value', 'Dernière valeur', 'Letzter Wert'),
  count: ml('Number of points', 'Nombre de points', 'Anzahl der Punkte'),
  stddev: ml('Standard deviation', 'Écart-type', 'Standardabweichung')
} as const;

/** State-kind labels (user-facing). */
export const STATE_KIND_MSG = {
  start: ml('Initial', 'Initial', 'Anfänglich'),
  intermediate: ml('Intermediate', 'Intermédiaire', 'Zwischen'),
  final: ml('Final (locked)', 'Final (verrouillé)', 'Endgültig (gesperrt)'),
  rejected: ml('Rejected', 'Rejeté', 'Abgelehnt')
} as const;

// --- default workflow / blank-factory labels (stored values, localized at creation) ---

/** Default labels for the seed workflow and the editor's blank factories. */
export const DEFAULTS_MSG = {
  // default 4-state workflow
  stateDraft: ml('Draft', 'Brouillon', 'Entwurf'),
  stateChecked: ml('Verified', 'Vérifié', 'Geprüft'),
  stateApproved: ml('Approved', 'Approuvé', 'Genehmigt'),
  stateRejected: ml('Rejected', 'Rejeté', 'Abgelehnt'),
  advanceVerify: ml('Verify & sign', 'Vérifier & signer', 'Prüfen & unterschreiben'),
  advanceApprove: ml('Approve & sign', 'Approuver & signer', 'Genehmigen & unterschreiben'),
  roleOperator: ml('Operator', 'Opérateur', 'Bediener'),
  roleManager: ml('Manager', 'Responsable', 'Verantwortlicher'),
  reject: ml('Reject', 'Rejeter', 'Ablehnen'),
  sendBackToDraft: ml('Send back to draft', 'Renvoyer en brouillon', 'Zurück an Entwurf senden'),
  // blank factories
  field: ml('Field', 'Champ', 'Feld'),
  column: ml('Column', 'Colonne', 'Spalte'),
  measure: ML_MEASURE,
  checklistItem: ml('Item to check', 'Point à vérifier', 'Zu prüfender Punkt'),
  // editor "add state" / toggle defaults
  newState: ml('New state', 'Nouvel état', 'Neuer Status'),
  advanceSign: ml('Sign & advance', 'Signer & avancer', 'Unterschreiben & vorrücken'),
  roleSigner: ml('Signer', 'Signataire', 'Unterzeichner')
} as const;

// --- plain-string helpers (transient / interpolated messages) ---

/** Confirm-delete prompt for one report (plain string — transient dialog). */
export function confirmDeleteReportMsg(name: string): string {
  return localize(
    ml(`Delete report "${name}"?`, `Supprimer le rapport « ${name} » ?`, `Bericht „${name}“ löschen?`)
  );
}
