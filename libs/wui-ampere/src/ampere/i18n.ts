// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Ampère page (English / French / German).
 *
 * All user-visible strings are {@link MultiLangString} maps resolved against the
 * active WebUI language via the shared `lit-translate` singleton. Use
 * {@link localizeDir} inside templates (reactive) and {@link localize} for
 * plain-string contexts. Locale keys use the base `.utf8` form so any country
 * variant (fr_FR, de_AT, …) still resolves.
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
  header: ml('Ampère (electrical)', 'Ampère (électrique)', 'Ampère (elektrisch)'),
  toolbar: {
    import: ml('Import', 'Importer', 'Importieren'),
    exportAll: ml('Export all', 'Exporter tout', 'Alle exportieren'),
    newNetwork: ml('New network', 'Nouveau réseau', 'Neues Netz'),
    backToList: ml('‹ Networks', '‹ Réseaux', '‹ Netze'),
    edit: ml('Edit', 'Éditer', 'Bearbeiten'),
    done: ml('Done', 'Terminer', 'Fertig'),
    exportOne: ml('Export this network', 'Exporter ce réseau', 'Dieses Netz exportieren'),
    zoomIn: ml('Zoom in', 'Zoom avant', 'Vergrößern'),
    zoomOut: ml('Zoom out', 'Zoom arrière', 'Verkleinern'),
    zoomReset: ml('Reset zoom', 'Réinitialiser le zoom', 'Zoom zurücksetzen'),
    addMeasurement: ml('Add a measurement', 'Ajouter une mesure', 'Messwert hinzufügen'),
    autoArrange: ml('Auto-arrange', 'Agencer auto', 'Automatisch anordnen'),
    autoArrangeHint: ml(
      'Re-place the symbols top → bottom (sources first) and left → right by branch.',
      'Replace les symboles de haut en bas (sources d’abord) et de gauche à droite par branche.',
      'Ordnet die Symbole von oben nach unten (Quellen zuerst) und je Zweig von links nach rechts an.'
    )
  },
  page: {
    offline: ml(
      'Offline mode: changes are not persisted to datapoints (backend unavailable or missing write rights).',
      "Mode hors-ligne : modifications non persistées dans les datapoints (backend indisponible ou droits d'écriture manquants).",
      'Offline-Modus: Änderungen werden nicht in Datenpunkten gespeichert (Backend nicht verfügbar oder fehlende Schreibrechte).'
    ),
    emptyList: ml('No saved network.', 'Aucun réseau enregistré.', 'Kein gespeichertes Netz.'),
    generateDemo: ml('Generate a demo network', 'Générer un réseau de démonstration', 'Demo-Netz erzeugen'),
    missing: ml('Network not found.', 'Réseau introuvable.', 'Netz nicht gefunden.'),
    backToList: ml('Back to the list', 'Retour à la liste', 'Zurück zur Liste'),
    importFailed: ml('Import failed.', 'Import échoué.', 'Import fehlgeschlagen.')
  },
  table: {
    name: ml('Name', 'Nom', 'Name'),
    symbols: ml('Symbols', 'Symboles', 'Symbole'),
    wires: ml('Wires', 'Fils', 'Leitungen'),
    updatedAt: ml('Last modification', 'Dernière modification', 'Letzte Änderung'),
    open: ml('Open', 'Ouvrir', 'Öffnen'),
    rename: ml('Rename', 'Renommer', 'Umbenennen'),
    exportOne: ml('Export', 'Exporter', 'Exportieren'),
    remove: ml('Delete', 'Supprimer', 'Löschen'),
    never: ml('never', 'jamais', 'nie')
  },
  canvas: {
    emptyEditing: ml(
      'Pick a symbol from the toolbox, then click on the canvas to place it.',
      'Choisissez un symbole dans la boîte à outils, puis cliquez sur la zone pour le placer.',
      'Wählen Sie ein Symbol aus der Werkzeugleiste und klicken Sie zum Platzieren auf die Fläche.'
    ),
    emptyDisplay: ml('Empty network.', 'Réseau vide.', 'Leeres Netz.'),
    wireHint: ml(
      'Click a port (○) then another to draw a wire — Esc to cancel.',
      'Cliquez sur un port (○) puis sur un autre pour tracer un fil — Échap pour annuler.',
      'Klicken Sie auf einen Port (○) und dann auf einen weiteren, um eine Leitung zu ziehen — Esc zum Abbrechen.'
    )
  },
  toolbox: {
    title: ml('Toolbox', 'Boîte à outils', 'Werkzeugleiste'),
    hint: ml('Select then place', 'Sélectionner puis placer', 'Auswählen und platzieren'),
    wire: ml('Wire', 'Fil', 'Leitung'),
    select: ml('Select / move', 'Sélectionner / déplacer', 'Auswählen / verschieben')
  },
  category: {
    sources: ml('Sources & substations', 'Sources & postes', 'Quellen & Stationen'),
    busbar: ml('Busbars & links', 'Jeux de barres & liaisons', 'Sammelschienen & Verbindungen'),
    switchgear: ml('Switchgear', 'Appareillage de coupure', 'Schaltgeräte'),
    measure: ml('Measures, loads & earth', 'Mesures, charges & terre', 'Messungen, Lasten & Erde')
  },
  inspector: {
    title: ml('Properties', 'Propriétés', 'Eigenschaften'),
    none: ml('Select a symbol, wire or measurement to edit it.', 'Sélectionnez un symbole, un fil ou une mesure pour le modifier.', 'Wählen Sie ein Symbol, eine Leitung oder einen Messwert zum Bearbeiten.'),
    label: ml('Label', 'Repère', 'Kennzeichnung'),
    rotation: ml('Rotation', 'Rotation', 'Drehung'),
    rotate: ml('Rotate 90°', 'Pivoter 90°', 'Um 90° drehen'),
    rotationFine: ml('Exact angle (30° steps — e.g. star-arranged transformers)', 'Angle exact (pas de 30° — ex. transfos en étoile)', 'Exakter Winkel (30°-Schritte — z. B. Trafos in Sternanordnung)'),
    stateDp: ml('State datapoint (open/closed)', 'Datapoint d’état (ouvert/fermé)', 'Zustands-Datenpunkt (offen/geschlossen)'),
    stateDpHint: ml(
      'Element read live; equals the "closed" value ⇒ the device conducts.',
      'Élément lu en direct ; égal à la valeur « fermé » ⇒ l’appareil conduit.',
      'Live gelesenes Element; gleich dem „geschlossen“-Wert ⇒ das Gerät leitet.'
    ),
    closedValue: ml('“Closed” value', 'Valeur « fermé »', '„Geschlossen“-Wert'),
    isSource: ml('Energy source (seeds the network)', 'Source d’énergie (amorce le réseau)', 'Energiequelle (speist das Netz)'),
    sourceDp: ml('Supply-state datapoint (source)', 'Datapoint d’alimentation (source)', 'Versorgungszustands-Datenpunkt (Quelle)'),
    sourceDpHint: ml(
      'Element read live; equals the "powered" value ⇒ the source energises the network. Unbound ⇒ always powered.',
      'Élément lu en direct ; égal à la valeur « alimenté » ⇒ la source alimente le réseau. Non lié ⇒ toujours alimentée.',
      'Live gelesenes Element; gleich dem „versorgt“-Wert ⇒ die Quelle speist das Netz. Ungebunden ⇒ immer versorgt.'
    ),
    poweredValue: ml('“Powered” value', 'Valeur « alimenté »', '„Versorgt“-Wert'),
    exitSide: ml('Wire exit', 'Sortie du fil', 'Leitungsabgang'),
    exitTop: ml('Top', 'Haut', 'Oben'),
    exitBottom: ml('Bottom', 'Bas', 'Unten'),
    width: ml('Width', 'Largeur', 'Breite'),
    height: ml('Height', 'Hauteur', 'Höhe'),
    delete: ml('Delete', 'Supprimer', 'Löschen'),
    measDp: ml('Measurement datapoint', 'Datapoint de mesure', 'Mess-Datenpunkt'),
    measLabel: ml('Caption', 'Libellé', 'Beschriftung'),
    measUnit: ml('Unit', 'Unité', 'Einheit'),
    measDecimals: ml('Decimals', 'Décimales', 'Dezimalstellen'),
    measAnchor: ml('Anchored to the selected symbol', 'Ancrée au symbole sélectionné', 'Am ausgewählten Symbol verankert'),
    wireInfo: ml('Wire', 'Fil', 'Leitung'),
    deleteSelection: ml('Delete selection', 'Supprimer la sélection', 'Auswahl löschen'),
    multiHint: ml(
      'Drag any selected item to move the whole selection — Del deletes it. Shift+click adds/removes an item.',
      'Glissez un élément sélectionné pour déplacer toute la sélection — Suppr la supprime. Maj+clic ajoute/retire un élément.',
      'Ziehen Sie ein ausgewähltes Element, um die gesamte Auswahl zu verschieben — Entf löscht sie. Umschalt+Klick fügt hinzu/entfernt.'
    )
  },
  networkDialog: {
    newTitle: ml('New network', 'Nouveau réseau', 'Neues Netz'),
    name: ml('Name', 'Nom', 'Name'),
    description: ml('Description', 'Description', 'Beschreibung'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    create: ml('Create', 'Créer', 'Erstellen'),
    save: ml('Save', 'Enregistrer', 'Speichern')
  },
  ai: {
    assistantTitle: ml('AI assistant', 'Assistant IA', 'KI-Assistent'),
    panelTitle: ml('Ampère assistant', 'Assistant Ampère', 'Ampère-Assistent'),
    placeholder: ml(
      'Describe the network to generate (e.g. “a 3-feeder TGBT with a transformer incomer and 4 outgoing breakers”).',
      'Décrivez le réseau à générer (ex. « un TGBT à 3 départs avec arrivée transformateur et 4 disjoncteurs de départ »).',
      'Beschreiben Sie das zu erzeugende Netz (z. B. „ein TGBT mit 3 Abgängen, Trafo-Einspeisung und 4 Abgangsschaltern“).'
    ),
    composerPlaceholder: ml('Ask or describe a network… (Ctrl+Enter)', 'Demandez ou décrivez un réseau… (Ctrl+Entrée)', 'Fragen oder Netz beschreiben… (Strg+Enter)'),
    thinking: ml('Thinking…', 'Réflexion…', 'Denkt nach…'),
    send: ml('Send', 'Envoyer', 'Senden'),
    clear: ml('Clear', 'Effacer', 'Löschen'),
    configure: ml('Configure', 'Configurer', 'Konfigurieren'),
    close: ml('Close', 'Fermer', 'Schließen'),
    emptyAnswer: ml('(empty answer)', '(réponse vide)', '(leere Antwort)'),
    proposed: ml('Proposed network', 'Réseau proposé', 'Vorgeschlagenes Netz'),
    applyToEditor: ml('Apply to editor', 'Appliquer à l’éditeur', 'In Editor übernehmen'),
    nodeMany: ml('symbols', 'symboles', 'Symbole'),
    nodeOne: ml('symbol', 'symbole', 'Symbol'),
    replaceWarn: ml(
      'Applying replaces the current diagram content.',
      'Appliquer remplace le contenu du schéma actuel.',
      'Übernehmen ersetzt den aktuellen Schemainhalt.'
    )
  },
  suggestions: {
    s1: ml(
      'A TGBT: grid incomer → main breaker → busbar → 4 outgoing feeders each with a breaker.',
      'Un TGBT : arrivée réseau → disjoncteur général → jeu de barres → 4 départs avec disjoncteur chacun.',
      'Ein TGBT: Netzeinspeisung → Hauptschalter → Sammelschiene → 4 Abgänge mit je einem Schalter.'
    ),
    s2: ml(
      'A transformer substation: MV grid → transformer → LV busbar with a disconnector and two motor feeders.',
      'Un poste transformateur : réseau HTA → transformateur → jeu de barres BT avec un sectionneur et deux départs moteur.',
      'Eine Trafostation: MS-Netz → Transformator → NS-Sammelschiene mit Trennschalter und zwei Motorabgängen.'
    ),
    s3: ml(
      'Two busbars linked by a bus-coupler breaker, each fed by its own transformer.',
      'Deux jeux de barres reliés par un disjoncteur de couplage, alimentés chacun par leur transformateur.',
      'Zwei Sammelschienen, verbunden durch einen Kuppelschalter, je von einem eigenen Trafo gespeist.'
    ),
    s4: ml(
      'Add an ammeter and a voltmeter on the main incomer.',
      'Ajoute un ampèremètre et un voltmètre sur l’arrivée principale.',
      'Füge ein Amperemeter und ein Voltmeter an der Haupteinspeisung hinzu.'
    )
  }
} as const;

/** Confirm-delete prompt for one network (plain string — transient dialog). */
export function confirmDeleteMsg(name: string): string {
  return localize(ml(`Delete network “${name}”?`, `Supprimer le réseau « ${name} » ?`, `Netz „${name}“ löschen?`));
}

/** Network count label (plain string — toolbar). */
export function networkCountMsg(count: number): string {
  return localize(ml(`${count} network(s)`, `${count} réseau(x)`, `${count} Netz(e)`));
}

/** "Rename — <name>" dialog title (plain string). */
export function renameTitleMsg(name: string): string {
  return localize(ml(`Rename — ${name}`, `Renommer — ${name}`, `Umbenennen — ${name}`));
}

/** "<N> selected items" heading (plain string — inspector, multi-selection). */
export function selectedCountMsg(count: number): string {
  return localize(ml(`${count} selected items`, `${count} éléments sélectionnés`, `${count} ausgewählte Elemente`));
}
