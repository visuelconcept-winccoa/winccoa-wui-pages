// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Audit Trail page.
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
 *
 * NOTE: `_AuditTrail` element names (`time`, `username`, `action`, …) are a fixed
 * WinCC OA data contract and are NOT translated. Only the on-screen column
 * *labels* are localized — see {@link MSG.col}, keyed by the element name.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import { getLanguage } from '@wincc-oa/wui-i18n-shared/localize-base.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Short BCP-47 language tag of the active UI language (for `lang` / `Intl`). */
export function dateLocale(): string {
  return getLanguage(); // 'en' | 'fr' | 'de' | …
}

/** Static UI strings, grouped by area. */
export const MSG = {
  toolbar: {
    datapoint: ml('Datapoints', 'Datapoints', 'Datenpunkte'),
    datapointPlaceholder: ml('Select one or more…', 'Sélectionnez un ou plusieurs…', 'Einen oder mehrere wählen…'),
    manage: ml('Manage', 'Gérer', 'Verwalten'),
    csv: ml('CSV', 'CSV', 'CSV'),
    json: ml('JSON', 'JSON', 'JSON'),
    print: ml('Print', 'Imprimer', 'Drucken'),
    refresh: ml('Refresh', 'Actualiser', 'Aktualisieren'),
    live24h: ml('Live 24 h', 'Live 24 h', 'Live 24 h'),
    search: ml('Search…', 'Rechercher…', 'Suchen…')
  },
  table: {
    filterPlaceholder: ml('Filter', 'Filtrer', 'Filtern'),
    sortHint: ml('Sort', 'Trier', 'Sortieren')
  },
  // On-screen / export column labels, keyed by the fixed `_AuditTrail` element
  // name. The element name (`key`) itself is a data contract and is NOT translated.
  col: {
    source: ml('Datapoint', 'Datapoint', 'Datenpunkt'),
    time: ml('Timestamp', 'Horodatage', 'Zeitstempel'),
    username: ml('User', 'Utilisateur', 'Benutzer'),
    action: ml('Action', 'Action', 'Aktion'),
    item: ml('Item', 'Élément', 'Element'),
    itemtype: ml('Type', 'Type', 'Typ'),
    oldval: ml('Old value', 'Ancienne valeur', 'Alter Wert'),
    newval: ml('New value', 'Nouvelle valeur', 'Neuer Wert'),
    reason: ml('Reason', 'Raison', 'Grund'),
    batchid: ml('Batch', 'Batch', 'Batch'),
    uinum: ml('UI', 'UI', 'UI'),
    host: ml('Host', 'Hôte', 'Host')
  },
  content: {
    noDpsPrefix: ml('No', 'Aucun datapoint', 'Kein'),
    noDpsSuffix: ml(
      ' datapoint. Click “Manage” to create one (archived).',
      '. Cliquez « Gérer » pour en créer un (archivé).',
      '-Datenpunkt. Klicken Sie auf „Verwalten“, um einen anzulegen (archiviert).'
    ),
    selectDp: ml(
      'Select an audit-trail datapoint.',
      "Sélectionnez un datapoint d'audit trail.",
      'Wählen Sie einen Audit-Trail-Datenpunkt aus.'
    ),
    noRecords: ml(
      'No record in the period. Check that the datapoint is archived (NGA).',
      'Aucun enregistrement sur la période. Vérifiez que le datapoint est archivé (NGA).',
      'Keine Aufzeichnung im Zeitraum. Prüfen Sie, ob der Datenpunkt archiviert ist (NGA).'
    ),
    noMatch: ml(
      'No record matches the search / filters.',
      'Aucun enregistrement ne correspond à la recherche / aux filtres.',
      'Keine Aufzeichnung entspricht der Suche / den Filtern.'
    ),
    roleForbidden: ml(
      'Your groups do not hold the “View” role of this page.',
      'Vos groupes ne possèdent pas le rôle « Consulter » de cette page.',
      'Ihre Gruppen besitzen die Rolle „Ansehen“ dieser Seite nicht.'
    )
  },
  notice: {
    offline: ml(
      'Offline mode: configuration is not persisted (backend not connected or missing rights).',
      'Mode hors-ligne : configuration non persistée (backend non connecté ou droits manquants).',
      'Offline-Modus: Konfiguration wird nicht gespeichert (Backend nicht verbunden oder fehlende Rechte).'
    )
  },
  manage: {
    title: ml(
      'Audit-trail datapoints',
      "Datapoints d'audit trail",
      'Audit-Trail-Datenpunkte'
    ),
    close: ml('Close', 'Fermer', 'Schließen'),
    create: ml('Create', 'Créer', 'Anlegen'),
    noGroupsPrefix: ml(
      'No active NGA archive group (type',
      "Aucun groupe d'archive NGA actif (type",
      'Keine aktive NGA-Archivgruppe (Typ'
    ),
    noGroupsSuffix: ml(
      '). Activate one to be able to create an archived datapoint.',
      '). Activez-en un pour pouvoir créer un datapoint archivé.',
      '). Aktivieren Sie eine, um einen archivierten Datenpunkt anlegen zu können.'
    ),
    newDpPrefix: ml('New datapoint (type', 'Nouveau datapoint (type', 'Neuer Datenpunkt (Typ'),
    newDpSuffix: ml(', archived)', ', archivé)', ', archiviert)'),
    namePlaceholder: ml('Name (e.g. Production)', 'Nom (ex. Production)', 'Name (z. B. Production)'),
    existingDps: ml('Existing datapoints', 'Datapoints existants', 'Vorhandene Datenpunkte'),
    noDpsPrefix: ml('No', 'Aucun datapoint', 'Kein'),
    noDpsSuffix: ml(
      ' datapoint for now.',
      ' pour le moment.',
      '-Datenpunkt vorhanden.'
    ),
    colDatapoint: ml('Datapoint', 'Datapoint', 'Datenpunkt'),
    colArchiveGroup: ml('Archive group', "Groupe d'archive", 'Archivgruppe'),
    notArchived: ml('not archived', 'non archivé', 'nicht archiviert'),
    deleteTitle: ml('Delete', 'Supprimer', 'Löschen'),
    systemNotDeletable: ml(
      'System datapoint — not deletable',
      'Datapoint système — non supprimable',
      'System-Datenpunkt — nicht löschbar'
    ),
    confirmHeading: ml('Delete datapoint', 'Supprimer le datapoint', 'Datenpunkt löschen')
  }
} as const;

/** Localized table/export header for a fixed `_AuditTrail` element (by element name). */
export function colLabel(key: keyof typeof MSG.col): MultiLangString {
  return MSG.col[key];
}

/** Confirm-delete prompt for one audit DP (plain string — transient dialog). */
export function confirmDeleteMsg(name: string): string {
  return localize(
    ml(
      `Permanently delete “${name}” and its archived history?`,
      `Supprimer définitivement « ${name} » et son historique archivé ?`,
      `„${name}“ und den archivierten Verlauf endgültig löschen?`
    )
  );
}

/** Record-count suffix for the meta line / print subtitle (plain string). */
export function recordsMsg(count: number): string {
  return localize(
    ml(`${count} record(s)`, `${count} enregistrement(s)`, `${count} Aufzeichnung(en)`)
  );
}

/** "shown of total record(s)" meta-line variant when search/filters hide rows. */
export function shownOfMsg(shown: number, total: number): string {
  return localize(
    ml(
      `${shown} of ${total} record(s)`,
      `${shown} sur ${total} enregistrement(s)`,
      `${shown} von ${total} Aufzeichnung(en)`
    )
  );
}

/** "History truncated to the N most recent records" notice (plain string). */
export function truncatedMsg(maxRows: number): string {
  return localize(
    ml(
      `History truncated to the ${maxRows} most recent records.`,
      `Historique tronqué aux ${maxRows} enregistrements les plus récents.`,
      `Verlauf auf die ${maxRows} neuesten Aufzeichnungen gekürzt.`
    )
  );
}

/** "(live 24 h)" range-label suffix (plain string). */
export function liveSuffixMsg(): string {
  return localize(ml('(live 24 h)', '(live 24 h)', '(Live 24 h)'));
}

/** Datapoint created + archived confirmation (plain string — set into reactive state). */
export function createdMsg(name: string, group: string): string {
  return localize(
    ml(
      `Datapoint “${name}” created and archived (group “${group}”).`,
      `Datapoint « ${name} » créé et archivé (groupe « ${group} »).`,
      `Datenpunkt „${name}“ angelegt und archiviert (Gruppe „${group}“).`
    )
  );
}

/** Creation-failure message (plain string — set into reactive state). */
export function createFailedMsg(detail: string): string {
  return localize(
    ml(`Creation failed: ${detail}`, `Échec de création : ${detail}`, `Anlegen fehlgeschlagen: ${detail}`)
  );
}

/** Archive-group reassignment confirmation (plain string — set into reactive state). */
export function groupAppliedMsg(group: string, name: string): string {
  return localize(
    ml(
      `Group “${group}” applied to “${name}”.`,
      `Groupe « ${group} » appliqué à « ${name} ».`,
      `Gruppe „${group}“ auf „${name}“ angewendet.`
    )
  );
}

/** Generic failure message (plain string — set into reactive state). */
export function failedMsg(detail: string): string {
  return localize(ml(`Failed: ${detail}`, `Échec : ${detail}`, `Fehlgeschlagen: ${detail}`));
}

/** Datapoint-deleted confirmation (plain string — set into reactive state). */
export function deletedMsg(name: string): string {
  return localize(
    ml(`Datapoint “${name}” deleted.`, `Datapoint « ${name} » supprimé.`, `Datenpunkt „${name}“ gelöscht.`)
  );
}

/** Deletion-failure message (plain string — set into reactive state). */
export function deleteFailedMsg(detail: string): string {
  return localize(
    ml(`Deletion failed: ${detail}`, `Échec de suppression : ${detail}`, `Löschen fehlgeschlagen: ${detail}`)
  );
}
