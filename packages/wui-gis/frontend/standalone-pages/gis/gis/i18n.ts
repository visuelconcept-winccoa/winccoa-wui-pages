// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the GIS page.
 *
 * All user-visible strings are {@link MultiLangString} maps resolved against the
 * active WebUI language via `lit-translate` (shared singleton — same instance as
 * the app shell, so the page reacts to the user's language). Use {@link localizeDir}
 * inside templates (reactive, re-renders on language change) and {@link localize}
 * for plain-string contexts (current language at call time).
 *
 * Locale keys use the base `.utf8` form (`en_US.utf8` / `fr.utf8` / `de.utf8`) so
 * any country variant (fr_FR, de_AT, de_CH, …) still resolves — the resolver falls
 * back to the language sub-tag.
 */
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import type { AssetKind, BasemapKind, ConnectionKind } from './types.js';

export {
  localize,
  localizeDir
} from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Label of each asset kind — also the marker's accessible name. */
export const ASSET_KIND_LABELS: Record<AssetKind, MultiLangString> = {
  generic: ml('Asset', 'Équipement', 'Anlage'),
  pump: ml('Pump', 'Pompe', 'Pumpe'),
  tank: ml('Reservoir', 'Réservoir', 'Behälter'),
  valve: ml('Valve', 'Vanne', 'Ventil'),
  meter: ml('Meter', 'Compteur', 'Zähler'),
  sensor: ml('Sensor', 'Capteur', 'Sensor'),
  treatment: ml('Treatment plant', 'Station de traitement', 'Kläranlage'),
  well: ml('Well / borehole', 'Forage / puits', 'Brunnen'),
  station: ml('Station', 'Station', 'Station'),
  cabinet: ml('Cabinet', 'Armoire', 'Schaltschrank'),
  light: ml('Street lighting', 'Éclairage public', 'Straßenbeleuchtung'),
  traffic: ml('Traffic light', 'Feu tricolore', 'Lichtsignalanlage'),
  air: ml('Air quality', 'Qualité de l’air', 'Luftqualität'),
  charger: ml('EV charger', 'Borne de recharge', 'Ladesäule'),
  tunnel: ml('Tunnel', 'Tunnel', 'Tunnel'),
  building: ml('Building', 'Bâtiment', 'Gebäude')
};

/** Label of each basemap kind. */
export const BASEMAP_LABELS: Record<BasemapKind, MultiLangString> = {
  osm: ml(
    'OpenStreetMap (public tiles)',
    'OpenStreetMap (tuiles publiques)',
    'OpenStreetMap (öffentliche Tiles)'
  ),
  raster: ml(
    'Own raster tile server (XYZ)',
    'Serveur de tuiles raster propre (XYZ)',
    'Eigener Raster-Tile-Server (XYZ)'
  ),
  style: ml(
    'Own vector style (MapLibre JSON)',
    'Style vectoriel propre (JSON MapLibre)',
    'Eigener Vektor-Style (MapLibre JSON)'
  ),
  none: ml(
    'No basemap (offline)',
    'Aucun fond de carte (hors ligne)',
    'Keine Basiskarte (offline)'
  )
};

/** Static UI strings, grouped by area. */
export const MSG = {
  page: {
    title: ml('GIS', 'SIG', 'GIS'),
    subtitle: ml(
      'Map-based supervision of the geo-located assets.',
      'Supervision cartographique des équipements géolocalisés.',
      'Kartenbasierte Überwachung der georeferenzierten Anlagen.'
    ),
    forbidden: ml(
      'You are not allowed to view this page.',
      'Vous n’êtes pas autorisé à consulter cette page.',
      'Sie dürfen diese Seite nicht ansehen.'
    ),
    offline: ml(
      'Demo sites: no GIS_Site datapoint found (or the backend is unreachable) — changes are kept in this browser only.',
      'Sites de démonstration : aucun datapoint GIS_Site trouvé (ou backend indisponible) — les modifications ne sont conservées que dans ce navigateur.',
      'Demo-Standorte: kein GIS_Site-Datenpunkt gefunden (oder Backend nicht erreichbar) — Änderungen bleiben nur in diesem Browser.'
    ),
    loading: ml(
      'Loading the sites…',
      'Chargement des sites…',
      'Standorte werden geladen…'
    )
  },

  overview: {
    empty: ml(
      'No site yet.',
      'Aucun site pour l’instant.',
      'Noch kein Standort.'
    ),
    emptyHint: ml(
      'Create a site, then place its assets on the map.',
      'Créez un site, puis placez ses équipements sur la carte.',
      'Erstellen Sie einen Standort und platzieren Sie dann seine Anlagen auf der Karte.'
    ),
    create: ml('New site', 'Nouveau site', 'Neuer Standort'),
    seedDemo: ml(
      'Load the demo sites',
      'Charger les sites de démonstration',
      'Demo-Standorte laden'
    ),
    colName: ml('Site', 'Site', 'Standort'),
    colCategory: ml('Category', 'Catégorie', 'Kategorie'),
    colAreas: ml('Areas', 'Zones', 'Bereiche'),
    colAssets: ml('Assets', 'Équipements', 'Anlagen'),
    colAlarms: ml('In alarm', 'En alarme', 'In Alarm'),
    colUpdated: ml(
      'Last saved',
      'Dernier enregistrement',
      'Zuletzt gespeichert'
    ),
    open: ml('Open', 'Ouvrir', 'Öffnen'),
    rename: ml('Settings', 'Paramètres', 'Einstellungen'),
    remove: ml('Delete', 'Supprimer', 'Löschen'),
    never: ml('never', 'jamais', 'nie')
  },

  map: {
    back: ml('All sites', 'Tous les sites', 'Alle Standorte'),
    fit: ml('Fit to content', 'Ajuster au contenu', 'An Inhalt anpassen'),
    recenter: ml(
      'Back to the site view',
      'Revenir à la vue du site',
      'Zurück zur Standortansicht'
    ),
    edit: ml('Edit', 'Éditer', 'Bearbeiten'),
    done: ml('Done', 'Terminer', 'Fertig'),
    addAsset: ml('Place an asset', 'Placer un équipement', 'Anlage platzieren'),
    addAssetHint: ml(
      'Click the map to place the asset.',
      'Cliquez sur la carte pour placer l’équipement.',
      'Klicken Sie auf die Karte, um die Anlage zu platzieren.'
    ),
    drawArea: ml('Draw an area', 'Tracer une zone', 'Bereich zeichnen'),
    drawAreaHint: ml(
      'Click each corner of the area, then close it with the button (at least 3 points).',
      'Cliquez chaque sommet de la zone, puis fermez-la avec le bouton (3 points minimum).',
      'Klicken Sie jede Ecke des Bereichs an und schließen Sie ihn dann mit der Schaltfläche (mindestens 3 Punkte).'
    ),
    finishArea: ml('Close the area', 'Fermer la zone', 'Bereich schließen'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    noBasemap: ml('No basemap', 'Aucun fond de carte', 'Keine Basiskarte'),
    tilesFailed: ml(
      'The basemap tiles could not be loaded — assets and areas are still shown. Check the tile server (or switch the site to "No basemap").',
      'Les tuiles du fond de carte n’ont pas pu être chargées — les équipements et les zones restent affichés. Vérifiez le serveur de tuiles (ou passez le site en « Aucun fond de carte »).',
      'Die Basiskarten-Tiles konnten nicht geladen werden — Anlagen und Bereiche werden weiterhin angezeigt. Prüfen Sie den Tile-Server (oder stellen Sie den Standort auf „Keine Basiskarte“).'
    ),
    cspBlocked: ml(
      'The basemap is blocked by the page’s security policy: this project does not allow external resources. Enable “Allow external resources” in the WinCC OA WebUI settings, or point this site at a tile server on the same origin (or switch it to “No basemap”). Assets and areas are still shown.',
      'Le fond de carte est bloqué par la politique de sécurité de la page : ce projet n’autorise pas les ressources externes. Activez « Allow external resources » dans les paramètres WebUI de WinCC OA, ou faites pointer ce site vers un serveur de tuiles de même origine (ou passez-le en « Aucun fond de carte »). Les équipements et les zones restent affichés.',
      'Die Basiskarte wird von der Sicherheitsrichtlinie der Seite blockiert: dieses Projekt erlaubt keine externen Ressourcen. Aktivieren Sie „Allow external resources“ in den WinCC-OA-WebUI-Einstellungen, oder verweisen Sie diesen Standort auf einen Tile-Server derselben Herkunft (oder stellen Sie ihn auf „Keine Basiskarte“). Anlagen und Bereiche werden weiterhin angezeigt.'
    ),
    webglFailed: ml(
      'This browser or graphics driver provides no usable WebGL context, so the map cannot be drawn.',
      'Ce navigateur ou ce pilote graphique ne fournit aucun contexte WebGL exploitable : la carte ne peut pas être dessinée.',
      'Dieser Browser oder Grafiktreiber stellt keinen nutzbaren WebGL-Kontext bereit, daher kann die Karte nicht gezeichnet werden.'
    ),
    areaFilter: ml('Area', 'Zone', 'Bereich'),
    allAreas: ml('Whole site', 'Tout le site', 'Gesamter Standort'),
    noArea: ml('Outside any area', 'Hors zone', 'Außerhalb aller Bereiche'),
    declutter: ml(
      'Group when zoomed out',
      'Regrouper en vue large',
      'Bei Weitsicht gruppieren'
    ),
    declutterHint: ml(
      'Zoomed out, assets are grouped into count badges so their markers stop overlapping; the ones in alarm always stay visible. Turn this off to show every asset.',
      'En vue large, les équipements sont regroupés en pastilles comptées pour que leurs marqueurs ne se chevauchent plus ; ceux en alarme restent toujours visibles. Désactivez pour afficher tous les équipements.',
      'Bei Weitsicht werden Anlagen zu Zählplaketten gruppiert, damit sich ihre Marker nicht überlappen; die in Alarm bleiben immer sichtbar. Zum Anzeigen aller Anlagen deaktivieren.'
    ),
    alarmsOnly: ml('In alarm only', 'En alarme seulement', 'Nur in Alarm'),
    assetCount: ml('assets', 'équipements', 'Anlagen'),
    emptySite: ml(
      'This site has no asset yet — switch to Edit and place one.',
      'Ce site n’a encore aucun équipement — passez en édition et placez-en un.',
      'Dieser Standort hat noch keine Anlage — wechseln Sie in den Bearbeitungsmodus und platzieren Sie eine.'
    )
  },

  inspector: {
    title: ml('Asset', 'Équipement', 'Anlage'),
    areaTitle: ml('Area', 'Zone', 'Bereich'),
    none: ml(
      'Select an asset on the map.',
      'Sélectionnez un équipement sur la carte.',
      'Wählen Sie eine Anlage auf der Karte aus.'
    ),
    name: ml('Name', 'Nom', 'Name'),
    kind: ml('Kind', 'Type', 'Art'),
    area: ml('Area', 'Zone', 'Bereich'),
    areas: ml('Areas', 'Zones', 'Bereiche'),
    areasHint: ml(
      'An asset can belong to several areas — each of them lists it and counts it.',
      'Un équipement peut appartenir à plusieurs zones — chacune le liste et le compte.',
      'Eine Anlage kann zu mehreren Bereichen gehören — jeder listet und zählt sie.'
    ),
    primaryAreaHint: ml(
      'When areas are grouped, the marker joins the badge of its first area:',
      'Lors du regroupement, le marqueur rejoint la pastille de sa première zone :',
      'Beim Gruppieren gehört der Marker zur Plakette seines ersten Bereichs:'
    ),
    position: ml('Position', 'Position', 'Position'),
    latitude: ml('Latitude', 'Latitude', 'Breite'),
    longitude: ml('Longitude', 'Longitude', 'Länge'),
    primaryDp: ml(
      'Primary datapoint',
      'Datapoint principal',
      'Haupt-Datenpunkt'
    ),
    primaryDpHint: ml(
      'Its alarm state colours the marker and scopes the Alarms drill-down.',
      'Son état d’alarme colore le marqueur et cadre la navigation vers les alarmes.',
      'Sein Alarmzustand färbt den Marker und begrenzt den Alarm-Drilldown.'
    ),
    readings: ml('Live values', 'Valeurs temps réel', 'Live-Werte'),
    addReading: ml('Add a value', 'Ajouter une valeur', 'Wert hinzufügen'),
    readingLabel: ml('Caption', 'Libellé', 'Bezeichnung'),
    readingUnit: ml('Unit', 'Unité', 'Einheit'),
    readingDecimals: ml('Decimals', 'Décimales', 'Dezimalstellen'),
    readingOnMap: ml('On the map', 'Sur la carte', 'Auf der Karte'),
    noReadings: ml(
      'No value bound.',
      'Aucune valeur liée.',
      'Kein Wert gebunden.'
    ),
    notes: ml('Notes', 'Notes', 'Notizen'),
    drill: ml('Drill-down', 'Navigation', 'Drilldown'),
    drillTarget: ml('Target view', 'Vue cible', 'Zielansicht'),
    drillRoute: ml('Route', 'Route', 'Route'),
    drillInvalid: ml(
      'A route must start with a slash, e.g. /fleet-3d/station-nord',
      'Une route doit commencer par une barre oblique, ex. /fleet-3d/station-nord',
      'Eine Route muss mit einem Schrägstrich beginnen, z. B. /fleet-3d/station-nord'
    ),
    goToArea: ml('Go to this area', 'Aller à cette zone', 'Zu diesem Bereich'),
    goToLine: ml('Go to this line', 'Aller à cette ligne', 'Zu dieser Linie'),
    openTarget: ml(
      'Open the target view',
      'Ouvrir la vue cible',
      'Zielansicht öffnen'
    ),
    openAlarms: ml(
      'Alarms of this asset',
      'Alarmes de cet équipement',
      'Alarme dieser Anlage'
    ),
    remove: ml('Delete the asset', 'Supprimer l’équipement', 'Anlage löschen'),
    removeArea: ml('Delete the area', 'Supprimer la zone', 'Bereich löschen'),
    unbound: ml('not bound', 'non lié', 'nicht gebunden'),
    noValue: ml('no value', 'pas de valeur', 'kein Wert'),
    inAlarm: ml('In alarm', 'En alarme', 'In Alarm'),
    color: ml('Colour', 'Couleur', 'Farbe'),
    groupZoom: ml(
      'Group below zoom',
      'Regrouper sous le zoom',
      'Gruppieren unter Zoom'
    ),
    groupZoomHint: ml(
      '0 = automatic: the area collapses into one badge as soon as it is too small on screen to tell its assets apart. Set a zoom level to decide yourself.',
      '0 = automatique : la zone se replie en une pastille dès qu’elle est trop petite à l’écran pour distinguer ses équipements. Indiquez un niveau de zoom pour décider vous-même.',
      '0 = automatisch: der Bereich klappt zu einer Plakette zusammen, sobald er auf dem Bildschirm zu klein ist, um seine Anlagen zu unterscheiden. Geben Sie eine Zoomstufe an, um selbst zu entscheiden.'
    ),
    areaAssets: ml(
      'Assets in this area',
      'Équipements de cette zone',
      'Anlagen in diesem Bereich'
    ),
    zoomToArea: ml(
      'Zoom to the area',
      'Zoomer sur la zone',
      'Auf Bereich zoomen'
    )
  },

  site: {
    createTitle: ml('New site', 'Nouveau site', 'Neuer Standort'),
    editTitle: ml(
      'Site settings',
      'Paramètres du site',
      'Standort-Einstellungen'
    ),
    name: ml('Name', 'Nom', 'Name'),
    description: ml('Description', 'Description', 'Beschreibung'),
    category: ml('Category', 'Catégorie', 'Kategorie'),
    categoryHint: ml(
      'Free grouping label shown on the overview (e.g. Water, City).',
      'Libellé de regroupement libre affiché sur la vue d’ensemble (ex. Eau, Ville).',
      'Freies Gruppierungslabel in der Übersicht (z. B. Wasser, Stadt).'
    ),
    center: ml('Map centre', 'Centre de la carte', 'Kartenmittelpunkt'),
    zoom: ml('Zoom', 'Zoom', 'Zoom'),
    basemap: ml('Basemap', 'Fond de carte', 'Basiskarte'),
    tileUrl: ml(
      'Tile URL template',
      'Modèle d’URL des tuiles',
      'Tile-URL-Vorlage'
    ),
    tileUrlHint: ml(
      'XYZ template, e.g. https://tiles.mycompany.local/{z}/{x}/{y}.png',
      'Modèle XYZ, ex. https://tuiles.masociete.local/{z}/{x}/{y}.png',
      'XYZ-Vorlage, z. B. https://tiles.meinefirma.local/{z}/{x}/{y}.png'
    ),
    styleUrl: ml('Style JSON URL', 'URL du style JSON', 'Style-JSON-URL'),
    attribution: ml('Attribution', 'Attribution', 'Namensnennung'),
    attributionHint: ml(
      'Credit line the tile licence requires.',
      'Mention exigée par la licence des tuiles.',
      'Vom Tile-Lizenzvertrag verlangte Namensnennung.'
    ),
    maxZoom: ml(
      'Maximum tile zoom',
      'Zoom maximal des tuiles',
      'Maximaler Tile-Zoom'
    ),
    groupZoom: ml(
      'Collapse the whole site below zoom',
      'Replier tout le site sous le zoom',
      'Gesamten Standort zusammenklappen unter Zoom'
    ),
    groupZoomHint: ml(
      '0 = automatic: the site collapses into a single badge as soon as it is too narrow on screen for its area badges to sit side by side. Set a zoom level to decide yourself.',
      '0 = automatique : le site se replie en une seule pastille dès qu’il est trop étroit à l’écran pour que les pastilles de ses zones tiennent côte à côte. Indiquez un niveau de zoom pour décider vous-même.',
      '0 = automatisch: der Standort klappt zu einer einzigen Plakette zusammen, sobald er zu schmal ist, damit die Bereichsplaketten nebeneinander passen. Geben Sie eine Zoomstufe an, um selbst zu entscheiden.'
    ),
    osmPolicy: ml(
      'The public OpenStreetMap tiles are free of licence cost but capped by the OSMF tile usage policy — point a production deployment at your own tile server.',
      'Les tuiles publiques OpenStreetMap sont gratuites mais limitées par la politique d’usage de l’OSMF — en production, pointez vers votre propre serveur de tuiles.',
      'Die öffentlichen OpenStreetMap-Tiles sind kostenlos, aber durch die OSMF-Nutzungsrichtlinie begrenzt — im Produktivbetrieb einen eigenen Tile-Server verwenden.'
    ),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    nameRequired: ml(
      'A name is required.',
      'Un nom est requis.',
      'Ein Name ist erforderlich.'
    ),
    centerInvalid: ml(
      'Latitude must be within ±90 and longitude within ±180.',
      'La latitude doit être comprise dans ±90 et la longitude dans ±180.',
      'Breite muss innerhalb ±90 und Länge innerhalb ±180 liegen.'
    ),
    urlRequired: ml(
      'This basemap needs a URL.',
      'Ce fond de carte nécessite une URL.',
      'Diese Basiskarte benötigt eine URL.'
    )
  },

  ai: {
    assistantTitle: ml('AI assistant', 'Assistant IA', 'KI-Assistent'),
    panelTitle: ml('GIS assistant', 'Assistant SIG', 'GIS-Assistent'),
    placeholder: ml(
      'Describe the site to configure — its areas and the assets to place. The assistant proposes a draft; you review it on the map before saving.',
      'Décrivez le site à configurer — ses zones et les équipements à placer. L’assistant propose un brouillon ; vous le vérifiez sur la carte avant d’enregistrer.',
      'Beschreiben Sie den einzurichtenden Standort — seine Bereiche und die zu platzierenden Anlagen. Der Assistent schlägt einen Entwurf vor; Sie prüfen ihn auf der Karte, bevor gespeichert wird.'
    ),
    composerPlaceholder: ml(
      'e.g. a drinking-water network around Annecy with 3 sectors…  (Ctrl+Enter to send)',
      'ex. un réseau d’eau potable autour d’Annecy avec 3 secteurs…  (Ctrl+Entrée pour envoyer)',
      'z. B. ein Trinkwassernetz um Annecy mit 3 Sektoren…  (Strg+Enter zum Senden)'
    ),
    send: ml('Send', 'Envoyer', 'Senden'),
    clear: ml(
      'Clear the conversation',
      'Effacer la conversation',
      'Unterhaltung löschen'
    ),
    configure: ml(
      'Configure the assistant',
      'Configurer l’assistant',
      'Assistent konfigurieren'
    ),
    // "Minimise", not "Close": the conversation is kept and the AI icon reopens it.
    close: ml('Minimise', 'Réduire', 'Minimieren'),
    thinking: ml('Thinking…', 'Réflexion…', 'Denkt nach…'),
    emptyAnswer: ml('(empty answer)', '(réponse vide)', '(leere Antwort)'),
    applyAsNew: ml('Create this site', 'Créer ce site', 'Standort erstellen'),
    applyToSite: ml(
      'Apply to this site',
      'Appliquer à ce site',
      'Auf diesen Standort anwenden'
    ),
    approxWarn: ml(
      'The coordinates are approximate — the assistant has no geocoder. Check every marker on the map and drag it into place.',
      'Les coordonnées sont approximatives — l’assistant n’a pas de géocodeur. Vérifiez chaque marqueur sur la carte et repositionnez-le.',
      'Die Koordinaten sind ungefähr — der Assistent hat keinen Geocoder. Prüfen Sie jeden Marker auf der Karte und ziehen Sie ihn an die richtige Stelle.'
    ),
    replaceWarn: ml(
      'This proposal REPLACES the site rather than completing it: everything it does not list is removed.',
      'Cette proposition REMPLACE le site au lieu de le compléter : tout ce qu’elle ne liste pas est supprimé.',
      'Dieser Vorschlag ERSETZT den Standort statt ihn zu ergänzen: alles, was er nicht auflistet, wird entfernt.'
    ),
    noChange: ml(
      'This proposal changes nothing on the site as it stands.',
      'Cette proposition ne change rien au site dans son état actuel.',
      'Dieser Vorschlag ändert am derzeitigen Standort nichts.'
    ),
    diffView: ml('framing', 'cadrage', 'Ausschnitt'),
    droppedWarn: ml(
      'Some proposed items were unusable and have been dropped.',
      'Certains éléments proposés étaient inexploitables et ont été écartés.',
      'Einige vorgeschlagene Elemente waren unbrauchbar und wurden verworfen.'
    ),
    noDpWarn: ml(
      'The assistant never binds datapoints — bind them yourself in the inspector.',
      'L’assistant ne lie jamais les datapoints — liez-les vous-même dans l’inspecteur.',
      'Der Assistent bindet keine Datenpunkte — binden Sie sie selbst im Inspektor.'
    ),
    // Diff chips. `%n` is the count, substituted by `diffSummaryMsg`.
    diffAdded: ml('%n added', '%n ajout(s)', '%n hinzugefügt'),
    diffUpdated: ml('%n modified', '%n modification(s)', '%n geändert'),
    diffRemoved: ml('%n removed', '%n suppression(s)', '%n entfernt')
  },

  aiSuggestions: {
    s1: ml(
      'A drinking-water network around Annecy: 3 sectors, treatment plant, 2 pumping stations, 3 reservoirs and sector flowmeters.',
      'Un réseau d’eau potable autour d’Annecy : 3 secteurs, une usine de traitement, 2 stations de pompage, 3 réservoirs et des débitmètres de sectorisation.',
      'Ein Trinkwassernetz um Annecy: 3 Sektoren, Wasserwerk, 2 Pumpstationen, 3 Behälter und Sektor-Durchflussmesser.'
    ),
    s2: ml(
      'A city centre with 3 districts: traffic lights, air-quality sensors, street-lighting cabinets and EV chargers.',
      'Un centre-ville avec 3 quartiers : feux tricolores, capteurs de qualité de l’air, armoires d’éclairage public et bornes de recharge.',
      'Eine Innenstadt mit 3 Quartieren: Lichtsignalanlagen, Luftqualitätssensoren, Beleuchtungsschränke und Ladesäulen.'
    ),
    s3: ml(
      'Add two boreholes in the north sector, with a level and a flow reading each.',
      'Ajoute deux forages dans le secteur nord, avec un niveau et un débit chacun.',
      'Füge zwei Brunnen im Nordsektor hinzu, jeweils mit Füllstand und Durchfluss.'
    ),
    s4: ml(
      'What readings would you suggest for a pumping station?',
      'Quelles valeurs proposerais-tu pour une station de pompage ?',
      'Welche Messwerte würdest du für eine Pumpstation vorschlagen?'
    )
  },

  io: {
    importLabel: ml('Import', 'Importer', 'Importieren'),
    importHint: ml(
      'A GIS JSON export, or a GeoJSON layer (polygons become areas, points become assets).',
      'Un export JSON du SIG, ou une couche GeoJSON (les polygones deviennent des zones, les points des équipements).',
      'Ein GIS-JSON-Export oder ein GeoJSON-Layer (Polygone werden Bereiche, Punkte werden Anlagen).'
    ),
    exportAll: ml('Export all', 'Tout exporter', 'Alles exportieren'),
    exportJson: ml('Export (JSON)', 'Exporter (JSON)', 'Exportieren (JSON)'),
    exportGeoJson: ml(
      'Export (GeoJSON)',
      'Exporter (GeoJSON)',
      'Exportieren (GeoJSON)'
    ),
    exportJsonHint: ml(
      'The complete configuration: bindings, readings, drill-down, basemap.',
      'La configuration complète : liaisons, valeurs, navigation, fond de carte.',
      'Die komplette Konfiguration: Bindungen, Werte, Drilldown, Basiskarte.'
    ),
    exportGeoJsonHint: ml(
      'Geometry for QGIS and other GIS tools; datapoint bindings travel as properties.',
      'La géométrie pour QGIS et les autres outils SIG ; les liaisons datapoint voyagent en propriétés.',
      'Geometrie für QGIS und andere GIS-Werkzeuge; Datenpunktbindungen reisen als Eigenschaften.'
    ),
    notJson: ml(
      'This file is not valid JSON.',
      'Ce fichier n’est pas du JSON valide.',
      'Diese Datei ist kein gültiges JSON.'
    ),
    noSite: ml(
      'No usable site found in this file.',
      'Aucun site exploitable trouvé dans ce fichier.',
      'Keine verwertbare Standortdefinition in dieser Datei gefunden.'
    ),
    importFailed: ml(
      'Import failed.',
      'L’import a échoué.',
      'Import fehlgeschlagen.'
    ),
    geoJsonReplaces: ml(
      'A GeoJSON layer replaces the areas and assets of the open site — review it on the map, then press Done.',
      'Une couche GeoJSON remplace les zones et les équipements du site ouvert — vérifiez sur la carte, puis appuyez sur Terminer.',
      'Ein GeoJSON-Layer ersetzt Bereiche und Anlagen des offenen Standorts — auf der Karte prüfen, dann Fertig drücken.'
    ),
    imported: ml('imported', 'importé(s)', 'importiert')
  },

  ring: {
    edit: ml('Edit the outline', 'Éditer le contour', 'Umriss bearbeiten'),
    done: ml('Finish the outline', 'Terminer le contour', 'Umriss abschließen'),
    draw: ml('Draw the outline', 'Tracer le contour', 'Umriss zeichnen'),
    fit: ml(
      'Fit around the assets',
      'Ajuster autour des équipements',
      'Um die Anlagen anpassen'
    ),
    fitHint: ml(
      'Redraw the outline tightly around this area’s assets (convex hull, 150 m margin). Replaces the current outline.',
      'Retrace le contour au plus près des équipements de cette zone (enveloppe convexe, marge de 150 m). Remplace le contour actuel.',
      'Zeichnet den Umriss eng um die Anlagen dieses Bereichs (konvexe Hülle, 150 m Rand). Ersetzt den aktuellen Umriss.'
    ),
    hint: ml(
      'Drag a corner to move it, click a corner to remove it, click a hollow midpoint to add one.',
      'Faites glisser un sommet pour le déplacer, cliquez un sommet pour le supprimer, cliquez un point milieu creux pour en ajouter un.',
      'Ziehen Sie eine Ecke, um sie zu verschieben, klicken Sie eine Ecke, um sie zu entfernen, klicken Sie einen hohlen Mittelpunkt, um eine hinzuzufügen.'
    ),
    drawHint: ml(
      'Click each corner of the outline, then close it with the button (at least 3 points).',
      'Cliquez chaque sommet du contour, puis fermez-le avec le bouton (3 points minimum).',
      'Klicken Sie jede Ecke des Umrisses an und schließen Sie ihn dann mit der Schaltfläche (mindestens 3 Punkte).'
    ),
    vertexHint: ml(
      'Drag to move, click to remove',
      'Glisser pour déplacer, cliquer pour supprimer',
      'Ziehen zum Verschieben, Klicken zum Entfernen'
    ),
    vertexLocked: ml(
      'Drag to move (a triangle is the smallest outline)',
      'Glisser pour déplacer (un triangle est le contour minimal)',
      'Ziehen zum Verschieben (ein Dreieck ist der kleinste Umriss)'
    ),
    midpointHint: ml(
      'Click to add a corner',
      'Cliquer pour ajouter un sommet',
      'Klicken, um eine Ecke hinzuzufügen'
    ),
    noRing: ml(
      'This area has no outline — it only groups its assets.',
      'Cette zone n’a pas de contour — elle regroupe seulement ses équipements.',
      'Dieser Bereich hat keinen Umriss — er gruppiert nur seine Anlagen.'
    ),
    points: ml('corners', 'sommets', 'Ecken')
  },

  area: {
    noAssets: ml(
      'No asset in this area yet.',
      'Aucun équipement dans cette zone.',
      'Noch keine Anlage in diesem Bereich.'
    ),
    openAsset: ml(
      'Open this asset',
      'Ouvrir cet équipement',
      'Diese Anlage öffnen'
    ),
    createTitle: ml('New area', 'Nouvelle zone', 'Neuer Bereich'),
    name: ml('Name', 'Nom', 'Name'),
    nameRequired: ml(
      'A name is required.',
      'Un nom est requis.',
      'Ein Name ist erforderlich.'
    )
  },
  /** Information layers: the tags on assets, and their browser. */
  layer: {
    title: ml('Layers', 'Layers', 'Layer'),
    open: ml('Layers', 'Layers', 'Layer'),
    empty: ml(
      'No layer yet. Create one here, or tag an asset directly from its panel.',
      'Aucun layer. Créez-en un ici, ou taguez un équipement directement depuis son panneau.',
      'Noch kein Layer. Erstellen Sie hier einen, oder taggen Sie eine Anlage direkt in ihrem Panel.'
    ),
    create: ml('New layer', 'Nouveau layer', 'Neuer Layer'),
    remove: ml(
      'Delete this layer',
      'Supprimer ce layer',
      'Diesen Layer löschen'
    ),
    show: ml('Show this layer', 'Afficher ce layer', 'Diesen Layer anzeigen'),
    hide: ml('Hide this layer', 'Masquer ce layer', 'Diesen Layer ausblenden'),
    isolate: ml(
      'Show only this layer',
      'N’afficher que ce layer',
      'Nur diesen Layer anzeigen'
    ),
    showAll: ml(
      'Show every layer',
      'Afficher tous les layers',
      'Alle Layer anzeigen'
    ),
    count: ml('%n layer(s)', '%n layer(s)', '%n Layer'),
    tags: ml('Layers', 'Layers', 'Layer'),
    tagsHint: ml(
      'Free tags, unrelated to the zones. Type a name to create one.',
      'Tags libres, indépendants des zones. Saisissez un nom pour en créer un.',
      'Freie Tags, unabhängig von den Bereichen. Namen eingeben, um einen zu erstellen.'
    )
  },

  /** Connections and the named lines they belong to. */
  link: {
    draw: ml('Draw a line', 'Tracer une ligne', 'Linie zeichnen'),
    drawHint: ml(
      'Click assets one after another to link them. A click on the map between two assets shapes the segment. Escape or Cancel stops.',
      'Cliquez les équipements l’un après l’autre pour les relier. Un clic sur la carte entre deux équipements met le tracé en forme. Échap ou Annuler arrête.',
      'Klicken Sie die Anlagen nacheinander an, um sie zu verbinden. Ein Klick auf die Karte zwischen zwei Anlagen formt den Verlauf. Escape oder Abbrechen beendet.'
    ),
    title: ml('Connection', 'Liaison', 'Verbindung'),
    name: ml('Name', 'Nom', 'Name'),
    kind: ml('Type', 'Type', 'Typ'),
    route: ml('Line', 'Ligne', 'Linie'),
    noRoute: ml('Standalone', 'Autonome', 'Eigenständig'),
    newRoute: ml('New line…', 'Nouvelle ligne…', 'Neue Linie…'),
    routeHint: ml(
      'The line carries the colour and the style; a standalone connection uses the neutral one.',
      'La ligne porte la couleur et le style ; une liaison autonome prend la couleur neutre.',
      'Die Linie trägt Farbe und Stil; eine eigenständige Verbindung nutzt die neutrale Farbe.'
    ),
    ends: ml('From → to', 'De → vers', 'Von → nach'),
    endsHint: ml(
      'The ends are assets, so the line follows them when a marker is moved. Redraw the connection to change them.',
      'Les extrémités sont des équipements : la ligne les suit quand un marqueur est déplacé. Retracez la liaison pour les changer.',
      'Die Enden sind Anlagen, die Linie folgt ihnen beim Verschieben eines Markers. Zeichnen Sie die Verbindung neu, um sie zu ändern.'
    ),
    shapePoints: ml(
      '%n shaping point(s)',
      '%n point(s) de forme',
      '%n Formpunkt(e)'
    ),
    straighten: ml('Straighten', 'Redresser', 'Gerade ziehen'),
    delete: ml(
      'Delete this connection',
      'Supprimer cette liaison',
      'Diese Verbindung löschen'
    )
  }
} as const;

/** Label of a connection kind in the active language. */
export function connectionKindLabel(kind: ConnectionKind): string {
  return localize(CONNECTION_KIND_LABELS[kind]);
}

/** What each connection kind is called — the line-style picker reads these. */
const CONNECTION_KIND_LABELS: Record<ConnectionKind, MultiLangString> = {
  generic: ml('Link', 'Liaison', 'Verbindung'),
  metro: ml('Metro', 'Métro', 'Metro'),
  rail: ml('Rail', 'Voie ferrée', 'Bahn'),
  power: ml('Power line', 'Ligne électrique', 'Stromleitung'),
  cable: ml('Cable', 'Câble', 'Kabel'),
  pipe: ml('Pipe', 'Conduite', 'Leitung'),
  road: ml('Road', 'Route', 'Straße')
};

/** Label of an asset kind in the active language. */
export function assetKindLabel(kind: AssetKind): string {
  return localize(ASSET_KIND_LABELS[kind]);
}

/** One diff chip: `"3 ajout(s)"` — the count substituted into a `%n` template. */
export function diffSummaryMsg(
  template: MultiLangString,
  count: number
): string {
  return localize(template).replace('%n', String(count));
}

/**
 * Tooltip of a count badge. `label` names the area or site it stands for when it stands
 * for one — a grid cell has no name, so it says only how many assets it hides.
 */
export function clusterTitle(
  label: string,
  count: number,
  alarms: number
): string {
  const what = label ? `${label} — ` : '';
  const inAlarm = alarms > 0 ? `, ${alarmCountMsg(alarms)}` : '';
  return localize(
    ml(
      `${what}${count} assets${inAlarm} — click to zoom in`,
      `${what}${count} équipements${inAlarm} — cliquez pour zoomer`,
      `${what}${count} Anlagen${inAlarm} — zum Zoomen klicken`
    )
  );
}

/**
 * `"2 in alarm"` — the synthesis shown next to the asset count, so an operator sees how
 * many alarms the site holds without hunting for the markers that carry them.
 */
/** `"3 layer(s)"` — how many layers the site declares. */
export function layerUsageMsg(count: number): string {
  return localize(MSG.layer.count).replace('%n', String(count));
}

/** `"3 point(s) de forme"` — how many shaping vertices a connection's path carries. */
export function shapePointsMsg(count: number): string {
  return localize(MSG.link.shapePoints).replace('%n', String(count));
}

export function alarmCountMsg(count: number): string {
  return localize(
    ml(
      count === 1 ? '1 in alarm' : `${count} in alarm`,
      count === 1 ? '1 en alarme' : `${count} en alarme`,
      count === 1 ? '1 in Alarm' : `${count} in Alarm`
    )
  );
}

/** `"3 sites"` — the overview's header count, pluralised per language. */
export function siteCountMsg(count: number): string {
  const one = count === 1;
  return localize(
    ml(
      one ? '1 site' : `${count} sites`,
      one ? '1 site' : `${count} sites`,
      one ? '1 Standort' : `${count} Standorte`
    )
  );
}

/** `"12 of 34 assets"` — what the map is currently showing. */
export function assetCountMsg(shown: number, total: number): string {
  const unit = localize(MSG.map.assetCount);
  if (shown === total) return `${total} ${unit}`;
  const of = localize(ml('of', 'sur', 'von'));
  return `${shown} ${of} ${total} ${unit}`;
}

/** Confirmation shown before deleting a site. */
export function confirmDeleteSiteMsg(name: string): string {
  return localize(
    ml(
      `Delete the site “${name}” and its datapoint?`,
      `Supprimer le site « ${name} » et son datapoint ?`,
      `Standort „${name}“ und seinen Datenpunkt löschen?`
    )
  );
}
