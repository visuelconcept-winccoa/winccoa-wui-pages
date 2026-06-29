// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Fleet Stop-Cause Analysis page (EN / FR / DE),
 * following the shared `lit-translate` singleton (same instance as the app shell,
 * so the page reacts to the user's language). Use {@link localizeDir} inside
 * templates (reactive, re-renders on language change) and {@link localize} for
 * plain-string contexts (current language at call time — attributes, labels,
 * placeholders, tooltips).
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
  toolbar: {
    back: ml('Back', 'Retour', 'Zurück'),
    stopCauses: ml('Stop causes', "Causes d'arrêt", 'Stoppursachen'),
    dateStart: ml('Start', 'Début', 'Start'),
    dateEnd: ml('End', 'Fin', 'Ende'),
    ateliers: ml('Workshops', 'Ateliers', 'Werkstätten'),
    allAteliers: ml('All workshops', 'Tous les ateliers', 'Alle Werkstätten'),
    machines: ml('Machines', 'Machines', 'Maschinen'),
    allMachines: ml('All machines', 'Toutes les machines', 'Alle Maschinen'),
    sortBy: ml('Sort by', 'Trier par', 'Sortieren nach'),
    timeCategory: ml('Time category', 'Catégorie de temps', 'Zeitkategorie'),
    refresh: ml('Refresh', 'Actualiser', 'Aktualisieren')
  },
  sort: {
    assigned: ml('Total assigned time', 'Cumul de temps assigné', 'Summe zugewiesener Zeit'),
    downtime: ml('Total downtime', "Temps d'arrêt total", 'Gesamtstillstandszeit'),
    occurrences: ml('Number of occurrences', "Nombre d'occurrences", 'Anzahl der Vorkommen')
  },
  classFilter: {
    unplanned: ml('Unplanned', 'Non planifié', 'Ungeplant'),
    planned: ml('Planned', 'Planifié', 'Geplant'),
    all: ml('All categories', 'Toutes catégories', 'Alle Kategorien')
  },
  chartTop: {
    top5: ml('Top 5', 'Top 5', 'Top 5'),
    top10: ml('Top 10', 'Top 10', 'Top 10'),
    all: ml('All causes', 'Toutes les causes', 'Alle Ursachen')
  },
  offline: ml(
    'Offline mode: workshop configuration unavailable (backend not connected). History data cannot be read.',
    "Mode hors-ligne : configuration des ateliers indisponible (backend non connecté). Les données d'historique ne peuvent pas être lues.",
    'Offline-Modus: Werkstattkonfiguration nicht verfügbar (Backend nicht verbunden). Verlaufsdaten können nicht gelesen werden.'
  ),
  tabs: {
    table: ml('Table', 'Tableau', 'Tabelle'),
    chart: ml('Chart', 'Graphique', 'Diagramm'),
    raw: ml('Raw data', 'Données brutes', 'Rohdaten')
  },
  empty: {
    noMachineDp: ml(
      'No selected machine has state and stop-cause datapoints configured.',
      "Aucune machine sélectionnée n'a de datapoint d'état et de cause d'arrêt configurés.",
      'Keine ausgewählte Maschine hat Status- und Stoppursachen-Datenpunkte konfiguriert.'
    ),
    noHistory: ml(
      'No history data for the period. Check that the state and cause datapoints are archived (NGA archiving configuration).',
      "Aucune donnée d'historique sur la période. Vérifiez que les datapoints d'état et de cause sont archivés (configuration d'archivage NGA).",
      'Keine Verlaufsdaten für den Zeitraum. Prüfen Sie, ob die Status- und Ursachen-Datenpunkte archiviert werden (NGA-Archivierungskonfiguration).'
    ),
    noStops: ml(
      'No stops for the selected period.',
      'Aucun arrêt sur la période sélectionnée.',
      'Keine Stopps im ausgewählten Zeitraum.'
    ),
    noCauseInCategory: ml(
      'No cause in this time category for the period.',
      'Aucune cause dans cette catégorie de temps sur la période.',
      'Keine Ursache in dieser Zeitkategorie für den Zeitraum.'
    )
  },
  table: {
    cause: ml('Cause', 'Cause', 'Ursache'),
    classification: ml('Classification', 'Classification', 'Klassifizierung'),
    assignedTime: ml('Assigned time', 'Temps assigné', 'Zugewiesene Zeit'),
    totalDowntime: ml('Total downtime', "Temps d'arrêt total", 'Gesamtstillstandszeit'),
    occurrences: ml('Occurrences', 'Occurrences', 'Vorkommen'),
    total: ml('Total', 'Total', 'Gesamt')
  },
  raw: {
    search: ml('Search for a machine…', 'Rechercher une machine…', 'Maschine suchen…'),
    machine: ml('Machine', 'Machine', 'Maschine'),
    cause: ml('Cause', 'Cause', 'Ursache'),
    category: ml('Category', 'Catégorie', 'Kategorie'),
    start: ml('Start', 'Début', 'Beginn'),
    end: ml('End', 'Fin', 'Ende'),
    duration: ml('Duration', 'Durée', 'Dauer'),
    counted: ml('Counted time', 'Temps comptabilisé', 'Gezählte Zeit'),
    countedReducedTitle: ml(
      'Reduced by a non-worked period',
      'Réduit par une période non travaillée',
      'Durch eine arbeitsfreie Zeit reduziert'
    )
  },
  chart: {
    show: ml('Show', 'Afficher', 'Anzeigen'),
    hoursAxis: ml('Hours', 'Heures', 'Stunden')
  }
} as const;

/** Footer count of raw stop records (plain string — table footer). */
export function rawStopCountMsg(count: number): string {
  return localize(ml(`${count} stop(s)`, `${count} arrêt(s)`, `${count} Stopp(s)`));
}
