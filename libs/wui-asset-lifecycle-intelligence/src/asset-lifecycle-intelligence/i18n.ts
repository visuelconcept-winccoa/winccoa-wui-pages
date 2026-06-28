// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Asset Lifecycle Intelligence page.
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
import { getLanguage } from '@wincc-oa/wui-i18n-shared/localize-base.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Short BCP-47 language tag of the active UI language (for `Intl` formatting). */
export function dateLocale(): string {
  return getLanguage(); // 'en' | 'fr' | 'de' | …
}

/** Static UI strings, grouped by area. */
export const MSG = {
  table: {
    name: ml('Designation', 'Désignation', 'Bezeichnung'),
    assetGroup: ml('Asset', 'Asset', 'Asset'),
    mlfb: ml('MLFB', 'MLFB', 'MLFB'),
    station: ml('Station', 'Station', 'Station'),
    area: ml('Workshop', 'Atelier', 'Werkstatt'),
    source: ml('Source', 'Source', 'Quelle'),
    phase: ml('Phase', 'Phase', 'Phase'),
    score: ml('Score', 'Score', 'Score'),
    level: ml('Level', 'Niveau', 'Stufe'),
    action: ml('Recommended action', 'Action recommandée', 'Empfohlene Maßnahme'),
    edit: ml('Edit', 'Modifier', 'Bearbeiten'),
    remove: ml('Delete', 'Supprimer', 'Löschen'),
    support: ml('Siemens support page', 'Page support Siemens', 'Siemens-Supportseite')
  },
  kpi: {
    assets: ml('Assets', 'Actifs', 'Anlagen'),
    avgScore: ml('Average score', 'Score moyen', 'Durchschnittsscore')
  },
  dialog: {
    newAsset: ml('New asset', 'Nouvel actif', 'Neues Asset'),
    editPrefix: ml('Edit', 'Édition', 'Bearbeiten'),
    secIdentity: ml('Identity', 'Identité', 'Identität'),
    secRisk: ml('Risk data', 'Données de risque', 'Risikodaten'),
    secNotes: ml('Notes', 'Notes', 'Notizen'),
    secSiemens: ml('Siemens data (MLFB)', 'Données Siemens (MLFB)', 'Siemens-Daten (MLFB)'),
    fName: ml('Designation', 'Désignation', 'Bezeichnung'),
    fMlfb: ml('Reference (MLFB)', 'Référence (MLFB)', 'Referenz (MLFB)'),
    fStation: ml('Station name', 'Nom de station', 'Stationsname'),
    fIp: ml('IP address', 'Adresse IP', 'IP-Adresse'),
    fArea: ml('Workshop / area', 'Atelier / zone', 'Werkstatt / Bereich'),
    fAssetGroup: ml('Asset (group)', 'Asset (groupe)', 'Asset (Gruppe)'),
    fSuccessor: ml('Successor (MLFB)', 'Successeur (MLFB)', 'Nachfolger (MLFB)'),
    fFirmwareField: ml('Field firmware', 'Firmware terrain', 'Feld-Firmware'),
    fFirmwareAvail: ml('Available firmware', 'Firmware disponible', 'Verfügbare Firmware'),
    fSource: ml('Creation source', 'Source de création', 'Erstellungsquelle'),
    fPhase: ml('Lifecycle phase', 'Phase cycle de vie', 'Lebenszyklusphase'),
    fFirmware: ml('Firmware gap', 'Écart firmware', 'Firmware-Abweichung'),
    fCriticality: ml('Process criticality', 'Criticité process', 'Prozesskritikalität'),
    fSupply: ml('Supply chain', 'Chaîne d’approvisionnement', 'Lieferkette'),
    fVuln: ml('Vulnerabilities', 'Vulnérabilités', 'Schwachstellen'),
    fHours: ml('Operating hours', 'Heures de service', 'Betriebsstunden'),
    fMtbf: ml('MTBF (hours, 0 = unknown)', 'MTBF (heures, 0 = inconnu)', 'MTBF (Stunden, 0 = unbekannt)'),
    crossRef: ml('Cross-reference via MLFB (Siemens)', 'Recouper via MLFB (Siemens)', 'Abgleich über MLFB (Siemens)'),
    applyFields: ml('Apply to fields', 'Appliquer aux champs', 'Auf Felder anwenden'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    save: ml('Save', 'Enregistrer', 'Speichern')
  },
  pi: {
    purchasability: ml('Purchasability', 'Achetabilité', 'Bestellbarkeit'),
    obsolescence: ml('Obsolescence', 'Obsolescence', 'Obsoleszenz'),
    phaseOut: ml('Phase-out announced', 'Annonce phase-out', 'Abkündigung angekündigt'),
    cancellation: ml('Product cancellation', 'Annulation produit', 'Produktabkündigung'),
    successor: ml('Successor', 'Successeur', 'Nachfolger'),
    substitute: ml('Substitute', 'Substitut', 'Ersatz'),
    support: ml('Support', 'Support', 'Support'),
    open: ml('open ↗', 'ouvrir ↗', 'öffnen ↗'),
    newPartLead: ml('New-part lead time', 'Délai pièce neuve', 'Lieferzeit Neuteil'),
    sparePartLead: ml('Spare-part lead time', 'Délai rechange', 'Lieferzeit Ersatzteil'),
    newPartPrice: ml('New-part price', 'Prix pièce neuve', 'Preis Neuteil'),
    origin: ml('Origin', 'Origine', 'Herkunft'),
    eccn: ml('ECCN', 'ECCN', 'ECCN'),
    delivery: ml('Delivery', 'Livraison', 'Lieferung'),
    unavailable: ml('unavailable', 'indisponible', 'nicht verfügbar'),
    onRequest: ml('on request', 'sur demande', 'auf Anfrage')
  },
  page: {
    import: ml('Import', 'Importer', 'Importieren'),
    export: ml('Export', 'Exporter', 'Exportieren'),
    importAml: ml('Import AML (TIA)', 'Importer AML (TIA)', 'AML importieren (TIA)'),
    importJson: ml('Import JSON', 'Importer JSON', 'JSON importieren'),
    exportJson: ml('Export JSON', 'Export JSON', 'JSON exportieren'),
    exportCsv: ml('Export CSV', 'Export CSV', 'CSV exportieren'),
    importHint: ml('JSON or AML/TIA', 'JSON ou AML/TIA', 'JSON oder AML/TIA'),
    newAsset: ml('New asset', 'Nouvel actif', 'Neues Asset'),
    offline: ml(
      'Offline mode: changes are not persisted to datapoints (backend unavailable or missing write rights).',
      'Mode hors-ligne : modifications non persistées dans les datapoints (backend indisponible ou droits d’écriture manquants).',
      'Offline-Modus: Änderungen werden nicht in Datenpunkten gespeichert (Backend nicht verfügbar oder fehlende Schreibrechte).'
    ),
    empty: ml('No managed assets yet.', 'Aucun actif géré pour l’instant.', 'Noch keine verwalteten Assets.'),
    importDemo: ml('Import the demo fleet', 'Importer le parc de démonstration', 'Demo-Bestand importieren'),
    importFailed: ml('Import failed.', 'Import échoué.', 'Import fehlgeschlagen.'),
    importAmlFailed: ml('AML import failed.', 'Import AML échoué.', 'AML-Import fehlgeschlagen.'),
    refreshAll: ml(
      'Cross-reference all MLFBs (Siemens)',
      'Recouper tous les MLFB (Siemens)',
      'Alle MLFB abgleichen (Siemens)'
    ),
    noMlfb: ml('No MLFB to cross-reference.', 'Aucun MLFB à recouper.', 'Keine MLFB zum Abgleichen.'),
    bulkFailed: ml('Bulk cross-reference failed.', 'Recoupement en masse échoué.', 'Massenabgleich fehlgeschlagen.'),
    search: ml('Search assets…', 'Rechercher des actifs…', 'Assets suchen…'),
    columns: ml('Columns', 'Colonnes', 'Spalten'),
    deleteAll: ml('Delete all', 'Tout supprimer', 'Alle löschen'),
    noMatch: ml('No asset matches the search.', 'Aucun actif ne correspond à la recherche.', 'Kein Asset entspricht der Suche.')
  },
  config: {
    gear: ml(
      'Configure the Siemens API connection',
      'Configurer la connexion API Siemens',
      'Siemens-API-Verbindung konfigurieren'
    ),
    title: ml(
      'Product Information Hub configuration',
      'Configuration Product Information Hub',
      'Product Information Hub – Konfiguration'
    ),
    baseUrl: ml('API base URL', 'URL de base de l’API', 'API-Basis-URL'),
    apiVersion: ml('API version', 'Version de l’API', 'API-Version'),
    apiKey: ml('API token', 'Token API', 'API-Token'),
    credit: ml('Remaining credit (lookups)', 'Crédit restant (recoupements)', 'Verbleibendes Guthaben (Abgleiche)'),
    creditHint: ml(
      '1 credit is consumed per lookup request (decremented server-side). Set the value to initialize the counter.',
      '1 crédit est consommé par recoupement (décrémenté côté serveur). Définissez la valeur pour initialiser le compteur.',
      '1 Guthaben wird pro Abgleich verbraucht (serverseitig dekrementiert). Wert setzen, um den Zähler zu initialisieren.'
    ),
    keyPlaceholder: ml(
      'Enter a new token to replace it',
      'Saisir un nouveau token pour le remplacer',
      'Neues Token zum Ersetzen eingeben'
    ),
    keySet: ml(
      'A token is currently configured — leave blank to keep it.',
      'Un token est actuellement configuré — laisser vide pour le conserver.',
      'Ein Token ist konfiguriert — leer lassen, um es beizubehalten.'
    ),
    keyNone: ml(
      'No token configured yet.',
      'Aucun token configuré pour l’instant.',
      'Noch kein Token konfiguriert.'
    ),
    hint: ml(
      'The token is stored in the ProductInfo_Config datapoint and used server-side by the productInfo manager; it is never read back into the browser. Changes apply on the next lookup (no restart needed).',
      'Le token est stocké dans le datapoint ProductInfo_Config et utilisé côté serveur par le manager productInfo ; il n’est jamais relu dans le navigateur. Les changements s’appliquent au prochain recoupement (aucun redémarrage nécessaire).',
      'Das Token wird im Datenpunkt ProductInfo_Config gespeichert und serverseitig vom productInfo-Manager verwendet; es wird nie in den Browser zurückgelesen. Änderungen gelten ab der nächsten Abfrage (kein Neustart nötig).'
    ),
    close: ml('Close', 'Fermer', 'Schließen')
  },
  demo: {
    prompt: ml('Import a demo fleet:', 'Importer un parc de démonstration :', 'Demo-Bestand importieren:'),
    semicon: ml('Semiconductor', 'Semi-conducteurs', 'Halbleiter'),
    agro: ml('Food & Beverage', 'Agroalimentaire', 'Lebensmittel & Getränke'),
    pharma: ml('Pharmaceutical', 'Pharmaceutique', 'Pharma')
  },
  view: {
    table: ml('Table', 'Tableau', 'Tabelle'),
    tree: ml('Tree', 'Arborescence', 'Baum')
  },
  tree: {
    ungrouped: ml('Ungrouped', 'Sans groupe', 'Ohne Gruppe'),
    noStation: ml('No station', 'Sans station', 'Ohne Station'),
    sumLabel: ml(
      'Score = worst component (colour) · Σ = total exposure',
      'Score = pire composant (couleur) · Σ = exposition totale',
      'Score = schlechteste Komponente (Farbe) · Σ = Gesamtexposition'
    ),
    sortLabel: ml('Sort:', 'Tri :', 'Sortierung:'),
    byScore: ml('Score', 'Score', 'Score'),
    bySum: ml('Σ Exposure', 'Σ Exposition', 'Σ Exposition'),
    byName: ml('Name', 'Nom', 'Name'),
    expandAll: ml('Expand all', 'Tout déplier', 'Alle aufklappen'),
    collapseAll: ml('Collapse all', 'Tout replier', 'Alle zuklappen')
  }
} as const;

/** `niveau n/6` obsolescence-level label. */
export function obsLevelMsg(level: number): MultiLangString {
  return ml(`level ${level}/6`, `niveau ${level}/6`, `Stufe ${level}/6`);
}

/** Delivery lead time in days (null = on request). */
export function daysMsg(days: number | null): MultiLangString {
  if (days == null) return MSG.pi.onRequest;
  return ml(`${days} d`, `${days} j`, `${days} T`);
}

/** Confirm-delete prompt for one asset (plain string — transient dialog). */
export function confirmDeleteMsg(name: string): string {
  return localize(
    ml(`Delete asset “${name}”?`, `Supprimer l'actif « ${name} » ?`, `Asset „${name}“ löschen?`)
  );
}

/** Confirm prompt for deleting the whole fleet (plain string — transient dialog). */
export function confirmDeleteAllMsg(count: number): string {
  return localize(
    ml(
      `Delete ALL ${count} managed asset(s)? This cannot be undone.`,
      `Supprimer la TOTALITÉ des ${count} actif(s) gérés ? Action irréversible.`,
      `ALLE ${count} verwalteten Assets löschen? Kann nicht rückgängig gemacht werden.`
    )
  );
}

/** Bulk Siemens cross-reference summary (plain string — set into reactive state). */
export function bulkSummaryMsg(unique: number, updated: number, obsUnavailable: number): string {
  const base = localize(
    ml(
      `${unique} MLFB cross-referenced · ${updated} asset(s) updated`,
      `${unique} MLFB recoupés · ${updated} actif(s) mis à jour`,
      `${unique} MLFB abgeglichen · ${updated} Asset(s) aktualisiert`
    )
  );
  if (obsUnavailable <= 0) return base;
  const tail = localize(
    ml(
      ` · obsolescence unavailable (${obsUnavailable})`,
      ` · obsolescence indisponible (${obsUnavailable})`,
      ` · Obsoleszenz nicht verfügbar (${obsUnavailable})`
    )
  );
  return `${base}${tail}`;
}

/** AML import summary (plain string — set into reactive state). */
export function amlImportedMsg(project: string, created: number, updated: number): string {
  return localize(
    ml(
      `Project “${project}” imported: ${created} asset(s) added, ${updated} updated.`,
      `Projet « ${project} » importé : ${created} actif(s) ajouté(s), ${updated} mis à jour.`,
      `Projekt „${project}“ importiert: ${created} Asset(s) hinzugefügt, ${updated} aktualisiert.`
    )
  );
}
