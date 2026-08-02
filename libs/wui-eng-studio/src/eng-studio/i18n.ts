// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation of the Engineering Studio page — EN / FR / DE.
 *
 * SELF-CONTAINED on purpose. The rest of the suite localises through
 * `@wincc-oa/wui-i18n-shared`, but this page's contract is to depend on `lit`
 * only (see NOTES, "the decoupling contract"): it must render in the shell, in the
 * offline demo and in the screenshot pipeline, where no `@wincc-oa/*` package
 * exists. So the same `ml(en, fr, de)` shape is kept for familiarity, with a tiny
 * resolver of its own.
 *
 * Language resolution, first match wins:
 *   1. the element's own `lang` property/attribute (the shell sets it);
 *   2. `?lang=` in the URL (what the screenshot pipeline and the demo use);
 *   3. `<html lang>`;
 *   4. `navigator.language`;
 *   5. English.
 * WinCC OA locale identifiers (`en_US.utf8`, `fr.utf8`, `de_AT.utf8`…) are accepted
 * as well as plain BCP-47 tags, since the shell passes the former.
 *
 * SCOPE — read this before hunting for a missing translation: the strings here are
 * the page's OWN. Messages produced by the pure engineering core (generator
 * warnings, browse warnings, outline parse errors) are **English** and shown
 * verbatim in every language. That boundary is deliberate — see NOTES,
 * "Localisation boundary".
 */

/** Languages the page ships. */
export type Lang = 'en' | 'fr' | 'de';

/** One translated string. */
export interface Ml {
  en: string;
  fr: string;
  de: string;
}

export function ml(en: string, fr: string, de: string): Ml {
  return { en, fr, de };
}

const LANGS: Lang[] = ['en', 'fr', 'de'];

/** Human label of each language (for the picker). */
export const LANG_LABEL: Record<Lang, string> = { en: 'EN', fr: 'FR', de: 'DE' };

/** Normalise a locale identifier (`fr_BE.utf8`, `de-AT`, `EN`) to a shipped language. */
export function normalizeLang(value: string | null | undefined): Lang | null {
  const head = String(value ?? '')
    .trim()
    .toLowerCase()
    .split(/[_.\-@]/)[0];
  return (LANGS as string[]).includes(head) ? (head as Lang) : null;
}

/** Resolve the page language (see the module header for the order). */
export function resolveLang(explicit?: string | null): Lang {
  const fromExplicit = normalizeLang(explicit);
  if (fromExplicit) return fromExplicit;
  if (typeof globalThis.location?.search === 'string') {
    const fromQuery = normalizeLang(new URLSearchParams(globalThis.location.search).get('lang'));
    if (fromQuery) return fromQuery;
  }
  const fromDocument = normalizeLang(globalThis.document?.documentElement?.lang);
  if (fromDocument) return fromDocument;
  const fromNavigator = normalizeLang(globalThis.navigator?.language);
  if (fromNavigator) return fromNavigator;
  return 'en';
}

/** Translate one string. */
export function t(message: Ml, lang: Lang): string {
  return message[lang] ?? message.en;
}

/**
 * Every string the page renders. Grouped by panel so a reviewer can check one
 * screen at a time. Placeholders are `{n}`, `{name}`… substituted by {@link fmt}.
 */
export const MSG = {
  // --- shell ----------------------------------------------------------------
  title: ml('Engineering Studio', 'Engineering Studio', 'Engineering Studio'),
  subtitle: ml(
    'DP type · DP · config modelling — check-in / check-out',
    'Modélisation DPT · DP · configs — check-in / check-out',
    'Modellierung DPT · DP · Konfigs — Check-in / Check-out'
  ),
  demoBanner: ml(
    'Offline demo — sample data, no WinCC OA',
    'Démo hors-ligne — données d’exemple, sans WinCC OA',
    'Offline-Demo — Beispieldaten, ohne WinCC OA'
  ),
  loading: ml('Loading…', 'Chargement…', 'Wird geladen…'),
  loadFailed: ml('Cannot load: {error}', 'Chargement impossible : {error}', 'Laden nicht möglich: {error}'),
  step1: ml('1 · Devices', '1 · Équipements', '1 · Geräte'),
  step2: ml('2 · Model', '2 · Modèle', '2 · Modell'),
  step3: ml('3 · Control', '3 · Contrôle', '3 · Kontrolle'),

  // --- devices panel --------------------------------------------------------
  devicesRail: ml('COMMUNICATING DEVICES', 'ÉQUIPEMENTS COMMUNICANTS', 'KOMMUNIZIERENDE GERÄTE'),
  addDevice: ml('+ Add', '+ Ajouter', '+ Hinzufügen'),
  addDeviceSoon: ml(
    'Add a device: per-protocol form (coming soon).',
    'Ajout d’équipement : formulaire par protocole (à venir).',
    'Gerät hinzufügen: protokollspezifisches Formular (folgt).'
  ),
  noDevice: ml('No device.', 'Aucun équipement.', 'Kein Gerät.'),
  books: ml('Books', 'Carnets', 'Adressbücher'),
  bookCount: ml('{n} books', '{n} carnets', '{n} Adressbücher'),
  catalogChip: ml('catalog', 'catalogue', 'Katalog'),
  sharedBook: ml('Shared book', 'Carnet mutualisé', 'Gemeinsames Adressbuch'),
  refreshBook: ml('↻ Refresh the book', '↻ Rafraîchir le carnet', '↻ Adressbuch aktualisieren'),
  noBookForDevice: ml('No book for this device.', 'Aucun carnet pour cet équipement.', 'Kein Adressbuch für dieses Gerät.'),
  noBookHint: ml(
    'No book attached — add an interface (OPC UA browse), ingest a SimaticML export, or attach a shared catalog.',
    'Aucun carnet associé — ajoutez une interface (browse OPC UA) ou ingérez un export SimaticML, ou associez un carnet mutualisé.',
    'Kein Adressbuch verknüpft — Schnittstelle hinzufügen (OPC UA-Browse), SimaticML-Export einlesen oder gemeinsamen Katalog verknüpfen.'
  ),
  interfaceOf: ml('Interface — {name}', 'Interface — {name}', 'Schnittstelle — {name}'),
  fileCatalogHint: ml(
    'File catalog (no live interface) — bound to the device at check-in through its own interface.',
    'Catalogue de fichier (sans interface live) — lié à l’équipement au check-in via son interface.',
    'Datei-Katalog (ohne Live-Schnittstelle) — beim Check-in über die Schnittstelle des Geräts gebunden.'
  ),
  addressBook: ml('Address book', 'Carnet d’adresses', 'Adressbuch'),
  fieldProtocol: ml('protocol', 'protocole', 'Protokoll'),
  fieldConnection: ml('connection', 'connexion', 'Verbindung'),
  fieldDriver: ml('driver', 'driver', 'Treiber'),
  fieldSource: ml('source', 'source', 'Quelle'),
  fieldGenerated: ml('generated', 'généré', 'erzeugt'),
  fieldDetail: ml('detail', 'détail', 'Detail'),
  fieldEntries: ml('entries', 'entrées', 'Einträge'),
  fieldSharedWith: ml('shared with', 'mutualisé avec', 'gemeinsam mit'),
  fieldWarnings: ml('warnings', 'avertissements', 'Warnungen'),
  entriesValue: ml('{n} signals · {types} type(s)', '{n} signaux · {types} type(s)', '{n} Signale · {types} Typ(en)'),
  generatorWarnings: ml('Generator warnings', 'Avertissements du générateur', 'Generator-Warnungen'),

  // --- online browse --------------------------------------------------------
  browseTitle: ml('Online OPC UA browse', 'Parcours OPC UA en ligne', 'OPC UA-Browse (online)'),
  browseConnection: ml('connection', 'connexion', 'Verbindung'),
  browseRoot: ml('root', 'racine', 'Wurzel'),
  browseBookId: ml('book', 'carnet', 'Adressbuch'),
  browseBookIdPlaceholder: ml(
    'id (default: opcua-<connection>)',
    'id (défaut : opcua-<connexion>)',
    'ID (Standard: opcua-<Verbindung>)'
  ),
  browseRun: ml('Browse', 'Parcourir', 'Browsen'),
  disconnectedSuffix: ml(' (disconnected)', ' (déconnectée)', ' (getrennt)'),
  browseReplayable: ml(
    'This book is refreshable: “Refresh” replays the same walk ({root}) and shows the delta.',
    'Ce carnet est rafraîchissable : « Rafraîchir » relance le même parcours ({root}) et affiche le delta.',
    'Dieses Adressbuch ist aktualisierbar: „Aktualisieren“ wiederholt denselben Durchlauf ({root}) und zeigt das Delta.'
  ),
  browseNotReplayable: ml(
    'This book has no stored browse parameters: “Refresh” only re-runs the qualification rules. Run a browse above to make it refreshable.',
    'Ce carnet n’a pas de paramètres de parcours enregistrés : « Rafraîchir » ne rejoue que les règles de qualification. Lancer un parcours ci-dessus pour le rendre rafraîchissable.',
    'Für dieses Adressbuch sind keine Browse-Parameter gespeichert: „Aktualisieren“ führt nur die Qualifizierungsregeln erneut aus. Starten Sie oben einen Durchlauf, um es aktualisierbar zu machen.'
  ),
  deltaTitle: ml('Delta of the last walk', 'Delta du dernier parcours', 'Delta des letzten Durchlaufs'),
  deltaNoChange: ml(
    'No change: the source matches the stored book.',
    'Aucun changement : la source est identique au carnet stocké.',
    'Keine Änderung: die Quelle entspricht dem gespeicherten Adressbuch.'
  ),
  deltaRemoved: ml('{n} removed', '{n} disparu(s)', '{n} entfernt'),
  deltaRemovedHint: ml(
    '— check the models that reference them:',
    '— vérifier les modèles qui les référencent :',
    '— prüfen Sie die Modelle, die sie verwenden:'
  ),
  deltaChanged: ml('{n} changed', '{n} modifié(s)', '{n} geändert'),
  deltaChangedHint: ml('(type, access or address):', '(type, accès ou adresse) :', '(Typ, Zugriff oder Adresse):'),
  deltaAdded: ml('{n} new', '{n} nouveau(x)', '{n} neu'),
  browseDone: ml(
    'Walk of “{conn}” finished: {n} signals{delta}.',
    'Parcours de « {conn} » terminé : {n} signaux{delta}.',
    'Durchlauf von „{conn}“ beendet: {n} Signale{delta}.'
  ),
  browseFailed: ml('Browse failed: {error}', 'Parcours impossible : {error}', 'Browse fehlgeschlagen: {error}'),
  refreshRebrowsed: ml(
    'Book “{name}” re-browsed online: {n} signals{delta}.',
    'Carnet « {name} » re-parcouru en ligne : {n} signaux{delta}.',
    'Adressbuch „{name}“ online neu durchlaufen: {n} Signale{delta}.'
  ),
  refreshRulesOnly: ml(
    'Book “{name}” refreshed (rules only): {n} signals. {note}',
    'Carnet « {name} » rafraîchi (règles seules) : {n} signaux. {note}',
    'Adressbuch „{name}“ aktualisiert (nur Regeln): {n} Signale. {note}'
  ),
  refreshFailed: ml(
    'Refresh failed: {error} — the stored book is kept.',
    'Rafraîchissement impossible : {error} — le carnet stocké est conservé.',
    'Aktualisierung fehlgeschlagen: {error} — das gespeicherte Adressbuch bleibt erhalten.'
  ),
  deltaNone: ml(' (no change)', ' (aucun changement)', ' (keine Änderung)'),

  // --- signal table ---------------------------------------------------------
  bookSignals: ml('Book signals', 'Signaux du carnet', 'Signale des Adressbuchs'),
  filterPlaceholder: ml('filter path or comment…', 'filtrer chemin ou commentaire…', 'Pfad oder Kommentar filtern…'),
  allRoles: ml('all roles', 'tous les rôles', 'alle Rollen'),
  allQualified: ml('all qualified', 'tout qualifié', 'alles qualifiziert'),
  toQualify: ml('{n} to qualify', '{n} à qualifier', '{n} zu qualifizieren'),
  applyRules: ml('⚙ Apply the rules', '⚙ Appliquer les règles', '⚙ Regeln anwenden'),
  applyRulesTitle: ml(
    'Re-run the qualification rules',
    'Réappliquer les règles de qualification',
    'Qualifizierungsregeln erneut anwenden'
  ),
  checkedCount: ml('{n} checked', '{n} coché(s)', '{n} ausgewählt'),
  uncheckAll: ml('uncheck', 'décocher', 'Auswahl aufheben'),
  assignRole: ml('assign a role to the checked…', 'affecter un rôle aux cochés…', 'Rolle den Ausgewählten zuweisen…'),
  fixAccess: ml('fix the access of the checked…', 'corriger l’accès des cochés…', 'Zugriff der Ausgewählten korrigieren…'),
  fixAccessTitle: ml(
    'Fix the access of the checked signals — the generated address direction follows',
    'Corriger l’accès des signaux cochés — la direction d’adresse générée en découle',
    'Zugriff der ausgewählten Signale korrigieren — die erzeugte Adressrichtung folgt daraus'
  ),
  accessReadOnly: ml('r — read only', 'r — lecture seule', 'r — nur lesen'),
  accessWriteOnly: ml('w — write only', 'w — écriture seule', 'w — nur schreiben'),
  accessReadWrite: ml('rw — read/write', 'rw — lecture/écriture', 'rw — lesen/schreiben'),
  accessApplied: ml(
    'Access “{access}” applied to {n} signal(s) — the generated address direction follows.',
    'Accès « {access} » appliqué à {n} signal(aux) — la direction d’adresse générée suivra.',
    'Zugriff „{access}“ auf {n} Signal(e) angewendet — die erzeugte Adressrichtung folgt.'
  ),
  rolesApplied: ml(
    '{n} signal(s) qualified as “{role}”.',
    '{n} signal(aux) qualifié(s) « {role} ».',
    '{n} Signal(e) als „{role}“ qualifiziert.'
  ),
  rulesApplied: ml(
    'Rules applied on “{name}”: {n}/{total} signals qualified.',
    'Règles appliquées sur « {name} » : {n}/{total} signaux qualifiés.',
    'Regeln auf „{name}“ angewendet: {n}/{total} Signale qualifiziert.'
  ),
  colPath: ml('path', 'chemin', 'Pfad'),
  colRole: ml('role', 'rôle', 'Rolle'),
  colType: ml('type', 'type', 'Typ'),
  colUnit: ml('unit', 'unité', 'Einheit'),
  colAccess: ml('access', 'accès', 'Zugriff'),
  colSourceType: ml('source type', 'type source', 'Quelltyp'),
  colTemplate: ml('template', 'gabarit', 'Vorlage'),
  colAddresses: ml('addresses (per mode)', 'adresses (par mode)', 'Adressen (je Modus)'),
  colComment: ml('comment', 'commentaire', 'Kommentar'),
  unmappedTitle: ml('type not mapped', 'type non mappé', 'Typ nicht zugeordnet'),
  accessDeclared: ml(
    'access declared by the source',
    'accès déclaré par la source',
    'von der Quelle deklarierter Zugriff'
  ),
  accessAssumed: ml(
    'access NOT declared by the source (assumed read-only) — the direction will come from the role; fix it here if the signal is writable',
    'accès NON déclaré par la source (supposé lecture seule) — la direction viendra du rôle ; corriger ici si le signal est accessible en écriture',
    'Zugriff NICHT von der Quelle deklariert (nur lesend angenommen) — die Richtung kommt aus der Rolle; hier korrigieren, wenn das Signal schreibbar ist'
  ),
  accessManual: ml('access set manually', 'accès corrigé manuellement', 'Zugriff manuell gesetzt'),

  // --- model panel ----------------------------------------------------------
  bookOf: ml('Book — {name}', 'Carnet — {name}', 'Adressbuch — {name}'),
  filterShort: ml('filter…', 'filtrer…', 'filtern…'),
  signalsOf: ml('{shown} / {total} signals', '{shown} / {total} signaux', '{shown} / {total} Signale'),
  modelOf: ml('Model — {name}', 'Modèle — {name}', 'Modell — {name}'),
  typesCount: ml('{n} type(s)', '{n} type(s)', '{n} Typ(en)'),
  dpsCount: ml('{n} DP', '{n} DP', '{n} DP'),
  configsCount: ml('{n} configs', '{n} configs', '{n} Konfigs'),
  testRead: ml('◉ Test-read', '◉ Test-read', '◉ Testlesen'),
  colDpe: ml('DPE', 'DPE', 'DPE'),
  colAddress: ml('address', 'adresse', 'Adresse'),
  colDir: ml('dir', 'dir', 'Ri.'),
  colAlarm: ml('alarm', 'alarme', 'Alarm'),
  colArchive: ml('archive', 'archive', 'Archiv'),
  colRange: ml('range', 'plage', 'Bereich'),
  colLiveValue: ml('live value', 'valeur live', 'Live-Wert'),
  noWorkspace: ml('No workspace.', 'Aucun workspace.', 'Kein Workspace.'),

  // --- generator ------------------------------------------------------------
  genTitle: ml(
    'Generate the model from this book',
    'Générer le modèle depuis ce carnet',
    'Modell aus diesem Adressbuch erzeugen'
  ),
  genType: ml('type', 'type', 'Typ'),
  genZone: ml('zone', 'zone', 'Zone'),
  genEquipments: ml('devices', 'équipements', 'Geräte'),
  genStructure: ml('structure', 'structure', 'Struktur'),
  genMirror: ml('mirror the book', 'miroir du carnet', 'Spiegel des Adressbuchs'),
  genCustom: ml('custom structure + mapping', 'structure personnalisée + mapping', 'eigene Struktur + Zuordnung'),
  genRun: ml('⚙ Generate', '⚙ Générer', '⚙ Erzeugen'),
  genUnknownHint: ml(
    '{n} signal(s) “to qualify”: their DPEs will be created without any config.',
    '{n} signal(aux) « à qualifier » : leurs DPE seront créés sans config.',
    '{n} Signal(e) „zu qualifizieren“: ihre DPEs werden ohne Konfig erstellt.'
  ),
  genDone: ml(
    'Model generated: type “{type}”, {dps} DP, {configs} configured DPEs — see the Control tab.',
    'Modèle généré : type « {type} », {dps} DP, {configs} DPE configurés — voir l’onglet Contrôle.',
    'Modell erzeugt: Typ „{type}“, {dps} DP, {configs} konfigurierte DPEs — siehe Reiter Kontrolle.'
  ),
  genFailed: ml('Generation failed: {error}', 'Génération impossible : {error}', 'Erzeugung fehlgeschlagen: {error}'),
  outlineHint: ml(
    'target structure (indentation = nesting, “Name : Type” = leaf)',
    'structure cible (indentation = imbrication, « Nom : Type » = feuille)',
    'Zielstruktur (Einrückung = Verschachtelung, „Name : Typ“ = Blatt)'
  ),
  mappedCount: ml('{n}/{total} element(s) mapped', '{n}/{total} élément(s) associé(s)', '{n}/{total} Element(e) zugeordnet'),
  autoBind: ml('⚡ Map automatically', '⚡ Associer automatiquement', '⚡ Automatisch zuordnen'),
  notMapped: ml('— not mapped —', '— non associé —', '— nicht zugeordnet —'),
  ambiguousLeaf: ml(
    '“{leaf}”: several candidate signals ({candidates}) — choose below.',
    '« {leaf} » : plusieurs signaux candidats ({candidates}) — choisir ci-dessous.',
    '„{leaf}“: mehrere Kandidaten ({candidates}) — unten auswählen.'
  ),
  autoBindDone: ml(
    'Automatic mapping: {bound} mapped, {unbound} without a match, {ambiguous} ambiguous.',
    'Association automatique : {bound} élément(s) associé(s), {unbound} sans correspondance, {ambiguous} ambigu(s).',
    'Automatische Zuordnung: {bound} zugeordnet, {unbound} ohne Treffer, {ambiguous} mehrdeutig.'
  ),

  // --- control panel --------------------------------------------------------
  controlTitle: ml('Control — check-in', 'Contrôle — check-in', 'Kontrolle — Check-in'),
  dryRun: ml('Preview (dry-run)', 'Aperçu (dry-run)', 'Vorschau (Dry-Run)'),
  checkin: ml('⇧ Check-in', '⇧ Check-in', '⇧ Check-in'),
  planEmpty: ml(
    'Nothing to check in: the workspace matches the project.',
    'Rien à checker-in : le workspace est identique au projet.',
    'Nichts einzuchecken: der Workspace entspricht dem Projekt.'
  ),
  opCreate: ml('create', 'créer', 'erstellen'),
  opUpdate: ml('update', 'modifier', 'ändern'),
  opDelete: ml('delete', 'supprimer', 'löschen'),
  colOp: ml('op', 'op', 'Op'),
  colObject: ml('object', 'objet', 'Objekt'),
  colName: ml('name', 'nom', 'Name'),
  conflictChip: ml('conflict', 'conflit', 'Konflikt'),
  conflictTitle: ml(
    'The live object changed since check-out — the applier refuses it',
    'L’objet live a changé depuis le check-out — l’applicateur le refuse',
    'Das Live-Objekt hat sich seit dem Check-out geändert — der Applier lehnt es ab'
  ),
  reportPreview: ml('Preview', 'Aperçu', 'Vorschau'),
  reportApplied: ml('Check-in result', 'Résultat du check-in', 'Ergebnis des Check-in'),
  reportCreated: ml('{n} created', '{n} créé(s)', '{n} erstellt'),
  reportUpdated: ml('{n} updated', '{n} modifié(s)', '{n} geändert'),
  reportDeleted: ml('{n} deleted', '{n} supprimé(s)', '{n} gelöscht'),
  reportSkipped: ml('{n} skipped', '{n} ignoré(s)', '{n} übersprungen'),
  reportFailed: ml('{n} failed', '{n} échec(s)', '{n} fehlgeschlagen'),
  checkinApplied: ml('Check-in applied.', 'Check-in appliqué.', 'Check-in angewendet.'),
  checkinFailed: ml('Check-in failed: {error}', 'Check-in impossible : {error}', 'Check-in fehlgeschlagen: {error}')
} as const;

/**
 * Role labels, translated here rather than taken from the core's
 * `SIGNAL_ROLE_LABEL` (which stays French, the untranslated engine layer).
 * Keyed by `SignalRole` — kept as a plain record so the page needs no core import
 * for its typing.
 */
export const ROLE_LABEL: Record<string, Ml> = {
  measure: ml('measure', 'mesure', 'Messwert'),
  setpoint: ml('setpoint', 'consigne', 'Sollwert'),
  command: ml('command', 'commande', 'Befehl'),
  state: ml('state', 'état', 'Zustand'),
  alarm: ml('alarm', 'alarme', 'Alarm'),
  counter: ml('counter', 'compteur', 'Zähler'),
  parameter: ml('parameter', 'paramètre', 'Parameter'),
  unknown: ml('to qualify', 'à qualifier', 'zu qualifizieren')
};

/** Substitute `{placeholder}` occurrences. Unknown placeholders are left as-is. */
export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replaceAll(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole));
}
