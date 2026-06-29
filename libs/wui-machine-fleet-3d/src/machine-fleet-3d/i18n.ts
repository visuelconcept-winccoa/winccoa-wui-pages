// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable sonarjs/no-duplicate-string -- a translation catalog repeats short field/column labels across UI areas by design */

/**
 * Internationalisation for the Machine Fleet 3D page.
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

/** Static UI strings, grouped by area. */
export const MSG = {
  shell: {
    notFound: ml('Atelier not found.', 'Atelier introuvable.', 'Werkstatt nicht gefunden.'),
    back: ml('Back', 'Retour', 'Zurück')
  },
  overview: {
    graphicsCatalog: ml('Graphics catalog', 'Catalogue graphiques', 'Grafikkatalog'),
    closures: ml('Non-working days', 'Jours non travaillés', 'Arbeitsfreie Tage'),
    stopAnalysis: ml(
      'Stop cause analysis',
      "Analyse des causes d'arrêts",
      'Analyse der Stillstandsursachen'
    ),
    kpiAnalysis: ml('KPI analysis', 'Analyse des KPI', 'KPI-Analyse'),
    newEllipsis: ml('New…', 'Nouveau…', 'Neu…'),
    offlineNotice: ml(
      'Offline mode: changes not persisted to the datapoints (backend unavailable or write rights missing).',
      'Mode hors-ligne : modifications non persistées dans les datapoints (backend indisponible ou droits d’écriture manquants).',
      'Offline-Modus: Änderungen werden nicht in den Datapoints gespeichert (Backend nicht verfügbar oder fehlende Schreibrechte).'
    ),
    emptyNone: ml('No atelier configured.', 'Aucun atelier configuré.', 'Keine Werkstatt konfiguriert.'),
    importDemo: ml(
      'Import the demonstration atelier',
      "Importer l'atelier de démonstration",
      'Demo-Werkstatt importieren'
    ),
    openView3d: ml('Open the 3D view', 'Ouvrir la vue 3D', '3D-Ansicht öffnen'),
    machineCount: ml('machine(s)', 'machine(s)', 'Maschine(n)'),
    defaultAtelierName: ml('Atelier', 'Atelier', 'Werkstatt'), // TODO(de): review label vs. proper name
    demoAtelierName: ml(
      'Demonstration atelier',
      'Atelier de démonstration',
      'Demo-Werkstatt'
    )
  },
  view: {
    backToAteliers: ml('Back to ateliers', 'Retour aux ateliers', 'Zurück zu den Werkstätten'),
    confirm: ml('Confirm', 'Valider', 'Bestätigen'),
    atelier: ml('Atelier', 'Atelier', 'Werkstatt'), // TODO(de): review label vs. proper name
    renameAtelier: ml("Rename the atelier", "Renommer l'atelier", 'Werkstatt umbenennen'),
    deleteAtelier: ml("Delete the atelier", "Supprimer l'atelier", 'Werkstatt löschen'),
    resetView: ml('Reset the view', 'Réinitialiser la vue', 'Ansicht zurücksetzen'),
    editMode: ml(
      'Edit mode (move machines)',
      'Mode édition (déplacer les machines)',
      'Bearbeitungsmodus (Maschinen verschieben)'
    ),
    roof: ml('Building roof', 'Toiture du bâtiment', 'Gebäudedach'),
    labels: ml('Machine labels', 'Étiquettes des machines', 'Maschinenbeschriftungen'),
    alertsOnly: ml(
      'Show alerts only',
      'Afficher seulement les alertes',
      'Nur Warnungen anzeigen'
    ),
    viewpoints: ml('Viewpoints', 'Points de vue', 'Ansichtspunkte'),
    graphicsCatalogGlb: ml(
      'Graphics catalog (GLB / billboards)',
      'Catalogue de graphiques (GLB / billboards)',
      'Grafikkatalog (GLB / Billboards)'
    ),
    configureBuilding: ml(
      'Configure the building',
      'Configurer le bâtiment',
      'Gebäude konfigurieren'
    ),
    stateMappings: ml("State mappings", "Mappings d'état", 'Zustandszuordnungen'),
    importAtelier: ml(
      'Import the atelier (JSON)',
      "Importer l'atelier (JSON)",
      'Werkstatt importieren (JSON)'
    ),
    exportAtelier: ml(
      'Export the atelier (JSON)',
      "Exporter l'atelier (JSON)",
      'Werkstatt exportieren (JSON)'
    ),
    machines: ml('Machines', 'Machines', 'Maschinen'),
    tiltUp: ml('Tilt up', 'Incliner vers le haut', 'Nach oben neigen'),
    tiltDown: ml('Tilt down', 'Incliner vers le bas', 'Nach unten neigen'),
    rotateLeft: ml('Rotate left', 'Pivoter à gauche', 'Nach links drehen'),
    rotateRight: ml('Rotate right', 'Pivoter à droite', 'Nach rechts drehen'),
    defaultView: ml('Default view', 'Vue par défaut', 'Standardansicht'),
    zoomIn: ml('Zoom in', 'Zoom avant', 'Vergrößern'),
    zoomOut: ml('Zoom out', 'Zoom arrière', 'Verkleinern'),
    presetTop: ml('Top', 'Dessus', 'Oben'),
    presetFront: ml('Front', 'Face', 'Vorne'),
    presetSide: ml('Side', 'Côté', 'Seite'),
    presetIso: ml('Iso', 'Iso', 'Iso'),
    cameraModeToggle: ml(
      '3D view (perspective) / 2D (top)',
      'Vue 3D (perspective) / 2D (dessus)',
      '3D-Ansicht (Perspektive) / 2D (oben)'
    ),
    saveView: ml('Save the view', 'Enregistrer la vue', 'Ansicht speichern'),
    noViewpoints: ml(
      'No viewpoint saved',
      'Aucun point de vue enregistré',
      'Kein Ansichtspunkt gespeichert'
    ),
    goToView: ml('Go to this view', 'Aller à cette vue', 'Zu dieser Ansicht gehen'),
    defaultViewpointOn: ml(
      'Default view at load (click to remove)',
      'Vue par défaut au chargement (cliquer pour retirer)',
      'Standardansicht beim Laden (zum Entfernen klicken)'
    ),
    defaultViewpointOff: ml(
      'Set as default view at load',
      'Définir comme vue par défaut au chargement',
      'Als Standardansicht beim Laden festlegen'
    ),
    refreshFromCamera: ml(
      'Refresh from current camera view',
      'Actualiser depuis la vue caméra actuelle',
      'Von aktueller Kameraansicht aktualisieren'
    ),
    rename: ml('Rename', 'Renommer', 'Umbenennen'),
    delete: ml('Delete', 'Supprimer', 'Löschen'),
    edit: ml('Edit', 'Éditer', 'Bearbeiten'),
    viewOnly: ml('View', 'Visualiser', 'Anzeigen'),
    close: ml('Close', 'Fermer', 'Schließen'),
    openDashboard: ml('Open the dashboard', 'Ouvrir le tableau de bord', 'Dashboard öffnen'),
    link: ml('Link', 'Lien', 'Link'),
    noInformation: ml('No information', 'Aucune information', 'Keine Informationen'),
    state: ml('State', 'État', 'Zustand'),
    stopCause: ml("Stop cause", "Cause d'arrêt", 'Stillstandsursache'),
    workOrder: ml('Current work order', 'OF en cours', 'Aktueller Fertigungsauftrag'),
    operation: ml('Operation', 'Opération', 'Vorgang'),
    obsolescenceAli: ml('Obsolescence (ALI)', 'Obsolescence (ALI)', 'Obsoleszenz (ALI)'),
    confirmDeleteHeading: ml("Delete the atelier", "Supprimer l'atelier", 'Werkstatt löschen'),
    newMachineName: ml('New machine', 'Nouvelle machine', 'Neue Maschine'),
    viewLabel: ml('View', 'Vue', 'Ansicht') // TODO(de): review (used as viewpoint name prefix)
  },
  create: {
    title: ml('New atelier', 'Nouvel atelier', 'Neue Werkstatt'),
    startTemplate: ml('Starting template', 'Modèle de départ', 'Ausgangsvorlage'),
    name: ml('Name', 'Nom', 'Name'),
    id: ml('Identifier', 'Identifiant', 'Bezeichner'),
    generateAuto: ml('Generate automatically', 'Générer automatiquement', 'Automatisch generieren'),
    idTaken: ml(
      'This identifier already exists — choose another one.',
      'Cet identifiant existe déjà — choisissez-en un autre.',
      'Dieser Bezeichner existiert bereits — wählen Sie einen anderen.'
    ),
    idHint: ml(
      'Used as the datapoint name (MachineFleet3D_<id>).',
      'Sert de nom du datapoint (MachineFleet3D_<id>).',
      'Wird als Datapoint-Name verwendet (MachineFleet3D_<id>).'
    ),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    create: ml('Create', 'Créer', 'Erstellen'),
    defaultName: ml('New atelier', 'Nouvel atelier', 'Neue Werkstatt')
  },
  machineDash: {
    close: ml('Close', 'Fermer', 'Schließen'),
    processParams: ml('Process parameters', 'Paramètres Process', 'Prozessparameter'),
    alarmTracking: ml('Alarm tracking', 'Suivi Alarmes', 'Alarmverfolgung'),
    alarmTrackingPlaceholder: ml(
      'Alarm tracking — not available (coming soon).',
      'Suivi des alarmes — non disponible (à venir).',
      'Alarmverfolgung — nicht verfügbar (in Kürze).'
    ),
    prevPeriod: ml('Previous period', 'Période précédente', 'Vorheriger Zeitraum'),
    nextPeriod: ml('Next period', 'Période suivante', 'Nächster Zeitraum'),
    period: ml('Period', 'Période', 'Zeitraum'),
    start: ml('Start', 'Début', 'Beginn'),
    end: ml('End', 'Fin', 'Ende'),
    noProcessParams: ml(
      'No process parameter configured.',
      'Aucun paramètre process configuré.',
      'Kein Prozessparameter konfiguriert.'
    ),
    ganttTitle: ml('Machine state Gantt', 'Gantt état machine', 'Gantt-Diagramm Maschinenzustand'),
    exportGanttCsv: ml('Export the Gantt (CSV)', 'Exporter le Gantt (CSV)', 'Gantt exportieren (CSV)'),
    noHistory: ml(
      "No history data over the period.",
      "Aucune donnée d'historique sur la période.",
      'Keine Verlaufsdaten im Zeitraum.'
    ),
    tipStart: ml('Start:', 'Début :', 'Beginn:'),
    tipEnd: ml('End:', 'Fin :', 'Ende:'),
    tipCause: ml('Cause:', 'Cause :', 'Ursache:'),
    paretoTitle: ml('Pareto of stops', 'Pareto des arrêts', 'Pareto der Stillstände'),
    exportParetoCsv: ml('Export the Pareto (CSV)', 'Exporter le Pareto (CSV)', 'Pareto exportieren (CSV)'),
    openAnalysisTitle: ml(
      "Open the stop-cause analysis filtered on this machine",
      "Ouvrir l'analyse des causes d'arrêts filtrée sur cette machine",
      'Stillstandsursachenanalyse für diese Maschine gefiltert öffnen'
    ),
    analyse: ml('Analyse', 'Analyser', 'Analysieren'),
    classPlanned: ml('planned', 'planifié', 'geplant'), // TODO(de): review (interpolated into "no … stop" message)
    classUnplanned: ml('unplanned', 'non planifié', 'ungeplant'), // TODO(de): review
    periodToday: ml('Today', "Aujourd'hui", 'Heute'),
    period24h: ml('24 hours', '24 heures', '24 Stunden'),
    period7d: ml('7 days', '7 jours', '7 Tage'),
    period30d: ml('30 days', '30 jours', '30 Tage'),
    periodWeek: ml('This week', 'Cette semaine', 'Diese Woche'),
    periodMonth: ml('This month', 'Ce mois', 'Dieser Monat'),
    periodCustom: ml('Custom…', 'Personnalisé…', 'Benutzerdefiniert…'),
    paretoTopAll: ml('All', 'Tous', 'Alle'),
    metricDowntime: ml('Cumulated downtime', "Temps d'arrêt cumulé", 'Kumulierte Stillstandszeit'),
    metricFrequency: ml('Stop frequency', "Fréquence d'arrêt", 'Stillstandshäufigkeit'),
    classOptUnplanned: ml('Unplanned stops', 'Arrêts non planifiés', 'Ungeplante Stillstände'),
    classOptPlanned: ml('Planned stops', 'Arrêts planifiés', 'Geplante Stillstände'),
    // CSV column headers (Gantt export)
    csvStart: ml('Start', 'Début', 'Beginn'),
    csvEnd: ml('End', 'Fin', 'Ende'),
    csvState: ml('State', 'État', 'Zustand'),
    csvStopCause: ml('Stop cause', "Cause d'arrêt", 'Stillstandsursache'),
    // CSV column headers (Pareto export)
    csvCause: ml('Cause', 'Cause', 'Ursache'),
    csvClassification: ml('Classification', 'Classification', 'Klassifizierung'),
    csvDowntimeSec: ml("Downtime (s)", "Temps d'arrêt (s)", 'Stillstandszeit (s)'),
    csvDowntime: ml("Downtime", "Temps d'arrêt", 'Stillstandszeit'),
    csvOccurrences: ml('Occurrences', 'Occurrences', 'Vorkommen'),
    csvCumulPct: ml('Cumulative %', 'Cumul %', 'Kumuliert %')
  },
  machineDialog: {
    importMachine: ml(
      'Import the machine (JSON)',
      'Importer la machine (JSON)',
      'Maschine importieren (JSON)'
    ),
    exportMachine: ml(
      'Export the machine (JSON)',
      'Exporter la machine (JSON)',
      'Maschine exportieren (JSON)'
    ),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    close: ml('Close', 'Fermer', 'Schließen'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    tabGeneral: ml('General', 'Général', 'Allgemein'),
    tabStateProduction: ml('State & production', 'État & production', 'Zustand & Produktion'),
    tabParams: ml('Parameters', 'Paramètres', 'Parameter'),
    tabDashboard: ml('Dashboard', 'Dashboard', 'Dashboard'),
    tabArchiving: ml('Archiving', 'Archivage', 'Archivierung'),
    tabKpi: ml('KPI', 'KPI', 'KPI'),
    tabDisplay: ml('Display', 'Affichage', 'Anzeige'),
    backendUnavailable: ml('Backend unavailable.', 'Backend indisponible.', 'Backend nicht verfügbar.'),
    archivingEmpty: ml(
      "No linked datapoint or configured KPI. First configure the DPs / KPIs in the other tabs.",
      "Aucun datapoint lié ni KPI configuré. Configurez d'abord les DP / KPI dans les autres onglets.",
      'Kein verknüpfter Datenpunkt oder konfigurierter KPI. Konfigurieren Sie zuerst die DPs / KPIs in den anderen Registerkarten.'
    ),
    noArchiveGroup: ml(
      "No active archive group discovered (type _NGA_Group).",
      "Aucun groupe d'archive actif découvert (type _NGA_Group).",
      'Keine aktive Archivgruppe gefunden (Typ _NGA_Group).'
    ),
    archivingDpsTitle: ml(
      'NGA archiving of datapoints',
      'Archivage NGA des datapoints',
      'NGA-Archivierung der Datenpunkte'
    ),
    archivingDpsHint: ml(
      "Enable archiving and choose an archive group to historise these datapoints (machine state, stop cause, parameters…).",
      "Activez l'archivage et choisissez un groupe d'archive pour historiser ces datapoints (état machine, cause d'arrêt, paramètres…).",
      'Aktivieren Sie die Archivierung und wählen Sie eine Archivgruppe, um diese Datenpunkte zu historisieren (Maschinenzustand, Stillstandsursache, Parameter…).'
    ),
    archivingKpiTitle: ml(
      'Archiving of real-time KPIs',
      'Archivage des KPI temps réel',
      'Archivierung der Echtzeit-KPIs'
    ),
    archivingKpiHint: ml(
      "Enables archiving of the value computed by the manager (to trace curves) and chooses the archive group.",
      "Active l'archivage de la valeur calculée par le manager (pour tracer des courbes) et choisit le groupe d'archive.",
      'Aktiviert die Archivierung des vom Manager berechneten Werts (zum Zeichnen von Kurven) und wählt die Archivgruppe.'
    ),
    kpiValueComputed: ml(
      'Computed KPI value (curves)',
      'Valeur KPI calculée (courbes)',
      'Berechneter KPI-Wert (Kurven)'
    ),
    kpiRealtimeTitle: ml(
      'Real-time KPI (server computation, archived)',
      'KPI temps réel (calcul serveur, archivés)',
      'Echtzeit-KPI (Serverberechnung, archiviert)'
    ),
    kpiRealtimeHint: ml(
      "Each KPI is computed server-side (kpiCalc manager) over a sliding window and written to an archived datapoint — which lets you trace curves. Choose the type (the formula follows from it), the aggregation period and the refresh frequency.",
      "Chaque KPI est calculé côté serveur (manager kpiCalc) sur une fenêtre glissante et écrit dans un datapoint archivé — ce qui permet d'en tracer des courbes. Choisissez le type (la formule en découle), la période d'agrégation et la fréquence d'actualisation.",
      'Jeder KPI wird serverseitig (kpiCalc-Manager) über ein gleitendes Fenster berechnet und in einen archivierten Datenpunkt geschrieben — wodurch sich Kurven zeichnen lassen. Wählen Sie den Typ (die Formel ergibt sich daraus), den Aggregationszeitraum und die Aktualisierungsfrequenz.'
    ),
    addKpi: ml('Add a KPI', 'Ajouter un KPI', 'KPI hinzufügen'),
    noKpi: ml('No KPI configured.', 'Aucun KPI configuré.', 'Kein KPI konfiguriert.'),
    manageThresholds: ml(
      'Manage thresholds (colours)…',
      'Gérer les seuils (couleurs)…',
      'Schwellenwerte verwalten (Farben)…'
    ),
    removeKpi: ml('Remove this KPI', 'Retirer ce KPI', 'Diesen KPI entfernen'),
    kpiTypeLabel: ml(
      'Type (determines the formula)',
      'Type (détermine la formule)',
      'Typ (bestimmt die Formel)'
    ),
    kpiNameOptional: ml('Name (optional)', 'Nom (optionnel)', 'Name (optional)'),
    kpiWindowLabel: ml(
      'Aggregation period (sliding window)',
      "Période d'agrégation (fenêtre glissante)",
      'Aggregationszeitraum (gleitendes Fenster)'
    ),
    kpiRefreshLabel: ml('Refresh (min)', 'Actualisation (min)', 'Aktualisierung (Min.)'),
    kpiThresholdsLabel: ml('Thresholds (colours)', 'Seuils (couleurs)', 'Schwellenwerte (Farben)'),
    identity: ml('Identity', 'Identité', 'Identität'),
    fieldName: ml('Name', 'Nom', 'Name'),
    fieldType: ml('Type', 'Type', 'Typ'),
    processLabel: ml(
      'Process (simulated parameters)',
      'Métier (paramètres simulés)',
      'Gewerk (simulierte Parameter)'
    ),
    fieldLoc: ml('Marker (e.g. C7)', 'Repère (ex. C7)', 'Kennzeichen (z. B. C7)'),
    fieldHeight: ml('Height', 'Hauteur', 'Höhe'),
    appearance: ml('Appearance', 'Apparence', 'Erscheinungsbild'),
    rotationLabel: ml('Rotation (vertical axis)', 'Rotation (axe vertical)', 'Drehung (vertikale Achse)'),
    colour: ml('Colour', 'Couleur', 'Farbe'),
    defaultColour: ml('Default colour', 'Couleur par défaut', 'Standardfarbe'),
    showInScene: ml(
      'Show the machine in the 3D scene',
      'Afficher la machine dans la scène 3D',
      'Maschine in der 3D-Szene anzeigen'
    ),
    displayTitle: ml('Display (bubble & popup)', 'Affichage (bulle & popup)', 'Anzeige (Blase & Popup)'),
    displayHint: ml(
      "For each piece of information (state, production tracking, parameters and KPI), choose its visibility in the machine bubble and in the popup (on click), and set its display order with the arrows.",
      "Pour chaque information (état, suivi de production, paramètres et KPI), choisissez sa visibilité dans la bulle machine et dans le popup (au clic), et réglez son ordre d'affichage avec les flèches.",
      'Wählen Sie für jede Information (Zustand, Produktionsverfolgung, Parameter und KPI) ihre Sichtbarkeit in der Maschinenblase und im Popup (beim Klick) und stellen Sie die Anzeigereihenfolge mit den Pfeilen ein.'
    ),
    colInformation: ml('Information', 'Information', 'Information'),
    colBubble: ml('Bubble', 'Bulle', 'Blase'),
    colPopup: ml('Popup', 'Popup', 'Popup'),
    colOrder: ml('Order', 'Ordre', 'Reihenfolge'),
    moveUp: ml('Move up', 'Monter', 'Nach oben'),
    moveDown: ml('Move down', 'Descendre', 'Nach unten'),
    portiqueDimensions: ml('Gantry dimensions', 'Dimensions du portique', 'Portalabmessungen'),
    span: ml('Span', 'Portée', 'Spannweite'),
    height: ml('Height', 'Hauteur', 'Höhe'),
    pillars: ml('Pillars', 'Piliers', 'Stützen'),
    tableDiameter: ml(
      'Rotary table diameter',
      'Diamètre de la table rotative',
      'Durchmesser des Drehtisches'
    ),
    basculeurDimensions: ml('Tilter dimensions', 'Dimensions du basculeur', 'Kipper-Abmessungen'),
    width: ml('Width', 'Largeur', 'Breite'),
    depth: ml('Depth', 'Profondeur', 'Tiefe'),
    tiltDpLabel: ml(
      'Tilt-angle DP (°, 0 = flat)',
      'DP angle de basculement (°, 0 = à plat)',
      'Kippwinkel-DP (°, 0 = flach)'
    ),
    tiltInvert: ml(
      "Invert the animation angle (0 ↔ 90)",
      "Inverser l'angle d'animation (0 ↔ 90)",
      'Animationswinkel umkehren (0 ↔ 90)'
    ),
    billboardTitle: ml('Icon (billboard)', 'Icône (billboard)', 'Symbol (Billboard)'),
    billboardHint: ml(
      "Choose a library, then the icon representing this station (or import some via the catalog).",
      "Choisissez une bibliothèque, puis l'icône représentant ce poste (ou importez-en via le catalogue).",
      'Wählen Sie eine Bibliothek und dann das Symbol für diesen Arbeitsplatz (oder importieren Sie welche über den Katalog).'
    ),
    library: ml('Library', 'Bibliothèque', 'Bibliothek'),
    manageCatalog: ml('Manage the catalog…', 'Gérer le catalogue…', 'Katalog verwalten…'),
    size: ml('Size', 'Taille', 'Größe'),
    semifabBuiltin: ml('SemiFab (built-in)', 'SemiFab (intégrée)', 'SemiFab (integriert)'),
    importedNoLibrary: ml(
      'Imported (no library)',
      'Importées (sans bibliothèque)',
      'Importiert (ohne Bibliothek)'
    ),
    noResourceInLibrary: ml(
      'No resource in this library.',
      'Aucune ressource dans cette bibliothèque.',
      'Keine Ressource in dieser Bibliothek.'
    ),
    glbTitle: ml('3D model (GLB)', 'Modèle 3D (GLB)', '3D-Modell (GLB)'),
    glbResource: ml('GLB resource', 'Ressource GLB', 'GLB-Ressource'),
    manage: ml('Manage', 'Gérer', 'Verwalten'),
    glbEmpty: ml(
      'No resource — click « Manage » to import a GLB model.',
      'Aucune ressource — cliquez « Gérer » pour importer un modèle GLB.',
      'Keine Ressource — klicken Sie auf « Verwalten », um ein GLB-Modell zu importieren.'
    ),
    machineState: ml('Machine state', 'État machine', 'Maschinenzustand'),
    commLabel: ml('Communication', 'Communication', 'Kommunikation'),
    stopCauseLabel: ml('Stop cause', "Cause d'arrêt", 'Stillstandsursache'),
    workOrderLabel: ml('Current work order', 'OF en cours', 'Aktueller Fertigungsauftrag'),
    operationLabel: ml('Operation', 'Opération', 'Vorgang'),
    tiltAngleLabel: ml('Tilt angle', 'Angle basculement', 'Kippwinkel'),
    stateDpLabel: ml('State datapoint', "Datapoint d'état", 'Zustands-Datenpunkt'),
    stateMappingLabel: ml('State mapping', "Mapping d'état", 'Zustandszuordnung'),
    manageStateMappings: ml(
      "Manage state mappings…",
      "Gérer les mappings d'état…",
      'Zustandszuordnungen verwalten…'
    ),
    commDpLabel: ml(
      "Communication DP (bool, or int: 0 = offline, ≥ 1 = connected)",
      "DP communication (bool, ou int : 0 = hors ligne, ≥ 1 = connectée)",
      'Kommunikations-DP (bool oder int: 0 = offline, ≥ 1 = verbunden)'
    ),
    aliTitle: ml(
      'Asset Lifecycle Intelligence (obsolescence)',
      'Asset Lifecycle Intelligence (obsolescence)',
      'Asset Lifecycle Intelligence (Obsoleszenz)'
    ),
    aliHint: ml(
      "Link this machine to an ALI module asset to display its obsolescence/risk score. Then enable « Obsolescence (ALI) » in the Display tab.",
      "Liez cette machine à un asset du module ALI pour afficher son score d'obsolescence/risque. Activez ensuite « Obsolescence (ALI) » dans l'onglet Affichage.",
      'Verknüpfen Sie diese Maschine mit einem Asset des ALI-Moduls, um ihren Obsoleszenz-/Risikowert anzuzeigen. Aktivieren Sie anschließend « Obsoleszenz (ALI) » in der Registerkarte Anzeige.'
    ),
    aliEmpty: ml(
      "No ALI asset found (Asset Lifecycle module not installed, empty inventory or backend unavailable).",
      "Aucun asset ALI trouvé (module Asset Lifecycle non installé, inventaire vide ou backend indisponible).",
      'Kein ALI-Asset gefunden (Asset-Lifecycle-Modul nicht installiert, leeres Inventar oder Backend nicht verfügbar).'
    ),
    aliLinkedAsset: ml('Linked ALI asset', 'Asset ALI lié', 'Verknüpftes ALI-Asset'),
    production: ml('Production tracking', 'Suivi production', 'Produktionsverfolgung'),
    stopCauseDpLabel: ml('Stop-cause DP', "DP cause d'arrêt", 'Stillstandsursache-DP'),
    workOrderDpLabel: ml('Current work order DP', "DP OF en cours", 'DP aktueller Fertigungsauftrag'),
    operationDpLabel: ml('Current operation DP', "DP opération en cours", 'DP aktueller Vorgang'),
    dashboardMachine: ml('Machine dashboard', 'Dashboard machine', 'Maschinen-Dashboard'),
    dashboardModeLabel: ml(
      'Dashboard opened from the machine card',
      'Tableau de bord ouvert depuis la fiche machine',
      'Vom Maschinenkarte geöffnetes Dashboard'
    ),
    dashboardDefaultHint: ml(
      "The built-in machine dashboard (Process parameters, alarm tracking, KPI: state Gantt + Pareto of stops) is shown, contextualised with this machine. No configuration required.",
      "Le tableau de bord machine intégré (Paramètres process, suivi alarmes, KPI : Gantt état + Pareto des arrêts) s'affiche, contextualisé avec cette machine. Aucune configuration requise.",
      'Das integrierte Maschinen-Dashboard (Prozessparameter, Alarmverfolgung, KPI: Zustands-Gantt + Pareto der Stillstände) wird kontextbezogen zu dieser Maschine angezeigt. Keine Konfiguration erforderlich.'
    ),
    dashboardLinkedLabel: ml(
      'Linked WinCC OA dashboard',
      'Dashboard WinCC OA lié',
      'Verknüpftes WinCC OA Dashboard'
    ),
    dashboardNumberLabel: ml('Dashboard number', 'Numéro de dashboard', 'Dashboard-Nummer'),
    createDashboard: ml(
      'Create a dashboard for this machine',
      'Créer un dashboard pour cette machine',
      'Ein Dashboard für diese Maschine erstellen'
    ),
    exportParamsTitleDisabled: ml(
      'Select a dashboard first',
      'Sélectionnez d’abord un dashboard',
      'Wählen Sie zuerst ein Dashboard'
    ),
    exportParamsTitle: ml(
      'Export the configured parameters',
      'Exporter les paramètres configurés',
      'Konfigurierte Parameter exportieren'
    ),
    exportParams: ml(
      'Export parameters (State + KPI)',
      'Exporter les paramètres (État + KPI)',
      'Parameter exportieren (Zustand + KPI)'
    ),
    externalLinks: ml('External links (URL)', 'Liens externes (URL)', 'Externe Links (URL)'),
    addLink: ml('Add a link', 'Ajouter un lien', 'Link hinzufügen'),
    noExternalLink: ml('No external link.', 'Aucun lien externe.', 'Kein externer Link.'),
    removeLink: ml('Remove this link', 'Retirer ce lien', 'Diesen Link entfernen'),
    buttonLabel: ml('Button label', 'Libellé du bouton', 'Schaltflächenbeschriftung'),
    buttonIcon: ml('Button icon', 'Icône du bouton', 'Schaltflächensymbol'),
    chooseEllipsis: ml('Choose…', 'Choisir…', 'Auswählen…'),
    urlLabel: ml('URL (https://…)', 'URL (https://…)', 'URL (https://…)'),
    urlPlaceholder: ml(
      'https://example.com/dashboard',
      'https://exemple.com/tableau-de-bord',
      'https://beispiel.de/dashboard'
    ),
    paramsTitle: ml('Parameters', 'Paramètres', 'Parameter'),
    addParam: ml('Add a parameter', 'Ajouter un paramètre', 'Parameter hinzufügen'),
    paramLabel: ml('Label', 'Libellé', 'Bezeichnung'),
    paramUnit: ml('Unit', 'Unité', 'Einheit'),
    defaultParamName: ml('Parameter', 'Paramètre', 'Parameter'),
    delete: ml('Delete', 'Supprimer', 'Löschen'),
    editTitlePrefix: ml('Edit', 'Édition', 'Bearbeiten') // TODO(de): review (used as "Edit — <name>")
  },
  buildingDialog: {
    title: ml('Building configuration', 'Configuration du bâtiment', 'Gebäudekonfiguration'),
    close: ml('Close', 'Fermer', 'Schließen'),
    apply: ml('Apply', 'Appliquer', 'Anwenden'),
    length: ml('Length (m)', 'Longueur (m)', 'Länge (m)'),
    width: ml('Width (m)', 'Largeur (m)', 'Breite (m)'),
    height: ml('Height (m)', 'Hauteur (m)', 'Höhe (m)'),
    bays: ml('Bays', 'Travées', 'Felder'),
    colStep: ml('Column step (m)', 'Pas poteaux (m)', 'Stützenraster (m)'),
    roofType: ml('Roof type', 'Type de toiture', 'Dachtyp'),
    floorType: ml('Floor type', 'Type de sol', 'Bodentyp'),
    navButtons: ml('Navigation buttons', 'Boutons de navigation', 'Navigationsschaltflächen'),
    roofShed: ml('Sheds (sawtooth)', 'Sheds (redents)', 'Sheddach'),
    roofFlat: ml('Flat', 'Plate', 'Flach'),
    roofMonoslope: ml('Monoslope', 'Monopente', 'Pultdach'),
    roofNone: ml('None', 'Aucune', 'Keine')
  },
  configPanel: {
    deleteMachineHeading: ml('Delete the machine', 'Supprimer la machine', 'Maschine löschen'),
    machines: ml('Machines', 'Machines', 'Maschinen'),
    searchMachine: ml(
      'Search for a machine…',
      'Rechercher une machine…',
      'Maschine suchen…'
    ),
    addMachine: ml('Add a machine', 'Ajouter une machine', 'Maschine hinzufügen'),
    edit: ml('Edit', 'Éditer', 'Bearbeiten'),
    viewOnly: ml('View', 'Visualiser', 'Anzeigen'),
    delete: ml('Delete', 'Supprimer', 'Löschen')
  },
  graphicsCatalog: {
    title: ml('Graphics catalog', 'Catalogue de graphiques', 'Grafikkatalog'),
    tabGlb: ml('3D objects (GLB)', 'Objets 3D (GLB)', '3D-Objekte (GLB)'),
    tabBillboards: ml('Billboards', 'Billboards', 'Billboards'),
    close: ml('Close', 'Fermer', 'Schließen'),
    import: ml('Import', 'Importer', 'Importieren'),
    name: ml('Name', 'Nom', 'Name'),
    resourceNamePlaceholder: ml(
      'Resource name',
      'Nom de la ressource',
      'Ressourcenname'
    ),
    library: ml('Library', 'Bibliothèque', 'Bibliothek'),
    optional: ml('(optional)', '(optionnel)', '(optional)'),
    chooseFile: ml('Choose a file', 'Choisir un fichier', 'Datei auswählen'),
    noResource: ml(
      'No resource imported',
      'Aucune ressource importée',
      'Keine Ressource importiert'
    ),
    noLibrary: ml('No library', 'Sans bibliothèque', 'Ohne Bibliothek'),
    delete: ml('Delete', 'Supprimer', 'Löschen'),
    fileUnreadable: ml(
      'Cannot read the file.',
      'Lecture du fichier impossible.',
      'Datei kann nicht gelesen werden.'
    ),
    importFailed: ml(
      'Import failed (write rights or backend unavailable).',
      "Échec de l'import (droits d'écriture ou backend indisponible).",
      'Import fehlgeschlagen (Schreibrechte oder Backend nicht verfügbar).'
    )
  },
  stateMapping: {
    title: ml("State mappings", "Mappings d'état", 'Zustandszuordnungen'),
    close: ml('Close', 'Fermer', 'Schließen'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    mapping: ml('Mapping', 'Mapping', 'Zuordnung'), // TODO(de): review technical term
    newItem: ml('New', 'Nouveau', 'Neu'),
    deleteMapping: ml(
      'Delete this mapping',
      'Supprimer ce mapping',
      'Diese Zuordnung löschen'
    ),
    name: ml('Name', 'Nom', 'Name'),
    fallbackState: ml('Default state', 'État par défaut', 'Standardzustand'),
    rulesHeading: ml(
      'Rules (first match wins)',
      'Règles (première correspondance gagne)',
      'Regeln (erste Übereinstimmung gewinnt)'
    ),
    addRule: ml('Add a rule', 'Ajouter une règle', 'Regel hinzufügen'),
    colorsHeading: ml('Colours per state', 'Couleurs par état', 'Farben pro Zustand'),
    min: ml('min', 'min', 'min'),
    max: ml('max', 'max', 'max'),
    newMappingName: ml('New mapping', 'Nouveau mapping', 'Neue Zuordnung')
  },
  trsThresholds: {
    title: ml('TRS thresholds', 'Seuils TRS', 'OEE-Schwellenwerte'), // TODO(de): TRS=OEE confirm
    close: ml('Close', 'Fermer', 'Schließen'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    configuration: ml('Configuration', 'Configuration', 'Konfiguration'),
    newItem: ml('New', 'Nouveau', 'Neu'),
    deleteConfig: ml(
      'Delete this configuration',
      'Supprimer cette configuration',
      'Diese Konfiguration löschen'
    ),
    name: ml('Name', 'Nom', 'Name'),
    bandsHeading: ml(
      'Value bands (TRS ≥ threshold → colour)',
      'Bandes de valeurs (TRS ≥ seuil → couleur)',
      'Wertebänder (OEE ≥ Schwelle → Farbe)' // TODO(de): TRS=OEE confirm
    ),
    colThreshold: ml('Threshold (%)', 'Seuil (%)', 'Schwelle (%)'),
    colColour: ml('Colour', 'Couleur', 'Farbe'),
    colLabel: ml('Label', 'Libellé', 'Bezeichnung'),
    addBand: ml('Add a band', 'Ajouter une bande', 'Band hinzufügen'),
    newConfigName: ml('New thresholds', 'Nouveaux seuils', 'Neue Schwellenwerte')
  }
} as const;

/** "from <start> to <end>" range label for the machine dashboard period. */
export function rangeLabelMsg(start: string, end: string): string {
  return localize(
    ml(`from ${start} to ${end}`, `du ${start} au ${end}`, `von ${start} bis ${end}`)
  );
}

/** "Link <n>" fallback label for an unnamed external dashboard link. */
export function linkFallbackMsg(n: number): string {
  return localize(ml(`Link ${n}`, `Lien ${n}`, `Link ${n}`));
}

/** Hint describing the max number of external dashboard links shown in the popup. */
export function dashboardLinksHintMsg(max: number): string {
  return localize(
    ml(
      `Up to ${max} links appear as buttons in the machine card (popup). Each link opens in a new tab.`,
      `Jusqu'à ${max} liens s'affichent comme boutons dans la fiche machine (popup). Chaque lien s'ouvre dans un nouvel onglet.`,
      `Bis zu ${max} Links erscheinen als Schaltflächen in der Maschinenkarte (Popup). Jeder Link öffnet sich in einem neuen Tab.`
    )
  );
}

/** "No <class> stop over the period." message for the machine-dashboard Pareto. */
export function noStopOfClassMsg(klass: string): string {
  return localize(
    ml(
      `No ${klass} stop over the period.`,
      `Aucun arrêt ${klass} sur la période.`,
      `Kein ${klass} Stillstand im Zeitraum.`
    )
  );
}

/** Confirm-delete message for a machine in the config panel (plain string). */
export function confirmDeleteMachineMsg(name: string): string {
  return localize(
    ml(
      `Remove the machine « ${name} » from this atelier?`,
      `Supprimer la machine « ${name} » de cet atelier ?`,
      `Maschine « ${name} » aus dieser Werkstatt entfernen?`
    )
  );
}

/** "Machines (<shown>/<total>)" section title for the config panel. */
export function machinesCountMsg(shown: number, total: number): string {
  return localize(
    ml(
      `Machines (${shown}/${total})`,
      `Machines (${shown}/${total})`,
      `Maschinen (${shown}/${total})`
    )
  );
}

/** "Resources (<n>)" subhead for the graphics catalog. */
export function resourcesCountMsg(n: number): string {
  return localize(ml(`Resources (${n})`, `Ressources (${n})`, `Ressourcen (${n})`));
}

/** "File too large" error for the graphics-catalog import (plain string). */
export function fileTooLargeMsg(sizeMb: string, maxMb: number): string {
  return localize(
    ml(
      `File too large (${sizeMb} MB, max ${maxMb} MB).`,
      `Fichier trop volumineux (${sizeMb} Mo, max ${maxMb} Mo).`,
      `Datei zu groß (${sizeMb} MB, max ${maxMb} MB).`
    )
  );
}

/** Confirm-delete message for an atelier (plain string with the atelier name). */
export function confirmDeleteAtelierMsg(name: string): string {
  return localize(
    ml(
      `Permanently delete the atelier « ${name} » and its datapoint?`,
      `Supprimer définitivement l'atelier « ${name} » et son datapoint ?`,
      `Werkstatt « ${name} » und ihren Datapoint endgültig löschen?`
    )
  );
}
