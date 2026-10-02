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
 *   1. the element's own `lang` property/attribute (an explicit integration);
 *   2. `localStorage['lang']` — the WinCC OA WebUI USER SESSION language: the
 *      shell's `wui-translation-loader` boots lit-translate from exactly that key,
 *      so reading it follows the user connection without importing a single
 *      `@wincc-oa/*` package. Absent outside the shell (the demo runs on its own
 *      origin), so the offline paths below keep working;
 *   3. `?lang=` in the URL (what the screenshot pipeline and the demo use);
 *   4. `<html lang>`;
 *   5. `navigator.language`;
 *   6. English.
 * WinCC OA locale identifiers (`en_US.utf8`, `fr.utf8`, `de_AT.utf8`…) are accepted
 * as well as plain BCP-47 tags, since the shell stores the former.
 *
 * There is deliberately NO language picker in the page: in the WinCC OA context
 * the language comes from the user connection (above), and offering a second
 * switch would let the page disagree with the shell around it. Outside WinCC OA
 * the demo and the screenshot pipeline select it with `?lang=`.
 *
 * SCOPE — two tables:
 *   {@link MSG}         the page's own strings;
 *   {@link WARNING_MSG} the CORE's warnings, keyed by `EngWarning.code`. The core
 *                       stays language-neutral (a stable code + an English template
 *                       + params); this page re-templates each code and substitutes
 *                       the same params. An unknown code falls back to the core's
 *                       English message, so a new warning is never invisible —
 *                       merely untranslated. `demo/check-i18n.mjs` fails on any
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

/** A string that is deliberately IDENTICAL in every language (an OPC UA identifier, a product name). */
function same(value: string): Ml {
  return { en: value, fr: value, de: value };
}

const LANGS: Lang[] = ['en', 'fr', 'de'];

/** Normalise a locale identifier (`fr_BE.utf8`, `de-AT`, `EN`) to a shipped language. */
export function normalizeLang(value: string | null | undefined): Lang | null {
  const head = String(value ?? '')
    .trim()
    .toLowerCase()
    .split(/[_.\-@]/)[0];
  return (LANGS as string[]).includes(head) ? (head as Lang) : null;
}

/** `localStorage['lang']` — the WebUI user-session language (see the module header). */
function sessionLang(): string | null {
  try {
    return globalThis.localStorage?.getItem('lang') ?? null;
  } catch {
    return null; // storage may be denied (sandboxed frame) — not a reason to fail
  }
}

/** Resolve the page language (see the module header for the order). */
export function resolveLang(explicit?: string | null): Lang {
  const fromExplicit = normalizeLang(explicit);
  if (fromExplicit) return fromExplicit;
  const fromSession = normalizeLang(sessionLang());
  if (fromSession) return fromSession;
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
  stepInstances: ml('Instances', 'Instances', 'Instanzen'),

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
    'This project has no connection named “{name}” (it has: {known}). Saving the equipment will CREATE it as an _OPCUAServer connection — declare the endpoint (opc.tcp://…) so the driver knows where to connect.',
    'Ce projet n’a aucune connexion nommée « {name} » (il a : {known}). Enregistrer l’équipement la CRÉERA comme connexion _OPCUAServer — déclarez l’endpoint (opc.tcp://…) pour que le driver sache où se connecter.',
    'Dieses Projekt hat keine Verbindung mit dem Namen „{name}“ (vorhanden: {known}). Beim Speichern des Geräts wird sie als _OPCUAServer-Verbindung ERSTELLT — deklarieren Sie den Endpoint (opc.tcp://…), damit der Treiber weiß, wohin er sich verbinden soll.'
  ),
  connCreated: ml(
    'Connection “{name}” created in the project ({dp}).',
    'Connexion « {name} » créée dans le projet ({dp}).',
    'Verbindung „{name}“ im Projekt erstellt ({dp}).'
  ),
  connCreateFailed: ml(
    'The connection “{name}” could not be created: {error}',
    'La connexion « {name} » n’a pas pu être créée : {error}',
    'Die Verbindung „{name}“ konnte nicht erstellt werden: {error}'
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
  addDevice: ml('New', 'Nouveau', 'Neu'),
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
  bookLinkHint: ml(
    'Open “{name}” in the Catalogs tab',
    'Ouvrir « {name} » dans l’onglet Catalogues',
    '„{name}“ im Katalog-Tab öffnen'
  ),
  entriesChip: ml('{n} signals', '{n} signaux', '{n} Signale'),
  deviceModelDps: ml('Model datapoints', 'Datapoints du modèle', 'Datenpunkte aus dem Modell'),
  deviceModelDpsHint: ml(
    'Only the datapoints the model binds to this equipment.',
    'Uniquement les datapoints que le modèle lie à cet équipement.',
    'Nur die Datenpunkte, die das Modell an dieses Gerät bindet.'
  ),
  deviceModelDpsEmpty: ml(
    'The model binds no datapoint to this equipment yet — pick it as the target in the Model panel and generate.',
    'Le modèle ne lie encore aucun datapoint à cet équipement — choisissez-le comme cible dans le panneau Modèle et générez.',
    'Das Modell bindet noch keinen Datenpunkt an dieses Gerät — im Modell-Panel als Ziel wählen und generieren.'
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
  driverNoneForProtocol: ml(
    'The project has drivers, but none that can serve {protocol} (the simulation driver is never offered) — start or add one, or enter its manager number.',
    'Le projet a des drivers, mais aucun ne peut servir {protocol} (le driver de simulation n’est jamais proposé) — en démarrer ou en ajouter un, ou saisir son numéro de manager.',
    'Das Projekt hat Treiber, aber keinen, der {protocol} bedienen kann (der Simulationstreiber wird nie angeboten) — einen starten oder hinzufügen, oder die Managernummer eingeben.'
  ),
  driverMismatch: ml(
    'Driver {n} is a “{type}”, which does not match the {protocol} protocol of this equipment.',
    'Le driver {n} est un « {type} », ce qui ne correspond pas au protocole {protocol} de cet équipement.',
    'Treiber {n} ist ein „{type}“ und passt nicht zum {protocol}-Protokoll dieses Geräts.'
  ),
  paramUnset: ml('— not stated —', '— non renseigné —', '— nicht angegeben —'),
  deviceSecurity: ml('OPC UA security', 'Sécurité OPC UA', 'OPC UA-Sicherheit'),
  deviceSecurityHint: ml(
    'Written to the LIVE connection at save time — the same settings as the standard OPC UA connection panel. Fields left empty do not touch the connection.',
    'Écrit sur la connexion EN DIRECT à l’enregistrement — les mêmes réglages que le panneau standard de connexions OPC UA. Un champ laissé vide ne touche pas la connexion.',
    'Wird beim Speichern auf die LIVE-Verbindung geschrieben — dieselben Einstellungen wie im Standard-Panel der OPC UA-Verbindungen. Leere Felder lassen die Verbindung unangetastet.'
  ),
  devicePasswordSet: ml(
    'A password is set on the connection — leave empty to keep it.',
    'Un mot de passe est défini sur la connexion — laisser vide pour le conserver.',
    'Auf der Verbindung ist ein Passwort gesetzt — leer lassen, um es zu behalten.'
  ),
  devicePasswordUnset: ml(
    'No password on the connection. It is encrypted by WinCC OA with the project’s driver certificate and never stored by the studio.',
    'Aucun mot de passe sur la connexion. Il est chiffré par WinCC OA avec le certificat driver du projet et jamais stocké par le studio.',
    'Kein Passwort auf der Verbindung. Es wird von WinCC OA mit dem Treiberzertifikat des Projekts verschlüsselt und vom Studio nie gespeichert.'
  ),
  deviceCertFlagsHint: ml(
    'Certificate checks to relax (Config.Flags — the standard panel’s advanced settings). Each one weakens the server verification: tick only what the plant situation requires.',
    'Contrôles de certificat à assouplir (Config.Flags — les réglages avancés du panneau standard). Chacun affaiblit la vérification du serveur : ne cocher que ce que la situation impose.',
    'Zu lockernde Zertifikatsprüfungen (Config.Flags — die erweiterten Einstellungen des Standard-Panels). Jede schwächt die Serverprüfung: nur ankreuzen, was die Anlage wirklich erfordert.'
  ),
  connSecurityApplied: ml(
    'Security applied to the connection ({what}).',
    'Sécurité appliquée à la connexion ({what}).',
    'Sicherheit auf die Verbindung angewendet ({what}).'
  ),
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
  bookNew: ml('New', 'Nouveau', 'Neu'),
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
  bookDelete: ml('Delete', 'Supprimer', 'Löschen'),
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
  /** Says that a second pick ADDS — a file input cannot append, so it must be told. */
  bookFilesAccumulate: ml(
    'Pick again to add more files — they accumulate. One source may declare several blocks, and a data block needs the UDTs it references.',
    'Sélectionner de nouveau pour ajouter des fichiers — ils s’accumulent. Une source peut déclarer plusieurs blocs, et un bloc de données a besoin des UDT qu’il référence.',
    'Erneut auswählen, um weitere Dateien hinzuzufügen — sie sammeln sich an. Eine Quelle kann mehrere Bausteine deklarieren, und ein Datenbaustein braucht die referenzierten UDTs.'
  ),
  bookFileRemove: ml('Remove {file}', 'Retirer {file}', '{file} entfernen'),
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
  // --- S7Plus browse ---------------------------------------------------------
  s7plusSource: ml('TIA source', 'source TIA', 'TIA-Quelle'),
  s7plusOnline: ml('Online — the live PLC', 'En ligne — l’automate', 'Online — die Live-SPS'),
  s7plusSourceHint: ml(
    'The station to read: the PLC itself, or one of the TIA exports the driver found under the project’s data/TIA_Projects. A walk of an export produces a TEMPLATE catalog (no interface), because it describes an engineered program and not a live binding.',
    'La station à lire : l’automate lui-même, ou l’un des exports TIA que le driver a trouvés sous data/TIA_Projects du projet. Le parcours d’un export produit un catalogue MODÈLE (sans interface) : il décrit un programme conçu, pas une liaison vivante.',
    'Die zu lesende Station: die SPS selbst oder einer der TIA-Exporte, die der Treiber unter data/TIA_Projects des Projekts gefunden hat. Der Durchlauf eines Exports ergibt einen VORLAGEN-Katalog (ohne Schnittstelle), da er ein projektiertes Programm und keine lebende Bindung beschreibt.'
  ),
  s7plusHmiOnly: ml(
    'Only elements “Visible in HMI Engineering”',
    'Uniquement les éléments « Visible dans l’ingénierie IHM »',
    'Nur Elemente „Sichtbar in HMI Engineering“'
  ),
  s7plusHmiOnlyHint: ml(
    'The driver’s own filter (its third browse parameter), on by default like the standard panel. Off, the walk sees everything the program declares — including what the machine builder did not mean to expose.',
    'Le filtre du driver lui-même (son troisième paramètre de parcours), actif par défaut comme dans le panneau standard. Désactivé, le parcours voit tout ce que le programme déclare — y compris ce que le constructeur n’entendait pas exposer.',
    'Der Filter des Treibers selbst (sein dritter Browse-Parameter), standardmäßig aktiv wie im Standardpanel. Deaktiviert sieht der Durchlauf alles, was das Programm deklariert — auch was der Maschinenbauer nicht exponieren wollte.'
  ),
  s7plusNeedStation: ml(
    'Choose the TIA source to walk (the PLC, or one of its exports).',
    'Choisir la source TIA à parcourir (l’automate, ou l’un de ses exports).',
    'Die zu durchlaufende TIA-Quelle wählen (die SPS oder einen ihrer Exporte).'
  ),
  s7plusNoManager: ml(
    'The S7+ browse service is not reachable: deploy the s7plusBrowse manager and start it in pmon. Nothing can be browsed until then.',
    'Le service de parcours S7+ est injoignable : déployer le manager s7plusBrowse et le démarrer dans pmon. Rien ne peut être parcouru d’ici là.',
    'Der S7+-Browse-Dienst ist nicht erreichbar: den Manager s7plusBrowse bereitstellen und in pmon starten. Bis dahin kann nichts durchlaufen werden.'
  ),
  s7plusNoDriver: ml(
    'No S7Plus driver is running: the driver answers the browse, so start it before walking a station.',
    'Aucun driver S7Plus ne tourne : c’est le driver qui répond au parcours — le démarrer avant de parcourir une station.',
    'Es läuft kein S7Plus-Treiber: der Treiber antwortet auf den Browse — vor dem Durchlauf einer Station starten.'
  ),
  s7plusExplorerTitle: ml('Explore the station', 'Explorer la station', 'Station erkunden'),
  s7plusExplorerHint: ml(
    'One request per branch, nothing stored: open the blocks that matter, then promote one as the walk root — the difference between a catalog of 200 useful signals and one of the whole program.',
    'Une requête par branche, rien n’est enregistré : ouvrir les blocs qui comptent, puis en promouvoir un comme racine du parcours — c’est la différence entre un catalogue de 200 signaux utiles et un catalogue de tout le programme.',
    'Eine Anfrage pro Zweig, nichts wird gespeichert: die relevanten Bausteine öffnen und einen davon als Durchlauf-Wurzel setzen — der Unterschied zwischen einem Katalog mit 200 nützlichen Signalen und einem des gesamten Programms.'
  ),
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
    's7plus-browse': ml('S7+ browse', 'parcours S7+', 'S7+-Browse'),
    simaticml: ml('SimaticML export', 'export SimaticML', 'SimaticML-Export'),
    s7sym: ml('STEP 7 symbols', 'symboles STEP 7', 'STEP 7-Symbole'),
    s7awl: ml('STEP 7 sources (AWL)', 'sources STEP 7 (AWL)', 'STEP 7-Quellen (AWL)'),
    xvm: ml('Schneider XVM', 'XVM Schneider', 'Schneider XVM'),
    csv: ml('Schneider CSV', 'CSV Schneider', 'Schneider CSV'),
    nodeset: ml('OPC UA NodeSet2', 'NodeSet2 OPC UA', 'OPC UA NodeSet2'),
    'ai-proposal': ml('AI proposal', 'proposition IA', 'KI-Vorschlag'),
    manual: ml('entered by hand', 'saisi à la main', 'manuell erfasst')
  },

  /** Generator choices of the creation form (one per supported source). */
  format: {
    browse: ml('Live OPC UA server (explore, then walk)', 'Serveur OPC UA en ligne (explorer puis parcourir)', 'Live-OPC-UA-Server (erkunden, dann durchlaufen)'),
    's7plus': ml(
      'Live S7-1200/1500, symbolic (S7+ browse)',
      'S7-1200/1500 en ligne, symbolique (parcours S7+)',
      'Live S7-1200/1500, symbolisch (S7+-Durchlauf)'
    ),
    simaticml: ml('TIA / SimaticML export (XML)', 'Export TIA / SimaticML (XML)', 'TIA-/SimaticML-Export (XML)'),
    s7sym: ml(
      'STEP 7 symbol table (.asc / .sdf / .seq / .csv)',
      'Table des symboles STEP 7 (.asc / .sdf / .seq / .csv)',
      'STEP 7-Symboltabelle (.asc / .sdf / .seq / .csv)'
    ),
    s7awl: ml('STEP 7 sources — data blocks (AWL/STL)', 'Sources STEP 7 — blocs de données (AWL/LIST)', 'STEP 7-Quellen — Datenbausteine (AWL)'),
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
    's7plus': ml(
      'Reads the S7Plus driver’s own symbolic browse, through the dedicated browse manager: the blocks and tag tables of a station, member by member, with the exact symbolic address the driver resolves at runtime. Two sources — the LIVE PLC (the program currently loaded) or a TIA export placed under the project’s data/TIA_Projects (a template catalog, since the PLC is not contacted). The browse states NO access rights, so every signal is catalogued read-only with an “assumed” access: qualify by role, or fix the access by hand.',
      'Lit le parcours symbolique du driver S7Plus, via le manager de parcours dédié : les blocs et tables de variables d’une station, membre par membre, avec l’adresse symbolique exacte que le driver résout à l’exécution. Deux sources — l’automate EN LIGNE (le programme actuellement chargé) ou un export TIA placé sous data/TIA_Projects du projet (catalogue modèle, puisque l’automate n’est pas interrogé). Le parcours n’indique AUCUN droit d’accès : chaque signal est catalogué en lecture seule avec un accès « supposé » — qualifier par rôle, ou corriger l’accès à la main.',
      'Liest den symbolischen Browse des S7Plus-Treibers über den dedizierten Browse-Manager: die Bausteine und Variablentabellen einer Station, Member für Member, mit der exakten symbolischen Adresse, die der Treiber zur Laufzeit auflöst. Zwei Quellen — die LIVE-SPS (das aktuell geladene Programm) oder ein TIA-Export unter data/TIA_Projects des Projekts (Vorlagenkatalog, da die SPS nicht kontaktiert wird). Der Browse nennt KEINE Zugriffsrechte: jedes Signal wird nur lesend mit „angenommenem“ Zugriff katalogisiert — per Rolle qualifizieren oder den Zugriff manuell korrigieren.'
    ),
    simaticml: ml(
      'A TIA Openness export is a BUNDLE: select the DB documents together with the UDTs they reference, otherwise the members of an unresolved UDT are reported as warnings instead of being catalogued.',
      'Un export TIA Openness est un LOT : sélectionner les documents DB avec les UDT qu’ils référencent, sinon les membres d’un UDT non résolu sont signalés en avertissement au lieu d’être catalogués.',
      'Ein TIA-Openness-Export ist ein BÜNDEL: die DB-Dokumente zusammen mit den referenzierten UDTs auswählen, sonst werden die Member eines nicht aufgelösten UDT als Warnung gemeldet statt katalogisiert.'
    ),
    s7sym: ml(
      'The symbol table names the memory areas — inputs, outputs, flags, peripheral words — and the project’s data blocks. It does NOT contain what is inside a data block: the classic S7 protocol carries no layout, so the DB members come from the AWL sources. The column order and the dialect (.asc, .sdf, .seq, .csv) are detected, not configured.',
      'La table des symboles nomme les zones mémoire — entrées, sorties, mémentos, mots de périphérie — et les blocs de données du projet. Elle ne contient PAS le contenu d’un bloc de données : le protocole S7 classique ne transporte aucune structure, les membres des DB viennent donc des sources AWL. L’ordre des colonnes et le dialecte (.asc, .sdf, .seq, .csv) sont détectés, pas configurés.',
      'Die Symboltabelle benennt die Speicherbereiche — Eingänge, Ausgänge, Merker, Peripheriewörter — und die Datenbausteine des Projekts. Sie enthält NICHT den Inhalt eines Datenbausteins: das klassische S7-Protokoll überträgt keine Struktur, die DB-Member stammen daher aus den AWL-Quellen. Spaltenreihenfolge und Dialekt (.asc, .sdf, .seq, .csv) werden erkannt, nicht konfiguriert.'
    ),
    s7awl: ml(
      'STEP 7 “Generate source” on the data blocks. The member ORDER is read from the declaration and the byte offsets are computed with the classic standard layout (bit packing, word alignment, String[n] = n + 2), producing operands such as DB10.DBD4. Add the symbol table beside it to name a block Echange rather than DB10 — the addresses are the same either way.',
      'STEP 7 « Générer source » sur les blocs de données. L’ORDRE des membres est lu dans la déclaration et les offsets sont calculés selon la structure standard classique (compactage des bits, alignement mot, String[n] = n + 2), ce qui donne des opérandes comme DB10.DBD4. Ajouter la table des symboles à côté pour nommer un bloc Echange plutôt que DB10 — les adresses sont identiques dans les deux cas.',
      'STEP 7 „Quelle erzeugen“ für die Datenbausteine. Die REIHENFOLGE der Member wird aus der Deklaration gelesen und die Byte-Offsets nach dem klassischen Standardaufbau berechnet (Bitpackung, Wortausrichtung, String[n] = n + 2), was Operanden wie DB10.DBD4 ergibt. Die Symboltabelle daneben laden, um einen Baustein Echange statt DB10 zu nennen — die Adressen sind in beiden Fällen dieselben.'
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

  // --- classic S7: the online check of a catalog ------------------------------
  s7InventoryRun: ml('Check against the CPU', 'Vérifier sur la CPU', 'Gegen die CPU prüfen'),
  s7InventoryRunning: ml('Reading the CPU…', 'Lecture de la CPU…', 'CPU wird gelesen…'),
  s7InventoryHint: ml(
    'Read the CPU’s block directory and compare it with this catalog: data blocks it addresses that the PLC does not hold, blocks it reads past the end of, and blocks the export left behind. Nothing is written — neither to the catalog nor to the PLC.',
    'Lire le répertoire des blocs de la CPU et le comparer à ce catalogue : blocs de données adressés mais absents de l’automate, blocs lus au-delà de leur fin, et blocs oubliés par l’export. Rien n’est écrit — ni dans le catalogue, ni dans l’automate.',
    'Das Bausteinverzeichnis der CPU lesen und mit diesem Katalog vergleichen: adressierte, aber in der SPS fehlende Datenbausteine, über ihr Ende hinaus gelesene Bausteine und vom Export ausgelassene Bausteine. Es wird nichts geschrieben — weder in den Katalog noch in die SPS.'
  ),
  s7InventoryRead: ml('· {n} block(s) read', '· {n} bloc(s) lus', '· {n} Baustein(e) gelesen'),
  s7CpuUnknown: ml('CPU not identified', 'CPU non identifiée', 'CPU nicht identifiziert'),
  s7InventoryTitle: ml('CPU reading', 'Lecture de la CPU', 'CPU-Auslesung'),
  s7Counts: ml('Blocks in the CPU:', 'Blocs dans la CPU :', 'Bausteine in der CPU:'),
  s7Pdu: ml('PDU {n} B', 'PDU {n} o', 'PDU {n} B'),
  s7PduHint: ml(
    'Maximum telegram size negotiated with the CPU — how much it can answer per exchange.',
    'Taille maximale de télégramme négociée avec la CPU — ce qu’elle peut répondre par échange.',
    'Mit der CPU ausgehandelte maximale Telegrammgröße — wie viel sie pro Austausch beantworten kann.'
  ),
  s7Bytes: ml('{n} B', '{n} o', '{n} B'),
  s7NoDataBlock: ml(
    'This catalog addresses no data block, and the CPU holds none — nothing to compare.',
    'Ce catalogue n’adresse aucun bloc de données et la CPU n’en porte aucun — rien à comparer.',
    'Dieser Katalog adressiert keinen Datenbaustein und die CPU enthält keinen — nichts zu vergleichen.'
  ),

  // Columns of the CPU-reading table: the catalog's side, then the machine's.
  s7ColBlock: ml('Block', 'Bloc', 'Baustein'),
  s7ColStatus: ml('State', 'État', 'Status'),
  s7ColSignals: ml('Signals', 'Signaux', 'Signale'),
  s7ColRead: ml('Read up to', 'Lu jusqu’à', 'Gelesen bis'),
  s7ColCpuSize: ml('CPU size', 'Taille CPU', 'CPU-Größe'),
  s7ColCompiled: ml('Compiled', 'Compilé', 'Übersetzt'),
  s7ColAuthor: ml('Author', 'Auteur', 'Autor'),

  /** One word per verdict — the pill an operator scans down the column. */
  s7Status: {
    ok: ml('matches', 'concorde', 'stimmt'),
    absent: ml('absent', 'absent', 'fehlt'),
    overrun: ml('too short', 'trop court', 'zu kurz'),
    unknown: ml('not readable', 'illisible', 'nicht lesbar'),
    uncatalogued: ml('not catalogued', 'non catalogué', 'nicht katalogisiert')
  },

  /** …and what to DO about it, as the pill's tooltip. */
  s7StatusHint: {
    ok: ml(
      'The CPU holds this block and it is at least as long as the catalog reads.',
      'La CPU porte ce bloc et il est au moins aussi long que ce que lit le catalogue.',
      'Die CPU enthält diesen Baustein und er ist mindestens so lang, wie der Katalog liest.'
    ),
    absent: ml(
      'The catalog addresses this block but the CPU does not hold it — every signal built from it will fail to bind. The export is newer than the PLC, or it came from another station.',
      'Le catalogue adresse ce bloc mais la CPU ne le porte pas — tout signal construit à partir de lui ne se liera pas. L’export est plus récent que l’automate, ou il vient d’une autre station.',
      'Der Katalog adressiert diesen Baustein, aber die CPU enthält ihn nicht — jedes daraus gebaute Signal wird sich nicht binden. Der Export ist neuer als die SPS oder stammt von einer anderen Station.'
    ),
    overrun: ml(
      'The catalog reads past the end of this block: it was shortened since the export. The addresses below the cut still work, which is what makes this hard to notice.',
      'Le catalogue lit au-delà de la fin de ce bloc : il a été réduit depuis l’export. Les adresses situées avant la coupure fonctionnent toujours, ce qui rend le problème difficile à repérer.',
      'Der Katalog liest über das Ende dieses Bausteins hinaus: er wurde seit dem Export verkleinert. Die Adressen unterhalb des Schnitts funktionieren weiterhin, was das Problem schwer erkennbar macht.'
    ),
    unknown: ml(
      'The CPU would not describe this block — protected, or unreadable. Nothing is concluded: this is “not asked”, not “not there”.',
      'La CPU n’a pas voulu décrire ce bloc — protégé ou illisible. Rien n’en est conclu : c’est « non demandé », pas « absent ».',
      'Die CPU wollte diesen Baustein nicht beschreiben — geschützt oder nicht lesbar. Daraus wird nichts geschlossen: das heißt „nicht gefragt“, nicht „nicht vorhanden“.'
    ),
    uncatalogued: ml(
      'The CPU holds this block and the catalog addresses none of it. Not an error — but it is how an export that left something behind is found.',
      'La CPU porte ce bloc et le catalogue n’en adresse rien. Ce n’est pas une erreur — mais c’est ainsi qu’on découvre un export qui a laissé quelque chose de côté.',
      'Die CPU enthält diesen Baustein und der Katalog adressiert nichts davon. Kein Fehler — aber so findet man einen Export, der etwas ausgelassen hat.'
    )
  },

  s7NoDeviceForBook: ml(
    'No classic-S7 equipment uses this catalog, so there is no CPU to read it against — attach it to one first.',
    'Aucun équipement S7 classique n’utilise ce catalogue : il n’y a donc pas de CPU sur laquelle le vérifier — le rattacher d’abord à un équipement.',
    'Kein klassisches S7-Gerät verwendet diesen Katalog, es gibt also keine CPU zum Abgleich — ihn zuerst einem Gerät zuordnen.'
  ),

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
  colHistory: ml('history', 'historique', 'Historie'),
  colAcq: ml('acq.', 'acq.', 'Erf.'),
  acqFromRolePoll: ml(
    'Role "{role}" → POLLING: the value is sampled on a poll group. The default for everything but a fault and a state — a flat, predictable load. Changeable per element in the model’s structure tree.',
    'Rôle « {role} » → POLLING : la valeur est échantillonnée sur un groupe de scrutation. Le défaut pour tout sauf un défaut et un état — charge plate et prévisible. Modifiable par élément dans l’arbre de structure du modèle.',
    'Rolle „{role}“ → POLLING: der Wert wird über eine Pollgruppe abgetastet. Der Standard für alles außer Störung und Zustand — gleichmäßige, vorhersehbare Last. Pro Element im Strukturbaum des Modells änderbar.'
  ),
  acqFromRoleSpont: ml(
    'Role "{role}" → SUBSCRIPTION: the server pushes the value on change. The default for a fault and a state — a transition between two ticks IS the information. Changeable per element in the model’s structure tree.',
    'Rôle « {role} » → SOUSCRIPTION : le serveur pousse la valeur au changement. Le défaut pour un défaut et un état — une transition entre deux tops EST l’information. Modifiable par élément dans l’arbre de structure du modèle.',
    'Rolle „{role}“ → ABONNEMENT: der Server sendet den Wert bei Änderung. Der Standard für Störung und Zustand — ein Übergang zwischen zwei Takten IST die Information. Pro Element im Strukturbaum des Modells änderbar.'
  ),
  acqNotOpcua: ml(
    'POLLING, whatever the role: only the OPC UA driver subscribes. A "{protocol}" catalog is sampled — a leaf asking for a subscription there falls back to polling at generation and says so.',
    'POLLING, quel que soit le rôle : seul le driver OPC UA souscrit. Un catalogue « {protocol} » est échantillonné — un élément y demandant une souscription retombe en polling à la génération, et le dit.',
    'POLLING, unabhängig von der Rolle: nur der OPC-UA-Treiber abonniert. Ein „{protocol}“-Katalog wird abgetastet — ein Element, das dort ein Abonnement verlangt, fällt bei der Generierung auf Polling zurück und sagt es.'
  ),
  acqUnqualified: ml(
    'Not qualified: no role, so no acquisition mode — and no config at all is generated for this signal.',
    'Non qualifié : pas de rôle, donc pas de mode d’acquisition — et aucune config n’est générée pour ce signal.',
    'Nicht qualifiziert: keine Rolle, also kein Erfassungsmodus — und für dieses Signal wird überhaupt keine Konfiguration erzeugt.'
  ),
  historyYes: ml(
    'The source keeps a HISTORY of this signal (OPC UA: Historizing / AccessLevel HistoryRead) — decide whether WinCC OA should archive it too.',
    'La source conserve un HISTORIQUE de ce signal (OPC UA : Historizing / AccessLevel HistoryRead) — à décider si WinCC OA doit l’archiver aussi.',
    'Die Quelle führt eine HISTORIE dieses Signals (OPC UA: Historizing / AccessLevel HistoryRead) — entscheiden, ob WinCC OA es ebenfalls archivieren soll.'
  ),
  historyNo: ml(
    'The source states it keeps NO history of this signal.',
    'La source indique qu’elle ne conserve PAS d’historique de ce signal.',
    'Die Quelle gibt an, KEINE Historie dieses Signals zu führen.'
  ),
  addressHistorical: ml(
    'HISTORICAL address, left INACTIVE: the "Historical" box of the WinCC OA address is checked (_address.._offset) because the OPC UA source states it keeps a history of this signal and the address READS it (IN / IN-OUT). The history is read through a HistoryRead request, so the address does not acquire the value live as well — activate it in PARA if the live value is needed too.',
    'Adresse HISTORIQUE, laissée INACTIVE : la case « Historical » de l’adresse WinCC OA est cochée (_address.._offset) car la source OPC UA déclare conserver un historique de ce signal et l’adresse le LIT (IN / IN-OUT). L’historique est lu par une requête HistoryRead, l’adresse n’acquiert donc pas aussi la valeur en direct — l’activer dans PARA si la valeur live est nécessaire.',
    'HISTORISCHE Adresse, INAKTIV gelassen: das Feld „Historical“ der WinCC-OA-Adresse ist gesetzt (_address.._offset), denn die OPC-UA-Quelle führt nach eigener Angabe eine Historie dieses Signals und die Adresse LIEST es (IN / IN-OUT). Die Historie wird über eine HistoryRead-Anfrage gelesen, die Adresse erfasst den Wert also nicht zusätzlich live — in PARA aktivieren, wenn auch der Live-Wert gebraucht wird.'
  ),
  historyUnknown: ml(
    'The source says nothing about history (a register map, a CSV export, or a browse whose driver exposes no AccessLevel) — unknown, not "no".',
    'La source ne dit rien de l’historique (table de registres, export CSV, ou parcours dont le driver n’expose pas AccessLevel) — inconnu, et non « non ».',
    'Die Quelle sagt nichts zur Historie (Registertabelle, CSV-Export oder ein Browse, dessen Treiber AccessLevel nicht liefert) — unbekannt, nicht „nein“.'
  ),
  liveNotYet: ml(
    'This DPE does not exist in the project yet — there is no value to read until the check-in creates it.',
    'Ce DPE n’existe pas encore dans le projet — aucune valeur à lire tant que le check-in ne l’a pas créé.',
    'Dieser DPE existiert im Projekt noch nicht — kein Wert lesbar, bis der Check-in ihn erstellt.'
  ),
  policyTitle: ml('Deployment (per mapping)', 'Déploiement (par mapping)', 'Deployment (je Zuordnung)'),
  // Short headers: the table has seven columns inside the composer's narrow
  // column, and "classe d’alarme" spelled out is what pushed the range out of view.
  // Two letters on a tree row: the row already carries a name, a type, a mapping and
  // a range — spelled-out labels would push the structure out of view.
  acqPoll: ml('poll', 'polling', 'Polling'),
  acqSpont: ml('subscribe', 'souscription', 'Abo'),
  acqHint: ml(
    'How this element is acquired. POLL: read at the rhythm of a poll group — flat, predictable load, blind to anything that changes and comes back between two ticks. SUBSCRIBE: pushed by the server on change, with the source timestamp; its publishing interval and deadband live on the subscription.',
    'Comment cet élément est acquis. POLLING : lu au rythme d’un groupe — charge plate et prévisible, aveugle à ce qui change et revient entre deux tops. SOUSCRIPTION : poussé par le serveur au changement, avec l’horodatage source ; l’intervalle de publication et la bande morte vivent sur la souscription.',
    'Wie dieses Element erfasst wird. POLLING: im Rhythmus einer Poll-Gruppe gelesen — flache, vorhersehbare Last, blind für alles, was sich zwischen zwei Takten ändert und zurückkehrt. ABO: vom Server bei Änderung gesendet, mit Quell-Zeitstempel; Publishing-Intervall und Totband liegen am Abonnement.'
  ),
  acqPollGroup: ml(
    'Poll group (_PollGroup) — its period is the rhythm of this element.',
    'Groupe de polling (_PollGroup) — sa période est le rythme de cet élément.',
    'Poll-Gruppe (_PollGroup) — ihre Periode ist der Rhythmus dieses Elements.'
  ),
  acqSubscription: ml(
    'Subscription (_OPCUASubscription) — it carries the publishing interval and the deadband. Without one, the element is written POLLED.',
    'Souscription (_OPCUASubscription) — elle porte l’intervalle de publication et la bande morte. Sans elle, l’élément est écrit en POLLING.',
    'Abonnement (_OPCUASubscription) — es trägt Publishing-Intervall und Totband. Ohne eines wird das Element GEPOLLT geschrieben.'
  ),
  acqDefaultGroup: ml('— default group —', '— groupe par défaut —', '— Standardgruppe —'),
  acqNoSubscription: ml('— none (→ polling) —', '— aucune (→ polling) —', '— keines (→ Polling) —'),
  policyAlarmShort: ml('alm', 'alm', 'Alm'),
  policyArchiveShort: ml('arch', 'arch', 'Arch'),
  policyAlarmClass: ml('class', 'classe', 'Klasse'),
  policyArchiveGroup: ml('group', 'groupe', 'Gruppe'),
  dpSearch: ml('search', 'recherche', 'Suche'),
  dpSearchHint: ml(
    'WinCC OA wildcards: * for any run, ? for one character. The project’s datapoints, not only the alert classes — that is what this is for.',
    'Jokers WinCC OA : * pour une suite quelconque, ? pour un caractère. Les datapoints du projet, pas seulement les classes d’alarme — c’est le but.',
    'WinCC OA-Platzhalter: * für eine beliebige Folge, ? für ein Zeichen. Die Datenpunkte des Projekts, nicht nur die Alarmklassen — genau dafür ist das da.'
  ),
  dpSearchNone: ml('No datapoint matches.', 'Aucun datapoint ne correspond.', 'Kein Datenpunkt passt.'),
  dpSearchTruncated: ml(
    'Result truncated — narrow the pattern to see the rest.',
    'Résultat tronqué — affiner le motif pour voir la suite.',
    'Ergebnis gekürzt — Muster verfeinern, um den Rest zu sehen.'
  ),
  dpSearchFailed: ml('Datapoint search failed: {error}', 'Recherche de datapoint échouée : {error}', 'Datenpunktsuche fehlgeschlagen: {error}'),
  pickDp: ml('Pick a datapoint…', 'Choisir un datapoint…', 'Datenpunkt wählen…'),
  policyGoodRange: ml(
    'Which value is the HEALTHY one — the alert is raised on the other (_alert_hdl.._ok_range).',
    'Quelle valeur est le BON état — l’alarme est levée sur l’autre (_alert_hdl.._ok_range).',
    'Welcher Wert ist der GUTE — der Alarm wird beim anderen ausgelöst (_alert_hdl.._ok_range).'
  ),
  policyGoodFalse: ml('good = FALSE', 'bon = FAUX', 'gut = FALSCH'),
  policyGoodTrue: ml('good = TRUE', 'bon = VRAI', 'gut = WAHR'),
  policyThresholds: ml(
    'Thresholds, comma-separated: N of them make N+1 ranges (WinCC OA analog alert handling). Empty = the plain non-zero alert.',
    'Seuils, séparés par des virgules : N seuils font N+1 plages (alarme analogique WinCC OA). Vide = simple alarme sur valeur non nulle.',
    'Schwellen, mit Komma getrennt: N Schwellen ergeben N+1 Bereiche (analoge Alarmierung von WinCC OA). Leer = einfacher Alarm bei Wert ungleich null.'
  ),
  policyDirection: ml(
    'Which side alarms: above the thresholds, or below them.',
    'Quel côté alarme : au-dessus des seuils, ou en dessous.',
    'Welche Seite alarmiert: über den Schwellen oder darunter.'
  ),
  policyAbove: ml('above', 'au-dessus', 'darüber'),
  policyBelow: ml('below', 'en dessous', 'darunter'),
  policyRangeClass: ml(
    'Alert class of THIS range — leave empty to use the element’s class.',
    'Classe d’alarme de CETTE plage — laisser vide pour utiliser la classe de l’élément.',
    'Alarmklasse DIESES Bereichs — leer lassen, um die Klasse des Elements zu verwenden.'
  ),
  policyRangeClassHint: ml(
    'one class per range — how an alarm escalates',
    'une classe par plage — l’escalade de l’alarme',
    'eine Klasse pro Bereich — die Eskalation des Alarms'
  ),
  policyRangeHint: ml(
    'Both bounds, as min..max (e.g. 0..450). Empty = no range: the studio never invents one.',
    'Les deux bornes, sous la forme min..max (ex. 0..450). Vide = aucune plage : le studio n’en invente jamais.',
    'Beide Grenzen als min..max (z. B. 0..450). Leer = kein Bereich: das Studio erfindet keinen.'
  ),
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
  composerCatalog: ml('source catalogs', 'catalogues sources', 'Quellkataloge'),
  composerNoCatalog: ml(
    'No source catalog selected: the structure can be edited and SAVED as it is — a branch can only be mapped once a catalog is checked above.',
    'Aucun catalogue source sélectionné : la structure peut être éditée et ENREGISTRÉE telle quelle — une branche ne peut être mappée qu’une fois un catalogue coché ci-dessus.',
    'Kein Quellkatalog ausgewählt: die Struktur kann bearbeitet und so GESPEICHERT werden — ein Zweig kann erst zugeordnet werden, wenn oben ein Katalog angehakt ist.'
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
  genEquipments: ml('devices', 'équipements', 'Geräte'),

  // --- reusable models -------------------------------------------------------
  // A house-standard type is authored once and applied to machine after machine, so
  // it is stored — with its structure and its mappings, but WITHOUT the target or
  // the equipment names, which are what differ between two applications.
  modelLibrary: ml('Models', 'Modèles', 'Modelle'),
  // The empty state of the tree's FIRST level, not a dropdown placeholder: it has to
  // say what to do, since there is nothing to click yet.
  modelNone: ml(
    'No model yet — “New model” to author one, or “Mirror the catalog”.',
    'Aucun modèle — « Nouveau modèle » pour en composer un, ou « Miroir du catalogue ».',
    'Noch kein Modell — „Neues Modell“ zum Aufbauen, oder „Katalog spiegeln“.'
  ),
  modelSave: ml('Save', 'Enregistrer', 'Speichern'),
  modelSaveHint: ml(
    'Stores the type’s structure and its mappings under its type name, reusable on any equipment. The equipment names and the target are NOT stored — they are what differs between two applications.',
    'Enregistre la structure du type et ses mappings sous le nom du type, réutilisable sur n’importe quel équipement. Les noms d’équipements et la cible ne sont PAS enregistrés — c’est ce qui diffère entre deux applications.',
    'Speichert die Struktur des Typs und seine Zuordnungen unter dem Typnamen, wiederverwendbar auf jedem Gerät. Gerätenamen und Ziel werden NICHT gespeichert — genau das unterscheidet zwei Anwendungen.'
  ),
  modelDelete: ml('Delete', 'Supprimer', 'Löschen'),
  modelLoaded: ml(
    'Model “{name}” loaded (type “{type}”) — edit its sources, its structure and its mapping below.',
    'Modèle « {name} » chargé (type « {type} ») — modifier ci-dessous ses sources, sa structure et son mapping.',
    'Modell „{name}“ geladen (Typ „{type}“) — unten Quellen, Struktur und Zuordnung bearbeiten.'
  ),
  modelSaved: ml('Model “{name}” saved.', 'Modèle « {name} » enregistré.', 'Modell „{name}“ gespeichert.'),
  modelDeleted: ml('Model “{name}” deleted.', 'Modèle « {name} » supprimé.', 'Modell „{name}“ gelöscht.'),
  modelSaveFailed: ml('Model refused: {error}', 'Modèle refusé : {error}', 'Modell abgelehnt: {error}'),
  genTargetNotServed: ml(
    '“{name}” does not reference this catalog. Generating still works — the addresses use its own connection — but link the catalog to it if it is meant to serve it.',
    '« {name} » ne référence pas ce catalogue. La génération fonctionne quand même — les adresses utilisent sa propre connexion — mais associez-lui le catalogue s’il doit le servir.',
    '„{name}“ verweist nicht auf diesen Katalog. Die Erzeugung funktioniert dennoch — die Adressen nutzen seine eigene Verbindung — aber verknüpfen Sie den Katalog, wenn er ihn bedienen soll.'
  ),
  genDone: ml(
    'Instance(s) created: type “{type}”, {dps} DP, {configs} configured DPEs — the diff below says what a check-in would write.',
    'Instance(s) créée(s) : type « {type} », {dps} DP, {configs} DPE configurés — le diff ci-dessous indique ce qu’un check-in écrirait.',
    'Instanz(en) erstellt: Typ „{type}“, {dps} DP, {configs} konfigurierte DPEs — das Diff unten zeigt, was ein Check-in schreiben würde.'
  ),
  genFailed: ml('Generation failed: {error}', 'Génération impossible : {error}', 'Erzeugung fehlgeschlagen: {error}'),
  mappedCount: ml('{n}/{total} element(s) mapped', '{n}/{total} élément(s) associé(s)', '{n}/{total} Element(e) zugeordnet'),

  // --- structure tree (the graphical authoring of a custom type) --------------
  // The outline text stays the storage format; the tree is the way to SHAPE it, and
  // it carries each leaf's mapping so nothing has to be held in one's head.
  treeEmpty: ml(
    'Empty type — add an element or a group.',
    'Type vide — ajouter un élément ou un groupe.',
    'Leerer Typ — ein Element oder eine Gruppe hinzufügen.'
  ),
  treeCollapse: ml('Fold this group', 'Replier ce groupe', 'Diese Gruppe einklappen'),
  treeExpand: ml('Unfold this group', 'Déplier ce groupe', 'Diese Gruppe ausklappen'),
  treeCollapseAll: ml('Fold every group', 'Replier tous les groupes', 'Alle Gruppen einklappen'),
  treeExpandAll: ml('Unfold every group', 'Déplier tous les groupes', 'Alle Gruppen ausklappen'),
  treeGroupsCount: ml('{n} group(s), {collapsed} folded', '{n} groupe(s), {collapsed} replié(s)', '{n} Gruppe(n), {collapsed} eingeklappt'),
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
  controlTitle: ml('Instances — check-in', 'Instances — check-in', 'Instanzen — Check-in'),
  // --- instances tree --------------------------------------------------------
  instancesOfModel: ml('{n} instance(s)', '{n} instance(s)', '{n} Instanz(en)'),
  instanceNoModel: ml(
    'No model has produced a datapoint yet — compose one in the Model tab and generate it for an equipment.',
    'Aucun modèle n’a encore produit de datapoint — en composer un dans l’onglet Modèle et le générer pour un équipement.',
    'Noch kein Modell hat einen Datenpunkt erzeugt — im Modell-Tab eines zusammenstellen und für ein Gerät erzeugen.'
  ),
  instanceNone: ml(
    'This model has no instance yet.',
    'Ce modèle n’a encore aucune instance.',
    'Dieses Modell hat noch keine Instanz.'
  ),
  instanceOnDevice: ml('on {device}', 'sur {device}', 'auf {device}'),
  instanceNoDevice: ml(
    'no equipment — its DPEs carry no address yet',
    'aucun équipement — ses DPE ne portent pas encore d’adresse',
    'kein Gerät — seine DPEs tragen noch keine Adresse'
  ),
  instanceModelUnsaved: ml(
    'generated type, not saved as a model',
    'type généré, non enregistré comme modèle',
    'erzeugter Typ, nicht als Modell gespeichert'
  ),
  adopt: ml('Parameterise', 'Paramétrer', 'Parametrieren'),
  adoptHint: ml(
    'Bring this existing datapoint under the model: the instance form opens with its name, and generating writes the model’s configs ONTO it — the datapoint itself is never re-created.',
    'Placer ce datapoint existant sous le modèle : le formulaire d’instance s’ouvre avec son nom, et la génération écrit les configs du modèle SUR lui — le datapoint n’est jamais recréé.',
    'Diesen vorhandenen Datenpunkt unter das Modell bringen: das Instanzformular öffnet sich mit seinem Namen, und die Erzeugung schreibt die Konfigs des Modells AUF ihn — der Datenpunkt wird nie neu erstellt.'
  ),
  statusUnmanaged: ml('in the project', 'dans le projet', 'im Projekt'),
  statusUnmanagedHint: ml(
    'This datapoint EXISTS in the project and the model does not describe it yet — re-apply the model to it, or create it as an instance, to bring its configs under the model.',
    'Ce datapoint EXISTE dans le projet et le modèle ne le décrit pas encore — réappliquer le modèle ou le créer comme instance pour placer ses configs sous le modèle.',
    'Dieser Datenpunkt EXISTIERT im Projekt und das Modell beschreibt ihn noch nicht — das Modell erneut anwenden oder ihn als Instanz erstellen, um seine Konfigs unter das Modell zu bringen.'
  ),
  statusSynced: ml('checked in', 'checké in', 'eingecheckt'),
  statusCreate: ml('to create', 'à créer', 'zu erstellen'),
  statusUpdate: ml('to update', 'à mettre à jour', 'zu aktualisieren'),
  statusDelete: ml('to delete', 'à supprimer', 'zu löschen'),
  statusConflict: ml('conflict', 'conflit', 'Konflikt'),
  statusAllSynced: ml(
    'Everything is checked in: the working copy and the project agree.',
    'Tout est checké in : la copie de travail et le projet concordent.',
    'Alles ist eingecheckt: Arbeitskopie und Projekt stimmen überein.'
  ),
  statusPending: ml(
    '{n} of {total} instance(s) differ from the project.',
    '{n} instance(s) sur {total} diffèrent du projet.',
    '{n} von {total} Instanz(en) weichen vom Projekt ab.'
  ),
  instanceNew: ml('New instance', 'Nouvelle instance', 'Neue Instanz'),
  instanceNewHint: ml(
    'Apply this model to equipment: name the datapoints and pick the equipment they read. This is where a model becomes datapoints — the Model tab only defines it.',
    'Appliquer ce modèle à un équipement : nommer les datapoints et choisir l’équipement qu’ils lisent. C’est ici qu’un modèle devient des datapoints — l’onglet Modèle ne fait que le définir.',
    'Dieses Modell auf Geräte anwenden: die Datenpunkte benennen und das Gerät wählen, das sie lesen. Hier wird ein Modell zu Datenpunkten — der Reiter Modell definiert es nur.'
  ),
  instanceCreate: ml('Create the instance(s)', 'Créer la ou les instances', 'Instanz(en) erstellen'),
  dpesCount: ml('{n} DPE', '{n} DPE', '{n} DPE'),
  reapplyAll: ml('Re-apply all', 'Réappliquer tout', 'Alle anwenden'),
  reapplyAllHint: ml(
    'Regenerate every model’s instances from its current structure, mappings and deployment policy — the global counterpart of the per-model button. It stops at the working copy: the diff below then says what a check-in would write.',
    'Régénère les instances de chaque modèle depuis sa structure, ses mappings et sa politique de déploiement actuels — l’équivalent global du bouton par modèle. S’arrête à la copie de travail : le diff ci-dessous indique alors ce qu’un check-in écrirait.',
    'Erzeugt die Instanzen jedes Modells aus seiner aktuellen Struktur, seinen Zuordnungen und seiner Deployment-Richtlinie neu — das globale Gegenstück zur Schaltfläche pro Modell. Endet bei der Arbeitskopie: das Diff unten zeigt dann, was ein Check-in schreiben würde.'
  ),
  reapplyAllNothing: ml(
    'No model has an instance yet — nothing to re-apply.',
    'Aucun modèle n’a d’instance — rien à réappliquer.',
    'Kein Modell hat eine Instanz — nichts anzuwenden.'
  ),
  reapplyAllDone: ml('{n} model(s) re-applied.', '{n} modèle(s) réappliqué(s).', '{n} Modell(e) erneut angewendet.'),
  recreate: ml('Re-create', 'Recréer', 'Neu erstellen'),
  recreateArmed: ml('Confirm re-creation', 'Confirmer la recréation', 'Neuerstellung bestätigen'),
  recreateHint: ml(
    'DESTRUCTIVE, and never needed for an ordinary change: everything else AMENDS — the DP type is changed in place and each datapoint keeps its identity, its configs and its archived values. This deletes the type and its datapoints and re-creates them; their history goes with them. Use it only for a change the runtime refuses in place.',
    'DESTRUCTIF, et jamais nécessaire pour une modification ordinaire : tout le reste MET À JOUR — le type DP est modifié sur place et chaque datapoint garde son identité, ses configs et ses valeurs archivées. Ceci supprime le type et ses datapoints puis les recrée ; leur historique part avec. À n’utiliser que pour une modification que le runtime refuse sur place.',
    'DESTRUKTIV und für eine normale Änderung nie nötig: alles andere ÄNDERT — der DP-Typ wird an Ort und Stelle geändert und jeder Datenpunkt behält Identität, Konfigs und archivierte Werte. Dies löscht den Typ und seine Datenpunkte und erstellt sie neu; ihre Historie geht mit. Nur für eine Änderung verwenden, die die Laufzeit vor Ort ablehnt.'
  ),
  recreateConfirm: ml(
    'Click again to DELETE and re-create the type and its datapoints — their archived values are lost.',
    'Cliquer à nouveau pour SUPPRIMER et recréer le type et ses datapoints — leurs valeurs archivées sont perdues.',
    'Erneut klicken, um den Typ und seine Datenpunkte zu LÖSCHEN und neu zu erstellen — ihre archivierten Werte sind verloren.'
  ),
  recreateArm: ml(
    'Re-creation of “{type}” armed — click again to confirm. Its datapoints and their history will be deleted.',
    'Recréation de « {type} » armée — cliquer à nouveau pour confirmer. Ses datapoints et leur historique seront supprimés.',
    'Neuerstellung von „{type}“ vorbereitet — erneut klicken zum Bestätigen. Seine Datenpunkte und ihre Historie werden gelöscht.'
  ),
  recreateNothing: ml(
    'Nothing to re-create for “{type}” — the project already matches the working copy.',
    'Rien à recréer pour « {type} » — le projet correspond déjà à la copie de travail.',
    'Nichts neu zu erstellen für „{type}“ — das Projekt entspricht bereits der Arbeitskopie.'
  ),
  recreateDone: ml(
    '“{type}” re-created: {n} object(s) written.',
    '« {type} » recréé : {n} objet(s) écrit(s).',
    '„{type}“ neu erstellt: {n} Objekt(e) geschrieben.'
  ),
  reapplyModel: ml('Re-apply', 'Réappliquer', 'Anwenden'),
  reapplyHint: ml(
    'Regenerates every instance of this model from its current structure, mappings and deployment policy — what makes a model change reach the datapoints it already produced.',
    'Régénère chaque instance de ce modèle depuis sa structure, ses mappings et sa politique de déploiement actuels — c’est ce qui fait qu’une modification du modèle atteint les datapoints déjà produits.',
    'Erzeugt jede Instanz dieses Modells aus seiner aktuellen Struktur, seinen Zuordnungen und seiner Deployment-Richtlinie neu — damit eine Modelländerung die bereits erzeugten Datenpunkte erreicht.'
  ),
  reapplyDone: ml(
    'Model “{name}” re-applied to {n} instance(s).',
    'Modèle « {name} » réappliqué à {n} instance(s).',
    'Modell „{name}“ auf {n} Instanz(en) angewendet.'
  ),
  reapplyNoBook: ml(
    'Model “{name}” cannot be re-applied: its source catalog is gone — pick a catalog in the Model tab and generate again.',
    'Le modèle « {name} » ne peut pas être réappliqué : son catalogue source a disparu — choisir un catalogue dans l’onglet Modèle et régénérer.',
    'Modell „{name}“ kann nicht angewendet werden: sein Quellkatalog fehlt — im Modell-Tab einen Katalog wählen und neu erzeugen.'
  ),
  reapplyNothing: ml(
    'Model “{name}” has no instance to re-apply to.',
    'Le modèle « {name} » n’a aucune instance à réappliquer.',
    'Modell „{name}“ hat keine Instanz, auf die angewendet werden könnte.'
  ),
  planDetailTitle: ml('What a check-in would write', 'Ce qu’un check-in écrirait', 'Was ein Check-in schreiben würde'),
  sourcePrimary: ml('primary', 'principal', 'primär'),
  sourceHint: ml(
    'A model may read SEVERAL catalogs — two DBs of one PLC, or a TIA export beside the OPC UA browse of the same machine. Every mapping names its catalog (“catalogue::path”), so each branch keeps the driver of the source it reads. Per catalog: IMPORT merges its paths into the structure, already mapped; UNLINK takes them back out.',
    'Un modèle peut lire PLUSIEURS catalogues — deux DB d’un même automate, ou un export TIA à côté du parcours OPC UA de la même machine. Chaque mapping nomme son catalogue (« catalogue::chemin »), donc chaque branche conserve le driver de la source qu’elle lit. Par catalogue : IMPORTER fusionne ses chemins dans la structure, déjà mappés ; DÉLIER les en retire.',
    'Ein Modell kann MEHRERE Kataloge lesen — zwei DBs einer SPS, oder ein TIA-Export neben dem OPC UA-Browse derselben Maschine. Jede Zuordnung nennt ihren Katalog („Katalog::Pfad“), damit jeder Zweig den Treiber seiner Quelle behält. Pro Katalog: IMPORTIEREN fügt seine Pfade zugeordnet in die Struktur ein; TRENNEN nimmt sie wieder heraus.'
  ),
  sourceMirrorAction: ml('Import into the model', 'Importer dans le modèle', 'In das Modell importieren'),
  sourceRemoveAction: ml('Remove from the model', 'Retirer du modèle', 'Aus dem Modell entfernen'),
  sourceRemoveHint: ml(
    'Remove this catalog FROM the model: the branches that read it, their mappings and their deployment decisions go with it. A branch you re-mapped onto another catalog stays. The catalog itself is not touched.',
    'Retirer ce catalogue DU modèle : les branches qui le lisent, leurs mappings et leurs décisions de déploiement partent avec. Une branche re-mappée sur un autre catalogue reste. Le catalogue lui-même n’est pas touché.',
    'Diesen Katalog AUS dem Modell entfernen: die Zweige, die ihn lesen, ihre Zuordnungen und ihre Deployment-Entscheidungen gehen mit. Ein Zweig, der auf einen anderen Katalog umgemappt wurde, bleibt. Der Katalog selbst wird nicht angetastet.'
  ),
  sourceRemoveDone: ml(
    '“{name}” removed from the model — {n} branch(es) went with it.',
    '« {name} » retiré du modèle — {n} branche(s) partie(s) avec.',
    '„{name}“ aus dem Modell entfernt — {n} Zweig(e) gingen mit.'
  ),
  sourceMirrorHint: ml(
    'Update the model from THIS catalog: its paths are merged into the structure and every branch added comes mapped to the signal it came from. What is already in the model wins — a branch you renamed or re-mapped is left untouched and counted.',
    'Mettre à jour le modèle depuis CE catalogue : ses chemins sont fusionnés dans la structure et chaque branche ajoutée arrive mappée sur le signal d’origine. Ce qui est déjà dans le modèle gagne — une branche renommée ou re-mappée est laissée intacte et comptée.',
    'Das Modell aus DIESEM Katalog aktualisieren: seine Pfade werden in die Struktur eingefügt, und jeder neue Zweig kommt an sein Ursprungssignal zugeordnet. Was bereits im Modell steht, gewinnt — ein umbenannter oder neu zugeordneter Zweig bleibt unangetastet und wird gezählt.'
  ),
  mirrorDone: ml(
    'Model updated from “{name}” — {branches} branch(es) added and mapped.',
    'Modèle mis à jour depuis « {name} » — {branches} branche(s) ajoutée(s) et mappée(s).',
    'Modell aus „{name}“ aktualisiert — {branches} Zweig(e) hinzugefügt und zugeordnet.'
  ),
  synced: ml('in sync', 'synchronisé', 'synchron'),
  syncedHint: ml(
    'The project’s DP type matches this model, structure for structure.',
    'Le type DP du projet correspond à ce modèle, structure pour structure.',
    'Der DP-Typ des Projekts entspricht diesem Modell, Struktur für Struktur.'
  ),
  diverged: ml('diverged', 'divergent', 'abweichend'),
  divergedHint: ml(
    'The project’s DP type of this name differs from the model — it was edited elsewhere (PARA), or the model changed and was never re-applied. Create an instance / re-apply to write the model, or edit the model to match.',
    'Le type DP du projet portant ce nom diffère du modèle — il a été modifié ailleurs (PARA), ou le modèle a changé sans être réappliqué. Créer une instance / réappliquer pour écrire le modèle, ou modifier le modèle pour correspondre.',
    'Der DP-Typ dieses Namens im Projekt weicht vom Modell ab — er wurde anderswo (PARA) bearbeitet, oder das Modell wurde geändert und nie erneut angewendet. Instanz erstellen / erneut anwenden, um das Modell zu schreiben, oder das Modell anpassen.'
  ),
  syncAbsent: ml('not created', 'non créé', 'nicht erstellt'),
  syncAbsentHint: ml(
    'No DP type of this name in the project yet — this model has produced nothing so far.',
    'Aucun type DP de ce nom dans le projet — ce modèle n’a encore rien produit.',
    'Noch kein DP-Typ dieses Namens im Projekt — dieses Modell hat bisher nichts erzeugt.'
  ),
  modelEdit: ml('Edit', 'Éditer', 'Bearbeiten'),
  modelEditCancelled: ml(
    'Changes to “{name}” dropped — the stored model is shown again.',
    'Modifications de « {name} » abandonnées — le modèle enregistré est réaffiché.',
    'Änderungen an „{name}“ verworfen — das gespeicherte Modell wird wieder angezeigt.'
  ),
  modelNew: ml('New', 'Nouveau', 'Neu'),
  modelNewHint: ml(
    'Create a model: give it a name and a description, then choose its source catalogs and shape its structure.',
    'Créer un modèle : lui donner un nom et une description, puis choisir ses catalogues sources et façonner sa structure.',
    'Ein Modell erstellen: Name und Beschreibung angeben, dann Quellkataloge wählen und die Struktur formen.'
  ),
  modelDeleteHint: ml(
    'Delete the selected model. Its instances are NOT deleted — they stay in the workspace until you remove them there.',
    'Supprimer le modèle sélectionné. Ses instances ne sont PAS supprimées — elles restent dans l’espace de travail jusqu’à leur retrait.',
    'Das ausgewählte Modell löschen. Seine Instanzen werden NICHT gelöscht — sie bleiben im Arbeitsbereich, bis sie dort entfernt werden.'
  ),
  modelCreateTitle: ml('New model', 'Nouveau modèle', 'Neues Modell'),
  modelCreate: ml('Create', 'Créer', 'Erstellen'),
  modelCreated: ml(
    'Model “{name}” created — choose its source catalogs below.',
    'Modèle « {name} » créé — choisir ses catalogues sources ci-dessous.',
    'Modell „{name}“ erstellt — unten seine Quellkataloge wählen.'
  ),
  modelTargetType: ml('DP type', 'type DP', 'DP-Typ'),
  modelTargetExisting: ml(
    '“{type}” already exists in the project: this model PARAMETERISES it — a generation writes the configs of its datapoints and leaves the type itself alone.',
    '« {type} » existe déjà dans le projet : ce modèle le PARAMÈTRE — une génération écrit les configs de ses datapoints et ne touche pas au type lui-même.',
    '„{type}“ existiert bereits im Projekt: dieses Modell PARAMETRIERT ihn — eine Erzeugung schreibt die Konfigs seiner Datenpunkte und lässt den Typ selbst unberührt.'
  ),
  modelTargetNew: ml(
    '“{type}” does not exist yet — a generation creates it, then the datapoints of the equipment it is applied to.',
    '« {type} » n’existe pas encore — une génération le crée, puis les datapoints de l’équipement auquel il est appliqué.',
    '„{type}“ existiert noch nicht — eine Erzeugung erstellt ihn und dann die Datenpunkte des Geräts, auf das er angewendet wird.'
  ),
  modelFromType: ml('from a DP type', 'depuis un type DP', 'aus einem DP-Typ'),
  modelFromTypeNone: ml('— empty structure —', '— structure vide —', '— leere Struktur —'),
  modelFromTypeHint: ml(
    'Start the model from a DP type the project ALREADY has: its structure is copied, its branches unmapped — what each one reads is the next decision (a catalog’s IMPORT button, or the picker on the branch). This is how a type engineered in PARA becomes a model.',
    'Démarrer le modèle depuis un type DP DÉJÀ présent dans le projet : sa structure est copiée, ses branches non mappées — ce que chacune lit est la décision suivante (le bouton IMPORTER d’un catalogue, ou le sélecteur sur la branche). C’est ainsi qu’un type conçu dans PARA devient un modèle.',
    'Das Modell aus einem im Projekt SCHON vorhandenen DP-Typ starten: seine Struktur wird kopiert, seine Zweige bleiben ohne Zuordnung — was jeder liest, ist die nächste Entscheidung (die IMPORTIEREN-Schaltfläche eines Katalogs oder die Auswahl am Zweig). So wird ein in PARA erstellter Typ zu einem Modell.'
  ),
  modelFromTypeFailed: ml(
    'DP type “{type}” could not be read: {error}',
    'Le type DP « {type} » n’a pas pu être lu : {error}',
    'DP-Typ „{type}“ konnte nicht gelesen werden: {error}'
  ),
  modelName: ml('name', 'nom', 'Name'),
  modelNameRequired: ml('A name is required.', 'Un nom est obligatoire.', 'Ein Name ist erforderlich.'),
  modelTypeWillBe: ml('DP type: {type}', 'Type DP : {type}', 'DP-Typ: {type}'),
  modelDescription: ml('description', 'description', 'Beschreibung'),
  modelDescriptionPlaceholder: ml(
    'What this model is for — which machine, which standard, what it assumes.',
    'À quoi sert ce modèle — quelle machine, quel standard, ce qu’il suppose.',
    'Wofür dieses Modell dient — welche Maschine, welcher Standard, welche Annahmen.'
  ),
  modelPickHint: ml(
    'Pick a model on the left to see and edit it, or create one.',
    'Choisir un modèle à gauche pour le voir et l’éditer, ou en créer un.',
    'Links ein Modell wählen, um es zu sehen und zu bearbeiten, oder ein neues erstellen.'
  ),
  modelNoSource: ml('no catalog', 'aucun catalogue', 'kein Katalog'),
  dryRun: ml('Preview', 'Aperçu', 'Vorschau'),
  checkin: ml('Check-in', 'Check-in', 'Check-in'),

  // --- why check-in is (un)available -----------------------------------------
  // A permanently greyed primary button is a dead end: "not allowed" and "nothing to
  // apply" call for opposite actions, so the reason is stated, never left to guess.
  checkinScopeHint: ml(
    'Check in THIS scope only — {n} object(s). It synchronises without re-creating: an existing DP type is changed in place and an existing datapoint keeps its identity, its configs and its archived values.',
    'Checker-in UNIQUEMENT cette portée — {n} objet(s). Synchronise sans recréer : un type DP existant est modifié sur place et un datapoint existant garde son identité, ses configs et ses valeurs archivées.',
    'NUR diesen Bereich einchecken — {n} Objekt(e). Synchronisiert ohne Neuerstellung: ein vorhandener DP-Typ wird an Ort und Stelle geändert, ein vorhandener Datenpunkt behält Identität, Konfigs und archivierte Werte.'
  ),
  checkinScopeDone: ml(
    '“{scope}” checked in — {n} object(s) written.',
    '« {scope} » checké in — {n} objet(s) écrit(s).',
    '„{scope}“ eingecheckt — {n} Objekt(e) geschrieben.'
  ),
  checkinReady: ml(
    'Apply the diff to the project, transactionally.',
    'Appliquer le diff au projet, de façon transactionnelle.',
    'Das Diff transaktional auf das Projekt anwenden.'
  ),
  checkinNothing: ml(
    'Nothing to check in — create an instance of a model above, the diff appears here.',
    'Rien à checker-in — créer d’abord une instance d’un modèle ci-dessus, le diff apparaît ici.',
    'Nichts einzuchecken — zuerst oben eine Instanz eines Modells erstellen, das Diff erscheint hier.'
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
  measure: ml('TM measure', 'TM mesure', 'TM Messwert'),
  setpoint: ml('TR setpoint', 'TR consigne', 'TR Sollwert'),
  command: ml('TC command', 'TC commande', 'TC Befehl'),
  state: ml('TS state', 'TS état', 'TS Zustand'),
  alarm: ml('TA alarm', 'TA alarme', 'TA Alarm'),
  counter: ml('TCP counter', 'TCP compteur', 'TCP Zähler'),
  parameter: ml('TX parameter', 'TX paramètre', 'TX Parameter'),
  unknown: ml('to qualify', 'à qualifier', 'zu qualifizieren')
};

/**
 * The TELEMETRY CODE of each role — the prefix every role label carries
 * (`TM mesure`, `TC commande`…), in the utility convention: TM télémesure,
 * TC télécommande, TR télérégulation (setpoint), TS télésignalisation (state),
 * TA téléalarme, TCP télécomptage (counter), TX parameter.
 *
 * Kept as its own table, and NOT translated: it is a designation, the same in
 * every language, and it is what an operator reading a schematic or a signal
 * list recognises first. `unknown` has none on purpose — an unqualified signal
 * has no telemetry nature yet, and inventing a code for it would hide that.
 */
export const ROLE_CODE: Record<string, string> = {
  measure: 'TM',
  setpoint: 'TR',
  command: 'TC',
  state: 'TS',
  alarm: 'TA',
  counter: 'TCP',
  parameter: 'TX'
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
  connection: ml('connection (S7)', 'connexion (S7)', 'Verbindung (S7)'),
  ip: ml('IP address', 'adresse IP', 'IP-Adresse'),
  rack: ml('rack', 'rack', 'Rack'),
  slot: ml('slot', 'slot', 'Steckplatz'),
  port: ml('TCP port', 'port TCP', 'TCP-Port'),
  unitId: ml('unit id (slave)', 'unit id (esclave)', 'Unit-ID (Slave)'),
  cpu: ml('CPU reference', 'référence CPU', 'CPU-Referenz'),
  wordOrder: ml('word order', 'ordre des mots', 'Wortreihenfolge'),
  zeroBased: ml('zero based addressing', 'adressage base zéro', 'Adressierung ab Null'),
  // --- OPC UA connection security (the standard panel's vocabulary) ----------
  user: ml('user (empty = anonymous)', 'utilisateur (vide = anonyme)', 'Benutzer (leer = anonym)'),
  password: ml('password', 'mot de passe', 'Passwort'),
  securityPolicy: ml('security policy', 'politique de sécurité', 'Sicherheitsrichtlinie'),
  messageMode: ml('message mode', 'mode des messages', 'Nachrichtenmodus'),
  clientCertificate: ml('client certificate', 'certificat client', 'Client-Zertifikat'),
  allowUnsecured: ml(
    'allow unsecured servers (passwords travel unencrypted!)',
    'autoriser les serveurs non sécurisés (mots de passe en clair !)',
    'ungesicherte Server zulassen (Passwörter unverschlüsselt!)'
  ),
  ignoreInvalidCert: ml('accept an invalid certificate', 'accepter un certificat invalide', 'ungültiges Zertifikat akzeptieren'),
  ignoreRevocation: ml('ignore revoked certificates', 'ignorer les certificats révoqués', 'widerrufene Zertifikate ignorieren'),
  ignoreIssuerRevocation: ml(
    'ignore issuer revocation-list errors',
    'ignorer les erreurs de liste de révocation de l’émetteur',
    'Fehler der Aussteller-Sperrliste ignorieren'
  ),
  ignoreExpiredCert: ml('accept expired certificates', 'accepter les certificats expirés', 'abgelaufene Zertifikate akzeptieren'),
  ignoreInvalidHostname: ml('accept an invalid hostname', 'accepter un nom d’hôte invalide', 'ungültigen Hostnamen akzeptieren'),
  ignoreInvalidUri: ml('ignore an invalid ApplicationUri', 'ignorer un ApplicationUri invalide', 'ungültige ApplicationUri ignorieren'),
  ignoreBasicConstraints: ml('ignore basic constraints', 'ignorer les contraintes de base', 'Basic Constraints ignorieren')
};

/**
 * Labels of the values of a `choice`/`flag` connection parameter, keyed
 * `<paramKey>.<value>`. An unlabelled value renders raw, like an unlabelled key.
 */
export const PARAM_OPTION_LABEL: Record<string, Ml> = {
  'wordOrder.big': ml('big-endian (no swap)', 'big-endian (sans permutation)', 'Big-Endian (kein Tausch)'),
  'wordOrder.little': ml('little-endian (swapped)', 'little-endian (permuté)', 'Little-Endian (getauscht)'),
  'zeroBased.true': ml('yes — the first register is 0', 'oui — le premier registre est 0', 'ja — das erste Register ist 0'),
  'zeroBased.false': ml('no — the first register is 1', 'non — le premier registre est 1', 'nein — das erste Register ist 1'),
  // Policy names are OPC UA identifiers — kept verbatim, only qualified.
  'securityPolicy.None': ml('None (no encryption)', 'None (sans chiffrement)', 'None (keine Verschlüsselung)'),
  'securityPolicy.Basic256Sha256': same('Basic256Sha256'),
  'securityPolicy.Aes128Sha256RsaOaep': same('Aes128Sha256RsaOaep'),
  'securityPolicy.Aes256Sha256RsaPss': same('Aes256Sha256RsaPss'),
  'securityPolicy.Basic128Rsa15': ml('Basic128Rsa15 (deprecated)', 'Basic128Rsa15 (obsolète)', 'Basic128Rsa15 (veraltet)'),
  'securityPolicy.Basic256': ml('Basic256 (deprecated)', 'Basic256 (obsolète)', 'Basic256 (veraltet)'),
  'messageMode.None': same('None'),
  'messageMode.Sign': same('Sign'),
  'messageMode.SignAndEncrypt': same('Sign & Encrypt')
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
 *    checked mechanically (`demo/check-i18n.mjs`), because a dropped `{n}`
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
  'device.security-mismatch': ml(
    'Security policy and message mode go together: either both None, or a policy with Sign / Sign&Encrypt (got policy "{policy}", mode "{mode}").',
    'La politique de sécurité et le mode des messages vont ensemble : soit les deux à None, soit une politique avec Sign / Sign&Encrypt (reçu politique « {policy} », mode « {mode} »).',
    'Sicherheitsrichtlinie und Nachrichtenmodus gehören zusammen: entweder beide None, oder eine Richtlinie mit Sign / Sign&Encrypt (erhalten: Richtlinie „{policy}“, Modus „{mode}“).'
  ),
  'device.password-without-user': ml(
    'A password without a user name does nothing: the client logs in anonymously when the user is empty.',
    'Un mot de passe sans utilisateur ne sert à rien : le client se connecte anonymement quand l’utilisateur est vide.',
    'Ein Passwort ohne Benutzernamen bewirkt nichts: der Client meldet sich anonym an, wenn der Benutzer leer ist.'
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
  // --- S7Plus (S7-1200/1500 symbolic browse) ---------------------------------
  // Translated from the core's own English templates, placeholder for placeholder
  // (`tools/check-eng-i18n.mjs` fails if one drifts).
  's7plus.arrays-expanded': ml(
    '{n} ARRAY(s) catalogued ELEMENT BY ELEMENT ({paths}{more}) — one signal per index, since WinCC OA addresses an S7Plus array member individually.',
    '{n} ARRAY(s) catalogué(s) ÉLÉMENT PAR ÉLÉMENT ({paths}{more}) — un signal par indice, car WinCC OA adresse individuellement chaque membre d’un array S7Plus.',
    '{n} ARRAY(s) ELEMENTWEISE katalogisiert ({paths}{more}) — ein Signal pro Index, da WinCC OA ein S7Plus-Array-Element einzeln adressiert.'
  ),
  's7plus.array-truncated': ml(
    '{n} array(s) catalogued up to {max} elements only ({paths}{more}) — the rest is MISSING from the book. Raise maxArrayElements, or browse into the array itself.',
    '{n} array(s) catalogué(s) jusqu’à {max} éléments seulement ({paths}{more}) — le reste est ABSENT du carnet. Augmenter maxArrayElements, ou parcourir l’array lui-même.',
    '{n} Array(s) nur bis {max} Elemente katalogisiert ({paths}{more}) — der Rest FEHLT im Adressbuch. maxArrayElements erhöhen oder das Array selbst durchsuchen.'
  ),
  's7plus.type-unmapped': ml(
    '{n} signal(s) whose TIA datatype has no verified WinCC OA element type ({paths}{more}) — catalogued and flagged "unmapped": no address is generated on them.',
    '{n} signal(s) dont le type TIA n’a aucun type d’élément WinCC OA vérifié ({paths}{more}) — catalogué(s) et marqué(s) « unmapped » : aucune adresse n’est générée dessus.',
    '{n} Signal(e), deren TIA-Datentyp keinen verifizierten WinCC OA-Elementtyp hat ({paths}{more}) — katalogisiert und als „unmapped“ markiert: es wird keine Adresse dafür erzeugt.'
  ),
  's7plus.access-assumed': ml(
    'The S7Plus browse exposes no access rights: all {n} signals are catalogued READ-ONLY with an "assumed" access — the direction comes from the role (its profile). Qualify before generating, or fix the access by hand.',
    'Le parcours S7Plus n’expose aucun droit d’accès : les {n} signaux sont catalogués en LECTURE SEULE avec un accès « supposé » — la direction vient du rôle (son profil). Qualifier avant de générer, ou corriger l’accès à la main.',
    'Der S7Plus-Browse liefert keine Zugriffsrechte: alle {n} Signale sind NUR-LESEND mit „angenommenem“ Zugriff katalogisiert — die Richtung kommt aus der Rolle (ihrem Profil). Vor dem Erzeugen qualifizieren oder den Zugriff manuell korrigieren.'
  ),
  's7plus.hmi-filtered': ml(
    'Only the elements flagged "Visible in HMI Engineering" in TIA were browsed — an element the program does not expose is ABSENT from this catalog. Re-browse with the filter off to see everything.',
    'Seuls les éléments marqués « Visible in HMI Engineering » dans TIA ont été parcourus — un élément que le programme n’expose pas est ABSENT de ce catalogue. Relancer le parcours sans le filtre pour tout voir.',
    'Es wurden nur die in TIA als „Visible in HMI Engineering“ markierten Elemente durchsucht — ein Element, das das Programm nicht freigibt, FEHLT in diesem Katalog. Ohne Filter erneut durchsuchen, um alles zu sehen.'
  ),
  's7plus.source-online': ml(
    'Read ONLINE from the PLC through connection "{connection}" — the catalog is the program currently loaded, and the driver must stay able to resolve each symbol at runtime.',
    'Lu EN LIGNE depuis l’automate via la connexion « {connection} » — le catalogue est le programme actuellement chargé, et le driver doit rester capable de résoudre chaque symbole à l’exécution.',
    'ONLINE von der SPS über die Verbindung „{connection}“ gelesen — der Katalog ist das aktuell geladene Programm, und der Treiber muss jedes Symbol zur Laufzeit weiterhin auflösen können.'
  ),
  's7plus.source-project': ml(
    'Read from the TIA project "{project}" (an export under <proj>/data/TIA_Projects) — the PLC was NOT contacted, so a program downloaded since may differ. Re-browse online to confirm.',
    'Lu depuis le projet TIA « {project} » (un export sous <proj>/data/TIA_Projects) — l’automate n’a PAS été contacté, un programme chargé depuis peut donc différer. Relancer un parcours en ligne pour confirmer.',
    'Aus dem TIA-Projekt „{project}“ gelesen (ein Export unter <proj>/data/TIA_Projects) — die SPS wurde NICHT kontaktiert, ein seither geladenes Programm kann daher abweichen. Zur Bestätigung online erneut durchsuchen.'
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

  'modelgen.subscription-missing': ml(
    '{n} element(s) asked to be SUBSCRIBED without a subscription ({leaves}{more}) — written POLLED instead, because an empty subscription in the reference IS polling. Name an _OPCUASubscription on the model, or accept polling.',
    '{n} élément(s) demandé(s) en SOUSCRIPTION sans souscription ({leaves}{more}) — écrits en POLLING à la place, car une souscription vide dans la référence EST du polling. Nommer une _OPCUASubscription sur le modèle, ou accepter le polling.',
    '{n} Element(e) sollen ABONNIERT werden, ohne Abonnement ({leaves}{more}) — stattdessen GEPOLLT geschrieben, denn ein leeres Abonnement in der Referenz IST Polling. Eine _OPCUASubscription am Modell benennen oder Polling akzeptieren.'
  ),
  'modelgen.connection-repointed': ml(
    'Addresses RE-POINTED at the target connection: {details}. The catalog names the server it was browsed on; an instance is addressed through its own equipment’s connection.',
    'Adresses RE-POINTÉES sur la connexion cible : {details}. Le catalogue nomme le serveur sur lequel il a été parcouru ; une instance s’adresse par la connexion de son propre équipement.',
    'Adressen auf die ZIELVERBINDUNG umgesetzt: {details}. Der Katalog nennt den Server, auf dem er durchsucht wurde; eine Instanz wird über die Verbindung ihrer eigenen Anlage adressiert.'
  ),
  'modelgen.historical-addresses': ml(
    '{n} address(es) marked HISTORICAL ("_address.._offset") and left INACTIVE: the OPC UA server states it keeps a history of those signals and they are read (IN / IN-OUT), so the project reads that history through a HistoryRead request instead of acquiring the value live as well. Activate them in PARA if a signal also needs its live value.',
    '{n} adresse(s) marquée(s) HISTORIQUE (« _address.._offset ») et laissée(s) INACTIVE(s) : le serveur OPC UA déclare conserver un historique de ces signaux et ils sont lus (IN / IN-OUT), le projet lit donc cet historique par une requête HistoryRead au lieu d’acquérir aussi la valeur en direct. Les activer dans PARA si un signal a également besoin de sa valeur live.',
    '{n} Adresse(n) als HISTORISCH markiert („_address.._offset“) und INAKTIV gelassen: der OPC-UA-Server führt nach eigener Angabe eine Historie dieser Signale und sie werden gelesen (IN / IN-OUT), das Projekt liest diese Historie daher über eine HistoryRead-Anfrage, statt den Wert zusätzlich live zu erfassen. In PARA aktivieren, wenn ein Signal auch seinen Live-Wert braucht.'
  ),
  'modelgen.alarm-unsupported': ml(
    'Alarm IGNORED on {n} element(s) whose type cannot carry one ({leaves}{more}) — an alert compares a value, which a String, a Blob or a Time has none of.',
    'Alarme IGNORÉE sur {n} élément(s) dont le type ne peut en porter ({leaves}{more}) — une alarme compare une valeur, ce qu’un String, un Blob ou un Time n’a pas.',
    'Alarm auf {n} Element(en) IGNORIERT, deren Typ keinen tragen kann ({leaves}{more}) — ein Alarm vergleicht einen Wert, den ein String, ein Blob oder eine Time nicht hat.'
  ),
  'modelgen.mirror-kept': ml(
    '{n} branch(es) already in the model were left untouched ({leaves}{more}) — the model wins over the catalog.',
    '{n} branche(s) déjà présente(s) dans le modèle ont été laissées intactes ({leaves}{more}) — le modèle gagne sur le catalogue.',
    '{n} bereits im Modell vorhandene Zweig(e) blieben unangetastet ({leaves}{more}) — das Modell gewinnt über den Katalog.'
  ),
  'modelgen.mirror-collision': ml(
    'Branch “{leaf}” is already mirrored from catalog “{owner}” — “{skipped}” of “{book}” was skipped.',
    'La branche « {leaf} » est déjà reproduite du catalogue « {owner} » — « {skipped} » de « {book} » a été ignoré.',
    'Zweig „{leaf}“ wird bereits aus Katalog „{owner}“ gespiegelt — „{skipped}“ von „{book}“ wurde übersprungen.'
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
  'schneider.xvm-crypted': ml(
    'The export is ENCRYPTED (<crypted> payload) — Control Expert writes it that way when the project or its sections are password-protected. No variable can be read. Re-export the variables from an unprotected project (or remove the protection first).',
    'L’export est CHIFFRÉ (charge « crypted ») — Control Expert l’écrit ainsi lorsque le projet ou ses sections sont protégés par mot de passe. Aucune variable n’est lisible. Réexporter les variables depuis un projet non protégé (ou lever la protection au préalable).',
    'Der Export ist VERSCHLÜSSELT (<crypted>-Nutzlast) — Control Expert schreibt ihn so, wenn das Projekt oder seine Sektionen passwortgeschützt sind. Es kann keine Variable gelesen werden. Die Variablen aus einem ungeschützten Projekt neu exportieren (oder den Schutz zuvor entfernen).'
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

  // --- classic S7: symbol table -------------------------------------------------
  's7sym.unreadable-line': ml(
    'Line {line}: not a symbol record ("{text}") — skipped.',
    'Ligne {line} : ce n’est pas un enregistrement de symbole (« {text} ») — ignorée.',
    'Zeile {line}: kein Symbol-Datensatz („{text}“) — übersprungen.'
  ),
  's7sym.unreadable-address': ml(
    'Line {line}: "{address}" is not an S7 address — symbol "{symbol}" skipped.',
    'Ligne {line} : « {address} » n’est pas une adresse S7 — symbole « {symbol} » ignoré.',
    'Zeile {line}: „{address}“ ist keine S7-Adresse — Symbol „{symbol}“ übersprungen.'
  ),
  's7sym.no-address-column': ml(
    'No S7 address recognised in {n} record(s): neither column holds operands such as "E 0.0", "MW 20" or "DB 10". This does not look like a STEP 7 symbol table.',
    'Aucune adresse S7 reconnue dans {n} enregistrement(s) : aucune des deux colonnes ne contient d’opérandes comme « E 0.0 », « MW 20 » ou « DB 10 ». Ce fichier ne ressemble pas à une table des symboles STEP 7.',
    'In {n} Datensatz/Datensätzen keine S7-Adresse erkannt: keine der beiden Spalten enthält Operanden wie „E 0.0“, „MW 20“ oder „DB 10“. Das sieht nicht nach einer STEP 7-Symboltabelle aus.'
  ),
  's7sym.no-symbol': ml(
    'Line {line}: address "{address}" carries no symbol — skipped.',
    'Ligne {line} : l’adresse « {address} » ne porte aucun symbole — ignorée.',
    'Zeile {line}: Adresse „{address}“ trägt kein Symbol — übersprungen.'
  ),
  's7sym.duplicate-symbol': ml(
    'Symbol "{symbol}" is declared twice (lines {first} and {line}) — the second is skipped.',
    'Le symbole « {symbol} » est déclaré deux fois (lignes {first} et {line}) — le second est ignoré.',
    'Symbol „{symbol}“ ist zweimal deklariert (Zeilen {first} und {line}) — das zweite wird übersprungen.'
  ),
  's7sym.duplicate-address': ml(
    'Address "{address}" is named twice ("{first}" and "{symbol}", line {line}) — both are catalogued.',
    'L’adresse « {address} » est nommée deux fois (« {first} » et « {symbol} », ligne {line}) — les deux sont cataloguées.',
    'Adresse „{address}“ ist zweimal benannt („{first}“ und „{symbol}“, Zeile {line}) — beide werden katalogisiert.'
  ),
  's7sym.width-mismatch': ml(
    'Symbol "{symbol}" (line {line}): "{address}" addresses a {width} but the declared type is "{type}" — the export or the symbol is stale.',
    'Symbole « {symbol} » (ligne {line}) : « {address} » adresse un {width} alors que le type déclaré est « {type} » — l’export ou le symbole n’est plus à jour.',
    'Symbol „{symbol}“ (Zeile {line}): „{address}“ adressiert ein {width}, der deklarierte Typ ist aber „{type}“ — Export oder Symbol ist veraltet.'
  ),
  's7sym.datatype-unmapped': ml(
    'Symbol "{symbol}": datatype "{type}" is not mapped — bound as String.',
    'Symbole « {symbol} » : type « {type} » non mappé — lié en String.',
    'Symbol „{symbol}“: Datentyp „{type}“ nicht zugeordnet — als String gebunden.'
  ),
  's7sym.no-db-content': ml(
    'A symbol table names data blocks but never their CONTENT — the S7 protocol carries no symbolic layout. {n} data block(s) named here ({names}{more}) hold no signal in this catalog: ingest their AWL/DB sources, or a TIA export, to catalogue their members.',
    'Une table des symboles nomme les blocs de données mais jamais leur CONTENU — le protocole S7 ne transporte aucune structure symbolique. {n} bloc(s) de données nommé(s) ici ({names}{more}) ne portent aucun signal dans ce catalogue : importer leurs sources AWL/DB, ou un export TIA, pour cataloguer leurs membres.',
    'Eine Symboltabelle benennt Datenbausteine, aber nie deren INHALT — das S7-Protokoll überträgt keine symbolische Struktur. {n} hier benannte Datenbaustein(e) ({names}{more}) enthalten in diesem Katalog kein Signal: deren AWL/DB-Quellen oder einen TIA-Export importieren, um die Member zu katalogisieren.'
  ),
  's7sym.no-signal': ml(
    'No addressable signal in this symbol table ({blocks} block name(s) read).',
    'Aucun signal adressable dans cette table des symboles ({blocks} nom(s) de bloc lus).',
    'Kein adressierbares Signal in dieser Symboltabelle ({blocks} Bausteinname(n) gelesen).'
  ),

  // --- classic S7: AWL / STL sources --------------------------------------------
  's7awl.no-block': ml(
    'No DATA_BLOCK or TYPE declaration found — this does not look like a STEP 7 AWL/STL source.',
    'Aucune déclaration DATA_BLOCK ni TYPE trouvée — ce fichier ne ressemble pas à une source AWL/LIST STEP 7.',
    'Keine DATA_BLOCK- oder TYPE-Deklaration gefunden — das sieht nicht nach einer STEP 7-AWL-Quelle aus.'
  ),
  's7awl.no-block-in-file': ml(
    '{file}: no DATA_BLOCK or TYPE declaration found.',
    '{file} : aucune déclaration DATA_BLOCK ni TYPE trouvée.',
    '{file}: keine DATA_BLOCK- oder TYPE-Deklaration gefunden.'
  ),
  's7awl.no-block-number': ml(
    'Data block "{name}" (line {line}) carries no block number — its members cannot be addressed, so it is skipped.',
    'Le bloc de données « {name} » (ligne {line}) ne porte aucun numéro de bloc — ses membres ne peuvent pas être adressés, il est donc ignoré.',
    'Datenbaustein „{name}“ (Zeile {line}) trägt keine Bausteinnummer — seine Member sind nicht adressierbar und werden übersprungen.'
  ),
  's7awl.unreadable-declaration': ml(
    'Line {line}: declaration not understood ("{text}") — skipped.',
    'Ligne {line} : déclaration non comprise (« {text} ») — ignorée.',
    'Zeile {line}: Deklaration nicht verstanden („{text}“) — übersprungen.'
  ),
  's7awl.udt-missing': ml(
    'Member "{member}": UDT "{udt}" is not part of the ingested sources — skipped.',
    'Membre « {member} » : l’UDT « {udt} » ne fait pas partie des sources importées — ignoré.',
    'Member „{member}“: UDT „{udt}“ gehört nicht zu den importierten Quellen — übersprungen.'
  ),
  's7awl.udt-recursive': ml(
    'Member "{member}": recursive UDT "{udt}" — skipped.',
    'Membre « {member} » : UDT récursif « {udt} » — ignoré.',
    'Member „{member}“: rekursiver UDT „{udt}“ — übersprungen.'
  ),
  's7awl.instance-type-missing': ml(
    'DB{number}: declared from "{type}", which is not part of the ingested sources — no signal catalogued.',
    'DB{number} : déclaré à partir de « {type} », qui ne fait pas partie des sources importées — aucun signal catalogué.',
    'DB{number}: aus „{type}“ deklariert, das nicht zu den importierten Quellen gehört — kein Signal katalogisiert.'
  ),
  's7awl.array-skipped': ml(
    'Member "{path}": array datatypes are not imported — skipped.',
    'Membre « {path} » : les types tableau ne sont pas importés — ignoré.',
    'Member „{path}“: Array-Datentypen werden nicht importiert — übersprungen.'
  ),
  's7awl.empty-block': ml(
    'DB{number} (line {line}) declares no member — skipped.',
    'DB{number} (ligne {line}) ne déclare aucun membre — ignoré.',
    'DB{number} (Zeile {line}) deklariert kein Member — übersprungen.'
  ),
  's7awl.datatype-unmapped': ml(
    'Member "{path}": datatype "{type}" is not mapped — bound as String.',
    'Membre « {path} » : type « {type} » non mappé — lié en String.',
    'Member „{path}“: Datentyp „{type}“ nicht zugeordnet — als String gebunden.'
  ),
  's7awl.no-offset': ml(
    'Member "{path}": no byte offset could be computed — catalogued without an address.',
    'Membre « {path} » : aucun offset d’octet n’a pu être calculé — catalogué sans adresse.',
    'Member „{path}“: kein Byte-Offset berechenbar — ohne Adresse katalogisiert.'
  ),
  's7awl.standard-layout': ml(
    'Addresses are computed for the STANDARD (non-optimized) block layout — the only one an S7-300/400 has. If a block was compiled "optimized" (S7-1200/1500), it has no byte offsets and these addresses do not apply: browse it through the S7Plus driver instead.',
    'Les adresses sont calculées pour la structure de bloc STANDARD (non optimisée) — la seule que possède un S7-300/400. Si un bloc a été compilé « optimisé » (S7-1200/1500), il n’a aucun offset d’octet et ces adresses ne s’appliquent pas : le parcourir via le pilote S7Plus à la place.',
    'Die Adressen werden für den STANDARD-Bausteinaufbau (nicht optimiert) berechnet — den einzigen, den eine S7-300/400 hat. Wurde ein Baustein „optimiert“ übersetzt (S7-1200/1500), hat er keine Byte-Offsets und diese Adressen gelten nicht: dann über den S7Plus-Treiber durchlaufen.'
  ),

  // --- classic S7: the online cross-check ----------------------------------------
  's7browse.db-absent': ml(
    '⚠️ {n} data block(s) this catalog addresses are NOT in the CPU ({names}{more}) — every signal built from them will fail to bind. The source is newer than the PLC, or the export came from another station.',
    '⚠️ {n} bloc(s) de données adressés par ce catalogue sont ABSENTS de la CPU ({names}{more}) — tout signal construit à partir d’eux ne se liera pas. La source est plus récente que l’automate, ou l’export vient d’une autre station.',
    '⚠️ {n} von diesem Katalog adressierte Datenbaustein(e) sind NICHT in der CPU ({names}{more}) — jedes daraus gebaute Signal wird sich nicht binden. Die Quelle ist neuer als die SPS, oder der Export stammt von einer anderen Station.'
  ),
  's7browse.db-overrun': ml(
    '⚠️ {n} data block(s) are SHORTER in the CPU than this catalog reads ({names}{more}) — the block was reduced since the source was generated. The addresses below the cut still work, which is what makes this hard to notice.',
    '⚠️ {n} bloc(s) de données sont PLUS COURTS dans la CPU que ce que lit ce catalogue ({names}{more}) — le bloc a été réduit depuis la génération de la source. Les adresses situées avant la coupure fonctionnent toujours, ce qui rend le problème difficile à repérer.',
    '⚠️ {n} Datenbaustein(e) sind in der CPU KÜRZER als dieser Katalog liest ({names}{more}) — der Baustein wurde seit der Quellenerzeugung verkleinert. Die Adressen unterhalb des Schnitts funktionieren weiterhin, was das Problem schwer erkennbar macht.'
  ),
  's7browse.db-unknown': ml(
    '{n} data block(s) could not be described by the CPU ({names}{more}) — protected or unreadable. Nothing is concluded about them: this is “not asked”, not “not there”.',
    '{n} bloc(s) de données n’ont pas pu être décrits par la CPU ({names}{more}) — protégés ou illisibles. Rien n’en est conclu : c’est « non demandé », pas « absent ».',
    '{n} Datenbaustein(e) konnten von der CPU nicht beschrieben werden ({names}{more}) — geschützt oder nicht lesbar. Daraus wird nichts geschlossen: das heißt „nicht gefragt“, nicht „nicht vorhanden“.'
  ),
  's7browse.db-uncatalogued': ml(
    '{n} data block(s) present in the CPU are addressed nowhere in this catalog ({names}{more}). Not an error — but it is the only way to find out that an export left something behind.',
    '{n} bloc(s) de données présents dans la CPU ne sont adressés nulle part dans ce catalogue ({names}{more}). Ce n’est pas une erreur — mais c’est le seul moyen de découvrir qu’un export a laissé quelque chose de côté.',
    '{n} in der CPU vorhandene Datenbaustein(e) werden in diesem Katalog nirgends adressiert ({names}{more}). Kein Fehler — aber der einzige Weg zu erkennen, dass ein Export etwas ausgelassen hat.'
  ),
  's7browse.no-db-addressed': ml(
    'This catalog addresses no data block, so the inventory can only confirm the CPU identity ({cpu}) and its {n} block(s). Memory-area signals (inputs, outputs, flags) are not verifiable online: the CPU reports blocks, never a symbol.',
    'Ce catalogue n’adresse aucun bloc de données : l’inventaire ne peut donc que confirmer l’identité de la CPU ({cpu}) et ses {n} bloc(s). Les signaux des zones mémoire (entrées, sorties, mémentos) ne sont pas vérifiables en ligne : la CPU rend compte de blocs, jamais d’un symbole.',
    'Dieser Katalog adressiert keinen Datenbaustein, daher kann das Inventar nur die CPU-Identität ({cpu}) und ihre {n} Baustein(e) bestätigen. Signale der Speicherbereiche (Eingänge, Ausgänge, Merker) sind online nicht überprüfbar: die CPU meldet Bausteine, nie ein Symbol.'
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
