// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Power plants page (EN/FR/DE).
 *
 * Same scheme as the GIS page: {@link MultiLangString} maps resolved against the active
 * WebUI language via `lit-translate`. {@link localizeDir} inside templates (reactive),
 * {@link localize} for plain strings.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import {
  STATE_FAULT,
  STATE_MAINTENANCE,
  STATE_OFF,
  STATE_RUN
} from './data/plants.js';

export {
  localize,
  localizeDir
} from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Label of each plant state (`etat`). */
export const STATE_LABELS: Record<number, MultiLangString> = {
  [STATE_OFF]: ml('Stopped', 'Arrêt', 'Aus'),
  [STATE_RUN]: ml('Running', 'Marche', 'In Betrieb'),
  [STATE_FAULT]: ml('Fault', 'Défaut', 'Störung'),
  [STATE_MAINTENANCE]: ml('Maintenance', 'Maintenance', 'Wartung')
};

export const MSG = {
  page: {
    title: ml('Power plants', 'Centrales', 'Kraftwerke'),
    subtitle: ml(
      'Operating parameters of the simulated plants, highest output first.',
      'Paramètres de fonctionnement des centrales simulées, par puissance décroissante.',
      'Betriebsparameter der simulierten Kraftwerke, höchste Leistung zuerst.'
    ),
    forbidden: ml(
      'Your groups do not hold the "view" role of this page.',
      'Vos groupes ne possèdent pas le rôle « consulter » de cette page.',
      'Ihre Gruppen besitzen die Rolle „Ansehen" dieser Seite nicht.'
    ),
    offline: ml(
      'No connection to WinCC OA: no value can be read.',
      'Pas de connexion à WinCC OA : aucune valeur ne peut être lue.',
      'Keine Verbindung zu WinCC OA: Es können keine Werte gelesen werden.'
    ),
    failed: ml(
      'The GisSim_* datapoints could not be queried.',
      'Les datapoints GisSim_* n’ont pas pu être interrogés.',
      'Die Datenpunkte GisSim_* konnten nicht abgefragt werden.'
    ),
    empty: ml(
      'No site declares a plant: an asset with both a "puissance" and a "capacite" reading.',
      'Aucun site ne déclare de centrale : un équipement avec une mesure « puissance » et une mesure « capacite ».',
      'Kein Standort deklariert ein Kraftwerk: eine Anlage mit den Messwerten „puissance" und „capacite".'
    )
  },
  summary: {
    plants: ml('Plants', 'Centrales', 'Kraftwerke'),
    running: ml('Running', 'En marche', 'In Betrieb'),
    output: ml('Total output', 'Puissance totale', 'Gesamtleistung'),
    capacity: ml(
      'Available capacity',
      'Capacité disponible',
      'Verfügbare Kapazität'
    ),
    load: ml('Fleet load', 'Charge du parc', 'Flottenauslastung')
  },
  card: {
    output: ml('Output', 'Puissance', 'Leistung'),
    capacity: ml('Capacity', 'Capacité dispo.', 'Kapazität'),
    load: ml('Load factor', 'Facteur de charge', 'Lastfaktor'),
    voltage: ml('Voltage', 'Tension', 'Spannung'),
    frequency: ml('Frequency', 'Fréquence', 'Frequenz'),
    openMap: ml('Show on the map', 'Voir sur la carte', 'Auf der Karte zeigen'),
    unknownState: ml('Unknown', 'Inconnu', 'Unbekannt')
  }
} as const;

/** Label of a plant state, `Unknown` for a value the simulator does not publish. */
export function stateLabel(state: number | undefined): MultiLangString {
  return (
    (state === undefined ? undefined : STATE_LABELS[state]) ??
    MSG.card.unknownState
  );
}

/** Empty state once plants are found but none of their outputs has arrived yet. */
export function waitingMsg(count: number): MultiLangString {
  return ml(
    `${count} plant(s) found — waiting for their values.`,
    `${count} centrale(s) trouvée(s) — en attente de leurs valeurs.`,
    `${count} Kraftwerk(e) gefunden — warte auf ihre Werte.`
  );
}
