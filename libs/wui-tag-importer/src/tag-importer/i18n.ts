// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Tag Importer page (EN / FR / DE), following the
 * shared `lit-translate` singleton. `localizeDir(...)` in templates (reactive),
 * `localize(...)` for plain-string attributes.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

export const MSG = {
  title: ml('Tag Importer', 'Importateur de tags', 'Tag-Import'),
  subtitle: ml(
    'Import device tags into datapoint types and datapoints',
    'Importer des tags dans des types de datapoints et des datapoints',
    'Gerätetags in Datenpunkttypen und Datenpunkte importieren'
  ),
  steps: {
    driver: ml('Driver', 'Driver', 'Treiber'),
    connection: ml('Connection', 'Connexion', 'Verbindung'),
    source: ml('Source', 'Source', 'Quelle'),
    select: ml('Select', 'Sélection', 'Auswahl'),
    review: ml('Review', 'Revue', 'Prüfung'),
    apply: ml('Apply', 'Application', 'Anwenden')
  },
  driver: {
    choose: ml('Choose the driver to import from', 'Choisissez le driver source', 'Wählen Sie den Quell-Treiber'),
    opcua: ml('OPC UA', 'OPC UA', 'OPC UA'),
    opcuaHint: ml(
      'Import tags from OPC UA — a NodeSet2 file or a live server.',
      'Importer des tags depuis OPC UA — un fichier NodeSet2 ou un serveur live.',
      'Tags aus OPC UA importieren — eine NodeSet2-Datei oder ein Live-Server.'
    ),
    soon: ml('Other protocols — coming soon', 'Autres protocoles — à venir', 'Weitere Protokolle — folgen')
  },
  connection: {
    title: ml('OPC UA connection', 'Connexion OPC UA', 'OPC UA-Verbindung'),
    useExisting: ml('Use an existing connection', 'Utiliser une connexion existante', 'Vorhandene Verbindung verwenden'),
    createNew: ml('Create a new connection', 'Créer une nouvelle connexion', 'Neue Verbindung erstellen'),
    name: ml('Name (optional)', 'Nom (optionnel)', 'Name (optional)'),
    endpoint: ml('Endpoint URL', 'URL du endpoint', 'Endpoint-URL'),
    security: ml('Security policy', 'Politique de sécurité', 'Sicherheitsrichtlinie'),
    mode: ml('Message mode', 'Mode de message', 'Nachrichtenmodus'),
    driver: ml('Driver number', 'Numéro de driver', 'Treibernummer'),
    driverHint: ml('OPC UA client driver (-num). Auto-detected; change if needed.', 'Driver client OPC UA (-num). Détecté automatiquement ; modifiable.', 'OPC UA-Client-Treiber (-num). Automatisch erkannt; änderbar.'),
    noDriver: ml(
      'No OPC UA driver is running — start a WCCOAopcua driver before creating a connection.',
      'Aucun driver OPC UA en cours — démarrez un driver WCCOAopcua avant de créer une connexion.',
      'Kein OPC UA-Treiber läuft — starten Sie einen WCCOAopcua-Treiber, bevor Sie eine Verbindung erstellen.'
    ),
    user: ml('User (optional)', 'Utilisateur (optionnel)', 'Benutzer (optional)'),
    password: ml('Password', 'Mot de passe', 'Passwort'),
    create: ml('Create and continue', 'Créer et continuer', 'Erstellen und fortfahren'),
    creating: ml('Creating connection…', 'Création de la connexion…', 'Verbindung wird erstellt…'),
    continue: ml('Continue', 'Continuer', 'Weiter'),
    edit: ml('Edit', 'Éditer', 'Bearbeiten'),
    editing: ml('Editing connection', 'Édition de la connexion', 'Verbindung bearbeiten'),
    save: ml('Save and continue', 'Enregistrer et continuer', 'Speichern und fortfahren'),
    saving: ml('Saving…', 'Enregistrement…', 'Speichern…'),
    passwordKeep: ml('Password (leave blank to keep unchanged)', 'Mot de passe (laisser vide pour conserver)', 'Passwort (leer lassen, um es beizubehalten)'),
    createError: ml('Could not create the connection.', 'Impossible de créer la connexion.', 'Verbindung konnte nicht erstellt werden.'),
    updateError: ml('Could not update the connection.', 'Impossible de mettre à jour la connexion.', 'Verbindung konnte nicht aktualisiert werden.'),
    readError: ml('Could not read the connection configuration.', 'Impossible de lire la configuration de la connexion.', 'Verbindungskonfiguration konnte nicht gelesen werden.'),
    endpointRequired: ml('An endpoint URL is required.', 'Une URL de endpoint est requise.', 'Eine Endpoint-URL ist erforderlich.')
  },
  bind: {
    label: ml('Write OPC UA address configs', 'Écrire les configurations d’adresse OPC UA', 'OPC UA-Adresskonfigurationen schreiben'),
    nodesetNsWarn: ml(
      'NodeSet namespace indices may differ from the live server — verify the NodeIds before relying on the bindings.',
      'Les index de namespace du NodeSet peuvent différer du serveur live — vérifiez les NodeIds avant de vous fier aux liaisons.',
      'Die Namespace-Indizes des NodeSets können vom Live-Server abweichen — prüfen Sie die NodeIds.'
    )
  },
  source: {
    protocol: ml('Protocol', 'Protocole', 'Protokoll'),
    opcua: ml('OPC UA', 'OPC UA', 'OPC UA'),
    mode: ml('Import from', 'Importer depuis', 'Importieren aus'),
    fromFile: ml('NodeSet2 XML file', 'Fichier XML NodeSet2', 'NodeSet2-XML-Datei'),
    fromFileHint: ml(
      'Offline import from a standard OPC UA NodeSet2 file. Repeated instances of a type are mutualised into one datapoint type.',
      'Import hors ligne depuis un fichier OPC UA NodeSet2 standard. Les instances répétées d’un type sont mutualisées en un seul type de datapoint.',
      'Offline-Import aus einer OPC UA-NodeSet2-Standarddatei. Wiederholte Instanzen eines Typs werden zu einem Datenpunkttyp zusammengefasst.'
    ),
    fromServer: ml('Live OPC UA server', 'Serveur OPC UA en ligne', 'Aktiver OPC UA-Server'),
    fromServerHint: ml(
      'Browse a connected server and build a datapoint type from a selected instance; the address configs are written too.',
      'Parcourir un serveur connecté et construire un type de datapoint depuis une instance sélectionnée ; les configurations d’adresse sont écrites également.',
      'Einen verbundenen Server durchsuchen und aus einer ausgewählten Instanz einen Datenpunkttyp erstellen; die Adresskonfigurationen werden ebenfalls geschrieben.'
    )
  },
  file: {
    drop: ml('Drop a NodeSet2 .xml here or click to browse', 'Déposez un .xml NodeSet2 ici ou cliquez', 'NodeSet2-.xml hier ablegen oder klicken'),
    hint: ml('.xml files only (UANodeSet)', 'Fichiers .xml uniquement (UANodeSet)', 'Nur .xml-Dateien (UANodeSet)'),
    parsing: ml('Parsing…', 'Analyse…', 'Analysieren…'),
    parseError: ml('Could not parse this file as an OPC UA NodeSet2 document.', 'Impossible d’analyser ce fichier comme un document OPC UA NodeSet2.', 'Diese Datei konnte nicht als OPC UA-NodeSet2-Dokument analysiert werden.'),
    typesFound: ml('object types', 'types d’objets', 'Objekttypen'),
    instancesFound: ml('instances', 'instances', 'Instanzen')
  },
  online: {
    connection: ml('Connection', 'Connexion', 'Verbindung'),
    noConnections: ml(
      'No OPC UA connection found. Create one in the OPC UA client configuration first.',
      'Aucune connexion OPC UA trouvée. Créez-en une dans la configuration du client OPC UA.',
      'Keine OPC UA-Verbindung gefunden. Erstellen Sie zuerst eine in der OPC UA-Client-Konfiguration.'
    ),
    connected: ml('connected', 'connectée', 'verbunden'),
    disconnected: ml('disconnected', 'déconnectée', 'getrennt'),
    browse: ml('Browse', 'Parcourir', 'Durchsuchen'),
    browsing: ml('Browsing…', 'Parcours…', 'Durchsuchen…'),
    pickInstance: ml(
      'Select one or more instances (tick the nodes) to model as datapoint types',
      'Sélectionnez une ou plusieurs instances (cochez les nœuds) à modéliser en types de datapoint',
      'Wählen Sie eine oder mehrere Instanzen (Knoten ankreuzen) als Datenpunkttypen'
    ),
    selected: ml('selected', 'sélectionné(s)', 'ausgewählt'),
    assembly: ml('Assembly', 'Assemblage', 'Zusammensetzung'),
    perNode: ml('Flat — one datapoint per node', 'À plat — un datapoint par nœud', 'Flach — ein Datenpunkt pro Knoten'),
    grouped: ml('Sub-levels — one datapoint, nodes nested', 'Sous-niveaux — un datapoint, nœuds imbriqués', 'Unterebenen — ein Datenpunkt, Knoten verschachtelt'),
    groupName: ml('Datapoint / type name', 'Nom du datapoint / type', 'Datenpunkt-/Typname'),
    childName: ml('Sub-element name', 'Nom du sous-élément', 'Name des Unterelements'),
    browseError: ml('Browsing the server failed.', 'Le parcours du serveur a échoué.', 'Das Durchsuchen des Servers ist fehlgeschlagen.')
  },
  options: {
    title: ml('Options', 'Options', 'Optionen'),
    prefix: ml('Datapoint-type name prefix', 'Préfixe des noms de type', 'Präfix für Typnamen'),
    prefixHint: ml('Prepended to every generated type name to avoid collisions.', 'Ajouté devant chaque nom de type généré pour éviter les collisions.', 'Wird jedem generierten Typnamen vorangestellt, um Kollisionen zu vermeiden.'),
    hybrid: ml('Share nested types (typeref)', 'Mutualiser les types imbriqués (typeref)', 'Verschachtelte Typen teilen (Typeref)'),
    hybridHint: ml(
      'A nested type used by two or more parents becomes its own datapoint type referenced by DPT_TYPEREF; one-off nesting is flattened. Turn off to always flatten.',
      'Un type imbriqué utilisé par au moins deux parents devient un type de datapoint propre référencé par DPT_TYPEREF ; l’imbrication ponctuelle est aplatie. Désactivez pour toujours aplatir.',
      'Ein von mindestens zwei Eltern verwendeter verschachtelter Typ wird zu einem eigenen, per DPT_TYPEREF referenzierten Datenpunkttyp; einmalige Verschachtelung wird abgeflacht. Ausschalten, um immer abzuflachen.'
    )
  },
  review: {
    types: ml('Datapoint types', 'Types de datapoints', 'Datenpunkttypen'),
    dps: ml('Datapoints', 'Datapoints', 'Datenpunkte'),
    addresses: ml('Address configs', 'Configurations d’adresse', 'Adresskonfigurationen'),
    colName: ml('Name', 'Nom', 'Name'),
    colType: ml('Type', 'Type', 'Typ'),
    colDpe: ml('Element', 'Élément', 'Element'),
    colNode: ml('NodeId', 'NodeId', 'NodeId'),
    exists: ml('exists', 'existe', 'vorhanden'),
    willCreate: ml('will create', 'sera créé', 'wird angelegt'),
    flatten: ml('Flatten', 'Aplatir', 'Abflachen'),
    keepRef: ml('Keep as reference', 'Garder en référence', 'Als Referenz behalten'),
    empty: ml('Nothing to import yet — pick a source.', 'Rien à importer — choisissez une source.', 'Noch nichts zu importieren — wählen Sie eine Quelle.'),
    createNew: ml('Create new', 'Créer nouveau', 'Neu erstellen'),
    mapTo: ml('Map to datapoint type', 'Associer au type de datapoint', 'Auf Datenpunkttyp abbilden'),
    extendType: ml('Extend the type if elements are missing', 'Étendre le type si des éléments manquent', 'Typ erweitern, wenn Elemente fehlen'),
    colDir: ml('Direction', 'Direction', 'Richtung'),
    dirIn: ml('IN', 'IN', 'IN'),
    dirIo: ml('IN/OUT', 'IN/OUT', 'IN/OUT'),
    filter: ml('Filter elements…', 'Filtrer les éléments…', 'Elemente filtern…'),
    checkFiltered: ml('Check filtered', 'Cocher les filtrés', 'Gefilterte markieren'),
    uncheckAll: ml('Uncheck all', 'Tout décocher', 'Alle abwählen'),
    setIn: ml('Set IN', 'Passer en IN', 'Auf IN setzen'),
    setIo: ml('Set IN/OUT', 'Passer en IN/OUT', 'Auf IN/OUT setzen')
  },
  summary: {
    typesNew: ml('new types', 'nouveaux types', 'neue Typen'),
    typesExisting: ml('existing types (skipped)', 'types existants (ignorés)', 'vorhandene Typen (übersprungen)'),
    dpsNew: ml('new datapoints', 'nouveaux datapoints', 'neue Datenpunkte'),
    dpsExisting: ml('existing datapoints (skipped)', 'datapoints existants (ignorés)', 'vorhandene Datenpunkte (übersprungen)'),
    addresses: ml('address configs', 'configs d’adresse', 'Adresskonfigurationen'),
    warnings: ml('warnings', 'avertissements', 'Warnungen')
  },
  actions: {
    back: ml('Back', 'Retour', 'Zurück'),
    next: ml('Next', 'Suivant', 'Weiter'),
    dryRun: ml('Preview (dry-run)', 'Aperçu (simulation)', 'Vorschau (Testlauf)'),
    apply: ml('Create in project', 'Créer dans le projet', 'Im Projekt anlegen'),
    applying: ml('Creating…', 'Création…', 'Anlegen…'),
    reset: ml('Start over', 'Recommencer', 'Neu beginnen')
  },
  result: {
    title: ml('Import result', 'Résultat de l’import', 'Importergebnis'),
    created: ml('created', 'créé', 'angelegt'),
    skipped: ml('skipped', 'ignoré', 'übersprungen'),
    failed: ml('failed', 'échoué', 'fehlgeschlagen'),
    allOk: ml('Import completed successfully.', 'Import terminé avec succès.', 'Import erfolgreich abgeschlossen.'),
    someFailed: ml('Import completed with errors.', 'Import terminé avec des erreurs.', 'Import mit Fehlern abgeschlossen.')
  },
  confirm: {
    apply: ml(
      'Create these datapoint types, datapoints and address configs in the project?',
      'Créer ces types de datapoints, datapoints et configurations d’adresse dans le projet ?',
      'Diese Datenpunkttypen, Datenpunkte und Adresskonfigurationen im Projekt anlegen?'
    ),
    yes: ml('Yes, create', 'Oui, créer', 'Ja, anlegen'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen')
  },
  common: {
    forbidden: ml('You lack the permission for this action.', 'Permission manquante pour cette action.', 'Fehlende Berechtigung für diese Aktion.')
  }
} as const;

/** Confirm prompt naming the counts about to be written. */
export function confirmApplyMsg(typesNew: number, dpsNew: number, addresses: number): string {
  return localize(
    ml(
      `Create ${typesNew} datapoint type(s), ${dpsNew} datapoint(s) and ${addresses} address config(s) in the project?`,
      `Créer ${typesNew} type(s) de datapoint, ${dpsNew} datapoint(s) et ${addresses} configuration(s) d’adresse dans le projet ?`,
      `${typesNew} Datenpunkttyp(en), ${dpsNew} Datenpunkt(e) und ${addresses} Adresskonfiguration(en) im Projekt anlegen?`
    )
  );
}
