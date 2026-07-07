// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Fleet KPI Analysis page.
 *
 * All user-visible strings are {@link MultiLangString} maps resolved against the
 * active WebUI language via the shared `localize` singleton (same instance as the
 * app shell, so the page reacts to the user's language). Use {@link localizeDir}
 * inside templates (reactive, re-renders on language change) and {@link localize}
 * for plain-string contexts (current language at call time — e.g. echarts axis /
 * series names, placeholders set as attributes).
 *
 * Locale keys use the base `.utf8` form (`en_US.utf8` / `fr.utf8` / `de.utf8`) so
 * any country variant (fr_FR, de_AT, de_CH, …) still resolves — the resolver
 * falls back to the language sub-tag.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Static UI strings, grouped by area. */
export const MSG = {
  toolbar: {
    back: ml('Back', 'Retour', 'Zurück'),
    start: ml('Start', 'Début', 'Beginn'),
    end: ml('End', 'Fin', 'Ende'),
    ateliers: ml('Workshops', 'Ateliers', 'Werkstätten'),
    allAteliers: ml('All workshops', 'Tous les ateliers', 'Alle Werkstätten'),
    machines: ml('Machines', 'Machines', 'Maschinen'),
    allMachines: ml('All machines', 'Toutes les machines', 'Alle Maschinen'),
    refresh: ml('Refresh', 'Actualiser', 'Aktualisieren')
  },
  roleForbidden: ml(
    'Your groups do not hold the "view" role of this page.',
    'Vos groupes ne possèdent pas le rôle « consulter » de cette page.',
    'Ihre Gruppen besitzen die Rolle „Ansehen" dieser Seite nicht.'
  ),
  offline: ml(
    'Offline mode: workshop configuration unavailable (backend not connected). History data cannot be read.',
    "Mode hors-ligne : configuration des ateliers indisponible (backend non connecté). Les données d'historique ne peuvent pas être lues.",
    'Offline-Modus: Werkstattkonfiguration nicht verfügbar (Backend nicht verbunden). Verlaufsdaten können nicht gelesen werden.'
  ),
  tabs: {
    table: ml('Table', 'Tableau', 'Tabelle'),
    chart: ml('Chart', 'Graphique', 'Diagramm')
  },
  content: {
    noMachines: ml(
      'No selected machine has a state and stop-cause datapoint configured.',
      "Aucune machine sélectionnée n'a de datapoint d'état et de cause d'arrêt configurés.",
      'Keine ausgewählte Maschine hat einen Status- und Stillstandsursachen-Datenpunkt konfiguriert.'
    ),
    noHistory: ml(
      'No history data over the period. Check that the state and cause datapoints are archived (NGA archiving configuration).',
      "Aucune donnée d'historique sur la période. Vérifiez que les datapoints d'état et de cause sont archivés (configuration d'archivage NGA).",
      'Keine Verlaufsdaten im Zeitraum. Prüfen Sie, ob die Status- und Ursachen-Datenpunkte archiviert werden (NGA-Archivierungskonfiguration).'
    )
  },
  table: {
    searchMachine: ml('Search a machine…', 'Rechercher une machine…', 'Maschine suchen…'),
    machine: ml('Machine', 'Machine', 'Maschine'),
    trs: ml('OEE (availability)', 'TRS (disponibilité)', 'OEE (Verfügbarkeit)'),
    unplanned: ml('Unplanned stop', 'Arrêt non planifié', 'Ungeplanter Stillstand'),
    planned: ml('Planned stop', 'Arrêt planifié', 'Geplanter Stillstand'),
    fleet: ml('Fleet', 'Parc', 'Maschinenpark'),
    noHistoryRow: ml('(no history)', "(pas d'historique)", '(kein Verlauf)')
  },
  chart: {
    trsAxis: ml('OEE %', 'TRS %', 'OEE %'),
    trsSeries: ml('OEE', 'TRS', 'OEE')
  }
} as const;
