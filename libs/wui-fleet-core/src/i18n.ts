// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the shared Fleet kit (EN / FR / DE).
 *
 * Scope: the user-facing strings of the kit's own UI component, the stop-cause
 * catalog editor ({@link ./ui/mf-stop-causes.ts}). The kit's domain modules
 * ({@link ./types.ts}, {@link ./engine.ts}, {@link ./closures.ts}) expose label
 * maps and formatting helpers (e.g. `STATE_LABELS`, `STOP_CLASSIFICATION_LABELS`,
 * `formatDuration`) as **plain-string data contracts** that each consuming page
 * renders verbatim and localizes through its own catalog — they are intentionally
 * left as-is here so the public kit API stays stable.
 *
 * All user-visible strings are {@link MultiLangString} maps resolved against the
 * active WebUI language via the shared `lit-translate` singleton (same instance
 * as the app shell, so the UI reacts to the user's language). Use
 * {@link localizeDir} inside templates (reactive, re-renders on language change)
 * and {@link localize} for plain-string contexts (current language at call time —
 * attributes, titles/tooltips, labels).
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
  causes: {
    title: ml("Stop-cause catalog", "Catalogue des causes d'arrêt", 'Katalog der Stoppursachen'),
    importJson: ml('Import (JSON)', 'Importer (JSON)', 'Importieren (JSON)'),
    exportJson: ml('Export (JSON)', 'Exporter (JSON)', 'Exportieren (JSON)'),
    colCode: ml('Code', 'Code', 'Code'),
    colDescription: ml('Description', 'Description', 'Beschreibung'),
    colClassification: ml('Classification', 'Classification', 'Klassifizierung'),
    colDefault: ml('Default', 'Défaut', 'Standard'),
    empty: ml('No cause.', 'Aucune cause.', 'Keine Ursache.'),
    addCause: ml('Add a cause', 'Ajouter une cause', 'Ursache hinzufügen'),
    defaultToggle: ml(
      'Cause shown when the code is absent from the catalog',
      "Cause affichée quand le code est absent du catalogue",
      'Ursache, die angezeigt wird, wenn der Code nicht im Katalog vorhanden ist'
    ),
    remove: ml('Delete', 'Supprimer', 'Löschen'),
    close: ml('Close', 'Fermer', 'Schließen'),
    save: ml('Save', 'Enregistrer', 'Speichern')
  },
  classification: {
    unplanned: ml('Unplanned stop', 'Arrêt non planifié', 'Ungeplanter Stopp'),
    planned: ml('Planned stop', 'Arrêt planifié', 'Geplanter Stopp'),
    production: ml('Production', 'Production', 'Produktion')
  }
} as const;
