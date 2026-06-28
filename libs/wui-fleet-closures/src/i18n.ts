// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Non-Worked Periods (Fleet Closures) page
 * (EN / FR / DE), following the shared `lit-translate` singleton.
 * `localizeDir(...)` in templates (reactive, re-renders on language change),
 * `localize(...)` for plain-string contexts (attributes, toast text, transient
 * messages — current language at call time).
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
    import: ml('Import', 'Importer', 'Importieren'),
    export: ml('Export', 'Exporter', 'Exportieren'),
    save: ml('Save', 'Enregistrer', 'Speichern')
  },
  filters: {
    year: ml('Year', 'Année', 'Jahr'),
    allYears: ml('All years', 'Toutes les années', 'Alle Jahre'),
    ateliers: ml('Workshops', 'Ateliers', 'Werkstätten'),
    allAteliers: ml('All workshops', 'Tous les ateliers', 'Alle Werkstätten'),
    machines: ml('Machines', 'Machines', 'Maschinen'),
    allMachines: ml('All machines', 'Toutes les machines', 'Alle Maschinen')
  },
  offline: ml(
    'Offline mode: the configuration cannot be read or saved (backend not connected).',
    'Mode hors-ligne : la configuration ne peut pas être lue ni enregistrée (backend non connecté).',
    'Offline-Modus: Die Konfiguration kann nicht gelesen oder gespeichert werden (Backend nicht verbunden).'
  ),
  table: {
    scope: ml('Scope', 'Périmètre', 'Geltungsbereich'),
    start: ml('Start', 'Début', 'Beginn'),
    end: ml('End', 'Fin', 'Ende'),
    duration: ml('Duration', 'Durée', 'Dauer'),
    empty: ml('No period for this filter.', 'Aucune période sur ce filtre.', 'Kein Zeitraum für diesen Filter.'),
    addRange: ml('Add a period', 'Ajouter une période', 'Zeitraum hinzufügen'),
    addFor: ml('for', 'pour', 'für'),
    delete: ml('Delete', 'Supprimer', 'Löschen')
  },
  scope: {
    atelierPrefix: ml('Workshop: ', 'Atelier : ', 'Werkstatt: ')
  },
  overlap: {
    title: ml('Overlapping periods', 'Recouvrement de périodes', 'Überlappende Zeiträume'),
    body: ml(
      'Some imported periods overlap existing periods. What would you like to do?',
      'Certaines périodes importées chevauchent des périodes existantes. Que souhaitez-vous faire ?',
      'Einige importierte Zeiträume überschneiden sich mit vorhandenen Zeiträumen. Was möchten Sie tun?'
    ),
    replaceLabel: ml('Replace', 'Remplacer', 'Ersetzen'),
    replaceDesc: ml(
      ': the imported configuration replaces the existing one.',
      ' : la configuration importée remplace l’existante.',
      ': Die importierte Konfiguration ersetzt die vorhandene.'
    ),
    ignoreLabel: ml('Ignore', 'Ignorer', 'Ignorieren'),
    ignoreDesc: ml(
      ': keep the existing one, add only the non-overlapping periods.',
      ' : conserver l’existant, n’ajouter que les périodes sans chevauchement.',
      ': Vorhandene beibehalten, nur die nicht überschneidenden Zeiträume hinzufügen.'
    ),
    cancelLabel: ml('Cancel', 'Annuler', 'Abbrechen'),
    cancelDesc: ml(': import nothing.', ' : ne rien importer.', ': nichts importieren.')
  },
  toast: {
    saved: ml('Periods saved.', 'Périodes enregistrées.', 'Zeiträume gespeichert.'),
    saveFailed: ml('Save failed.', 'Échec de l’enregistrement.', 'Speichern fehlgeschlagen.'),
    unreadableFile: ml('Unreadable file.', 'Fichier illisible.', 'Datei nicht lesbar.'),
    invalidJson: ml('Invalid JSON.', 'JSON invalide.', 'Ungültiges JSON.'),
    imported: ml('Periods imported.', 'Périodes importées.', 'Zeiträume importiert.'),
    replaced: ml('Configuration replaced.', 'Configuration remplacée.', 'Konfiguration ersetzt.'),
    addedNonConflicting: ml(
      'Non-conflicting periods added.',
      'Périodes non conflictuelles ajoutées.',
      'Nicht überschneidende Zeiträume hinzugefügt.'
    )
  }
} as const;

/** Atelier scope label, e.g. "Workshop: Assembly" (plain string — used in option labels). */
export function atelierScopeLabel(name: string): string {
  return `${localize(MSG.scope.atelierPrefix)}${name}`;
}

/** Period count label, e.g. "3 period(s)" (plain string — current language at call time). */
export function periodCountMsg(count: number): string {
  return localize(
    ml(`${count} period(s)`, `${count} période(s)`, `${count} Zeitraum/Zeiträume`)
  );
}

/**
 * Reason a range is subsumed by a larger one (plain string — assigned to the
 * row warning `title=`). `where` is the localized "at workshop level" suffix (or
 * empty), `from`/`to` are pre-formatted date-time strings.
 */
export function coveredReasonMsg(where: string, from: string, to: string): string {
  return localize(
    ml(
      `Period ignored: fully covered by a larger period${where} (from ${from} to ${to}).`,
      `Période ignorée : entièrement couverte par une période plus large${where} (du ${from} au ${to}).`,
      `Zeitraum ignoriert: vollständig durch einen größeren Zeitraum abgedeckt${where} (von ${from} bis ${to}).`
    )
  );
}

/** "at workshop level" suffix for {@link coveredReasonMsg} (plain string). */
export function atWorkshopLevelMsg(): string {
  return localize(ml(' at workshop level', ' au niveau atelier', ' auf Werkstattebene'));
}

/** Human-readable duration: number of days (plain string — current language). */
export function daysSpanMsg(days: number, remHours: number): string {
  if (remHours > 0) {
    return localize(ml(`${days} d ${remHours} h`, `${days} j ${remHours} h`, `${days} T ${remHours} h`));
  }
  return localize(ml(`${days} d`, `${days} j`, `${days} T`));
}

/** Human-readable duration: hours only (plain string — current language). */
export function hoursSpanMsg(hours: number): string {
  return localize(ml(`${hours} h`, `${hours} h`, `${hours} h`));
}
