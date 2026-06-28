// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable sonarjs/no-duplicate-string -- a translation catalog repeats short field/column labels (e.g. "Type", "Status") across UI areas by design */

/**
 * Internationalisation for the PARA (datapoint parametrization) page.
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

/** Shared labels reused across several UI areas (hoisted to satisfy no-duplicate-string). */
const SHARED = {
  cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
  delete: ml('Delete', 'Supprimer', 'Löschen'),
  type: ml('Type', 'Type', 'Typ'),
  status: ml('Status', 'Statut', 'Status'),
  element: ml('Element', 'Élément', 'Element'),
  loading: ml('Loading…', 'Chargement…', 'Wird geladen…'),
  noValueElements: ml(
    'No value-bearing elements under this selection.',
    'Aucun élément à valeur sous cette sélection.',
    'Keine wertführenden Elemente unter dieser Auswahl.'
  ),
  unknownDpType: ml(
    'Unknown datapoint type — re-select the element in the tree.',
    "Type du datapoint inconnu — re-sélectionnez l'élément dans l'arbre.",
    'Unbekannter Datenpunkttyp — wählen Sie das Element im Baum erneut aus.'
  )
} as const;

/** Static UI strings, grouped by area. */
export const MSG = {
  shared: SHARED,
  page: {
    tabModel: ml('Model (types)', 'Modèle (Types)', 'Modell (Typen)'),
    tabInstances: ml('Instances & values', 'Instances & valeurs', 'Instanzen & Werte'),
    tabArchive: ml('Archiving', 'Archivage', 'Archivierung'),
    tabAlarm: ml('Alarming', 'Alarming', 'Alarmierung'),
    importDpl: ml('Import DPL', 'Import DPL', 'DPL importieren'),
    exportDpl: ml('Export DPL', 'Export DPL', 'DPL exportieren'),
    exportTitle: ml(
      'Export the selection ticked in the instances tree',
      "Exporter la sélection cochée dans l'arbre des instances",
      'Die im Instanzenbaum markierte Auswahl exportieren'
    ),
    ctxModelNone: ml(
      '« Model » tab (DP-Type definition). No type selected.',
      'Onglet « Modèle » (définition de DP-Types). Aucun type sélectionné.',
      '„Modell“-Tab (DP-Typ-Definition). Kein Typ ausgewählt.'
    ),
    ctxInstances: ml(
      '« Instances & values » tab.',
      'Onglet « Instances & valeurs ».',
      '„Instanzen & Werte“-Tab.'
    )
  },
  typeEditor: {
    newType: ml('New type', 'Nouveau type', 'Neuer Typ'),
    filterTypes: ml('Filter types…', 'Filtrer les types…', 'Typen filtern…'),
    loadingTypes: ml('Loading types…', 'Chargement des types…', 'Typen werden geladen…'),
    noType: ml('No type.', 'Aucun type.', 'Kein Typ.'),
    selectOrCreate: ml(
      'Select a type on the left to edit it, or create a new one to define a model.',
      "Sélectionnez un type à gauche pour l'éditer, ou créez-en un nouveau pour définir un modèle.",
      'Wählen Sie links einen Typ zum Bearbeiten aus oder erstellen Sie einen neuen, um ein Modell zu definieren.'
    ),
    loadingType: ml('Loading type…', 'Chargement du type…', 'Typ wird geladen…'),
    addElement: ml('Add an element', 'Ajouter un élément', 'Element hinzufügen'),
    addSubstruct: ml('Add a sub-structure', 'Ajouter une sous-structure', 'Unterstruktur hinzufügen'),
    scalarRootRef: ml('referenced type', 'type référencé', 'referenzierter Typ'),
    refLabel: ml('Referenced type', 'Type référencé', 'Referenzierter Typ'),
    typeNameLabel: ml('Type name', 'Nom du type', 'Typname'),
    typeNamePlaceholder: ml('MyType', 'MonType', 'MeinTyp'),
    root: ml('Root', 'Racine', 'Wurzel'),
    deleteType: ml('Delete the type', 'Supprimer le type', 'Typ löschen'),
    createType: ml('Create the type', 'Créer le type', 'Typ erstellen'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    namePlaceholder: ml('name', 'nom', 'Name'),
    deleteHead: ml('Delete the type', 'Supprimer le type', 'Typ löschen'),
    proposalLoaded: ml(
      'Proposal loaded — review then save to apply it.',
      "Proposition chargée — relisez puis enregistrez pour l'appliquer.",
      'Vorschlag geladen — prüfen Sie ihn und speichern Sie zum Anwenden.'
    ),
    typeNameRequired: ml('The type name is required.', 'Le nom du type est requis.', 'Der Typname ist erforderlich.'),
    emptyStructure: ml('Empty structure.', 'Structure vide.', 'Leere Struktur.'),
    rootTyperefRef: ml(
      'The Typeref root must reference a type.',
      'La racine Typeref doit référencer un type.',
      'Die Typeref-Wurzel muss einen Typ referenzieren.'
    ),
    rootStructNeedsChild: ml(
      'A Struct root must have at least one element (or choose a scalar type for the root).',
      'Une racine Struct doit avoir au moins un élément (ou choisissez un type scalaire pour la racine).',
      'Eine Struct-Wurzel muss mindestens ein Element haben (oder wählen Sie einen skalaren Typ für die Wurzel).'
    ),
    elementNeedsName: ml(
      'Each element must have a name.',
      'Chaque élément doit avoir un nom.',
      'Jedes Element muss einen Namen haben.'
    )
  },
  nav: {
    reload: ml('Reload', 'Reload', 'Neu laden'),
    filterTypes: ml('Filter types…', 'Filter types…', 'Typen filtern…'),
    showInternal: ml('Show internal datapoints', 'Show internal datapoints', 'Interne Datenpunkte anzeigen'),
    deselectAll: ml('Deselect all', 'Tout décocher', 'Alle abwählen'),
    loading: ml('Loading…', 'Loading…', 'Wird geladen…'),
    noMatch: ml('No datapoint types match.', 'No datapoint types match.', 'Keine passenden Datenpunkttypen.'),
    selectForExport: ml('Select for DPL export', 'Select for DPL export', 'Für DPL-Export auswählen'),
    createDp: ml('Create datapoint', 'Create datapoint', 'Datenpunkt erstellen'),
    renameDp: ml('Rename datapoint', 'Rename datapoint', 'Datenpunkt umbenennen'),
    deleteDp: ml('Delete datapoint', 'Delete datapoint', 'Datenpunkt löschen'),
    dataType: ml('Data type', 'Data type', 'Datentyp'),
    // Config badge tooltips (also reused as the meaning of the badge).
    cfgAlertHdl: ml('Alarm handling', 'Alarm handling', 'Alarmbearbeitung'),
    cfgArchive: ml('Archiving', 'Archiving', 'Archivierung'),
    cfgAddress: ml('Peripheral address', 'Peripheral address', 'Peripherieadresse'),
    cfgPvRange: ml('Value range', 'Value range', 'Wertebereich'),
    cfgSmooth: ml('Smoothing', 'Smoothing', 'Glättung'),
    cfgDpFct: ml('DP function', 'DP function', 'DP-Funktion'),
    cfgMsgConv: ml('Message conversion', 'Message conversion', 'Nachrichtenkonvertierung')
  },
  detail: {
    selectToView: ml(
      'Select a datapoint type, datapoint, or element to view and edit its values.',
      'Select a datapoint type, datapoint, or element to view and edit its values.',
      'Wählen Sie einen Datenpunkttyp, Datenpunkt oder ein Element, um seine Werte anzuzeigen und zu bearbeiten.'
    ),
    typePrefix: ml('Type', 'Type', 'Typ'),
    loadingValues: ml('Loading values…', 'Loading values…', 'Werte werden geladen…'),
    noValueElements: ml(
      'No value-bearing elements found for this selection.',
      'No value-bearing elements found for this selection.',
      'Keine wertführenden Elemente für diese Auswahl gefunden.'
    ),
    colElement: ml('Element', 'Element', 'Element'),
    colType: ml('Type', 'Type', 'Typ'),
    colSourceTime: ml('Source time', 'Source time', 'Quellzeit'),
    colValue: ml('Value', 'Value', 'Wert'),
    colUnit: ml('Unit', 'Unit', 'Einheit'),
    colDescription: ml('Description', 'Description', 'Beschreibung'),
    hideConfig: ml('Hide config attributes', 'Hide config attributes', 'Konfigurationsattribute ausblenden'),
    showConfig: ml('Show config attributes', 'Show config attributes', 'Konfigurationsattribute anzeigen'),
    showOriginalOnline: ml(
      'Show _original / _online config attributes',
      'Show _original / _online config attributes',
      '_original / _online Konfigurationsattribute anzeigen'
    ),
    onePerLinePre: ml('one', 'one', 'ein'),
    onePerLinePost: ml('item per line', 'item per line', 'Eintrag pro Zeile'),
    writeValue: ml('Write value to datapoint', 'Write value to datapoint', 'Wert in Datenpunkt schreiben'),
    liveUnavailable: ml(
      'Some live values are unavailable.',
      'Certaines valeurs en direct sont indisponibles.',
      'Einige Live-Werte sind nicht verfügbar.'
    )
  },
  configDetail: {
    head: ml('Config attributes', 'Config attributes', 'Konfigurationsattribute'),
    reload: ml('Reload config attributes', 'Reload config attributes', 'Konfigurationsattribute neu laden'),
    reading: ml('Reading config attributes…', 'Reading config attributes…', 'Konfigurationsattribute werden gelesen…'),
    noConfigs: ml(
      'No configs found for this element.',
      'No configs found for this element.',
      'Keine Konfigurationen für dieses Element gefunden.'
    ),
    infoBits: ml('Info bits', 'Info bits', 'Info-Bits'),
    set: ml('set', 'set', 'gesetzt'),
    userBits: ml('User bits', 'User bits', 'Benutzer-Bits'),
    noneSet: ml('none set', 'none set', 'keine gesetzt'),
    userBitPrefix: ml('User bit', 'User bit', 'Benutzer-Bit'),
    onePerLine: ml('one item per line', 'one item per line', 'ein Eintrag pro Zeile')
  },
  dpDialog: {
    deleteConfirmPre: ml('Delete datapoint', 'Delete datapoint', 'Datenpunkt löschen'),
    cannotUndo: ml('This cannot be undone.', 'This cannot be undone.', 'Dies kann nicht rückgängig gemacht werden.'),
    typePrefix: ml('Type', 'Type', 'Typ'),
    newDpName: ml('New datapoint name', 'New datapoint name', 'Neuer Datenpunktname'),
    dpName: ml('Datapoint name', 'Datapoint name', 'Datenpunktname'),
    dpNamePlaceholder: ml('MyDatapoint', 'MyDatapoint', 'MeinDatenpunkt'),
    deleteTitle: ml('Delete datapoint', 'Delete datapoint', 'Datenpunkt löschen'),
    renameTitle: ml('Rename datapoint', 'Rename datapoint', 'Datenpunkt umbenennen'),
    createTitle: ml('Create datapoint', 'Create datapoint', 'Datenpunkt erstellen'),
    delete: ml('Delete', 'Delete', 'Löschen'),
    rename: ml('Rename', 'Rename', 'Umbenennen'),
    create: ml('Create', 'Create', 'Erstellen'),
    cancel: ml('Cancel', 'Cancel', 'Abbrechen'),
    nameRequired: ml('A datapoint name is required', 'A datapoint name is required', 'Ein Datenpunktname ist erforderlich'),
    nameMustDiffer: ml(
      'The new name must differ from the current name',
      'The new name must differ from the current name',
      'Der neue Name muss sich vom aktuellen Namen unterscheiden'
    )
  },
  dplDialog: {
    title: ml('Export DPL — content', 'Export DPL — contenu', 'DPL-Export — Inhalt'),
    summaryPre: ml('Selection:', 'Sélection :', 'Auswahl:'),
    summaryTypes: ml('type(s)', 'type(s)', 'Typ(en)'),
    summaryDps: ml('datapoint(s)', 'datapoint(s)', 'Datenpunkt(e)'),
    pickOne: ml(
      'Tick at least one category.',
      'Cochez au moins une catégorie.',
      'Markieren Sie mindestens eine Kategorie.'
    ),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    export: ml('Export', 'Exporter', 'Exportieren'),
    fT: ml('Types (definitions)', 'Types (définitions)', 'Typen (Definitionen)'),
    fTHint: ml('DP-Type definitions', 'Définitions des DP-Types', 'DP-Typ-Definitionen'),
    fD: ml('Datapoints (instances)', 'Datapoints (instances)', 'Datenpunkte (Instanzen)'),
    fDHint: ml('The list of datapoints', 'La liste des datapoints', 'Die Liste der Datenpunkte'),
    fP: ml('Parametrization / configs', 'Parametrization / configs', 'Parametrierung / Konfigurationen'),
    fPHint: ml(
      'All configs (incl. _common, _pv_range, _alert_hdl…)',
      'Tous les configs (incl. _common, _pv_range, _alert_hdl…)',
      'Alle Konfigurationen (inkl. _common, _pv_range, _alert_hdl…)'
    ),
    fO: ml('Original values', 'Original values', 'Originalwerte'),
    fOHint: ml('Current values (_original.._value)', 'Valeurs courantes (_original.._value)', 'Aktuelle Werte (_original.._value)'),
    fA: ml('Aliases & comments', 'Aliases & commentaires', 'Aliase & Kommentare'),
    fAHint: ml('Aliases and comments of DP/DPE', 'Alias et commentaires des DP/DPE', 'Aliase und Kommentare der DP/DPE'),
    fC: ml('CNS views', 'CNS views', 'CNS-Ansichten'),
    fCHint: ml('CNS views/trees', 'Vues/arbres CNS', 'CNS-Ansichten/-Bäume'),
    fH: ml('Config timestamps', 'Timestamps des configs', 'Konfig-Zeitstempel'),
    fHHint: ml('Timestamps on configs (modifies P)', 'Horodatages sur les configs (modifie P)', 'Zeitstempel auf Konfigurationen (ändert P)')
  },
  archive: {
    selectToConfigure: ml(
      'Select a datapoint, element, or type in the tree to configure its archiving.',
      "Sélectionnez un datapoint, un élément ou un type dans l'arbre pour configurer son archivage.",
      'Wählen Sie einen Datenpunkt, ein Element oder einen Typ im Baum, um seine Archivierung zu konfigurieren.'
    ),
    noGroups: ml(
      'No active archive group (type _NGA_Group)',
      "Aucun groupe d'archive actif (type _NGA_Group)",
      'Keine aktive Archivgruppe (Typ _NGA_Group)'
    ),
    colArchiveGroup: ml('Archive group', "Groupe d'archive", 'Archivgruppe'),
    colArchived: ml('Archived', 'Archivé', 'Archiviert'),
    archivingOn: ml('Archiving enabled', 'Archivage activé', 'Archivierung aktiviert'),
    archivingOff: ml('Archiving disabled', 'Archivage désactivé', 'Archivierung deaktiviert')
  },
  alarm: {
    selectToConfigure: ml(
      'Select a datapoint, element, or type in the tree to configure its alarms.',
      "Sélectionnez un datapoint, un élément ou un type dans l'arbre pour configurer ses alarmes.",
      'Wählen Sie einen Datenpunkt, ein Element oder einen Typ im Baum, um seine Alarme zu konfigurieren.'
    ),
    noClasses: ml(
      'No alarm class (_AlertClass) found',
      "Aucune classe d'alarme (_AlertClass) trouvée",
      'Keine Alarmklasse (_AlertClass) gefunden'
    ),
    colAlarmClass: ml('Alarm class', "Classe d'alarme", 'Alarmklasse'),
    colTrigger: ml('Trigger', 'Déclenchement', 'Auslösung'),
    colThresholds: ml('Thresholds', 'Seuils', 'Schwellwerte'),
    notAlarmable: ml('not alarmable', 'non alarmable', 'nicht alarmierbar'),
    analog: ml('analog', 'analogique', 'analog'),
    binary: ml('binary', 'binaire', 'binär'),
    high: ml('High (ASC)', 'Haut (ASC)', 'Hoch (ASC)'),
    low: ml('Low (DESC)', 'Bas (DESC)', 'Niedrig (DESC)'),
    ifTrue: ml('if TRUE', 'si VRAI', 'wenn WAHR'),
    ifFalse: ml('if FALSE', 'si FAUX', 'wenn FALSCH'),
    thresholdsPlaceholder: ml('e.g. 80 or 50,75,90', 'ex. 80 ou 50,75,90', 'z. B. 80 oder 50,75,90'),
    active: ml('active', 'actif', 'aktiv'),
    inactive: ml('inactive', 'inactif', 'inaktiv'),
    apply: ml('Apply', 'Appliquer', 'Anwenden'),
    disable: ml('Disable', 'Désactiver', 'Deaktivieren'),
    pickClass: ml("Choose an alarm class.", "Choisissez une classe d'alarme.", 'Wählen Sie eine Alarmklasse.'),
    thresholdsRequired: ml(
      'threshold(s) required (e.g. 80 or 50,75,90)',
      'seuil(s) requis (ex. 80 ou 50,75,90)',
      'Schwellwert(e) erforderlich (z. B. 80 oder 50,75,90)'
    ),
    alarmConfigured: ml('Alarm configured', 'Alarme configurée', 'Alarm konfiguriert'),
    alarmDisabled: ml('Alarm disabled', 'Alarme désactivée', 'Alarm deaktiviert')
  },
  ai: {
    assistantTitle: ml('AI assistant — PARA modeling', 'Assistant IA — modélisation PARA', 'KI-Assistent — PARA-Modellierung'),
    panelTitle: ml('PARA assistant', 'Assistant PARA', 'PARA-Assistent'),
    clear: ml('Clear the conversation', 'Effacer la conversation', 'Konversation löschen'),
    configure: ml(
      'Configure the AI (provider, model, token)',
      "Configurer l'IA (fournisseur, modèle, token)",
      'KI konfigurieren (Anbieter, Modell, Token)'
    ),
    close: ml('Close', 'Fermer', 'Schließen'),
    thinking: ml('The assistant is thinking…', "L'assistant réfléchit…", 'Der Assistent denkt nach…'),
    composerPlaceholder: ml(
      'Describe the model to create… (Ctrl+Enter to send)',
      'Décrivez le modèle à créer… (Ctrl+Entrée pour envoyer)',
      'Beschreiben Sie das zu erstellende Modell… (Strg+Eingabe zum Senden)'
    ),
    send: ml('Send', 'Envoyer', 'Senden'),
    placeholder: ml(
      'Ask the assistant to propose or adjust a data model. It proposes; you validate in the editor.',
      "Demandez à l'assistant de proposer ou d'ajuster un modèle de données. Il propose ; vous validez dans l'éditeur.",
      'Bitten Sie den Assistenten, ein Datenmodell vorzuschlagen oder anzupassen. Er schlägt vor; Sie bestätigen im Editor.'
    ),
    proposedModel: ml('Proposed model:', 'Modèle proposé :', 'Vorgeschlagenes Modell:'),
    elementOne: ml('element', 'élément', 'Element'),
    elementMany: ml('elements', 'éléments', 'Elemente'),
    applyToEditor: ml("Apply in the editor", "Appliquer dans l'éditeur", 'Im Editor anwenden'),
    emptyAnswer: ml('(empty answer)', '(réponse vide)', '(leere Antwort)')
  },
  // PARA AI starter prompts (rendered as clickable buttons in the empty chat).
  suggestions: {
    s1: ml(
      'Propose a type for a motor: speed (Float), state (Bool), setpoint (Float) and an alarms sub-structure.',
      'Propose un type pour un moteur : vitesse (Float), état (Bool), consigne (Float) et une sous-structure alarmes.',
      'Schlage einen Typ für einen Motor vor: Drehzahl (Float), Zustand (Bool), Sollwert (Float) und eine Alarm-Unterstruktur.'
    ),
    s2: ml(
      'Add a « maintenance » sub-structure (last service Time, hours Float) to the selected type.',
      'Ajoute une sous-structure « maintenance » (dernier entretien Time, heures Float) au type sélectionné.',
      'Füge dem ausgewählten Typ eine Unterstruktur „Wartung“ hinzu (letzte Wartung Time, Stunden Float).'
    ),
    s3: ml(
      'What are the _pv_range, _alert_hdl and _archive configs for on an element?',
      'À quoi servent les configs _pv_range, _alert_hdl et _archive sur un élément ?',
      'Wofür dienen die Konfigurationen _pv_range, _alert_hdl und _archive an einem Element?'
    ),
    s4: ml(
      'How should a pumping station be modeled in WinCC OA DP-Types?',
      'Comment bien modéliser une station de pompage en DP-Types WinCC OA ?',
      'Wie modelliert man eine Pumpstation in WinCC OA DP-Typen am besten?'
    )
  }
} as const;

/** Element-type catalog labels keyed by element-type name (rendered in the type-editor dropdown). */
export const ELEMENT_TYPE_LABEL: Record<string, MultiLangString> = {
  Struct: ml('Struct (sub-structure)', 'Struct (sous-structure)', 'Struct (Unterstruktur)'),
  Typeref: ml('Typeref (reference)', 'Typeref (référence)', 'Typeref (Referenz)')
};

/** Config labels keyed by config name (rendered in the config-attribute panel cards). */
export const CONFIG_LABEL: Record<string, MultiLangString> = {
  _original: ml('Original value', 'Original value', 'Originalwert'),
  _online: ml('Online value', 'Online value', 'Online-Wert'),
  _offline: ml('Offline value', 'Offline value', 'Offline-Wert'),
  _default: ml('Default value', 'Default value', 'Standardwert'),
  _pv_range: ml('Value range', 'Value range', 'Wertebereich'),
  _u_range: ml('User range', 'User range', 'Benutzerbereich'),
  _smooth: ml('Smoothing', 'Smoothing', 'Glättung'),
  _archive: ml('Archiving', 'Archiving', 'Archivierung'),
  _address: ml('Peripheral address', 'Peripheral address', 'Peripherieadresse'),
  _msg_conv: ml('Message conversion', 'Message conversion', 'Nachrichtenkonvertierung'),
  _cmd_conv: ml('Command conversion', 'Command conversion', 'Befehlskonvertierung'),
  _alert_hdl: ml('Alarm handling', 'Alarm handling', 'Alarmbearbeitung'),
  _alert_class: ml('Alert class', 'Alert class', 'Alarmklasse'),
  _corr: ml('Correction', 'Correction', 'Korrektur'),
  _dp_fct: ml('DP function', 'DP function', 'DP-Funktion'),
  _lock: ml('Lock', 'Lock', 'Sperre'),
  _distrib: ml('Driver allocation', 'Driver allocation', 'Treiberzuordnung'),
  _general: ml('Value storage', 'Value storage', 'Wertespeicherung'),
  _auth: ml('Authorization', 'Authorization', 'Berechtigung')
};

/** Config attribute labels keyed by a stable label key (rendered in the config-attribute rows). */
export const ATTR_LABEL: Record<string, MultiLangString> = {
  Value: ml('Value', 'Value', 'Wert'),
  'Source time': ml('Source time', 'Source time', 'Quellzeit'),
  Status: ml('Status', 'Status', 'Status'),
  'User bits': ml('User bits', 'User bits', 'Benutzer-Bits'),
  Manager: ml('Manager', 'Manager', 'Manager'),
  User: ml('User', 'User', 'Benutzer'),
  Authority: ml('Authority', 'Authority', 'Berechtigung'),
  Type: ml('Type', 'Type', 'Typ'),
  'Default value': ml('Default value', 'Default value', 'Standardwert'),
  'Set invalid bit': ml('Set invalid bit', 'Set invalid bit', 'Ungültig-Bit setzen'),
  'Set on range violation': ml('Set on range violation', 'Set on range violation', 'Bei Bereichsverletzung setzen'),
  Min: ml('Min', 'Min', 'Min'),
  Max: ml('Max', 'Max', 'Max'),
  'Include min': ml('Include min', 'Include min', 'Min einschließen'),
  'Include max': ml('Include max', 'Include max', 'Max einschließen'),
  Negate: ml('Negate', 'Negate', 'Negieren'),
  'Ignore invalid': ml('Ignore invalid', 'Ignore invalid', 'Ungültige ignorieren'),
  'Match pattern': ml('Match pattern', 'Match pattern', 'Vergleichsmuster'),
  Procedure: ml('Procedure', 'Procedure', 'Verfahren'),
  Interval: ml('Interval', 'Interval', 'Intervall'),
  Tolerance: ml('Tolerance', 'Tolerance', 'Toleranz'),
  'Phase limit': ml('Phase limit', 'Phase limit', 'Phasengrenze'),
  'Deriv. interval': ml('Deriv. interval', 'Deriv. interval', 'Ableitungsintervall'),
  'Tolerance 1': ml('Tolerance 1', 'Tolerance 1', 'Toleranz 1'),
  'Tolerance 2': ml('Tolerance 2', 'Tolerance 2', 'Toleranz 2'),
  'Flicker interval': ml('Flicker interval', 'Flicker interval', 'Flatterintervall'),
  'Compare old/new': ml('Compare old/new', 'Compare old/new', 'Alt/Neu vergleichen'),
  Reference: ml('Reference', 'Reference', 'Referenz'),
  Driver: ml('Driver', 'Driver', 'Treiber'),
  Direction: ml('Direction', 'Direction', 'Richtung'),
  Transformation: ml('Transformation', 'Transformation', 'Transformation'),
  Active: ml('Active', 'Active', 'Aktiv'),
  Lowlevel: ml('Lowlevel', 'Lowlevel', 'Lowlevel'),
  Subindex: ml('Subindex', 'Subindex', 'Subindex'),
  'Poll group': ml('Poll group', 'Poll group', 'Abfragegruppe'),
  Priority: ml('Priority', 'Priority', 'Priorität'),
  Text: ml('Text', 'Text', 'Text'),
  Locked: ml('Locked', 'Locked', 'Gesperrt'),
  'Manager id': ml('Manager id', 'Manager id', 'Manager-ID'),
  'User id': ml('User id', 'User id', 'Benutzer-ID'),
  Function: ml('Function', 'Function', 'Funktion'),
  Parameters: ml('Parameters', 'Parameters', 'Parameter'),
  'Global inputs': ml('Global inputs', 'Global inputs', 'Globale Eingänge')
} as const;

/** Resolve a config-attribute label key to a tri-lingual string (falls back to the key). */
export function attrLabel(key: string): MultiLangString {
  return ATTR_LABEL[key] ?? ml(key, key, key);
}

// ----- Dynamic plain-string helpers (transient messages that interpolate values) -----

/** Type-list load error (plain string). */
export function couldNotLoadTypesMsg(detail: string): string {
  return localize(
    ml(`Could not load types: ${detail}`, `Impossible de charger les types : ${detail}`, `Typen konnten nicht geladen werden: ${detail}`)
  );
}

/** Existing-type warning while editing a new type of the same name (plain string). */
export function typeExistsMsg(name: string): string {
  return localize(
    ml(
      `A type « ${name} » already exists: select it on the left to edit it, or choose another name.`,
      `Un type « ${name} » existe déjà : sélectionnez-le à gauche pour le modifier, ou choisissez un autre nom.`,
      `Ein Typ „${name}“ existiert bereits: Wählen Sie ihn links zum Bearbeiten aus oder wählen Sie einen anderen Namen.`
    )
  );
}

/** Scalar-root note for the editor (plain string with a code type). */
export function scalarRootNoteMsg(type: string): string {
  return localize(
    ml(
      `Scalar-root type (${type}) — no element. The datapoint will directly carry a value of this type.`,
      `Type à racine scalaire (${type}) — aucun élément. Le datapoint portera directement une valeur de ce type.`,
      `Skalarer Wurzeltyp (${type}) — kein Element. Der Datenpunkt trägt direkt einen Wert dieses Typs.`
    )
  );
}

/** Delete-type confirm body (plain string). */
export function deleteTypeConfirmMsg(name: string): string {
  return localize(
    ml(
      `Delete the type ${name}? Deletion fails if it still has instances.`,
      `Supprimer le type ${name} ? La suppression échoue s'il possède encore des instances.`,
      `Typ ${name} löschen? Das Löschen schlägt fehl, wenn er noch Instanzen hat.`
    )
  );
}

/** Duplicate-element-name validation error (plain string). */
export function duplicateElementMsg(name: string): string {
  return localize(
    ml(
      `Duplicate element name: « ${name} ».`,
      `Nom d'élément en double : « ${name} ».`,
      `Doppelter Elementname: „${name}“.`
    )
  );
}

/** Typeref-element-missing-reference validation error (plain string). */
export function typerefNeedsRefMsg(name: string): string {
  return localize(
    ml(
      `The element « ${name} » (Typeref) must reference a type.`,
      `L'élément « ${name} » (Typeref) doit référencer un type.`,
      `Das Element „${name}“ (Typeref) muss einen Typ referenzieren.`
    )
  );
}

/** Could-not-read-type error (plain string). */
export function couldNotReadTypeMsg(status: number): string {
  return localize(
    ml(
      `Could not read the type (HTTP ${status})`,
      `Impossible de lire le type (HTTP ${status})`,
      `Typ konnte nicht gelesen werden (HTTP ${status})`
    )
  );
}

/** Could-not-reach-the-PARA-API error (plain string). */
export function couldNotReachApiMsg(detail: string): string {
  return localize(
    ml(
      `Could not reach the PARA API: ${detail}`,
      `Impossible de joindre l'API PARA : ${detail}`,
      `PARA-API konnte nicht erreicht werden: ${detail}`
    )
  );
}

/** Save-failed error (plain string). */
export function saveFailedMsg(status: number): string {
  return localize(
    ml(`Save failed (HTTP ${status})`, `Échec de l'enregistrement (HTTP ${status})`, `Speichern fehlgeschlagen (HTTP ${status})`)
  );
}

/** Type-updated status (plain string). */
export function typeUpdatedMsg(name: string): string {
  return localize(ml(`Type « ${name} » updated.`, `Type « ${name} » mis à jour.`, `Typ „${name}“ aktualisiert.`));
}

/** Type-created status (plain string). */
export function typeCreatedMsg(name: string): string {
  return localize(ml(`Type « ${name} » created.`, `Type « ${name} » créé.`, `Typ „${name}“ erstellt.`));
}

/** Delete-refused error (plain string). */
export function deleteRefusedMsg(status: number): string {
  return localize(
    ml(`Deletion refused (HTTP ${status})`, `Suppression refusée (HTTP ${status})`, `Löschen abgelehnt (HTTP ${status})`)
  );
}

/** Type-deleted status (plain string). */
export function typeDeletedMsg(name: string): string {
  return localize(ml(`Type « ${name} » deleted.`, `Type « ${name} » supprimé.`, `Typ „${name}“ gelöscht.`));
}

/** Nav: could-not-load-types error (plain string). */
export function navCouldNotLoadTypesMsg(detail: string): string {
  return localize(
    ml(
      `Could not load datapoint types: ${detail}`,
      `Could not load datapoint types: ${detail}`,
      `Datenpunkttypen konnten nicht geladen werden: ${detail}`
    )
  );
}

/** Nav: could-not-load a specific type's children (plain string). */
export function navCouldNotLoadTypeMsg(type: string, detail: string): string {
  return localize(
    ml(
      `Could not load '${type}': ${detail}`,
      `Could not load '${type}': ${detail}`,
      `'${type}' konnte nicht geladen werden: ${detail}`
    )
  );
}

/** Nav: count selected for DPL export (plain string). */
export function navExportSelectedMsg(count: number): string {
  return localize(
    ml(
      `${count} selected for DPL export`,
      `${count} sélectionné(s) pour l'export DPL`,
      `${count} für DPL-Export ausgewählt`
    )
  );
}

/** Detail: truncated-rows notice (plain string). */
export function detailTruncatedMsg(max: number): string {
  return localize(
    ml(
      `Showing the first ${max} values; narrow the selection to see more.`,
      `Showing the first ${max} values; narrow the selection to see more.`,
      `Es werden die ersten ${max} Werte angezeigt; grenzen Sie die Auswahl ein, um mehr zu sehen.`
    )
  );
}

/** Detail/config: could-not-load-values error (plain string). */
export function couldNotLoadValuesMsg(detail: string): string {
  return localize(
    ml(`Could not load values: ${detail}`, `Could not load values: ${detail}`, `Werte konnten nicht geladen werden: ${detail}`)
  );
}

/** Detail: invalid-value-on-write error (plain string). */
export function invalidValueMsg(what: string, name: string): string {
  return localize(ml(`Invalid ${what} for ${name}`, `Invalid ${what} for ${name}`, `Ungültige(r) ${what} für ${name}`));
}

/** Detail: value-list descriptor used in the invalid message (plain string). */
export function valueListWord(baseType: string): string {
  return localize(ml(`${baseType} list`, `${baseType} list`, `${baseType}-Liste`));
}

/** Detail: wrote-value status (plain string). */
export function wroteValueMsg(name: string): string {
  return localize(ml(`Wrote ${name}`, `Wrote ${name}`, `${name} geschrieben`));
}

/** Detail: write-rejected error (plain string). */
export function writeRejectedMsg(name: string, status: number): string {
  return localize(
    ml(
      `Write rejected for ${name} (HTTP ${status})`,
      `Write rejected for ${name} (HTTP ${status})`,
      `Schreiben für ${name} abgelehnt (HTTP ${status})`
    )
  );
}

/** Detail/config: write-failed error (plain string). */
export function writeFailedMsg(detail: string): string {
  return localize(ml(`Write failed: ${detail}`, `Write failed: ${detail}`, `Schreiben fehlgeschlagen: ${detail}`));
}

/** Config: invalid-value-for-attr error (plain string). */
export function invalidAttrValueMsg(attr: string): string {
  return localize(ml(`Invalid value for ${attr}`, `Invalid value for ${attr}`, `Ungültiger Wert für ${attr}`));
}

/** Config: wrote-attr status (plain string). */
export function wroteAttrMsg(attr: string): string {
  return localize(ml(`Wrote ${attr}`, `Wrote ${attr}`, `${attr} geschrieben`));
}

/** Config: write-rejected-for-attr error (plain string). */
export function writeAttrRejectedMsg(attr: string, status: number): string {
  return localize(
    ml(
      `Write rejected for ${attr} (HTTP ${status})`,
      `Write rejected for ${attr} (HTTP ${status})`,
      `Schreiben für ${attr} abgelehnt (HTTP ${status})`
    )
  );
}

/** DP dialog: request-failed error (plain string). */
export function dpRequestFailedMsg(status: number): string {
  return localize(ml(`Request failed (HTTP ${status})`, `Request failed (HTTP ${status})`, `Anfrage fehlgeschlagen (HTTP ${status})`));
}

/** DP dialog: could-not-reach-API error (plain string). */
export function dpCouldNotReachApiMsg(detail: string): string {
  return localize(
    ml(
      `Could not reach the PARA API: ${detail}`,
      `Could not reach the PARA API: ${detail}`,
      `PARA-API konnte nicht erreicht werden: ${detail}`
    )
  );
}

/** DPL: exported-count status (plain string). */
export function dplExportedMsg(count: number): string {
  return localize(ml(`DPL exported (${count})`, `DPL exporté (${count})`, `DPL exportiert (${count})`));
}

/** DPL: export-failed error (plain string). */
export function dplExportFailedMsg(): string {
  return localize(ml('Export failed', 'Export échoué', 'Export fehlgeschlagen'));
}

/** DPL: imported-file status (plain string). */
export function dplImportedMsg(fileName: string): string {
  return localize(ml(`Imported ${fileName}`, `Importé ${fileName}`, `${fileName} importiert`));
}

/** DPL: import-failed error (plain string). */
export function dplImportFailedMsg(): string {
  return localize(ml('Import failed', 'Import échoué', 'Import fehlgeschlagen'));
}

/** Archive: load-error (plain string). */
export function archiveLoadErrorMsg(detail: string): string {
  return localize(
    ml(`Load error: ${detail}`, `Erreur de chargement : ${detail}`, `Ladefehler: ${detail}`)
  );
}

/** Archive: per-row archiving-toggled status (plain string). */
export function archiveToggledMsg(enabled: boolean, display: string): string {
  const en = enabled ? 'Archiving enabled' : 'Archiving disabled';
  const fr = enabled ? 'Archivage activé' : 'Archivage désactivé';
  const de = enabled ? 'Archivierung aktiviert' : 'Archivierung deaktiviert';
  return localize(ml(`${en}: ${display}`, `${fr} : ${display}`, `${de}: ${display}`));
}

/** Archive: group-set status (plain string). */
export function archiveGroupSetMsg(group: string, display: string): string {
  return localize(ml(`Group « ${group} »: ${display}`, `Groupe « ${group} » : ${display}`, `Gruppe „${group}“: ${display}`));
}

/** Generic per-row failure (plain string). */
export function failedOnMsg(display: string): string {
  return localize(ml(`Failed on ${display}`, `Échec sur ${display}`, `Fehler bei ${display}`));
}

/** Alarm: configured status (plain string). */
export function alarmConfiguredMsg(display: string): string {
  return localize(ml(`Alarm configured: ${display}`, `Alarme configurée : ${display}`, `Alarm konfiguriert: ${display}`));
}

/** Alarm: disabled status (plain string). */
export function alarmDisabledMsg(display: string): string {
  return localize(ml(`Alarm disabled: ${display}`, `Alarme désactivée : ${display}`, `Alarm deaktiviert: ${display}`));
}

/** Alarm: per-row failure with detail (plain string). */
export function alarmFailedOnMsg(display: string, detail: string): string {
  return localize(ml(`Failed on ${display}: ${detail}`, `Échec sur ${display} : ${detail}`, `Fehler bei ${display}: ${detail}`));
}

/**
 * Config: status info-bit tooltip (plain string). The `name`/`meaning` come from
 * the WinCC OA status-bit reference (`INFO_BITS`) and are kept verbatim, like the
 * config-attribute keys; only the surrounding wording is localized.
 */
export function infoBitTitleMsg(position: number, meaning: string): string {
  return localize(
    ml(`bit ${position} — ${meaning}`, `bit ${position} — ${meaning}`, `Bit ${position} — ${meaning}`)
  );
}
