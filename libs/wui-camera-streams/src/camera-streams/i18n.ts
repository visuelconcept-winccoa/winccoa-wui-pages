// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Camera Streams (RTSP) page.
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
  page: {
    headerTitle: ml('Camera Streams (RTSP)', 'Flux caméras (RTSP)', 'Kamera-Streams (RTSP)'),
    offline: ml(
      'Offline mode: changes are not persisted to datapoints (backend unavailable or missing write rights).',
      'Mode hors-ligne : modifications non persistées dans les datapoints (backend indisponible ou droits d’écriture manquants).',
      'Offline-Modus: Änderungen werden nicht in Datenpunkten gespeichert (Backend nicht verfügbar oder fehlende Schreibrechte).'
    ),
    import: ml('Import', 'Importer', 'Importieren'),
    exportAll: ml('Export all', 'Exporter tout', 'Alle exportieren'),
    newCamera: ml('New camera', 'Nouvelle caméra', 'Neue Kamera'),
    empty: ml('No RTSP camera registered.', 'Aucune caméra RTSP enregistrée.', 'Keine RTSP-Kamera registriert.'),
    generateDemo: ml(
      'Generate demo cameras',
      'Générer des caméras de démonstration',
      'Demo-Kameras erzeugen'
    ),
    importFailed: ml('Import failed.', 'Import échoué.', 'Import fehlgeschlagen.')
  },
  table: {
    stateTitle: ml(
      'RTSP stream reachability (cyclic server-side probe)',
      'Joignabilité du flux RTSP (test serveur cyclique)',
      'Erreichbarkeit des RTSP-Streams (zyklischer serverseitiger Test)'
    ),
    state: ml('State', 'État', 'Status'),
    name: ml('Name', 'Nom', 'Name'),
    host: ml('Host', 'Hôte', 'Host'),
    group: ml('Group', 'Groupe', 'Gruppe'),
    transport: ml('Transport', 'Transport', 'Transport'),
    audioChip: ml('Audio', 'Audio', 'Audio'),
    clients: ml('Clients', 'Clients', 'Clients'),
    lastViewed: ml('Last viewed', 'Dernière vue', 'Zuletzt angesehen'),
    audio: ml('Audio', 'Audio', 'Audio'),
    addFavorite: ml('Add to favorites', 'Ajouter aux favoris', 'Zu Favoriten hinzufügen'),
    removeFavorite: ml('Remove from favorites', 'Retirer des favoris', 'Aus Favoriten entfernen'),
    view: ml('View', 'Visionner', 'Ansehen'),
    edit: ml('Edit', 'Modifier', 'Bearbeiten'),
    exportOne: ml('Export this camera', 'Exporter cette caméra', 'Diese Kamera exportieren'),
    remove: ml('Delete', 'Supprimer', 'Löschen'),
    statusUnknownTitle: ml(
      'Reachability unknown (probe pending)',
      'Joignabilité inconnue (test en attente)',
      'Erreichbarkeit unbekannt (Test ausstehend)'
    ),
    statusReachable: ml('RTSP stream reachable', 'Flux RTSP joignable', 'RTSP-Stream erreichbar'),
    statusUnreachable: ml('RTSP stream unreachable', 'Flux RTSP injoignable', 'RTSP-Stream nicht erreichbar'),
    never: ml('never', 'jamais', 'nie')
  },
  dialog: {
    newCamera: ml('New RTSP camera', 'Nouvelle caméra RTSP', 'Neue RTSP-Kamera'),
    editPrefix: ml('Edit', 'Édition', 'Bearbeiten'),
    fName: ml('Name', 'Nom', 'Name'),
    fGroup: ml('Group', 'Groupe', 'Gruppe'),
    fUrl: ml('RTSP URL', 'URL RTSP', 'RTSP-URL'),
    fUsername: ml('User (optional)', 'Utilisateur (optionnel)', 'Benutzer (optional)'),
    fPassword: ml('Password (optional)', 'Mot de passe (optionnel)', 'Passwort (optional)'),
    show: ml('Show', 'Afficher', 'Anzeigen'),
    hide: ml('Hide', 'Masquer', 'Verbergen'),
    credentialsWarning: ml(
      'Credentials are stored in clear text in the datapoint and injected into the URL server-side (never sent to the browser). Reserve this for a trusted environment.',
      'Les identifiants sont enregistrés en clair dans le datapoint et injectés dans l’URL côté serveur (jamais envoyés au navigateur). À réserver à un environnement de confiance.',
      'Die Anmeldedaten werden im Klartext im Datenpunkt gespeichert und serverseitig in die URL eingefügt (nie an den Browser gesendet). Nur für eine vertrauenswürdige Umgebung verwenden.'
    ),
    fDescription: ml('Description', 'Description', 'Beschreibung'),
    secStreamOptions: ml('Stream options', 'Options de flux', 'Stream-Optionen'),
    fTransport: ml('RTSP transport', 'Transport RTSP', 'RTSP-Transport'),
    transportTcp: ml('TCP (reliable, recommended)', 'TCP (fiable, recommandé)', 'TCP (zuverlässig, empfohlen)'),
    transportUdp: ml('UDP (lower latency)', 'UDP (latence plus faible)', 'UDP (geringere Latenz)'),
    audioToggle: ml('Audio (MP2 track)', 'Audio (piste MP2)', 'Audio (MP2-Spur)'),
    fMaxWidth: ml('Max width (px, 0 = source)', 'Largeur max (px, 0 = source)', 'Max. Breite (px, 0 = Quelle)'),
    fFrameRate: ml('Frames/s (0 = 30)', 'Images/s (0 = 30)', 'Bilder/s (0 = 30)'),
    fVideoBitrate: ml('Video bitrate (kbps, 0 = auto)', 'Débit vidéo (kbps, 0 = auto)', 'Videobitrate (kbps, 0 = auto)'),
    secReconnect: ml('Reconnection', 'Reconnexion', 'Wiederverbindung'),
    autoReconnectToggle: ml(
      'Automatic WebSocket reconnection',
      'Reconnexion automatique du WebSocket',
      'Automatische WebSocket-Wiederverbindung'
    ),
    fReconnectDelay: ml('Delay between attempts (s)', 'Délai entre tentatives (s)', 'Verzögerung zwischen Versuchen (s)'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    save: ml('Save', 'Enregistrer', 'Speichern')
  },
  viewer: {
    back: ml('‹ Back', '‹ Retour', '‹ Zurück'),
    audioSuffix: ml(' · audio', ' · audio', ' · Audio'),
    fullscreen: ml('Fullscreen', 'Plein écran', 'Vollbild'),
    stop: ml('Stop', 'Arrêter', 'Stoppen'),
    restart: ml('Restart', 'Relancer', 'Neu starten'),
    statusIdle: ml('Idle', 'Inactif', 'Inaktiv'),
    statusConnecting: ml('Connecting…', 'Connexion…', 'Verbinden…'),
    statusConnected: ml('Live', 'En direct', 'Live'),
    statusReconnecting: ml('Reconnecting…', 'Reconnexion…', 'Wiederverbinden…'),
    statusDisconnected: ml('Stopped', 'Arrêté', 'Gestoppt'),
    statusError: ml('Error', 'Erreur', 'Fehler'),
    errNoUrl: ml('RTSP URL not set.', 'URL RTSP non renseignée.', 'RTSP-URL nicht angegeben.'),
    errPlayerInit: ml(
      'Player initialization failed.',
      'Échec de l’initialisation du lecteur.',
      'Initialisierung des Players fehlgeschlagen.'
    ),
    retrySuffix: ml(
      ' Retrying…',
      ' Nouvelle tentative en cours…',
      ' Neuer Versuch läuft…'
    ),
    errNoStream: ml(
      'No stream received (RTSP proxy unreachable, camera offline or invalid URL).',
      'Aucun flux reçu (proxy RTSP injoignable, caméra hors ligne ou URL invalide).',
      'Kein Stream empfangen (RTSP-Proxy nicht erreichbar, Kamera offline oder ungültige URL).'
    ),
    stalled: ml(
      'Stream interrupted — reconnecting…',
      'Flux interrompu — reconnexion…',
      'Stream unterbrochen — Wiederverbinden…'
    )
  }
} as const;

/** Confirm-delete prompt for one camera (plain string — transient dialog). */
export function confirmDeleteCameraMsg(name: string): string {
  return localize(
    ml(`Delete camera “${name}”?`, `Supprimer la caméra « ${name} » ?`, `Kamera „${name}“ löschen?`)
  );
}

/** Camera count badge (plain string — used in the toolbar). */
export function cameraCountMsg(count: number): string {
  return localize(ml(`${count} camera(s)`, `${count} caméra(s)`, `${count} Kamera(s)`));
}

/** Live connected-client count tooltip (plain string — table cell title). */
export function clientsConnectedMsg(count: number): string {
  return localize(
    ml(`${count} connected client(s)`, `${count} client(s) connecté(s)`, `${count} verbundene(r) Client(s)`)
  );
}

/** "verified at <time>" suffix for the reachability tooltip (plain string). */
export function checkedAtMsg(when: string): string {
  return localize(ml(`verified at ${when}`, `vérifié à ${when}`, `geprüft um ${when}`));
}
