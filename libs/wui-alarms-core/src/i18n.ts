// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the alarms kit (EN / FR / DE).
 *
 * All user-visible strings are {@link MultiLangString} maps resolved against the
 * active WebUI language. Use {@link localizeDir} inside templates (reactive,
 * re-renders on language change) and {@link localize} for plain-string contexts
 * (attributes, titles, labels — current language at call time).
 *
 * Locale keys use the base `.utf8` form (`en_US.utf8` / `fr.utf8` / `de.utf8`) so
 * any country variant (fr_FR, de_AT, de_CH, …) still resolves.
 *
 * The alarm TEXT itself is never translated here: it comes from the WinCC OA
 * alert class / datapoint configuration and is displayed as the project wrote it.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Static UI strings of the alarm view, grouped by area. */
export const MSG = {
  view: {
    title: ml('Alarms', 'Alarmes', 'Alarme'),
    help: ml(
      'Acknowledge and clear field alarms, worst first',
      'Acquitter et solder les alarmes du terrain, en commençant par les plus graves',
      'Feldalarme quittieren und abarbeiten, die schwersten zuerst'
    ),
    sourceActive: ml('Active', 'Actives', 'Aktiv'),
    sourceHistory: ml('History', 'Historique', 'Historie'),
    live: ml('Live', 'Temps réel', 'Echtzeit'),
    updatedAt: ml('updated at', 'mis à jour à', 'aktualisiert um'),
    refresh: ml('Refresh', 'Rafraîchir', 'Aktualisieren'),
    search: ml('Search a datapoint, a text, a class', 'Rechercher un datapoint, un texte, une classe', 'Datenpunkt, Text oder Klasse suchen'),
    unackOnly: ml('Unacknowledged only', 'Non acquittées seulement', 'Nur unquittierte'),
    ack: ml('Acknowledge', 'Acquitter', 'Quittieren'),
    ackVisible: ml('Acknowledge the page', 'Acquitter la page', 'Seite quittieren'),
    ackDenied: ml('Acknowledging is not granted to you.', 'L’acquittement ne vous est pas accordé.', 'Quittieren ist Ihnen nicht erlaubt.'),
    ackFailed: ml('Acknowledging failed.', 'L’acquittement a échoué.', 'Quittieren fehlgeschlagen.'),
    loading: ml('Loading…', 'Chargement…', 'Wird geladen…'),
    loadFailed: ml('The alarms could not be read.', 'Les alarmes n’ont pas pu être lues.', 'Die Alarme konnten nicht gelesen werden.'),
    noScope: ml('No datapoint is bound.', 'Aucun datapoint n’est associé.', 'Kein Datenpunkt zugeordnet.'),
    forbidden: ml(
      'This module is not granted to you.',
      'Ce module ne vous est pas accordé.',
      'Dieses Modul ist Ihnen nicht zugewiesen.'
    ),
    truncated: ml('Archive truncated — narrow the period.', 'Archive tronquée — resserrez la période.', 'Archiv gekürzt — Zeitraum einschränken.')
  },
  counters: {
    unacknowledged: ml('Unacknowledged', 'Non acquittées', 'Unquittiert'),
    goalZero: ml('target 0', 'objectif 0', 'Ziel 0'),
    goalHint: ml(
      'They await a takeover: by the end of the shift they must be at zero.',
      'Elles attendent une prise en charge : en fin de poste elles doivent être à zéro.',
      'Sie warten auf Übernahme: zum Schichtende müssen sie bei null sein.'
    ),
    active: ml('Standing', 'En cours', 'Stehend'),
    cleared: ml('cleared', 'retombées', 'gegangen'),
    acked: ml('ack', 'acq', 'quitt'),
    last: ml('Last alarm', 'Dernière alarme', 'Letzter Alarm')
  },
  histogram: {
    title: ml('Alarms per 10 minutes', 'Alarmes par 10 minutes', 'Alarme pro 10 Minuten'),
    window: ml('last 3 hours', '3 dernières heures', 'letzte 3 Stunden'),
    eemua: ml(
      'EEMUA 191: beyond ten alarms in ten minutes, no operator keeps up.',
      'EEMUA 191 : au-delà de dix alarmes en dix minutes, aucun opérateur ne suit.',
      'EEMUA 191: über zehn Alarme in zehn Minuten folgt kein Bediener mehr.'
    )
  },
  actors: {
    byText: ml('Most frequent', 'Les plus fréquentes', 'Häufigste'),
    byDp: ml('By datapoint', 'Par datapoint', 'Nach Datenpunkt'),
    hint: ml(
      'The recurring alarms — the EEMUA 191 reading of operator load.',
      'Les alarmes récurrentes : la lecture EEMUA 191 de la charge opérateur.',
      'Die wiederkehrenden Alarme — die EEMUA-191-Lesung der Bedienerlast.'
    )
  },
  table: {
    raised: ml('Raised', 'Apparition', 'Kommt'),
    cleared: ml('Cleared', 'Retombée', 'Geht'),
    severity: ml('Prio', 'Prio', 'Prio'),
    class: ml('Class', 'Classe', 'Klasse'),
    dpe: ml('Datapoint', 'Datapoint', 'Datenpunkt'),
    text: ml('Text', 'Texte', 'Text'),
    value: ml('Value', 'Valeur', 'Wert'),
    status: ml('State', 'État', 'Status'),
    ackBy: ml('Ack. by', 'Acq. par', 'Quitt. von'),
    empty: ml('No alarm.', 'Aucune alarme.', 'Kein Alarm.'),
    sortBy: ml('Sort by', 'Trier par', 'Sortieren nach'),
    selectAll: ml('Select the page', 'Sélectionner la page', 'Seite auswählen')
  },
  status: {
    ACTIVE: ml('ACTIVE', 'ACTIVE', 'AKTIV'),
    ACTIVE_ACK: ml('ACTIVE - ACK', 'ACTIVE - ACQ', 'AKTIV - QUITT'),
    CLEARED: ml('CLEARED', 'RETOMBÉE', 'GEGANGEN'),
    CLEARED_ACK: ml('CLEARED - ACK', 'RETOMBÉE - ACQ', 'GEGANGEN - QUITT')
  },
  period: {
    label: ml('Period', 'Période', 'Zeitraum'),
    today: ml('Today', 'Aujourd’hui', 'Heute'),
    '24h': ml('Last 24 h', '24 dernières heures', 'Letzte 24 Std.'),
    '7d': ml('Last 7 days', '7 derniers jours', 'Letzte 7 Tage'),
    '30d': ml('Last 30 days', '30 derniers jours', 'Letzte 30 Tage'),
    week: ml('Current week', 'Semaine en cours', 'Aktuelle Woche'),
    month: ml('Current month', 'Mois en cours', 'Aktueller Monat'),
    custom: ml('Custom', 'Personnalisée', 'Benutzerdefiniert'),
    start: ml('Start', 'Début', 'Beginn'),
    end: ml('End', 'Fin', 'Ende'),
    previous: ml('Previous period', 'Période précédente', 'Vorheriger Zeitraum'),
    next: ml('Next period', 'Période suivante', 'Nächster Zeitraum')
  }
} as const;

/** "296 of 2,727" — what the filters kept out of the snapshot. */
export function filteredOfTotalMsg(filtered: string, total: string): string {
  return localize(ml(`${filtered} of ${total}`, `${filtered} sur ${total}`, `${filtered} von ${total}`));
}

/** "1–25 of 296" — the pager's position. */
export function pagerRangeMsg(range: string, total: string): string {
  return localize(ml(`${range} of ${total}`, `${range} sur ${total}`, `${range} von ${total}`));
}

/** "from <start> to <end>" — the resolved period, same wording as the fleet pages. */
export function rangeLabelMsg(start: string, end: string): string {
  return localize(ml(`from ${start} to ${end}`, `du ${start} au ${end}`, `von ${start} bis ${end}`));
}

/** "12 selected" — how many rows an acknowledge would touch. */
export function selectedMsg(count: number): string {
  return localize(ml(`${count} selected`, `${count} sélectionnée(s)`, `${count} ausgewählt`));
}
