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
    ackFailed: ml(
      'Acknowledging failed — the write was refused',
      'L’acquittement a échoué — l’écriture a été refusée',
      'Quittieren fehlgeschlagen — der Schreibvorgang wurde abgelehnt'
    ),
    ackUnattributed: ml(
      'Acknowledged, but recorded under the server identity — your user is unknown to the WinCC OA user directory.',
      'Acquitté, mais enregistré sous l’identité du serveur — votre utilisateur est inconnu de l’annuaire WinCC OA.',
      'Quittiert, aber unter der Server-Identität erfasst — Ihr Benutzer ist im WinCC-OA-Verzeichnis unbekannt.'
    ),
    ackNothing: ml(
      'Nothing to acknowledge in the selection.',
      'Rien à acquitter dans la sélection.',
      'In der Auswahl gibt es nichts zu quittieren.'
    ),
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
    last: ml('Last alarm', 'Dernière alarme', 'Letzter Alarm'),
    fromPrior: ml('from priority', 'à partir de la priorité', 'ab Priorität')
  },
  histogram: {
    window: ml('last 3 hours', '3 dernières heures', 'letzte 3 Stunden'),
    alarms: ml('alarms raised', 'alarmes apparues', 'aufgetretene Alarme'),
    over: ml('above the operator-load ceiling', 'au-dessus du seuil de charge opérateur', 'über der Bedienerlastgrenze'),
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
    severity: ml('Range', 'Plage', 'Bereich'),
    prior: ml('Prior.', 'Prio.', 'Prio.'),
    priorHint: ml(
      'The alert class priority WinCC OA returns — the range above is derived from it.',
      'La priorité de classe d’alarme renvoyée par WinCC OA — la plage ci-contre en découle.',
      'Die von WinCC OA gelieferte Alarmklassen-Priorität — der Bereich daneben leitet sich daraus ab.'
    ),
    class: ml('Class', 'Classe', 'Klasse'),
    dpe: ml('Datapoint', 'Datapoint', 'Datenpunkt'),
    text: ml('Text', 'Texte', 'Text'),
    value: ml('Value', 'Valeur', 'Wert'),
    status: ml('State', 'État', 'Status'),
    ackBy: ml('Ack. by', 'Acq. par', 'Quitt. von'),
    empty: ml('No alarm.', 'Aucune alarme.', 'Kein Alarm.'),
    sortBy: ml('Sort by', 'Trier par', 'Sortieren nach'),
    selectAll: ml('Select the page', 'Sélectionner la page', 'Seite auswählen'),
    notAckable: ml(
      'This alert class does not accept an acknowledgement.',
      'Cette classe d’alarme n’accepte pas l’acquittement.',
      'Diese Alarmklasse akzeptiert keine Quittierung.'
    )
  },
  status: {
    ACTIVE: ml('ACTIVE', 'ACTIVE', 'AKTIV'),
    ACTIVE_ACK: ml('ACTIVE - ACK', 'ACTIVE - ACQ', 'AKTIV - QUITT'),
    /** Gone but nobody took it over — it stays in the active list until they do. */
    CLEARED: ml('CLEARED - UNACK', 'RETOMBÉE - NON ACQ', 'GEGANGEN - UNQUITT'),
    CLEARED_ACK: ml('CLEARED - ACK', 'RETOMBÉE - ACQ', 'GEGANGEN - QUITT')
  },
  ranges: {
    title: ml('Priority ranges', 'Plages de priorité', 'Prioritätsbereiche'),
    open: ml('Configure the ranges', 'Configurer les plages', 'Bereiche konfigurieren'),
    intro: ml(
      'A range groups the WinCC OA alert-class priorities of the project. Its abbreviation and its colour are what the list shows; alarms below the lowest range fall into it.',
      'Une plage regroupe les priorités des classes d’alarme WinCC OA du projet. Son abréviation et sa couleur sont ce qu’affiche la liste ; les alarmes sous la plage la plus basse y sont rattachées.',
      'Ein Bereich gruppiert die Prioritäten der WinCC-OA-Alarmklassen des Projekts. Kürzel und Farbe erscheinen in der Liste; Alarme unterhalb des niedrigsten Bereichs fallen in diesen.'
    ),
    colAbbr: ml('Abbreviation', 'Abréviation', 'Kürzel'),
    colColor: ml('Colour', 'Couleur', 'Farbe'),
    colMinPrior: ml('From priority', 'À partir de la priorité', 'Ab Priorität'),
    colPreview: ml('Preview', 'Aperçu', 'Vorschau'),
    add: ml('Add a range', 'Ajouter une plage', 'Bereich hinzufügen'),
    remove: ml('Remove', 'Supprimer', 'Entfernen'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    reset: ml('Restore the defaults', 'Rétablir les valeurs par défaut', 'Standardwerte wiederherstellen'),
    saved: ml('Ranges saved.', 'Plages enregistrées.', 'Bereiche gespeichert.'),
    saveFailed: ml('The ranges could not be saved.', 'Les plages n’ont pas pu être enregistrées.', 'Die Bereiche konnten nicht gespeichert werden.'),
    offline: ml(
      'Read-only configuration: the datapoint is unreachable, the defaults are in use.',
      'Configuration en lecture seule : le datapoint est inaccessible, les valeurs par défaut sont utilisées.',
      'Schreibgeschützte Konfiguration: Der Datenpunkt ist nicht erreichbar, es gelten die Standardwerte.'
    ),
    empty: ml('No range — the defaults apply.', 'Aucune plage — les valeurs par défaut s’appliquent.', 'Kein Bereich — es gelten die Standardwerte.')
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

/**
 * The histogram's own title: "Alarms per <bucket>".
 *
 * Derived from the bucket the histogram actually used — over a wide archived
 * period the bars are not ten minutes wide, and a title that keeps saying so
 * would misread the chart by an order of magnitude.
 */
export function perBucketMsg(bucketMs: number): string {
  const minutes = Math.round(bucketMs / 60_000);
  if (minutes <= 0) return localize(ml('Alarms raised', 'Alarmes apparues', 'Aufgetretene Alarme'));
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return localize(ml(`Alarms per ${days} d`, `Alarmes par ${days} j`, `Alarme pro ${days} T`));
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return localize(ml(`Alarms per ${hours} h`, `Alarmes par ${hours} h`, `Alarme pro ${hours} Std.`));
  }
  return localize(ml(`Alarms per ${minutes} min`, `Alarmes par ${minutes} min`, `Alarme pro ${minutes} Min.`));
}

/** "last 6 hours" — the statistics window when it is not the default three. */
export function lastHoursMsg(hours: number): string {
  return localize(ml(`last ${hours} hours`, `${hours} dernières heures`, `letzte ${hours} Stunden`));
}

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
