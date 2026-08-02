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
 * SCOPE — two tables:
 *   {@link MSG}         the page's own strings;
 *   {@link WARNING_MSG} the CORE's warnings, keyed by `EngWarning.code`. The core
 *                       stays language-neutral (a stable code + an English template
 *                       + params); this page re-templates each code and substitutes
 *                       the same params. An unknown code falls back to the core's
 *                       English message, so a new warning is never invisible —
 *                       merely untranslated. `tools/check-eng-i18n.mjs` fails on any
 *                       core code missing here, or on placeholders that drift.
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

/**
 * Translations of the CORE's warnings, keyed by `EngWarning.code`.
 *
 * The core stays language-neutral: it emits a stable code, an English template and
 * the params. This table re-templates each code in FR/DE and the page substitutes
 * the SAME params — so a value never has to be re-extracted from prose.
 *
 * Rules:
 *  - the `{placeholders}` of a translation must match the core's template. That is
 *    checked mechanically (`tools/check-eng-i18n.mjs`), because a dropped `{n}`
 *    renders a sentence with a missing number, silently, in one language only;
 *  - an UNKNOWN code falls back to the core's English message. A new core warning
 *    is therefore never invisible — merely untranslated;
 *  - `legacy` is the code given to books written before the structured warnings
 *    (see the core's `asEngWarnings`): nothing to translate, show it as it is.
 */
export const WARNING_MSG: Record<string, Ml> = {
  // --- address-book refresh ---------------------------------------------------
  'book.removed': ml(
    '⚠️ {n} signal(s) GONE from the source since the last walk ({paths}{more}) — check the models that reference them BEFORE any check-in.',
    '⚠️ {n} signal(aux) DISPARU(S) de la source depuis le dernier parcours ({paths}{more}) — vérifier les modèles qui les référencent AVANT tout check-in.',
    '⚠️ {n} Signal(e) seit dem letzten Durchlauf aus der Quelle VERSCHWUNDEN ({paths}{more}) — die Modelle prüfen, die sie verwenden, VOR jedem Check-in.'
  ),
  'book.changed': ml(
    '{n} signal(s) CHANGED (type, access or address) — the configs generated from them must be regenerated.',
    '{n} signal(aux) MODIFIÉ(S) (type, accès ou adresse) — les configs générées à partir d’eux sont à régénérer.',
    '{n} Signal(e) GEÄNDERT (Typ, Zugriff oder Adresse) — die daraus erzeugten Konfigs müssen neu erzeugt werden.'
  ),
  'book.added': ml('{n} new signal(s) found in the source.', '{n} nouveau(x) signal(aux) détecté(s) dans la source.', '{n} neue(s) Signal(e) in der Quelle gefunden.'),

  // --- online browse ----------------------------------------------------------
  'browse.truncated-entries': ml(
    'Walk TRUNCATED at {max} signals (maxEntries) — the book is INCOMPLETE. Narrow the browse root or raise the limit.',
    'Parcours TRONQUÉ à {max} signaux (maxEntries) — le carnet est INCOMPLET. Réduire la racine du parcours ou relever la limite.',
    'Durchlauf bei {max} Signalen ABGESCHNITTEN (maxEntries) — das Adressbuch ist UNVOLLSTÄNDIG. Wurzel einschränken oder Limit erhöhen.'
  ),
  'browse.truncated-requests': ml(
    'Walk TRUNCATED at {max} requests (maxRequests) — the book is INCOMPLETE. Narrow the browse root or raise the limit.',
    'Parcours TRONQUÉ à {max} requêtes (maxRequests) — le carnet est INCOMPLET. Réduire la racine du parcours ou relever la limite.',
    'Durchlauf bei {max} Anfragen ABGESCHNITTEN (maxRequests) — das Adressbuch ist UNVOLLSTÄNDIG. Wurzel einschränken oder Limit erhöhen.'
  ),
  'browse.depth-truncated': ml(
    '{n} branch(es) not explored beyond depth {depth} — the book is incomplete there.',
    '{n} branche(s) non explorée(s) au-delà de la profondeur {depth} — carnet incomplet sur ces branches.',
    '{n} Zweig(e) jenseits der Tiefe {depth} nicht erkundet — dort ist das Adressbuch unvollständig.'
  ),
  'browse.skipped-branches': ml(
    'Branches abandoned after the limit: {paths}{more}.',
    'Branches abandonnées après la limite : {paths}{more}.',
    'Nach dem Limit abgebrochene Zweige: {paths}{more}.'
  ),
  'browse.unreadable-branches': ml(
    '{n} unreadable branch(es): {details}{more}.',
    '{n} branche(s) illisible(s) : {details}{more}.',
    '{n} unlesbare(r) Zweig(e): {details}{more}.'
  ),
  'browse.methods-skipped': ml(
    '{n} OPC UA method(s) skipped (not modelled as DPEs).',
    '{n} méthode(s) OPC UA ignorée(s) (non modélisables en DPE).',
    '{n} OPC UA-Methode(n) übersprungen (nicht als DPE modellierbar).'
  ),
  'browse.arrays-flagged': ml(
    '{n} ARRAY variable(s) catalogued with their scalar base type and flagged "unmapped" ({paths}{more}) — the address write for a dynamic DPE is not verified: do not generate an address on them without validating it first.',
    '{n} variable(s) TABLEAU catalogué(es) avec leur type scalaire de base et marquées « non mappé » ({paths}{more}) — l’écriture d’adresse sur un DPE dynamique n’est pas vérifiée : ne pas générer d’adresse dessus sans validation.',
    '{n} ARRAY-Variable(n) mit ihrem skalaren Basistyp katalogisiert und als „nicht zugeordnet“ markiert ({paths}{more}) — das Adressschreiben auf einen dynamischen DPE ist nicht verifiziert: dort keine Adresse ohne Validierung erzeugen.'
  ),
  'browse.unnamed-nodes': ml(
    '{n} node(s) without a DisplayName skipped.',
    '{n} nœud(s) sans DisplayName ignoré(s).',
    '{n} Knoten ohne DisplayName übersprungen.'
  ),
  'browse.empty-root': ml(
    'No variable found under "{root}" — check the browse root and the connection state.',
    'Aucune variable trouvée sous « {root} » — vérifier la racine du parcours et l’état de la connexion.',
    'Keine Variable unter „{root}“ gefunden — Wurzel des Durchlaufs und Verbindungszustand prüfen.'
  ),
  'browse.access-all-assumed': ml(
    'This walk did not expose AccessLevel: every signal is catalogued READ-ONLY with an "assumed" access. The direction then comes from the role (its profile) — qualify before generating, or fix the access by hand.',
    'Ce parcours n’a pas exposé AccessLevel : tous les signaux sont catalogués en LECTURE SEULE avec un accès « supposé ». La direction vient alors du rôle (son profil) — qualifier avant de générer, ou corriger l’accès à la main.',
    'Dieser Durchlauf hat AccessLevel nicht geliefert: alle Signale sind NUR-LESEND mit „angenommenem“ Zugriff katalogisiert. Die Richtung kommt dann aus der Rolle (ihrem Profil) — vor dem Erzeugen qualifizieren oder den Zugriff manuell korrigieren.'
  ),
  'browse.access-partly-assumed': ml(
    '{n}/{total} signals without an exposed AccessLevel: "assumed" access (read-only) — the direction comes from the role for those.',
    '{n}/{total} signaux sans AccessLevel exposé : accès « supposé » (lecture seule) — pour ceux-là la direction vient du rôle.',
    '{n}/{total} Signale ohne gelieferten AccessLevel: „angenommener“ Zugriff (nur lesend) — für diese kommt die Richtung aus der Rolle.'
  ),
  'browse.access-read': ml(
    'AccessLevel read from the server for all {n} signals: the address direction will follow the real access.',
    'AccessLevel lu sur le serveur pour les {n} signaux : la direction d’adresse suivra l’accès réel.',
    'AccessLevel für alle {n} Signale vom Server gelesen: die Adressrichtung folgt dem echten Zugriff.'
  ),

  // --- NodeSet2 ---------------------------------------------------------------
  'nodeset.file-local-nodeids': ml(
    '⚠️ NodeSet2 NodeIds are FILE-LOCAL: a real server almost always assigns different namespace indices. The addresses below are CANDIDATES (placeholder "{placeholder}") — verify them against the server, or regenerate the book with an online browse, before any check-in.',
    '⚠️ Les NodeId d’un NodeSet2 sont LOCAUX AU FICHIER : un serveur réel attribue presque toujours d’autres index de namespace. Les adresses ci-dessous sont des CANDIDATES (placeholder « {placeholder} ») — les vérifier sur le serveur, ou régénérer le carnet par un parcours en ligne, avant tout check-in.',
    '⚠️ NodeIds eines NodeSet2 sind DATEILOKAL: ein echter Server vergibt fast immer andere Namespace-Indizes. Die Adressen unten sind KANDIDATEN (Platzhalter „{placeholder}“) — gegen den Server prüfen oder das Adressbuch per Online-Durchlauf neu erzeugen, vor jedem Check-in.'
  ),
  'nodeset.templates-only': ml(
    'No instance declared in the file: {n} type(s) catalogued as TEMPLATES (rooted at the type name) — a shareable book, bound to each device at generation time.',
    'Aucune instance déclarée dans le fichier : {n} type(s) catalogué(s) en GABARIT (racine = nom du type) — carnet mutualisable, lié à chaque équipement à la génération.',
    'Keine Instanz in der Datei deklariert: {n} Typ(en) als VORLAGEN katalogisiert (Wurzel = Typname) — ein gemeinsam nutzbares Adressbuch, das bei der Erzeugung an jedes Gerät gebunden wird.'
  ),
  'nodeset.no-variable': ml(
    'No usable variable found: check that the file really contains UAVariable nodes under UAObject/UAObjectType.',
    'Aucune variable exploitable trouvée : vérifier que le fichier contient bien des UAVariable sous des UAObject/UAObjectType.',
    'Keine verwertbare Variable gefunden: prüfen, ob die Datei wirklich UAVariable-Knoten unter UAObject/UAObjectType enthält.'
  ),
  'nodeset.methods-skipped': ml(
    '{n} OPC UA method(s) skipped (not modelled as DPEs).',
    '{n} méthode(s) OPC UA ignorée(s) (non modélisables en DPE).',
    '{n} OPC UA-Methode(n) übersprungen (nicht als DPE modellierbar).'
  ),
  'nodeset.arrays-flagged': ml(
    '{n} ARRAY variable(s) catalogued with their scalar base type and flagged "unmapped" ({paths}{more}) — the address write for a dynamic DPE is not verified.',
    '{n} variable(s) TABLEAU catalogué(es) avec leur type scalaire de base et marquées « non mappé » ({paths}{more}) — l’écriture d’adresse sur un DPE dynamique n’est pas vérifiée.',
    '{n} ARRAY-Variable(n) mit ihrem skalaren Basistyp katalogisiert und als „nicht zugeordnet“ markiert ({paths}{more}) — das Adressschreiben auf einen dynamischen DPE ist nicht verifiziert.'
  ),
  'nodeset.cycles-cut': ml(
    '{n} circular reference(s) cut while reading the model.',
    '{n} référence(s) circulaire(s) coupée(s) pendant la lecture du modèle.',
    '{n} zirkuläre Referenz(en) beim Lesen des Modells aufgetrennt.'
  ),
  'nodeset.depth-truncated': ml(
    '{n} branch(es) truncated beyond {depth} nesting levels.',
    '{n} branche(s) tronquée(s) au-delà de {depth} niveaux d’imbrication.',
    '{n} Zweig(e) jenseits von {depth} Verschachtelungsebenen abgeschnitten.'
  ),

  // --- model generation -------------------------------------------------------
  'modelgen.no-selection': ml(
    'No signal selected — nothing to generate.',
    'Aucun signal sélectionné — rien à générer.',
    'Kein Signal ausgewählt — nichts zu erzeugen.'
  ),
  'modelgen.prefix-stripped': ml(
    'Common prefix "{prefix}" stripped from the paths.',
    'Préfixe commun « {prefix} » retiré des chemins.',
    'Gemeinsames Präfix „{prefix}“ aus den Pfaden entfernt.'
  ),
  'modelgen.unusable-name': ml(
    'Signal "{path}" has no usable name — skipped.',
    'Signal « {path} » sans nom exploitable — ignoré.',
    'Signal „{path}“ hat keinen verwertbaren Namen — übersprungen.'
  ),
  'modelgen.no-device': ml(
    'No device supplied — the type is generated without any datapoint.',
    'Aucun équipement fourni — le type est généré sans datapoint.',
    'Kein Gerät angegeben — der Typ wird ohne Datenpunkt erzeugt.'
  ),
  'modelgen.unbound-leaves': ml(
    '{n} model element(s) with no mapped signal — DPEs created WITHOUT any config: {paths}{more}',
    '{n} élément(s) du modèle sans signal associé — DPE créés SANS config : {paths}{more}',
    '{n} Modellelement(e) ohne zugeordnetes Signal — DPEs OHNE Konfig erstellt: {paths}{more}'
  ),
  'modelgen.dangling-bindings': ml(
    '{n} mapping(s) point at a signal the book does not have: {details}',
    '{n} association(s) pointant vers un signal absent du carnet : {details}',
    '{n} Zuordnung(en) zeigen auf ein Signal, das das Adressbuch nicht hat: {details}'
  ),
  'modelgen.type-mismatch': ml(
    "{n} mapping(s) with a DIFFERENT TYPE (the model's type is kept): {details}",
    '{n} association(s) avec un TYPE DIFFÉRENT (le type du modèle est conservé) : {details}',
    '{n} Zuordnung(en) mit einem ANDEREN TYP (der Typ des Modells bleibt): {details}'
  ),
  'modelgen.unused-signals': ml(
    '{n} book signal(s) unused by the model (partial mapping assumed).',
    '{n} signal(aux) du carnet non utilisé(s) par le modèle (association partielle assumée).',
    '{n} Signal(e) des Adressbuchs vom Modell nicht genutzt (teilweise Zuordnung akzeptiert).'
  ),
  'modelgen.unqualified': ml(
    '{n} unqualified signal(s): their DPEs are created but NO config is generated — qualify them, then regenerate.',
    '{n} signal(aux) non qualifié(s) : leurs DPE sont créés mais AUCUNE config n’est générée — qualifier puis régénérer.',
    '{n} nicht qualifizierte(s) Signal(e): ihre DPEs werden erstellt, aber KEINE Konfig erzeugt — qualifizieren, dann neu erzeugen.'
  ),
  'modelgen.missing-address': ml(
    '{n} signal(s) with no address for mode "{mode}" — DPE created without a peripheral address.',
    '{n} signal(aux) sans adresse pour le mode « {mode} » — DPE créé sans adresse périphérique.',
    '{n} Signal(e) ohne Adresse für den Modus „{mode}“ — DPE ohne Peripherieadresse erstellt.'
  ),
  'modelgen.unresolved-reference': ml(
    '{n} signal(s) from an unbound catalog: supply the target connection to resolve the reference (placeholder left as-is).',
    '{n} signal(aux) issus d’un catalogue non lié : fournir la connexion cible pour résoudre la référence (placeholder non substitué).',
    '{n} Signal(e) aus einem nicht gebundenen Katalog: die Zielverbindung angeben, um die Referenz aufzulösen (Platzhalter unverändert).'
  ),
  'modelgen.unverified-datatype': ml(
    'The "{mode}" driver\'s "_datatype" transformation is UNVERIFIED (sentinel value) — confirm it on a real system before checking in.',
    'La transformation « _datatype » du driver « {mode} » est NON VÉRIFIÉE (valeur sentinelle) — à confirmer sur système réel avant check-in.',
    'Die „_datatype“-Transformation des Treibers „{mode}“ ist NICHT VERIFIZIERT (Sentinel-Wert) — vor dem Check-in an einem echten System bestätigen.'
  ),
  'modelgen.direction-adjusted': ml(
    'Address direction adjusted for {n} signal(s) — the role asked to write, the access declared by the source does not allow it: {details}{more}',
    'Direction d’adresse ajustée pour {n} signal(aux) — le rôle demandait l’écriture, l’accès déclaré par la source ne la permet pas : {details}{more}',
    'Adressrichtung für {n} Signal(e) angepasst — die Rolle wollte schreiben, der von der Quelle deklarierte Zugriff erlaubt es nicht: {details}{more}'
  ),
  'modelgen.access-assumed': ml(
    'Access NOT DECLARED for {n} signal(s) (a walk without AccessLevel): the direction comes from the role alone — check that the commands/setpoints really are writable on the device.',
    'Accès NON DÉCLARÉ pour {n} signal(aux) (parcours sans AccessLevel) : la direction vient du rôle seul — vérifier que les commandes/consignes sont bien accessibles en écriture sur l’équipement.',
    'Zugriff für {n} Signal(e) NICHT DEKLARIERT (Durchlauf ohne AccessLevel): die Richtung kommt allein aus der Rolle — prüfen, ob die Befehle/Sollwerte am Gerät wirklich schreibbar sind.'
  ),

  // --- structure outline ------------------------------------------------------
  'outline.odd-indent': ml(
    'line {line}: indented by {spaces} space(s) — use multiples of {step}',
    'ligne {line} : indentation de {spaces} espace(s) — utiliser des multiples de {step}',
    'Zeile {line}: um {spaces} Leerzeichen eingerückt — Vielfache von {step} verwenden'
  ),
  'outline.empty-name': ml('line {line}: empty element name', 'ligne {line} : nom d’élément vide', 'Zeile {line}: leerer Elementname'),
  'outline.invalid-identifier': ml(
    'line {line}: "{name}" yields no valid WinCC OA identifier',
    'ligne {line} : « {name} » ne donne aucun identifiant WinCC OA valide',
    'Zeile {line}: „{name}“ ergibt keinen gültigen WinCC OA-Identifier'
  ),
  'outline.sanitised': ml(
    'line {line}: "{name}" sanitised to "{clean}"',
    'ligne {line} : « {name} » assaini en « {clean} »',
    'Zeile {line}: „{name}“ bereinigt zu „{clean}“'
  ),
  'outline.unknown-type': ml(
    'line {line}: unknown type "{type}" — expected one of: {expected}',
    'ligne {line} : type « {type} » inconnu — attendu : {expected}',
    'Zeile {line}: unbekannter Typ „{type}“ — erwartet: {expected}'
  ),
  'outline.too-deep': ml(
    'line {line}: "{name}" is indented too deep (no parent at that level)',
    'ligne {line} : « {name} » indenté trop profondément (pas de parent à ce niveau)',
    'Zeile {line}: „{name}“ zu tief eingerückt (kein Elternelement auf dieser Ebene)'
  ),
  'outline.duplicate': ml(
    'line {line}: "{name}" duplicated under "{parent}"',
    'ligne {line} : « {name} » en doublon sous « {parent} »',
    'Zeile {line}: „{name}“ doppelt unter „{parent}“'
  ),

  // --- Schneider / Modbus -----------------------------------------------------
  'schneider.no-header': ml(
    'No recognised header — columns assumed in order: name, address, type, comment.',
    'Aucun en-tête reconnu — colonnes supposées dans l’ordre : nom, adresse, type, commentaire.',
    'Keine erkannte Kopfzeile — Spalten in dieser Reihenfolge angenommen: Name, Adresse, Typ, Kommentar.'
  ),
  'schneider.not-located': ml(
    'Variable "{name}" is not located (no address) — invisible to a Modbus client.',
    'Variable « {name} » non localisée (aucune adresse) — invisible pour un client Modbus.',
    'Variable „{name}“ ist nicht lokalisiert (keine Adresse) — für einen Modbus-Client unsichtbar.'
  ),
  'schneider.not-addressable': ml(
    'Variable "{name}" ({address}): {reason}.',
    'Variable « {name} » ({address}) : {reason}.',
    'Variable „{name}“ ({address}): {reason}.'
  ),
  'schneider.unverified-type': ml(
    'Variable "{name}": type "{type}" has no verified mapping — read as String.',
    'Variable « {name} » : type « {type} » sans correspondance vérifiée — lue comme String.',
    'Variable „{name}“: Typ „{type}“ ohne verifizierte Zuordnung — als String gelesen.'
  ),
  'schneider.register-overlap': ml(
    'Register {register} overlaps between "{first}" and "{second}" — check the memory layout.',
    'Chevauchement du registre {register} entre « {first} » et « {second} » — vérifier l’implantation mémoire.',
    'Register {register} überlappt zwischen „{first}“ und „{second}“ — Speicherbelegung prüfen.'
  ),
  'schneider.member-no-address': ml(
    'Member "{path}" has no address of its own — derived layout not computed (declare a located address, or export the member).',
    'Membre « {path} » sans adresse propre — implantation dérivée non calculée (déclarer une adresse localisée, ou exporter le membre).',
    'Member „{path}“ hat keine eigene Adresse — abgeleitete Belegung nicht berechnet (eine lokalisierte Adresse deklarieren oder das Member exportieren).'
  ),
  'schneider.xvm-unverified-schema': ml(
    'XVM/XSY reader: schema not verified against a vendor export (none available) — check the entries before any check-in.',
    'Lecteur XVM/XSY : schéma non vérifié sur un export constructeur (aucun disponible) — vérifier les entrées avant tout check-in.',
    'XVM/XSY-Leser: Schema nicht an einem Hersteller-Export verifiziert (keiner verfügbar) — die Einträge vor jedem Check-in prüfen.'
  ),
  'schneider.xvm-nothing-recognised': ml(
    'No variable recognised in the XML export — the XVM schema is unverified. Elements seen: {elements}. Add the missing element/attribute to the aliases in schneider/xvm.ts.',
    'Aucune variable reconnue dans l’export XML — schéma XVM non vérifié. Éléments rencontrés : {elements}. Ajouter l’élément/attribut manquant aux alias de schneider/xvm.ts.',
    'Keine Variable im XML-Export erkannt — das XVM-Schema ist nicht verifiziert. Gesehene Elemente: {elements}. Das fehlende Element/Attribut den Aliassen in schneider/xvm.ts hinzufügen.'
  ),
  'schneider.xvm-unreadable': ml('Unreadable XML: {error}', 'XML illisible : {error}', 'Unlesbares XML: {error}'),

  // --- SimaticML / TIA --------------------------------------------------------
  'simaticml.udt-missing': ml(
    'Member "{member}": UDT "{udt}" is not part of the bundle — skipped.',
    'Membre « {member} » : l’UDT « {udt} » ne fait pas partie du lot — ignoré.',
    'Member „{member}“: UDT „{udt}“ ist nicht Teil des Bündels — übersprungen.'
  ),
  'simaticml.udt-recursive': ml(
    'Member "{member}": recursive UDT "{udt}" — skipped.',
    'Membre « {member} » : UDT « {udt} » récursif — ignoré.',
    'Member „{member}“: rekursives UDT „{udt}“ — übersprungen.'
  ),
  'simaticml.array-skipped': ml(
    'Member "{path}": array datatypes are not imported in v1 — skipped.',
    'Membre « {path} » : les types tableau ne sont pas importés en v1 — ignoré.',
    'Member „{path}“: Array-Datentypen werden in v1 nicht importiert — übersprungen.'
  ),
  'simaticml.document-failed': ml('{file}: {error}', '{file} : {error}', '{file}: {error}'),
  'simaticml.no-block-number': ml(
    'DB "{block}": standard layout but no block number — classic operands skipped.',
    'DB « {block} » : implantation standard mais aucun numéro de bloc — opérandes classiques ignorés.',
    'DB „{block}“: Standard-Belegung, aber keine Blocknummer — klassische Operanden übersprungen.'
  ),
  'simaticml.datatype-unmapped': ml(
    'Member "{path}": datatype "{type}" is not mapped — bound as String.',
    'Membre « {path} » : type « {type} » non mappé — lié en String.',
    'Member „{path}“: Datentyp „{type}“ nicht zugeordnet — als String gebunden.'
  ),

  // --- demo fixtures (the offline sample books) --------------------------------
  'demo.pac3200-no-browse': ml(
    'Modbus: no browse is possible — this book comes from the vendor register map.',
    'Modbus : aucun browse possible — ce carnet vient de la cartographie de registres du constructeur.',
    'Modbus: kein Browse möglich — dieses Adressbuch stammt aus der Registerkarte des Herstellers.'
  ),
  'demo.pac3200-notations': ml(
    'Equivalent notations of the same register: {holding} (standard, shown here) = {word} (Industrial Edge templates) = offset {offset} of the manual.',
    'Notations équivalentes du même registre : {holding} (standard, affiché ici) = {word} (templates Industrial Edge) = offset {offset} du manuel.',
    'Gleichwertige Notationen desselben Registers: {holding} (Standard, hier gezeigt) = {word} (Industrial-Edge-Vorlagen) = Offset {offset} des Handbuchs.'
  ),
  'demo.pac3200-zero-based': ml(
    'Check the connector\'s "Zero based addressing" option: a one-register shift offsets every measurement.',
    'Vérifier l’option « Zero based addressing » du connecteur : un décalage d’un registre décale toutes les mesures.',
    'Die Option „Zero based addressing“ des Konnektors prüfen: eine Verschiebung um ein Register verschiebt alle Messwerte.'
  ),
  'demo.pac3200-energy-block': ml(
    'Energy counters: this book targets tariff T1 (block 2801-2820); block 801-820 exposes the cumulative counters as LREAL.',
    'Compteurs d’énergie : ce carnet cible le tarif T1 (bloc 2801-2820) ; le bloc 801-820 expose les compteurs cumulés en LREAL.',
    'Energiezähler: dieses Adressbuch zielt auf Tarif T1 (Block 2801-2820); Block 801-820 liefert die kumulierten Zähler als LREAL.'
  ),
  'demo.packml-subset': ml(
    'A representative SUBSET of PackTags (the OPC 30050 spec could not be opened directly) — recalibrate it with a browse of the machine, or by ingesting the spec NodeSet2.',
    'Sous-ensemble REPRÉSENTATIF de PackTags (la spec OPC 30050 n’a pas pu être ouverte directement) — à recalibrer par un browse de la machine, ou en ingérant le NodeSet2 de la spec.',
    'Eine REPRÄSENTATIVE Teilmenge der PackTags (die Spezifikation OPC 30050 konnte nicht direkt geöffnet werden) — mit einem Browse der Maschine oder durch Einlesen des NodeSet2 der Spezifikation neu kalibrieren.'
  ),
  'demo.packml-illustrative-nodeids': ml(
    'The NodeIds are illustrative (ns=4;s=…): the real namespace depends on the machine OPC UA server.',
    'Les NodeId sont illustratifs (ns=4;s=…) : l’espace de noms réel dépend du serveur OPC UA de la machine.',
    'Die NodeIds sind exemplarisch (ns=4;s=…): der echte Namespace hängt vom OPC UA-Server der Maschine ab.'
  ),

  // --- the page's own failures (not from the core) -----------------------------
  'ui.generation-failed': ml('{message}', '{message}', '{message}'),

  // --- check-in diff ----------------------------------------------------------
  'diff.retype-unsupported': ml(
    'Datapoint "{dp}" exists with type "{live}" (workspace: "{wanted}") — retype is not supported; item skipped.',
    'Le datapoint « {dp} » existe avec le type « {live} » (workspace : « {wanted} ») — le changement de type n’est pas supporté ; élément ignoré.',
    'Der Datenpunkt „{dp}“ existiert mit dem Typ „{live}“ (Workspace: „{wanted}“) — ein Typwechsel wird nicht unterstützt; Element übersprungen.'
  )
};
