// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Report Templates page (EN/FR/DE).
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
  toolbar: {
    reports: ml('Reports', 'Rapports', 'Berichte'),
    import: ml('Import', 'Importer', 'Importieren'),
    json: ml('JSON', 'JSON', 'JSON'),
    newTemplate: ml('New template', 'Nouveau modèle', 'Neue Vorlage')
  },
  empty: {
    none: ml('No template.', 'Aucun modèle.', 'Keine Vorlage.'),
    generateDemo: ml(
      'Generate a demo template',
      'Générer un modèle de démonstration',
      'Demo-Vorlage erstellen'
    )
  },
  offline: ml(
    'Offline mode: changes are not persisted (backend unavailable or missing write rights).',
    "Mode hors-ligne : modifications non persistées (backend indisponible ou droits d'écriture manquants).",
    'Offline-Modus: Änderungen werden nicht gespeichert (Backend nicht verfügbar oder fehlende Schreibrechte).'
  ),
  roleForbidden: ml(
    'Your groups do not hold the "view" role of this page.',
    'Vos groupes ne possèdent pas le rôle « consulter » de cette page.',
    'Ihre Gruppen besitzen die Rolle „Ansehen" dieser Seite nicht.'
  ),
  msg: {
    importFailed: ml('Import failed.', 'Import échoué.', 'Import fehlgeschlagen.'),
    copySuffix: ml('copy', 'copie', 'Kopie')
  }
} as const;

/** Confirm-delete prompt for one template (plain string — transient dialog). */
export function confirmDeleteMsg(name: string): string {
  return localize(
    ml(`Delete template “${name}”?`, `Supprimer le modèle « ${name} » ?`, `Vorlage „${name}“ löschen?`)
  );
}
