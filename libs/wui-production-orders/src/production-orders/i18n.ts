// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Production Orders page (EN / FR / DE), following
 * the shared `lit-translate` singleton (same instance as the app shell, so the
 * page reacts to the user's language). Use `localizeDir(...)` inside templates
 * (reactive, re-renders on language change) and `localize(...)` for plain-string
 * contexts (attributes, thrown/assigned messages — current language at call time).
 *
 * Locale keys use the base `.utf8` form (`en_US.utf8` / `fr.utf8` / `de.utf8`) so
 * any country variant (fr_FR, de_AT, de_CH, …) still resolves.
 *
 * NOTE: `OrderStatus` / `OrderPriority` type literals (`planned`, `running`,
 * `low`, …), datapoint names (`ProductionOrders_List`, `ProductionOrders_Kpi`),
 * event names (`wui:save`, …) and CSV/JSON export *contract* keys are NOT
 * translated — only the on-screen labels are.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

// Shared label triples reused across table / dialog / CSV groups. Hoisted to
// satisfy sonarjs/no-duplicate-string (same on-screen labels in several places).
const ORDER_NO = ml('Order no.', 'N° OF', 'Auftrags-Nr.');
const PLANNED_START = ml('Planned start', 'Début prévu', 'Geplanter Beginn');
const PLANNED_END = ml('Planned end', 'Fin prévue', 'Geplantes Ende');
const ACTUAL_START = ml('Actual start', 'Début réel', 'Tatsächlicher Beginn');
const ACTUAL_END = ml('Actual end', 'Fin réelle', 'Tatsächliches Ende');
const PRODUCT = ml('Product', 'Produit', 'Produkt');
const MACHINE = ml('Machine', 'Machine', 'Maschine');
const WORKSHOP = ml('Workshop', 'Atelier', 'Werkstatt');
const STATUS = ml('Status', 'Statut', 'Status');
const PRIORITY = ml('Priority', 'Priorité', 'Priorität');
const NOTES = ml('Notes', 'Notes', 'Notizen');

/** Static UI strings, grouped by area. */
export const MSG = {
  toolbar: {
    table: ml('Table', 'Table', 'Tabelle'),
    planning: ml('Planning', 'Planning', 'Planung'),
    importJson: ml('Import JSON', 'Importer JSON', 'JSON importieren'),
    exportJson: ml('Export JSON', 'Export JSON', 'JSON exportieren'),
    exportCsv: ml('Export CSV', 'Export CSV', 'CSV exportieren'),
    newOrder: ml('New order', 'Nouvel ordre', 'Neuer Auftrag')
  },
  notice: {
    offline: ml(
      'Offline mode: changes are not persisted to the datapoints (backend unavailable or missing write rights).',
      "Mode hors-ligne : modifications non persistées dans les datapoints (backend indisponible ou droits d'écriture manquants).",
      'Offline-Modus: Änderungen werden nicht in den Datenpunkten gespeichert (Backend nicht verfügbar oder fehlende Schreibrechte).'
    ),
    roleForbidden: ml(
      'Your groups do not hold the "view" role of this page.',
      'Vos groupes ne possèdent pas le rôle « consulter » de cette page.',
      'Ihre Gruppen besitzen die Rolle „Ansehen“ dieser Seite nicht.'
    )
  },
  empty: {
    none: ml(
      'No production order yet.',
      "Aucun ordre de production pour l'instant.",
      'Noch kein Fertigungsauftrag.'
    ),
    generateDemo: ml(
      'Generate demo orders',
      'Générer des OF de démonstration',
      'Demo-Aufträge erzeugen'
    ),
    importFailed: ml('Import failed.', 'Import échoué.', 'Import fehlgeschlagen.')
  },
  // Lifecycle status labels, keyed by the fixed `OrderStatus` type literal
  // (the key itself is a data contract and is NOT translated).
  status: {
    planned: ml('Upcoming', 'À venir', 'Geplant'),
    running: ml('Running', 'En cours', 'Läuft'),
    paused: ml('Paused', 'En pause', 'Pausiert'),
    done: ml('Done', 'Terminé', 'Fertig'),
    cancelled: ml('Cancelled', 'Annulé', 'Abgebrochen')
  },
  // Priority labels, keyed by the fixed `OrderPriority` type literal.
  priority: {
    low: ml('Low', 'Basse', 'Niedrig'),
    normal: ml('Normal', 'Normale', 'Normal'),
    high: ml('High', 'Haute', 'Hoch'),
    urgent: ml('Urgent', 'Urgente', 'Dringend')
  },
  // Status-workflow action labels (shown as icon-button tooltips).
  action: {
    start: ml('Start', 'Démarrer', 'Starten'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    pause: ml('Pause', 'Pause', 'Pause'),
    done: ml('Complete', 'Terminer', 'Abschließen'),
    resume: ml('Resume', 'Reprendre', 'Fortsetzen')
  },
  kpi: {
    orders: ml('Orders', 'Ordres', 'Aufträge'),
    upcoming: ml('Upcoming', 'À venir', 'Geplant'),
    running: ml('Running', 'En cours', 'Läuft'),
    done: ml('Done', 'Terminés', 'Fertig'),
    late: ml('Late', 'En retard', 'Verspätet')
  },
  gantt: {
    empty: ml(
      'No scheduled order (fill in the “planned start/end” dates).',
      'Aucun ordre planifié (renseignez les dates « début/fin prévue »).',
      'Kein geplanter Auftrag (tragen Sie die Termine „geplanter Beginn/Ende“ ein).'
    )
  },
  table: {
    orderNo: ORDER_NO,
    product: PRODUCT,
    machine: ml('Workshop · Machine', 'Atelier · Machine', 'Werkstatt · Maschine'),
    plannedStart: PLANNED_START,
    plannedEnd: PLANNED_END,
    qty: ml('Qty', 'Qté', 'Menge'),
    progress: ml('Progress', 'Avancement', 'Fortschritt'),
    priority: PRIORITY,
    status: STATUS,
    edit: ml('Edit', 'Modifier', 'Bearbeiten'),
    delete: ml('Delete', 'Supprimer', 'Löschen')
  },
  dialog: {
    titleNew: ml('New production order', 'Nouvel ordre de production', 'Neuer Fertigungsauftrag'),
    subIdentity: ml('Identity & product', 'Identité & produit', 'Identität & Produkt'),
    subAssignment: ml('Assignment', 'Affectation', 'Zuweisung'),
    subSchedule: ml('Schedule', 'Planning', 'Terminplan'),
    subStatus: ml('Status & priority', 'Statut & priorité', 'Status & Priorität'),
    subNotes: NOTES,
    orderNo: ORDER_NO,
    product: ml('Product designation', 'Désignation produit', 'Produktbezeichnung'),
    article: ml('Article reference', 'Référence article', 'Artikelreferenz'),
    qtyOrdered: ml('Ordered quantity', 'Quantité commandée', 'Bestellmenge'),
    qtyProduced: ml('Produced quantity', 'Quantité produite', 'Produzierte Menge'),
    plannedStart: PLANNED_START,
    plannedEnd: PLANNED_END,
    actualStart: ACTUAL_START,
    actualEnd: ACTUAL_END,
    status: STATUS,
    priority: PRIORITY,
    progress: ml('Progress (%)', 'Avancement (%)', 'Fortschritt (%)'),
    atelier: WORKSHOP,
    machine: MACHINE,
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    save: ml('Save', 'Enregistrer', 'Speichern')
  },
  // CSV export column header labels. The export *order* / data contract keys are
  // fixed; only the visible header text is localized.
  csv: {
    orderNo: ORDER_NO,
    product: PRODUCT,
    article: ml('Article', 'Article', 'Artikel'),
    qtyOrdered: ml('Ordered qty', 'Qté commandée', 'Bestellmenge'),
    qtyProduced: ml('Produced qty', 'Qté produite', 'Produzierte Menge'),
    atelier: WORKSHOP,
    machine: MACHINE,
    plannedStart: PLANNED_START,
    plannedEnd: PLANNED_END,
    actualStart: ACTUAL_START,
    actualEnd: ACTUAL_END,
    status: STATUS,
    priority: PRIORITY,
    progress: ml('Progress %', 'Avancement %', 'Fortschritt %'),
    notes: NOTES
  },
  io: {
    invalidFormat: ml(
      'Invalid format: “orders” array not found.',
      'Format invalide : tableau « orders » introuvable.',
      'Ungültiges Format: Array „orders“ nicht gefunden.'
    )
  }
} as const;

/** Localized lifecycle-status label (by `OrderStatus` literal). */
export function statusLabel(key: keyof typeof MSG.status): MultiLangString {
  return MSG.status[key];
}

/** Localized priority label (by `OrderPriority` literal). */
export function priorityLabel(key: keyof typeof MSG.priority): MultiLangString {
  return MSG.priority[key];
}

/** Edit-dialog title for an existing order (plain string — interpolates the order no.). */
export function editTitleMsg(orderNo: string): string {
  return localize(ml(`Edit — ${orderNo}`, `Édition — ${orderNo}`, `Bearbeiten — ${orderNo}`));
}

/** Confirm-delete prompt for one order (plain string — transient dialog). */
export function confirmDeleteMsg(name: string): string {
  return localize(
    ml(
      `Delete order “${name}”?`,
      `Supprimer l'ordre « ${name} » ?`,
      `Auftrag „${name}“ löschen?`
    )
  );
}
