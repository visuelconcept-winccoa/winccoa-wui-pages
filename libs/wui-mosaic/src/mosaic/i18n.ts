// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Mosaïque page.
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
  toolbar: {
    import: ml('Import', 'Importer', 'Importieren'),
    exportAll: ml('Export all', 'Exporter tout', 'Alle exportieren'),
    newMosaic: ml('New mosaic', 'Nouvelle mosaïque', 'Neues Mosaik'),
    backToList: ml('‹ Mosaics', '‹ Mosaïques', '‹ Mosaike'),
    addTile: ml('Add a tile', 'Ajouter une tuile', 'Kachel hinzufügen'),
    done: ml('Done', 'Terminer', 'Fertig'),
    edit: ml('Edit', 'Modifier', 'Bearbeiten')
  },
  page: {
    offline: ml(
      'Offline mode: changes are not persisted to datapoints (backend unavailable or missing write rights).',
      "Mode hors-ligne : modifications non persistées dans les datapoints (backend indisponible ou droits d'écriture manquants).",
      'Offline-Modus: Änderungen werden nicht in Datenpunkten gespeichert (Backend nicht verfügbar oder fehlende Schreibrechte).'
    ),
    emptyList: ml('No saved mosaic.', 'Aucune mosaïque enregistrée.', 'Kein gespeichertes Mosaik.'),
    generateDemo: ml(
      'Generate demo mosaics',
      'Générer des mosaïques de démonstration',
      'Demo-Mosaike erzeugen'
    ),
    missing: ml('Mosaic not found.', 'Mosaïque introuvable.', 'Mosaik nicht gefunden.'),
    backToList: ml('Back to the list', 'Retour à la liste', 'Zurück zur Liste'),
    importFailed: ml('Import failed.', 'Import échoué.', 'Import fehlgeschlagen.')
  },
  table: {
    name: ml('Name', 'Nom', 'Name'),
    sources: ml('Sources', 'Sources', 'Quellen'),
    tiles: ml('Tiles', 'Tuiles', 'Kacheln'),
    updatedAt: ml('Last modification', 'Dernière modification', 'Letzte Änderung'),
    open: ml('Open', 'Ouvrir', 'Öffnen'),
    rename: ml('Rename', 'Renommer', 'Umbenennen'),
    exportOne: ml('Export this mosaic', 'Exporter cette mosaïque', 'Dieses Mosaik exportieren'),
    remove: ml('Delete', 'Supprimer', 'Löschen'),
    emptyKinds: ml('empty', 'vide', 'leer'),
    never: ml('never', 'jamais', 'nie')
  },
  canvas: {
    emptyEditing: ml(
      'Add a tile to compose the mosaic.',
      'Ajoutez une tuile pour composer la mosaïque.',
      'Fügen Sie eine Kachel hinzu, um das Mosaik zusammenzustellen.'
    ),
    emptyDisplay: ml('Empty mosaic.', 'Mosaïque vide.', 'Leeres Mosaik.'),
    readonly: ml('Read-only', 'Lecture seule', 'Schreibgeschützt'),
    edit: ml('Edit', 'Modifier', 'Bearbeiten'),
    remove: ml('Delete', 'Supprimer', 'Löschen'),
    reload: ml('Reload', 'Recharger', 'Neu laden'),
    fullscreen: ml('Fullscreen', 'Plein écran', 'Vollbild'),
    resize: ml('Resize', 'Redimensionner', 'Größe ändern'),
    urlRefused: ml('External URL refused', 'URL externe refusée', 'Externe URL abgelehnt'),
    noSource: ml('Source not provided', 'Source non renseignée', 'Quelle nicht angegeben')
  },
  mosaicDialog: {
    newTitle: ml('New mosaic', 'Nouvelle mosaïque', 'Neues Mosaik'),
    renamePrefix: ml('Rename', 'Renommer', 'Umbenennen'),
    name: ml('Name', 'Nom', 'Name'),
    description: ml('Description', 'Description', 'Beschreibung'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    create: ml('Create', 'Créer', 'Erstellen'),
    save: ml('Save', 'Enregistrer', 'Speichern')
  },
  tile: {
    addTitle: ml('Add a tile', 'Ajouter une tuile', 'Kachel hinzufügen'),
    editTitle: ml('Edit the tile', 'Modifier la tuile', 'Kachel bearbeiten'),
    sourceKind: ml('Source type', 'Type de source', 'Quellentyp'),
    title: ml('Title', 'Titre', 'Titel'),
    display: ml('Display', 'Affichage', 'Anzeige'),
    interaction: ml(
      'Interaction (keyboard/mouse to the source)',
      'Interaction (clavier/souris vers la source)',
      'Interaktion (Tastatur/Maus zur Quelle)'
    ),
    forcedReadonly: ml(
      '— forced read-only',
      '— forcée en lecture seule',
      '— erzwungen schreibgeschützt'
    ),
    autoReload: ml(
      'Auto-reload (seconds, 0 = disabled)',
      'Rechargement automatique (secondes, 0 = désactivé)',
      'Automatisches Neuladen (Sekunden, 0 = deaktiviert)'
    ),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    add: ml('Add', 'Ajouter', 'Hinzufügen'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    // --- URL source ---
    urlLabel: ml('URL (relative to the server)', 'URL (relative au serveur)', 'URL (relativ zum Server)'),
    urlPlaceholder: ml(
      '/data/dashboard-wc/… or #/audit-trail',
      '/data/dashboard-wc/… ou #/audit-trail',
      '/data/dashboard-wc/… oder #/audit-trail'
    ),
    urlHint: ml(
      'Only URLs from this server (same origin); internal views via the hash, e.g. #/audit-trail.',
      'Uniquement des URL de ce serveur (même origine) ; les vues internes via le hash, ex. #/audit-trail.',
      'Nur URLs von diesem Server (gleicher Ursprung); interne Ansichten über den Hash, z. B. #/audit-trail.'
    ),
    // --- Fleet-3D source ---
    source: ml('Source', 'Source', 'Quelle'),
    fleetId: ml(
      'Identifier (empty = overview)',
      "Identifiant (vide = vue d’ensemble)",
      'Kennung (leer = Übersicht)'
    ),
    fleetIdHint: ml(
      'Workshop id (suffix of the MachineFleet3D_… DP).',
      'Id de l’atelier (suffixe du DP MachineFleet3D_…).',
      'Werkstatt-ID (Suffix des MachineFleet3D_…-DP).'
    ),
    fleetOverview: ml(
      'Overview (all workshops)',
      'Vue d’ensemble (tous les ateliers)',
      'Übersicht (alle Werkstätten)'
    ),
    // --- pick-source (VNC / camera) ---
    vncLabel: ml('VNC connection', 'Connexion VNC', 'VNC-Verbindung'),
    vncLower: ml('VNC connection', 'connexion VNC', 'VNC-Verbindung'),
    vncPage: ml('Remote VNC connections', 'Connexions VNC distantes', 'Remote-VNC-Verbindungen'),
    cameraLabel: ml('Camera', 'Caméra', 'Kamera'),
    cameraLower: ml('camera', 'caméra', 'Kamera'),
    cameraPage: ml('Camera streams (RTSP)', 'Flux caméras (RTSP)', 'Kamera-Streams (RTSP)')
  },
  kind: {
    fleet3d: ml('Machine fleet', 'Parc machine', 'Maschinenpark'),
    vnc: ml('VNC (read-only)', 'VNC (lecture seule)', 'VNC (schreibgeschützt)'),
    camera: ml('Camera (video stream)', 'Caméra (flux vidéo)', 'Kamera (Videostream)'),
    url: ml('URL', 'URL', 'URL')
  }
} as const;

/** Confirm-delete prompt for one mosaic (plain string — transient dialog). */
export function confirmDeleteMsg(name: string): string {
  return localize(
    ml(`Delete mosaic “${name}”?`, `Supprimer la mosaïque « ${name} » ?`, `Mosaik „${name}“ löschen?`)
  );
}

/** Mosaic count label (plain string — toolbar). */
export function mosaicCountMsg(count: number): string {
  return localize(ml(`${count} mosaic(s)`, `${count} mosaïque(s)`, `${count} Mosaik(e)`));
}

/** Tile count label (plain string — toolbar). */
export function tileCountMsg(count: number): string {
  return localize(ml(`${count} tile(s)`, `${count} tuile(s)`, `${count} Kachel(n)`));
}

/** "Rename — <name>" dialog title (plain string). */
export function renameTitleMsg(name: string): string {
  return localize(ml(`Rename — ${name}`, `Renommer — ${name}`, `Umbenennen — ${name}`));
}

/** Empty-catalogue notice for a pick-source (plain string — built from lower label + page name). */
export function pickSourceEmptyMsg(lowerLabel: string, pageName: string): string {
  return localize(
    ml(
      `No ${lowerLabel} registered. Create one on the “${pageName}” page before adding this tile.`,
      `Aucune ${lowerLabel} enregistrée. Créez-en une dans la page « ${pageName} » avant d'ajouter cette tuile.`,
      `Keine ${lowerLabel} registriert. Erstellen Sie eine auf der Seite „${pageName}“, bevor Sie diese Kachel hinzufügen.`
    )
  );
}

/** Pick-source selection hint (plain string — built from lower label). */
export function pickSourceHintMsg(lowerLabel: string): string {
  return localize(
    ml(
      `Select a ${lowerLabel} (shown read-only in the tile).`,
      `Sélectionnez une ${lowerLabel} (affichée en lecture seule dans la tuile).`,
      `Wählen Sie eine ${lowerLabel} (schreibgeschützt in der Kachel angezeigt).`
    )
  );
}

/** External-URL error message for the tile dialog (plain string). */
export function urlExternalErrorMsg(): string {
  return localize(
    ml(
      'External URL refused — enter a URL from the server (relative, e.g. /data/dashboard-wc/… or #/audit-trail).',
      'URL externe refusée — saisissez une URL du serveur (relative, ex. /data/dashboard-wc/… ou #/audit-trail).',
      'Externe URL abgelehnt — geben Sie eine URL vom Server ein (relativ, z. B. /data/dashboard-wc/… oder #/audit-trail).'
    )
  );
}
