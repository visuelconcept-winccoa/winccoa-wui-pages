// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the shared UI kit (`wui-kit`).
 *
 * Only the widget DEFAULTS / fallbacks live here — most labels (dialog heading,
 * message, confirm label, input label, …) are passed in by the calling page as
 * properties and are localised by that page. These maps cover the cases where a
 * caller does not provide a value, so the shared component still renders sensible
 * trilingual text.
 *
 * All user-visible strings are {@link MultiLangString} maps resolved against the
 * active WebUI language. Use {@link localizeDir} inside templates (reactive,
 * re-renders on language change) and {@link localize} for plain-string /
 * attribute contexts (current language at call time).
 *
 * Locale keys use the base `.utf8` form (`en_US.utf8` / `fr.utf8` / `de.utf8`) so
 * any country variant (fr_FR, de_AT, de_CH, …) still resolves.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Static UI strings, grouped by component. */
export const MSG = {
  confirmDialog: {
    heading: ml('Confirm deletion', 'Confirmer la suppression', 'Löschen bestätigen'),
    confirm: ml('Delete', 'Supprimer', 'Löschen'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen')
  },
  dpInput: {
    browse: ml('Search for a datapoint', 'Rechercher un datapoint', 'Datenpunkt suchen')
  }
} as const;
