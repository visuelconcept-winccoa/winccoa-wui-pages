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
  stepDevices: ml('Devices', 'Équipements', 'Geräte'),
  stepBooks: ml('Catalogs', 'Catalogues', 'Kataloge'),
  stepModel: ml('Model', 'Modèle', 'Modell'),
  stepControl: ml('Control', 'Contrôle', 'Kontrolle'),

  // --- devices panel --------------------------------------------------------
  devicesRail: ml('COMMUNICATING DEVICES', 'ÉQUIPEMENTS COMMUNICANTS', 'KOMMUNIZIERENDE GERÄTE'),

  // --- connection state (the LED and what it means) -------------------------
  // A coloured LED with no word beside it is a riddle, and a grey one is a riddle
  // with three possible answers (see the core's `DeviceStateSource`) — so the state
  // is spelled out, and the REASON travels with it as the badge's tooltip.
  stateConnected: ml('Connected', 'Connecté', 'Verbunden'),
  stateDisconnected: ml('Disconnected', 'Déconnecté', 'Getrennt'),
  stateUnknown: ml('State unknown', 'État inconnu', 'Status unbekannt'),
  stateVia: ml('read on “{connection}”', 'lu sur « {connection} »', 'gelesen an „{connection}“'),
  serverUnknown: ml(
    'This project has no connection named “{name}” (it has: {known}). Nothing refuses it — the connection may be created later — but as long as it does not exist, no state can be read and the generated addresses will not bind.',
    'Ce projet n’a aucune connexion nommée « {name} » (il a : {known}). Rien ne l’interdit — la connexion peut être créée ensuite — mais tant qu’elle n’existe pas, aucun état ne peut être lu et les adresses générées ne se lieront pas.',
    'Dieses Projekt hat keine Verbindung mit dem Namen „{name}“ (vorhanden: {known}). Nichts verbietet es — die Verbindung kann später erstellt werden — aber solange sie nicht existiert, kann kein Status gelesen werden und die erzeugten Adressen binden nicht.'
  ),
  stateWhy: {
    connstate: ml(
      'Read live on “{connection}” (Common.State.ConnState = {code}).',
      'Lu en direct sur « {connection} » (Common.State.ConnState = {code}).',
      'Live an „{connection}“ gelesen (Common.State.ConnState = {code}).'
    ),
    'opcua-connstate': ml(
      'Read live on the OPC UA connection “{connection}” (State.ConnState = {code}) — its driver leaves the common element undefined.',
      'Lu en direct sur la connexion OPC UA « {connection} » (State.ConnState = {code}) — son driver laisse l’élément commun indéfini.',
      'Live an der OPC UA-Verbindung „{connection}“ gelesen (State.ConnState = {code}) — ihr Treiber lässt das gemeinsame Element undefiniert.'
    ),
    'unknown-connection': ml(
      'No connection datapoint matches “{connection}” in this project — the declaration points at a connection that does not exist, which is not the same as a connection that is down.',
      'Aucun datapoint de connexion ne correspond à « {connection} » dans ce projet — la déclaration désigne une connexion inexistante, ce qui n’est pas la même chose qu’une connexion coupée.',
      'Kein Verbindungs-Datenpunkt passt zu „{connection}“ in diesem Projekt — die Deklaration verweist auf eine nicht existierende Verbindung, was nicht dasselbe ist wie eine unterbrochene Verbindung.'
    ),
    'ambiguous-connection': ml(
      'SEVERAL connections of the project carry the address “{connection}” — none of them may speak for this equipment, so no state is claimed. Name the connection in the declaration.',
      'PLUSIEURS connexions du projet portent l’adresse « {connection} » — aucune ne peut parler pour cet équipement, donc aucun état n’est affirmé. Nommer la connexion dans la déclaration.',
      'MEHRERE Verbindungen des Projekts tragen die Adresse „{connection}“ — keine davon darf für dieses Gerät sprechen, daher wird kein Status behauptet. Die Verbindung in der Deklaration benennen.'
    ),
    'probe-failed': ml(
      'The connection state of “{connection}” could not be read (driver stopped, or no permission) — reported as unknown rather than as disconnected.',
      'L’état de la connexion « {connection} » n’a pas pu être lu (driver arrêté, ou droits insuffisants) — signalé comme inconnu et non comme déconnecté.',
      'Der Verbindungsstatus von „{connection}“ konnte nicht gelesen werden (Treiber gestoppt oder keine Berechtigung) — als unbekannt gemeldet, nicht als getrennt.'
    ),
    unprobed: ml(
      'The declaration carries nothing to find a connection with (no server name, no address), so no state is read. A running driver does not mean a reachable station — nothing is assumed from it.',
      'La déclaration ne porte rien qui permette de retrouver une connexion (ni nom de serveur, ni adresse), donc aucun état n’est lu. Un driver démarré ne signifie pas une station joignable — rien n’en est déduit.',
      'Die Deklaration enthält nichts, womit eine Verbindung gefunden werden könnte (kein Servername, keine Adresse), daher wird kein Status gelesen. Ein laufender Treiber bedeutet keine erreichbare Station — daraus wird nichts abgeleitet.'
    )
  },

  /**
   * The RAW WinCC OA `ConnState`, in the vendor's own words (message catalogue
   * `opcua.cat`, keys `CommonConnState…`). Shown beside the LED because `1`, `3` and
   * `5` all light one red lamp and call for three different actions: fix the link,
   * re-enable the connection, look at the driver's error.
   */
  connStateCode: {
    '-1': ml('undefined', 'indéfini', 'undefiniert'),
    '0': ml('undefined by the driver', 'non renseigné par le driver', 'vom Treiber nicht gesetzt'),
    '1': ml('not connected', 'non connecté', 'nicht verbunden'),
    '3': ml('inactive (connection disabled)', 'inactive (connexion désactivée)', 'inaktiv (Verbindung deaktiviert)'),
    '5': ml('failure', 'défaut', 'Störung'),
    '256': ml('connected', 'connecté', 'verbunden'),
    '257': ml('main server · main connection', 'serveur principal · connexion principale', 'Hauptserver · Hauptverbindung'),
    '258': ml('main server · redundant connection', 'serveur principal · connexion redondante', 'Hauptserver · Redundanzverbindung'),
    '259': ml('redundant server · main connection', 'serveur redondant · connexion principale', 'Redundanzserver · Hauptverbindung'),
    '260': ml('redundant server · redundant connection', 'serveur redondant · connexion redondante', 'Redundanzserver · Redundanzverbindung')
  } as Record<string, Ml>,
  addDevice: ml('Add', 'Ajouter', 'Hinzufügen'),
  noDevice: ml('No device.', 'Aucun équipement.', 'Kein Gerät.'),
  books: ml('Books', 'Carnets', 'Adressbücher'),
  bookCount: ml('{n} books', '{n} carnets', '{n} Adressbücher'),
  catalogChip: ml('catalog', 'catalogue', 'Katalog'),
  sharedBook: ml('Shared book', 'Carnet mutualisé', 'Gemeinsames Adressbuch'),
  refreshBook: ml('Refresh the book', 'Rafraîchir le carnet', 'Adressbuch aktualisieren'),
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

  // --- device form ----------------------------------------------------------
  deviceEdit: ml('Edit', 'Modifier', 'Bearbeiten'),
  deviceFormNew: ml('New device', 'Nouvel équipement', 'Neues Gerät'),
  deviceFormEdit: ml('Device — {name}', 'Équipement — {name}', 'Gerät — {name}'),
  deviceDelete: ml('Delete', 'Supprimer', 'Löschen'),
  deviceDeleteConfirm: ml('Confirm the deletion', 'Confirmer la suppression', 'Löschen bestätigen'),
  deviceDeleteHint: ml(
    'Deleting only forgets the equipment here: its books are KEPT (they may be shared) and nothing already checked in is touched.',
    'La suppression n’oublie l’équipement qu’ici : ses carnets sont CONSERVÉS (ils peuvent être mutualisés) et rien de déjà checké-in n’est touché.',
    'Das Löschen vergisst das Gerät nur hier: seine Adressbücher BLEIBEN erhalten (sie können gemeinsam genutzt werden) und bereits eingecheckte Objekte werden nicht angetastet.'
  ),
  cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
  save: ml('Save', 'Enregistrer', 'Speichern'),
  deviceIdentity: ml('Identity', 'Identité', 'Identität'),
  deviceName: ml('name', 'nom', 'Name'),
  deviceIdFixed: ml(
    'Identifier: {id} — fixed at creation. Books and configs reference it, so a rename never changes it.',
    'Identifiant : {id} — fixé à la création. Les carnets et les configs le référencent : un renommage ne le change pas.',
    'Kennung: {id} — bei der Erstellung festgelegt. Adressbücher und Konfigs verweisen darauf, eine Umbenennung ändert sie nicht.'
  ),
  deviceIdDerived: ml(
    'Identifier: {id} — derived from the name, then fixed for good.',
    'Identifiant : {id} — dérivé du nom, puis fixé définitivement.',
    'Kennung: {id} — aus dem Namen abgeleitet und dann endgültig festgelegt.'
  ),
  deviceProtocol: ml('protocol', 'protocole', 'Protokoll'),
  deviceAccessModes: ml('access modes', 'modes d’accès', 'Zugriffsarten'),
  deviceAccessModesHint: ml(
    'One candidate address is generated per checked mode — an S7-1500 reachable both ways carries S7+ AND OPC UA.',
    'Une adresse candidate est générée par mode coché — un S7-1500 joignable des deux façons porte S7+ ET OPC UA.',
    'Pro angehakter Zugriffsart wird eine Kandidaten-Adresse erzeugt — eine S7-1500, die auf beiden Wegen erreichbar ist, trägt S7+ UND OPC UA.'
  ),
  deviceConnection: ml('Connection — {protocol}', 'Connexion — {protocol}', 'Verbindung — {protocol}'),
  deviceDriverNumber: ml('driver', 'driver', 'Treiber'),
  devicePollGroup: ml('poll group', 'groupe de poll', 'Poll-Gruppe'),
  devicePollGroupHint: ml(
    'Both optional. The poll group names the _PollGroup datapoint the generated addresses subscribe to.',
    'Les deux sont optionnels. Le groupe de poll nomme le datapoint _PollGroup auquel les adresses générées s’abonnent.',
    'Beide optional. Die Poll-Gruppe benennt den _PollGroup-Datenpunkt, den die erzeugten Adressen abonnieren.'
  ),

  // --- driver picker --------------------------------------------------------
  // The driver number is the manager number EVERY generated address of the
  // equipment lands on, so the form offers the project's drivers instead of asking
  // for a number from memory.
  driverRunning: ml('{n} — {type} · running', '{n} — {type} · en marche', '{n} — {type} · läuft'),
  driverStopped: ml('{n} — {type} · stopped', '{n} — {type} · arrêté', '{n} — {type} · gestoppt'),
  driverStateUnknown: ml('{n} — {type} · state unknown', '{n} — {type} · état inconnu', '{n} — {type} · Status unbekannt'),
  driverTypeUnknown: ml('type unreadable', 'type illisible', 'Typ nicht lesbar'),
  driverOther: ml('other — enter a number…', 'autre — saisir un numéro…', 'anderer — Nummer eingeben…'),
  driverFree: ml('manager number', 'numéro de manager', 'Managernummer'),
  driverHint: ml(
    'The manager number every generated address of this equipment is written to. Picked from the project’s drivers; auto-detection at check-in only covers OPC UA, so state it here for the other protocols.',
    'Le numéro de manager sur lequel chaque adresse générée de cet équipement est écrite. Choisi parmi les drivers du projet ; l’auto-détection au check-in ne couvre qu’OPC UA : le renseigner ici pour les autres protocoles.',
    'Die Managernummer, auf die jede erzeugte Adresse dieses Geräts geschrieben wird. Aus den Treibern des Projekts gewählt; die automatische Erkennung beim Check-in deckt nur OPC UA ab — für andere Protokolle hier angeben.'
  ),
  driverNoneListed: ml(
    'No driver could be listed (no runtime, or no permission) — enter the manager number.',
    'Aucun driver n’a pu être listé (pas de runtime, ou droits insuffisants) — saisir le numéro de manager.',
    'Es konnte kein Treiber aufgelistet werden (kein Runtime oder keine Berechtigung) — die Managernummer eingeben.'
  ),
  driverMismatch: ml(
    'Driver {n} is a “{type}”, which does not match the {protocol} protocol of this equipment.',
    'Le driver {n} est un « {type} », ce qui ne correspond pas au protocole {protocol} de cet équipement.',
    'Treiber {n} ist ein „{type}“ und passt nicht zum {protocol}-Protokoll dieses Geräts.'
  ),
  paramUnset: ml('— not stated —', '— non renseigné —', '— nicht angegeben —'),
  deviceDeclared: ml(
    'Declared on the WinCC OA side',
    'Déclaré côté WinCC OA',
    'Auf WinCC OA-Seite deklariert'
  ),
  deviceDeclaredHint: ml(
    'Recorded here, NOT applied: these are set in the project config file / when the connection to the device is created — there is no per-address attribute for them. They decide how every register of the book is interpreted (a word swap turns a REAL into nonsense, a one-register shift moves every measurement), so write down what the driver is actually configured with.',
    'Consigné ici, PAS appliqué : cela se règle dans le fichier config du projet / à la création de la connexion vers l’équipement — aucun attribut d’adresse ne les porte. Ces réglages décident de l’interprétation de chaque registre du carnet (une permutation de mots rend un REAL absurde, un décalage d’un registre décale toutes les mesures) : noter ici ce dont le driver est réellement configuré.',
    'Hier festgehalten, NICHT angewendet: das wird in der Projekt-Config-Datei / beim Anlegen der Verbindung zum Gerät eingestellt — es gibt kein Adressattribut dafür. Diese Einstellungen bestimmen, wie jedes Register des Adressbuchs interpretiert wird (ein Worttausch macht aus einem REAL Unsinn, eine Verschiebung um ein Register verschiebt alle Messwerte) — also notieren, wie der Treiber wirklich konfiguriert ist.'
  ),
  deviceBooks: ml('Address books', 'Carnets d’adresses', 'Adressbücher'),
  deviceNoBookYet: ml(
    'No book yet — save the equipment, then browse its server or ingest an export.',
    'Aucun carnet pour l’instant — enregistrer l’équipement, puis parcourir son serveur ou ingérer un export.',
    'Noch kein Adressbuch — das Gerät speichern, dann seinen Server durchlaufen oder einen Export einlesen.'
  ),
  deviceBooksHint: ml(
    'A book may be shared by several equipments (⇆): the catalog of a machine model is bound to each one at generation time.',
    'Un carnet peut être mutualisé entre plusieurs équipements (⇆) : le catalogue d’un modèle de machine est lié à chacun à la génération.',
    'Ein Adressbuch kann von mehreren Geräten gemeinsam genutzt werden (⇆): der Katalog eines Maschinenmodells wird bei der Erzeugung an jedes gebunden.'
  ),
  deviceProblems: ml('Problems', 'Problèmes', 'Probleme'),
  deviceCreated: ml('Device “{name}” created.', 'Équipement « {name} » créé.', 'Gerät „{name}“ erstellt.'),
  deviceUpdated: ml('Device “{name}” updated.', 'Équipement « {name} » modifié.', 'Gerät „{name}“ geändert.'),
  deviceDeleted: ml(
    'Device “{name}” deleted — its books are kept.',
    'Équipement « {name} » supprimé — ses carnets sont conservés.',
    'Gerät „{name}“ gelöscht — seine Adressbücher bleiben erhalten.'
  ),
  deviceSaveFailed: ml('Save refused: {error}', 'Enregistrement refusé : {error}', 'Speichern abgelehnt: {error}'),

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

  // --- catalogues panel -----------------------------------------------------
  // Books are FIRST-CLASS: a catalog exists on its own (a vendor register map, a
  // PackML interface, a machine-model catalog) and is bound to equipments
  // afterwards — so it must be creatable without declaring a device first.
  booksTitle: ml('Catalogs (address books)', 'Catalogues (carnets d’adresses)', 'Kataloge (Adressbücher)'),
  booksCount: ml('{n} catalog(s)', '{n} catalogue(s)', '{n} Katalog(e)'),
  booksSignalsTotal: ml('{n} signals', '{n} signaux', '{n} Signale'),
  bookNew: ml('New catalog', 'Nouveau catalogue', 'Neuer Katalog'),
  booksEmpty: ml(
    'No catalog yet. A catalog is created from a file (TIA/SimaticML export, Control Expert CSV or XVM, OPC UA NodeSet2) or by walking a live OPC UA server — no equipment needed.',
    'Aucun catalogue. Un catalogue se crée depuis un fichier (export TIA/SimaticML, CSV ou XVM Control Expert, NodeSet2 OPC UA) ou en parcourant un serveur OPC UA en ligne — sans équipement.',
    'Noch kein Katalog. Ein Katalog wird aus einer Datei erzeugt (TIA/SimaticML-Export, Control-Expert-CSV oder -XVM, OPC UA NodeSet2) oder durch das Durchlaufen eines Live-OPC-UA-Servers — ohne Gerät.'
  ),
  bookPickHint: ml('Pick a catalog on the left.', 'Choisir un catalogue à gauche.', 'Links einen Katalog auswählen.'),
  bookFilterPlaceholder: ml('filter the catalogs…', 'filtrer les catalogues…', 'Kataloge filtern…'),
  bookOrphan: ml('unused', 'inutilisé', 'unbenutzt'),
  bookOrphanTitle: ml(
    'This catalog serves no equipment yet — attach it below.',
    'Ce catalogue ne sert aucun équipement — l’associer ci-dessous.',
    'Dieser Katalog bedient noch kein Gerät — unten verknüpfen.'
  ),
  bookTemplate: ml('template', 'gabarit', 'Vorlage'),
  bookUsedBy: ml('Equipments served', 'Équipements servis', 'Bediente Geräte'),
  bookUsedByHint: ml(
    'Check the equipments this catalog serves. The relation is many-to-many: one catalog may serve several equipments (⇆) and one equipment may aggregate several catalogs.',
    'Cocher les équipements servis par ce catalogue. La relation est plusieurs-à-plusieurs : un catalogue peut servir plusieurs équipements (⇆) et un équipement peut agréger plusieurs catalogues.',
    'Die Geräte anhaken, die dieser Katalog bedient. Die Beziehung ist n:m: ein Katalog kann mehrere Geräte bedienen (⇆) und ein Gerät mehrere Kataloge zusammenfassen.'
  ),
  bookAttachApply: ml('Apply the links', 'Appliquer les associations', 'Verknüpfungen anwenden'),
  bookAttachDone: ml(
    'Catalog “{name}” now serves {n} equipment(s).',
    'Le catalogue « {name} » sert maintenant {n} équipement(s).',
    'Der Katalog „{name}“ bedient jetzt {n} Gerät(e).'
  ),
  bookAttachFailed: ml('Linking refused: {error}', 'Association refusée : {error}', 'Verknüpfen abgelehnt: {error}'),
  bookDelete: ml('Delete the catalog', 'Supprimer le catalogue', 'Katalog löschen'),
  bookDeleteConfirm: ml('Confirm the deletion', 'Confirmer la suppression', 'Löschen bestätigen'),
  bookDeleteHint: ml(
    'Deleting forgets the catalog and DETACHES it from every equipment that used it. Nothing already checked in is touched: the addresses written from it live in the project. A file catalog can only be recreated by re-ingesting its source.',
    'La suppression oublie le catalogue et le DÉTACHE de tous les équipements qui l’utilisaient. Rien de déjà checké-in n’est touché : les adresses écrites depuis lui vivent dans le projet. Un catalogue de fichier ne se recrée qu’en ré-ingérant sa source.',
    'Das Löschen vergisst den Katalog und LÖST ihn von allen Geräten, die ihn genutzt haben. Bereits eingecheckte Objekte werden nicht angetastet: die daraus geschriebenen Adressen leben im Projekt. Ein Datei-Katalog kann nur durch erneutes Einlesen seiner Quelle wiederhergestellt werden.'
  ),
  bookDeleteUsedWarning: ml(
    'Used by {n} equipment(s) — they will lose this catalog.',
    'Utilisé par {n} équipement(s) — ils perdront ce catalogue.',
    'Von {n} Gerät(en) genutzt — sie verlieren diesen Katalog.'
  ),
  bookDeleted: ml('Catalog “{name}” deleted.', 'Catalogue « {name} » supprimé.', 'Katalog „{name}“ gelöscht.'),
  bookDeleteFailed: ml('Deletion refused: {error}', 'Suppression refusée : {error}', 'Löschen abgelehnt: {error}'),

  // --- catalogue creation form ----------------------------------------------
  bookFormNew: ml('New catalog', 'Nouveau catalogue', 'Neuer Katalog'),
  bookIdentity: ml('Identity', 'Identité', 'Identität'),
  bookName: ml('name', 'nom', 'Name'),
  bookIdDerived: ml(
    'Identifier: {id} — derived from the name and then fixed: equipments reference a catalog by id.',
    'Identifiant : {id} — dérivé du nom puis fixé : les équipements référencent un catalogue par son id.',
    'Kennung: {id} — aus dem Namen abgeleitet und dann fest: Geräte verweisen per ID auf einen Katalog.'
  ),
  bookIdExists: ml(
    'A catalog “{id}” already exists — creating will REPLACE it (same as a re-browse).',
    'Un catalogue « {id} » existe déjà — la création le REMPLACERA (comme un re-parcours).',
    'Ein Katalog „{id}“ existiert bereits — das Erstellen ERSETZT ihn (wie ein erneuter Durchlauf).'
  ),
  bookSourceSection: ml('Source', 'Source', 'Quelle'),
  bookFormat: ml('generator', 'générateur', 'Generator'),
  bookFile: ml('file', 'fichier', 'Datei'),
  bookFiles: ml('files', 'fichiers', 'Dateien'),
  bookFileChosen: ml('{n} file(s), {size} kB', '{n} fichier(s), {size} ko', '{n} Datei(en), {size} kB'),
  bookNoFile: ml('No file chosen.', 'Aucun fichier choisi.', 'Keine Datei gewählt.'),
  bookReadFailed: ml('Cannot read the file: {error}', 'Lecture du fichier impossible : {error}', 'Datei nicht lesbar: {error}'),
  bookCreate: ml('Create the catalog', 'Créer le catalogue', 'Katalog erstellen'),
  bookCreated: ml(
    'Catalog “{name}” created: {n} signals, {warnings} warning(s).',
    'Catalogue « {name} » créé : {n} signaux, {warnings} avertissement(s).',
    'Katalog „{name}“ erstellt: {n} Signale, {warnings} Warnung(en).'
  ),
  bookCreateFailed: ml('Creation refused: {error}', 'Création refusée : {error}', 'Erstellen abgelehnt: {error}'),
  bookNeedName: ml('Give the catalog a name.', 'Nommer le catalogue.', 'Dem Katalog einen Namen geben.'),
  bookNeedFile: ml('Choose the source file.', 'Choisir le fichier source.', 'Die Quelldatei wählen.'),
  bookNeedConnection: ml(
    'Choose the OPC UA connection to walk.',
    'Choisir la connexion OPC UA à parcourir.',
    'Die zu durchlaufende OPC UA-Verbindung wählen.'
  ),
  bookInterfaceSection: ml('Interface of the catalog', 'Interface du catalogue', 'Schnittstelle des Katalogs'),
  bookInterfaceHint: ml(
    'Leave the connection empty for a TEMPLATE catalog (a vendor register map, a standard interface): it carries no interface of its own and is bound to each equipment’s connection at generation. Fill it in for a PROJECT catalog — an export of one machine, which addresses through its own connection.',
    'Laisser la connexion vide pour un catalogue GABARIT (carte de registres constructeur, interface standard) : il ne porte pas d’interface propre et est lié à la connexion de chaque équipement à la génération. La renseigner pour un catalogue PROJET — l’export d’une machine, qui adresse via sa propre connexion.',
    'Die Verbindung leer lassen für einen VORLAGEN-Katalog (Hersteller-Registerkarte, Standardschnittstelle): er trägt keine eigene Schnittstelle und wird bei der Erzeugung an die Verbindung jedes Geräts gebunden. Für einen PROJEKT-Katalog ausfüllen — der Export einer Maschine, die über ihre eigene Verbindung adressiert.'
  ),
  bookNodesetNoInterface: ml(
    'A NodeSet2 is always a template catalog: its namespace indices are file-local, so every address is emitted as a candidate with a <Connection> placeholder. Verify it against the server — or re-browse it online — before any check-in.',
    'Un NodeSet2 est toujours un catalogue gabarit : ses indices de namespace sont locaux au fichier, donc chaque adresse est émise en candidate avec un marqueur <Connection>. À vérifier contre le serveur — ou à re-parcourir en ligne — avant tout check-in.',
    'Ein NodeSet2 ist immer ein Vorlagen-Katalog: seine Namespace-Indizes sind dateilokal, daher wird jede Adresse als Kandidat mit einem <Connection>-Platzhalter ausgegeben. Vor jedem Check-in gegen den Server prüfen — oder online neu durchlaufen.'
  ),
  bookAttachSection: ml('Attach to equipments (optional)', 'Associer à des équipements (optionnel)', 'Mit Geräten verknüpfen (optional)'),

  // --- workspace housekeeping (the Control tab) ------------------------------
  // "Generate" had no counterpart: a model deleted from the library left its datapoints
  // queued for creation with no way to take them out. These words insist on WHAT is
  // being removed — the workspace's claim, not anything live.
  forgetHint: ml(
    'Ticking a row removes that object FROM THE WORKSPACE — a pending creation is cancelled, a pending update is dropped, a pending deletion is called off. The project itself is never touched.',
    'Cocher une ligne retire cet objet DU WORKSPACE — une création en attente est annulée, une mise à jour abandonnée, une suppression en attente annulée. Le projet lui-même n’est jamais touché.',
    'Eine Zeile anzuhaken entfernt dieses Objekt AUS DEM WORKSPACE — eine ausstehende Erstellung wird abgebrochen, eine Änderung verworfen, eine ausstehende Löschung zurückgenommen. Das Projekt selbst wird nie angetastet.'
  ),
  forgetSelected: ml('{n} selected', '{n} sélectionné(s)', '{n} ausgewählt'),
  forgetSelectedAction: ml('Remove from the workspace', 'Retirer du workspace', 'Aus dem Workspace entfernen'),
  forgetAll: ml('Select every row', 'Sélectionner toutes les lignes', 'Alle Zeilen auswählen'),
  forgetDone: ml(
    'Removed from the workspace: {types} type(s), {dps} datapoint(s), {configs} config(s). Nothing was changed in the project.',
    'Retirés du workspace : {types} type(s), {dps} datapoint(s), {configs} config(s). Rien n’a été modifié dans le projet.',
    'Aus dem Workspace entfernt: {types} Typ(en), {dps} Datenpunkt(e), {configs} Konfig(s). Im Projekt wurde nichts geändert.'
  ),
  forgetFailed: ml('Removal refused: {error}', 'Retrait refusé : {error}', 'Entfernen abgelehnt: {error}'),

  // --- import preview -------------------------------------------------------
  // The file is parsed AS SOON AS it is picked, with the very function the server
  // ingests with: what the preview shows is what the catalog will contain. It is the
  // only moment where a wrong file, a wrong generator or a source that yields 12 000
  // signals instead of 200 costs nothing to discover.
  bookPreviewSection: ml('File content', 'Contenu du fichier', 'Dateiinhalt'),
  bookPreviewParsing: ml('Reading the file…', 'Lecture du fichier…', 'Datei wird gelesen…'),
  bookPreviewCounts: ml(
    '{signals} signal(s), {types} structured type(s)',
    '{signals} signal(aux), {types} type(s) structuré(s)',
    '{signals} Signal(e), {types} strukturierte(r) Typ(en)'
  ),
  bookPreviewUnmapped: ml(
    '{n} datatype(s) unmapped (bound as String)',
    '{n} type(s) de données non mappé(s) (liés en String)',
    '{n} nicht zugeordnete(r) Datentyp(en) (als String gebunden)'
  ),
  bookPreviewEmpty: ml(
    'This file yields NO signal — most likely the wrong generator for it, or an export that carries no variable.',
    'Ce fichier ne donne AUCUN signal — probablement le mauvais générateur, ou un export qui ne contient aucune variable.',
    'Diese Datei ergibt KEIN Signal — wahrscheinlich der falsche Generator oder ein Export ohne Variablen.'
  ),
  bookPreviewFailed: ml(
    'This file cannot be read by the “{format}” generator: {error}',
    'Ce fichier n’est pas lisible par le générateur « {format} » : {error}',
    'Diese Datei kann der Generator „{format}“ nicht lesen: {error}'
  ),
  bookPreviewHint: ml(
    'Parsed in the browser with the same generator the server ingests with — nothing has been sent or stored yet. Addresses are bound on creation from the interface below.',
    'Analysé dans le navigateur avec le même générateur que celui du serveur — rien n’est encore envoyé ni enregistré. Les adresses sont liées à la création depuis l’interface ci-dessous.',
    'Im Browser mit demselben Generator wie auf dem Server analysiert — es wurde noch nichts gesendet oder gespeichert. Adressen werden beim Erstellen aus der Schnittstelle unten gebunden.'
  ),
  bookPreviewShowing: ml(
    'showing {n}/{total}',
    'affichés {n}/{total}',
    'angezeigt {n}/{total}'
  ),
  bookPreviewNoMatch: ml('No signal matches the filter.', 'Aucun signal ne correspond au filtre.', 'Kein Signal entspricht dem Filter.'),
  bookPreviewTypes: ml('Structured types', 'Types structurés', 'Strukturierte Typen'),
  bookPreviewMembers: ml('{n} member(s)', '{n} membre(s)', '{n} Element(e)'),

  // --- server explorer + walk progress --------------------------------------
  // A walk of a real server takes minutes. Two things follow: it must be possible to
  // LOOK at the address space before committing to a catalog, and the walk itself
  // must say where it is instead of freezing the screen.
  explorerTitle: ml('Explore the server', 'Explorer le serveur', 'Server erkunden'),
  explorerHint: ml(
    'Open the branches to see what the server actually exposes, BEFORE creating anything: one request per branch, nothing is stored. The branch you open here becomes the walk root below — which is how a catalog of 200 useful signals is made instead of one of 12 000.',
    'Ouvrir les branches pour voir ce que le serveur expose réellement, AVANT de créer quoi que ce soit : une requête par branche, rien n’est stocké. La branche ouverte ici devient la racine du parcours ci-dessous — c’est ainsi qu’on obtient un catalogue de 200 signaux utiles plutôt qu’un de 12 000.',
    'Die Zweige öffnen, um zu sehen, was der Server wirklich anbietet, BEVOR etwas erstellt wird: eine Anfrage pro Zweig, nichts wird gespeichert. Der hier geöffnete Zweig wird zur Wurzel des Durchlaufs unten — so entsteht ein Katalog mit 200 nützlichen Signalen statt mit 12 000.'
  ),
  explorerOpen: ml('Explore', 'Explorer', 'Erkunden'),
  explorerUseAsRoot: ml('Use as the walk root', 'Utiliser comme racine du parcours', 'Als Durchlauf-Wurzel verwenden'),
  explorerRootIs: ml('Walk root: {root}', 'Racine du parcours : {root}', 'Durchlauf-Wurzel: {root}'),
  explorerEmpty: ml('This branch exposes nothing.', 'Cette branche n’expose rien.', 'Dieser Zweig bietet nichts an.'),
  explorerCounts: ml(
    '{variables} variable(s) · {containers} branch(es)',
    '{variables} variable(s) · {containers} branche(s)',
    '{variables} Variable(n) · {containers} Zweig(e)'
  ),
  explorerFailed: ml('Cannot read this branch: {error}', 'Branche illisible : {error}', 'Zweig nicht lesbar: {error}'),
  walkTitle: ml('Walking the server…', 'Parcours du serveur…', 'Server wird durchlaufen…'),
  walkProgress: ml(
    '{entries} signal(s) · {requests} request(s) · depth {depth}',
    '{entries} signal(aux) · {requests} requête(s) · profondeur {depth}',
    '{entries} Signal(e) · {requests} Anfrage(n) · Tiefe {depth}'
  ),
  walkAt: ml('at {path}', 'sur {path}', 'bei {path}'),
  walkAtRoot: ml('at the root', 'à la racine', 'an der Wurzel'),
  walkCancel: ml('Stop', 'Arrêter', 'Anhalten'),
  walkCancelled: ml(
    'Walk stopped — the catalog keeps what it had.',
    'Parcours arrêté — le catalogue conserve son contenu précédent.',
    'Durchlauf angehalten — der Katalog behält seinen vorherigen Inhalt.'
  ),
  walkRun: ml('Walk into this catalog', 'Parcourir dans ce catalogue', 'In diesen Katalog durchlaufen'),
  walkRunHint: ml(
    'The catalog is declared first and the walk fills it: nothing is lost if a walk of a large server is stopped or fails, and it can simply be run again.',
    'Le catalogue est déclaré d’abord et le parcours le remplit : rien n’est perdu si le parcours d’un gros serveur est arrêté ou échoue, il suffit de le relancer.',
    'Der Katalog wird zuerst deklariert und der Durchlauf füllt ihn: bei einem abgebrochenen oder fehlgeschlagenen Durchlauf eines großen Servers geht nichts verloren — er kann einfach erneut gestartet werden.'
  ),
  bookDeclared: ml(
    'Catalog “{name}” declared — now walk the server into it.',
    'Catalogue « {name} » déclaré — lancer maintenant le parcours du serveur.',
    'Katalog „{name}“ deklariert — jetzt den Server hineinlaufen lassen.'
  ),
  bookEmptyYet: ml(
    'Declared, not yet generated: no signal. Walk the server into it, or refresh it.',
    'Déclaré, pas encore généré : aucun signal. Lancer le parcours du serveur, ou rafraîchir.',
    'Deklariert, noch nicht erzeugt: kein Signal. Den Server hineinlaufen lassen oder aktualisieren.'
  ),
  walkDone: ml(
    'Walk of “{conn}” finished: {n} signals in {requests} request(s){delta}.',
    'Parcours de « {conn} » terminé : {n} signaux en {requests} requête(s){delta}.',
    'Durchlauf von „{conn}“ beendet: {n} Signale in {requests} Anfrage(n){delta}.'
  ),

  // --- hiding signals by hand -----------------------------------------------
  // A catalog is a READING of a source, so hiding is an override kept beside the
  // book: a re-walk must not undo the operator's judgement, and nothing is lost.
  hideSignal: ml('Hide this signal', 'Masquer ce signal', 'Dieses Signal ausblenden'),
  hideChecked: ml('Hide the checked', 'Masquer les cochés', 'Ausgewählte ausblenden'),
  hiddenCount: ml('{n} hidden', '{n} masqué(s)', '{n} ausgeblendet'),
  hiddenTitle: ml(
    'Signals hidden by hand: they take no role, no address and no config. Nothing is deleted — restore them here.',
    'Signaux masqués à la main : ils ne prennent ni rôle, ni adresse, ni config. Rien n’est supprimé — les restaurer ici.',
    'Manuell ausgeblendete Signale: sie erhalten keine Rolle, keine Adresse und keine Konfig. Nichts wird gelöscht — hier wiederherstellen.'
  ),
  restoreHidden: ml('Restore all', 'Tout restaurer', 'Alle wiederherstellen'),
  hideDone: ml(
    '{n} signal(s) hidden — they take no role, no address and no config.',
    '{n} signal(aux) masqué(s) — ils ne prennent ni rôle, ni adresse, ni config.',
    '{n} Signal(e) ausgeblendet — sie erhalten keine Rolle, keine Adresse und keine Konfig.'
  ),
  restoreDone: ml('{n} signal(s) restored.', '{n} signal(aux) restauré(s).', '{n} Signal(e) wiederhergestellt.'),
  hideFailed: ml('Cannot hide: {error}', 'Masquage impossible : {error}', 'Ausblenden nicht möglich: {error}'),
  bookNoDeviceYet: ml(
    'No equipment declared yet — the catalog can be created now and attached later.',
    'Aucun équipement déclaré — le catalogue peut être créé maintenant et associé plus tard.',
    'Noch kein Gerät deklariert — der Katalog kann jetzt erstellt und später verknüpft werden.'
  ),

  /** Provenance kinds, as the catalogue list and the detail label them. */
  sourceKind: {
    'opcua-browse': ml('OPC UA browse', 'parcours OPC UA', 'OPC UA-Browse'),
    simaticml: ml('SimaticML export', 'export SimaticML', 'SimaticML-Export'),
    xvm: ml('Schneider XVM', 'XVM Schneider', 'Schneider XVM'),
    csv: ml('Schneider CSV', 'CSV Schneider', 'Schneider CSV'),
    nodeset: ml('OPC UA NodeSet2', 'NodeSet2 OPC UA', 'OPC UA NodeSet2'),
    'ai-proposal': ml('AI proposal', 'proposition IA', 'KI-Vorschlag'),
    manual: ml('entered by hand', 'saisi à la main', 'manuell erfasst')
  },

  /** Generator choices of the creation form (one per supported source). */
  format: {
    browse: ml('Live OPC UA server (explore, then walk)', 'Serveur OPC UA en ligne (explorer puis parcourir)', 'Live-OPC-UA-Server (erkunden, dann durchlaufen)'),
    simaticml: ml('TIA / SimaticML export (XML)', 'Export TIA / SimaticML (XML)', 'TIA-/SimaticML-Export (XML)'),
    csv: ml('Control Expert variables (CSV)', 'Variables Control Expert (CSV)', 'Control-Expert-Variablen (CSV)'),
    xvm: ml('Control Expert variables (XVM/XSY)', 'Variables Control Expert (XVM/XSY)', 'Control-Expert-Variablen (XVM/XSY)'),
    nodeset: ml('OPC UA NodeSet2 (XML)', 'NodeSet2 OPC UA (XML)', 'OPC UA NodeSet2 (XML)')
  },

  /** What each generator reads, and what it is trustworthy for. */
  formatHint: {
    browse: ml(
      'Explore the address space below to choose what is worth cataloguing, then create the catalog: it is declared first and the walk fills it, reporting what it finds as it goes. Catalogues every variable under the root: path, datatype and peripheral-address reference. The walk parameters are recorded, so “Refresh” replays the exact same walk and shows what moved.',
      'Explorer l’espace d’adressage ci-dessous pour choisir ce qui vaut d’être catalogué, puis créer le catalogue : il est déclaré d’abord et le parcours le remplit en rendant compte de ce qu’il trouve. Catalogue chaque variable sous la racine : chemin, type de données et référence d’adresse périphérique. Les paramètres du parcours sont enregistrés : « Rafraîchir » rejoue exactement le même parcours et montre ce qui a bougé.',
      'Den Adressraum unten erkunden, um zu wählen, was katalogisiert werden soll, dann den Katalog erstellen: er wird zuerst deklariert und der Durchlauf füllt ihn und berichtet dabei, was er findet. Katalogisiert jede Variable unter der Wurzel: Pfad, Datentyp und Peripherieadress-Referenz. Die Durchlaufparameter werden gespeichert, sodass „Aktualisieren“ genau denselben Durchlauf wiederholt und zeigt, was sich geändert hat.'
    ),
    simaticml: ml(
      'A TIA Openness export is a BUNDLE: select the DB documents together with the UDTs they reference, otherwise the members of an unresolved UDT are reported as warnings instead of being catalogued.',
      'Un export TIA Openness est un LOT : sélectionner les documents DB avec les UDT qu’ils référencent, sinon les membres d’un UDT non résolu sont signalés en avertissement au lieu d’être catalogués.',
      'Ein TIA-Openness-Export ist ein BÜNDEL: die DB-Dokumente zusammen mit den referenzierten UDTs auswählen, sonst werden die Member eines nicht aufgelösten UDT als Warnung gemeldet statt katalogisiert.'
    ),
    csv: ml(
      'Located variables become Modbus references (%MW100 → 40101, %M10 → coil 00011, %IW200 → input register 30201, read-only). Register overlaps, unlocated and topological variables are reported as warnings.',
      'Les variables localisées deviennent des références Modbus (%MW100 → 40101, %M10 → bobine 00011, %IW200 → registre d’entrée 30201, lecture seule). Chevauchements de registres, variables non localisées et adresses topologiques sont signalés en avertissement.',
      'Lokalisierte Variablen werden zu Modbus-Referenzen (%MW100 → 40101, %M10 → Spule 00011, %IW200 → Eingangsregister 30201, nur lesend). Registerüberlappungen, nicht lokalisierte und topologische Variablen werden als Warnung gemeldet.'
    ),
    xvm: ml(
      'Flattens structured variables to their members (Recette.Consigne → 40421) and picks units from the Unity-style attributes. The XVM schema is NOT vendor-verified — the book says so.',
      'Aplatit les variables structurées en leurs membres (Recette.Consigne → 40421) et récupère les unités dans les attributs de style Unity. Le schéma XVM n’est PAS vérifié constructeur — le carnet le signale.',
      'Flacht strukturierte Variablen auf ihre Member ab (Recette.Consigne → 40421) und übernimmt Einheiten aus den Unity-typischen Attributen. Das XVM-Schema ist NICHT herstellerverifiziert — das Adressbuch weist darauf hin.'
    ),
    nodeset: ml(
      'Reads the model without touching the machine: it has the AccessLevel a browse cannot expose, folds custom supertypes into their subtypes, and catalogues each ObjectType as a candidate DP type.',
      'Lit le modèle sans toucher à la machine : il porte l’AccessLevel qu’un parcours n’expose pas, replie les supertypes personnalisés dans leurs sous-types et catalogue chaque ObjectType en type de DP candidat.',
      'Liest das Modell, ohne die Maschine anzufassen: es enthält den AccessLevel, den ein Browse nicht liefert, faltet eigene Supertypen in ihre Subtypen und katalogisiert jeden ObjectType als DP-Typ-Kandidaten.'
    )
  },

  // --- signal table ---------------------------------------------------------
  bookSignals: ml('Book signals', 'Signaux du carnet', 'Signale des Adressbuchs'),
  filterPlaceholder: ml('filter path or comment…', 'filtrer chemin ou commentaire…', 'Pfad oder Kommentar filtern…'),
  allRoles: ml('all roles', 'tous les rôles', 'alle Rollen'),
  allQualified: ml('all qualified', 'tout qualifié', 'alles qualifiziert'),
  toQualify: ml('{n} to qualify', '{n} à qualifier', '{n} zu qualifizieren'),
  applyRules: ml('Apply the rules', 'Appliquer les règles', 'Regeln anwenden'),
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

  // --- per-signal role tagging -----------------------------------------------
  // The role is what drives every config at check-in, so it must be changeable on
  // ONE signal without going through the bulk bar — and undoable.
  roleEditHint: ml(
    'Click to change this signal’s role',
    'Cliquer pour changer le rôle de ce signal',
    'Klicken, um die Rolle dieses Signals zu ändern'
  ),
  roleFromRule: ml('— from the rules —', '— selon les règles —', '— gemäß den Regeln —'),
  roleOverridden: ml(
    'role set BY HAND (the rules would have proposed “{rule}”) — pick “{fromRule}” to hand it back to them',
    'rôle imposé À LA MAIN (les règles auraient proposé « {rule} ») — choisir « {fromRule} » pour le leur rendre',
    'Rolle MANUELL gesetzt (die Regeln hätten „{rule}“ vorgeschlagen) — „{fromRule}“ wählen, um sie ihnen zurückzugeben'
  ),
  roleSetOne: ml(
    '“{path}” qualified as “{role}” — a manual role outranks every rule.',
    '« {path} » qualifié « {role} » — un rôle manuel prime sur toutes les règles.',
    '„{path}“ als „{role}“ qualifiziert — eine manuelle Rolle hat Vorrang vor allen Regeln.'
  ),
  roleClearedOne: ml(
    '“{path}” handed back to the rules: “{role}”.',
    '« {path} » rendu aux règles : « {role} ».',
    '„{path}“ den Regeln zurückgegeben: „{role}“.'
  ),
  roleSetFailed: ml('Cannot set the role: {error}', 'Rôle non enregistré : {error}', 'Rolle nicht gesetzt: {error}'),
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
  composerTitle: ml('Compose the model', 'Composer le modèle', 'Modell zusammenstellen'),
  composerCatalog: ml('catalog', 'catalogue', 'Katalog'),
  composerNoCatalog: ml(
    'No catalog yet — create one in the Catalogs tab, then compose a model from it.',
    'Aucun catalogue — en créer un dans l’onglet Catalogues, puis composer un modèle depuis lui.',
    'Noch kein Katalog — im Reiter Kataloge einen erstellen, dann daraus ein Modell zusammenstellen.'
  ),
  bookOf: ml('Book — {name}', 'Carnet — {name}', 'Adressbuch — {name}'),
  filterShort: ml('filter…', 'filtrer…', 'filtern…'),
  signalsOf: ml('{shown} / {total} signals', '{shown} / {total} signaux', '{shown} / {total} Signale'),
  modelOf: ml('Model — {name}', 'Modèle — {name}', 'Modell — {name}'),
  typesCount: ml('{n} type(s)', '{n} type(s)', '{n} Typ(en)'),
  dpsCount: ml('{n} DP', '{n} DP', '{n} DP'),
  configsCount: ml('{n} configs', '{n} configs', '{n} Konfigs'),
  testRead: ml('Test-read', 'Test-read', 'Testlesen'),
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
  genTarget: ml('apply to', 'appliquer à', 'anwenden auf'),

  // --- reusable models -------------------------------------------------------
  // A house-standard type is authored once and applied to machine after machine, so
  // it is stored — with its structure and its mappings, but WITHOUT the target, the
  // zone or the equipment names, which are what differ between two applications.
  modelLibrary: ml('model', 'modèle', 'Modell'),
  modelNone: ml('— compose a new one —', '— en composer un nouveau —', '— ein neues zusammenstellen —'),
  modelSave: ml('Save the model', 'Enregistrer le modèle', 'Modell speichern'),
  modelSaveHint: ml(
    'Stores the type’s structure and its mappings under its type name, reusable on any equipment. The zone, the equipment names and the target are NOT stored — they are what differs between two applications.',
    'Enregistre la structure du type et ses mappings sous le nom du type, réutilisable sur n’importe quel équipement. La zone, les noms d’équipements et la cible ne sont PAS enregistrés — c’est ce qui diffère entre deux applications.',
    'Speichert die Struktur des Typs und seine Zuordnungen unter dem Typnamen, wiederverwendbar auf jedem Gerät. Zone, Gerätenamen und Ziel werden NICHT gespeichert — genau das unterscheidet zwei Anwendungen.'
  ),
  modelDelete: ml('Delete', 'Supprimer', 'Löschen'),
  modelLoaded: ml(
    'Model “{name}” loaded (type “{type}”) — pick the target equipment, the zone and the names, then generate.',
    'Modèle « {name} » chargé (type « {type} ») — choisir l’équipement cible, la zone et les noms, puis générer.',
    'Modell „{name}“ geladen (Typ „{type}“) — Zielgerät, Zone und Namen wählen, dann erzeugen.'
  ),
  modelSaved: ml('Model “{name}” saved.', 'Modèle « {name} » enregistré.', 'Modell „{name}“ gespeichert.'),
  modelDeleted: ml('Model “{name}” deleted.', 'Modèle « {name} » supprimé.', 'Modell „{name}“ gelöscht.'),
  modelSaveFailed: ml('Model refused: {error}', 'Modèle refusé : {error}', 'Modell abgelehnt: {error}'),
  modelCoverage: ml(
    'Against this catalog: {bound} mapped, {missing} pointing at a missing signal, {unbound} not mapped.',
    'Sur ce catalogue : {bound} associé(s), {missing} pointant un signal absent, {unbound} non associé(s).',
    'Für diesen Katalog: {bound} zugeordnet, {missing} auf ein fehlendes Signal zeigend, {unbound} nicht zugeordnet.'
  ),
  genTargetMissing: ml(
    'No target equipment — declare one in the Devices tab: the generated addresses need its connection and driver.',
    'Aucun équipement cible — en déclarer un dans l’onglet Équipements : les adresses générées ont besoin de sa connexion et de son driver.',
    'Kein Zielgerät — im Reiter Geräte eines deklarieren: die erzeugten Adressen brauchen seine Verbindung und seinen Treiber.'
  ),
  genTargetNotServed: ml(
    '“{name}” does not reference this catalog. Generating still works — the addresses use its own connection — but link the catalog to it if it is meant to serve it.',
    '« {name} » ne référence pas ce catalogue. La génération fonctionne quand même — les adresses utilisent sa propre connexion — mais associez-lui le catalogue s’il doit le servir.',
    '„{name}“ verweist nicht auf diesen Katalog. Die Erzeugung funktioniert dennoch — die Adressen nutzen seine eigene Verbindung — aber verknüpfen Sie den Katalog, wenn er ihn bedienen soll.'
  ),
  genStructure: ml('structure', 'structure', 'Struktur'),
  genMirror: ml('mirror the book', 'miroir du carnet', 'Spiegel des Adressbuchs'),
  genCustom: ml('custom structure + mapping', 'structure personnalisée + mapping', 'eigene Struktur + Zuordnung'),
  genRun: ml('Generate', 'Générer', 'Erzeugen'),
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

  // --- structure tree (the graphical authoring of a custom type) --------------
  // The outline text stays the storage format; the tree is the way to SHAPE it, and
  // it carries each leaf's mapping so nothing has to be held in one's head.
  genViewTree: ml('Tree', 'Arbre', 'Baum'),
  genViewText: ml('Outline (text)', 'Plan (texte)', 'Gliederung (Text)'),
  genViewHint: ml(
    'Two views of the SAME structure: shape it as a tree, or edit it as an outline (indentation = nesting, “Name : Type” = leaf) to paste it between projects. The text is derived from the tree, so they cannot disagree.',
    'Deux vues de la MÊME structure : la façonner en arbre, ou l’éditer en plan (indentation = imbrication, « Nom : Type » = feuille) pour la copier entre projets. Le texte découle de l’arbre : ils ne peuvent pas diverger.',
    'Zwei Ansichten der GLEICHEN Struktur: als Baum formen oder als Gliederung bearbeiten (Einrückung = Verschachtelung, „Name : Typ“ = Blatt), um sie zwischen Projekten zu kopieren. Der Text wird aus dem Baum abgeleitet, sie können nicht auseinanderlaufen.'
  ),
  treeEmpty: ml(
    'Empty type — add an element or a group.',
    'Type vide — ajouter un élément ou un groupe.',
    'Leerer Typ — ein Element oder eine Gruppe hinzufügen.'
  ),
  treeAddLeaf: ml('Element', 'Élément', 'Element'),
  treeAddGroup: ml('Group', 'Groupe', 'Gruppe'),
  treeGroupType: ml('group', 'groupe', 'Gruppe'),
  treeRemove: ml('Remove — its mapping goes with it', 'Supprimer — son mapping part avec', 'Entfernen — sein Mapping geht mit'),
  treeUnbound: ml(
    'Not mapped: this element would be created with no address and no config.',
    'Non associé : cet élément serait créé sans adresse ni config.',
    'Nicht zugeordnet: dieses Element würde ohne Adresse und ohne Konfig erstellt.'
  ),
  autoBind: ml('Map automatically', 'Associer automatiquement', 'Automatisch zuordnen'),
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
  checkin: ml('Check-in', 'Check-in', 'Check-in'),

  // --- why check-in is (un)available -----------------------------------------
  // A permanently greyed primary button is a dead end: "not allowed" and "nothing to
  // apply" call for opposite actions, so the reason is stated, never left to guess.
  checkinReady: ml(
    'Apply the diff to the project, transactionally.',
    'Appliquer le diff au projet, de façon transactionnelle.',
    'Das Diff transaktional auf das Projekt anwenden.'
  ),
  checkinNothing: ml(
    'Nothing to check in — generate a model first (Model tab), the diff appears here.',
    'Rien à checker-in — générer d’abord un modèle (onglet Modèle), le diff apparaît ici.',
    'Nichts einzuchecken — zuerst ein Modell erzeugen (Reiter Modell), das Diff erscheint hier.'
  ),
  checkinNoWorkspace: ml(
    'No workspace loaded yet.',
    'Aucun workspace chargé pour l’instant.',
    'Noch kein Workspace geladen.'
  ),
  checkinNoRole: ml(
    'The “Check-in” role is not granted to you — the diff and the dry-run stay available.',
    'Le rôle « Check-in » ne vous est pas accordé — le diff et l’aperçu restent disponibles.',
    'Die Rolle „Check-in“ ist Ihnen nicht zugewiesen — Diff und Vorschau bleiben verfügbar.'
  ),
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

/**
 * Labels of the connection parameters of the device form, keyed by the core's
 * `DeviceParamSpec.key`.
 *
 * The SHAPE of the form is data owned by the core (`PROTOCOL_PARAMS`: which keys a
 * protocol needs, which ones are required, an example value); only the WORDS live
 * here. Adding a protocol is then a core change plus a few labels — never a change
 * to the page's template. An unknown key falls back to the raw key, so a new
 * parameter shows up unlabelled rather than invisible.
 */
export const PARAM_LABEL: Record<string, Ml> = {
  server: ml('server (OPC UA connection)', 'serveur (connexion OPC UA)', 'Server (OPC UA-Verbindung)'),
  endpoint: ml('endpoint (for the record)', 'endpoint (pour mémoire)', 'Endpoint (zur Dokumentation)'),
  ip: ml('IP address', 'adresse IP', 'IP-Adresse'),
  rack: ml('rack', 'rack', 'Rack'),
  slot: ml('slot', 'slot', 'Steckplatz'),
  port: ml('TCP port', 'port TCP', 'TCP-Port'),
  unitId: ml('unit id (slave)', 'unit id (esclave)', 'Unit-ID (Slave)'),
  cpu: ml('CPU reference', 'référence CPU', 'CPU-Referenz'),
  wordOrder: ml('word order', 'ordre des mots', 'Wortreihenfolge'),
  zeroBased: ml('zero based addressing', 'adressage base zéro', 'Adressierung ab Null')
};

/**
 * Labels of the values of a `choice`/`flag` connection parameter, keyed
 * `<paramKey>.<value>`. An unlabelled value renders raw, like an unlabelled key.
 */
export const PARAM_OPTION_LABEL: Record<string, Ml> = {
  'wordOrder.big': ml('big-endian (no swap)', 'big-endian (sans permutation)', 'Big-Endian (kein Tausch)'),
  'wordOrder.little': ml('little-endian (swapped)', 'little-endian (permuté)', 'Little-Endian (getauscht)'),
  'zeroBased.true': ml('yes — the first register is 0', 'oui — le premier registre est 0', 'ja — das erste Register ist 0'),
  'zeroBased.false': ml('no — the first register is 1', 'non — le premier registre est 1', 'nein — das erste Register ist 1')
};

/** Substitute `{placeholder}` occurrences. Unknown placeholders are left as-is. */
export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replaceAll(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole));
}

/**
 * Render a CORE warning in the UI language: its `code` selects a translated template
 * from {@link WARNING_MSG}, into which the core's own `params` are substituted. An
 * unknown code (a newer core, or a `legacy` string from a book written before the
 * structured warnings) falls back to the English message the core shipped with it.
 *
 * Lives here rather than in each component: the page, the catalogues panel and the
 * creation form all show core warnings, and three copies of the fallback rule is
 * three chances for one of them to render `undefined` when the core adds a code.
 */
export function warnText(warning: { code: string; message: string; params?: Record<string, string | number> }, lang: Lang): string {
  const translated = WARNING_MSG[warning.code];
  return fmt(translated === undefined ? warning.message : t(translated, lang), warning.params ?? {});
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
  // --- device declaration (the form's own refusals) ----------------------------
  'device.name-required': ml('A device name is required.', 'Un nom d’équipement est requis.', 'Ein Gerätename ist erforderlich.'),
  'device.name-invalid': ml(
    'The name "{name}" is not a valid WinCC OA identifier — use "{clean}" (letters, digits and _).',
    'Le nom « {name} » n’est pas un identifiant WinCC OA valide — utiliser « {clean} » (lettres, chiffres et _).',
    'Der Name „{name}“ ist kein gültiger WinCC OA-Identifier — „{clean}“ verwenden (Buchstaben, Ziffern und _).'
  ),
  'device.name-taken': ml(
    'Another device is already named "{name}".',
    'Un autre équipement porte déjà le nom « {name} ».',
    'Ein anderes Gerät heißt bereits „{name}“.'
  ),
  'device.id-taken': ml(
    'The identifier "{id}" is already used by another device.',
    'L’identifiant « {id} » est déjà utilisé par un autre équipement.',
    'Die Kennung „{id}“ wird bereits von einem anderen Gerät verwendet.'
  ),
  'device.no-access-mode': ml(
    'Select at least one access mode — the model generator needs one to pick an address.',
    'Sélectionner au moins un mode d’accès — le générateur de modèle en a besoin pour choisir une adresse.',
    'Mindestens eine Zugriffsart auswählen — der Modellgenerator braucht sie, um eine Adresse zu wählen.'
  ),
  'device.param-required': ml(
    'The "{param}" parameter is required for the {protocol} protocol.',
    'Le paramètre « {param} » est requis pour le protocole {protocol}.',
    'Der Parameter „{param}“ ist für das Protokoll {protocol} erforderlich.'
  ),
  'device.param-invalid': ml(
    'The "{param}" parameter must be one of: {options} (got "{value}").',
    'Le paramètre « {param} » doit valoir l’une de ces valeurs : {options} (reçu « {value} »).',
    'Der Parameter „{param}“ muss einen dieser Werte haben: {options} (erhalten: „{value}“).'
  ),
  'device.driver-invalid': ml(
    'The driver number "{value}" must be a positive integer (a WinCC OA manager number).',
    'Le numéro de driver « {value} » doit être un entier positif (un numéro de manager WinCC OA).',
    'Die Treibernummer „{value}“ muss eine positive ganze Zahl sein (eine WinCC OA-Managernummer).'
  ),
  'device.driver-recommended': ml(
    'No driver number: auto-detection is only verified for OPC UA, so a {protocol} address will be refused at check-in until this is set.',
    'Aucun numéro de driver : la détection automatique n’est vérifiée que pour OPC UA, une adresse {protocol} sera donc refusée au check-in tant que ce champ est vide.',
    'Keine Treibernummer: die automatische Erkennung ist nur für OPC UA verifiziert, eine {protocol}-Adresse wird beim Check-in daher abgelehnt, solange dies nicht gesetzt ist.'
  ),

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
  'book.excluded': ml(
    '{n}/{total} signal(s) hidden by hand — they take no role, no address and no config. Restore them from the signal table.',
    '{n}/{total} signal(aux) masqué(s) à la main — ils ne prennent ni rôle, ni adresse, ni config. Les restaurer depuis la table des signaux.',
    '{n}/{total} Signal(e) manuell ausgeblendet — sie erhalten keine Rolle, keine Adresse und keine Konfig. In der Signaltabelle wiederherstellen.'
  ),
  'book.duplicate-paths': ml(
    '{n} duplicate signal path(s) dropped ({paths}{more}) — a book is keyed by path, so two signals sharing one would collapse into a single DPE. Report this: the generator should not produce them.',
    '{n} chemin(s) de signal en doublon écarté(s) ({paths}{more}) — un catalogue est indexé par chemin, donc deux signaux partageant le même se réduiraient à un seul DPE. À signaler : le générateur ne devrait pas en produire.',
    '{n} doppelte(r) Signalpfad(e) verworfen ({paths}{more}) — ein Katalog wird über den Pfad indiziert, zwei Signale mit demselben Pfad würden also zu einem einzigen DPE verschmelzen. Bitte melden: der Generator sollte keine erzeugen.'
  ),

  // --- reusable models --------------------------------------------------------
  'template.missing-entries': ml(
    '{n} mapping(s) point at signals this catalog does not have ({pairs}{more}) — those elements would be created with no address and no config.',
    '{n} mapping(s) pointent vers des signaux absents de ce catalogue ({pairs}{more}) — ces éléments seraient créés sans adresse ni config.',
    '{n} Zuordnung(en) zeigen auf Signale, die dieser Katalog nicht hat ({pairs}{more}) — diese Elemente würden ohne Adresse und ohne Konfig erstellt.'
  ),
  'template.unbound-leaves': ml(
    '{n} element(s) of the model are not mapped: they get no config.',
    '{n} élément(s) du modèle ne sont pas associés : ils n’auront aucune config.',
    '{n} Element(e) des Modells sind nicht zugeordnet: sie erhalten keine Konfig.'
  ),

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
  'modelgen.no-datatype': ml(
    'The "{mode}" driver has no "_datatype" transformation for {n} source type(s) ({types}) — those DPEs are created WITHOUT a peripheral address, on purpose: a neighbouring transformation would misread the value. Change the type in the PLC, or address them through another mode.',
    'Le driver « {mode} » n’a aucune transformation « _datatype » pour {n} type(s) source ({types}) — ces DPE sont créés SANS adresse périphérique, volontairement : une transformation voisine lirait la valeur de travers. Changer le type dans l’automate, ou les adresser par un autre mode.',
    'Der Treiber „{mode}“ hat keine „_datatype“-Transformation für {n} Quelltyp(en) ({types}) — diese DPEs werden absichtlich OHNE Peripherieadresse erstellt: eine benachbarte Transformation würde den Wert falsch lesen. Den Typ in der SPS ändern oder sie über einen anderen Modus adressieren.'
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
  'diff.dp-type-missing': ml(
    '{n} datapoint(s) staged for creation with a DP type that exists NEITHER in the workspace NOR in the project ({dps}{more}) — most likely a model that was deleted. They would fail at check-in: select them below and remove them from the workspace.',
    '{n} datapoint(s) en attente de création avec un type DP qui n’existe NI dans le workspace NI dans le projet ({dps}{more}) — probablement un modèle supprimé. Ils échoueraient au check-in : les sélectionner ci-dessous et les retirer du workspace.',
    '{n} Datenpunkt(e) zur Erstellung vorgemerkt mit einem DP-Typ, der WEDER im Workspace NOCH im Projekt existiert ({dps}{more}) — wahrscheinlich ein gelöschtes Modell. Beim Check-in würden sie fehlschlagen: unten auswählen und aus dem Workspace entfernen.'
  ),
  'diff.retype-unsupported': ml(
    'Datapoint "{dp}" exists with type "{live}" (workspace: "{wanted}") — retype is not supported; item skipped.',
    'Le datapoint « {dp} » existe avec le type « {live} » (workspace : « {wanted} ») — le changement de type n’est pas supporté ; élément ignoré.',
    'Der Datenpunkt „{dp}“ existiert mit dem Typ „{live}“ (Workspace: „{wanted}“) — ein Typwechsel wird nicht unterstützt; Element übersprungen.'
  )
};
