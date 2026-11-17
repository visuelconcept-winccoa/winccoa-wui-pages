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
    importFailed: ml('Import failed.', 'Import échoué.', 'Import fehlgeschlagen.'),
    roleForbidden: ml(
      'Your groups do not hold the "view" role of this page.',
      'Vos groupes ne possèdent pas le rôle « consulter » de cette page.',
      'Ihre Gruppen besitzen die Rolle „Ansehen“ dieser Seite nicht.'
    )
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
    never: ml('never', 'jamais', 'nie'),
    localHost: ml('USB camera of this PC', 'Caméra USB de ce PC', 'USB-Kamera dieses PCs'),
    localChip: ml('USB', 'USB', 'USB'),
    localStateTitle: ml(
      'Local camera: opened by each browser on its own PC (no server-side probe)',
      'Caméra locale : ouverte par chaque navigateur sur son propre PC (pas de test serveur)',
      'Lokale Kamera: von jedem Browser auf seinem eigenen PC geöffnet (kein serverseitiger Test)'
    ),
    localClientsTitle: ml(
      'Not relayed by the server — viewers are not counted',
      'Non relayée par le serveur — spectateurs non comptés',
      'Nicht über den Server übertragen — Zuschauer werden nicht gezählt'
    )
  },
  dialog: {
    newCamera: ml('New RTSP camera', 'Nouvelle caméra RTSP', 'Neue RTSP-Kamera'),
    editPrefix: ml('Edit', 'Édition', 'Bearbeiten'),
    fSourceKind: ml('Source', 'Source', 'Quelle'),
    kindRtsp: ml('RTSP IP camera (via the server)', 'Caméra IP RTSP (via le serveur)', 'RTSP-IP-Kamera (über den Server)'),
    kindLocal: ml(
      'USB camera of this PC (webcam)',
      'Caméra USB de ce PC (webcam)',
      'USB-Kamera dieses PCs (Webcam)'
    ),
    localInfo: ml(
      'The video is captured by each browser from a camera plugged into its own PC and never leaves it. The camera to use is chosen in the viewer and remembered by each browser.',
      'La vidéo est captée par chaque navigateur depuis une caméra branchée sur son propre PC et n’en sort pas. La caméra à utiliser se choisit dans la visionneuse et est mémorisée par chaque navigateur.',
      'Das Video wird von jedem Browser von einer an seinen eigenen PC angeschlossenen Kamera aufgenommen und verlässt diesen nicht. Die Kamera wird im Viewer gewählt und von jedem Browser gespeichert.'
    ),
    fResolution: ml('Resolution', 'Résolution', 'Auflösung'),
    resDefault: ml('Default (camera’s choice)', 'Par défaut (choix de la caméra)', 'Standard (Wahl der Kamera)'),
    res480p: ml('640 × 480', '640 × 480', '640 × 480'),
    res720p: ml('1280 × 720 (HD)', '1280 × 720 (HD)', '1280 × 720 (HD)'),
    res1080p: ml('1920 × 1080 (Full HD)', '1920 × 1080 (Full HD)', '1920 × 1080 (Full HD)'),
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
  },
  local: {
    endpoint: ml('USB camera of this PC', 'Caméra USB de ce PC', 'USB-Kamera dieses PCs'),
    device: ml('Camera', 'Caméra', 'Kamera'),
    unnamed: ml('Camera', 'Caméra', 'Kamera'),
    allow: ml('Allow camera access', 'Autoriser l’accès à la caméra', 'Kamerazugriff erlauben'),
    retry: ml('Retry', 'Réessayer', 'Erneut versuchen'),
    statusStarting: ml('Opening camera…', 'Ouverture de la caméra…', 'Kamera wird geöffnet…'),
    statusLive: ml('Live (local)', 'En direct (local)', 'Live (lokal)'),
    statusPermission: ml('Permission needed', 'Autorisation requise', 'Berechtigung erforderlich'),
    needPermission: ml(
      'The browser needs your permission to use a camera of this PC. Nothing is sent to the server: the video stays in this browser.',
      'Le navigateur a besoin de votre autorisation pour utiliser une caméra de ce PC. Rien n’est envoyé au serveur : la vidéo reste dans ce navigateur.',
      'Der Browser benötigt Ihre Erlaubnis, eine Kamera dieses PCs zu verwenden. Nichts wird an den Server gesendet: das Video bleibt in diesem Browser.'
    ),
    errInsecure: ml(
      'Camera capture needs a secure page: open the dashboard over HTTPS (or on http://localhost). Browsers block cameras on plain HTTP.',
      'La capture caméra exige une page sécurisée : ouvrez le tableau de bord en HTTPS (ou sur http://localhost). Les navigateurs bloquent les caméras en HTTP simple.',
      'Kameraaufnahme erfordert eine sichere Seite: Öffnen Sie das Dashboard über HTTPS (oder auf http://localhost). Browser blockieren Kameras bei reinem HTTP.'
    ),
    errUnsupported: ml(
      'This browser cannot capture a camera (no getUserMedia).',
      'Ce navigateur ne sait pas capter une caméra (pas de getUserMedia).',
      'Dieser Browser kann keine Kamera aufnehmen (kein getUserMedia).'
    ),
    errDenied: ml(
      'Camera access was denied. Click the camera (or padlock) icon in the address bar, set Camera to "Allow" for this site, then click Retry. If it stays blocked, check the operating system privacy settings (camera access for the browser).',
      'L’accès à la caméra a été refusé. Cliquez sur l’icône caméra (ou cadenas) de la barre d’adresse, passez Caméra sur « Autoriser » pour ce site, puis cliquez sur Réessayer. Si l’accès reste bloqué, vérifiez les paramètres de confidentialité du système (accès caméra du navigateur).',
      'Der Kamerazugriff wurde verweigert. Klicken Sie auf das Kamera- (oder Schloss-)Symbol in der Adressleiste, setzen Sie Kamera für diese Website auf „Zulassen“ und klicken Sie auf Erneut versuchen. Bleibt er blockiert, prüfen Sie die Datenschutzeinstellungen des Betriebssystems (Kamerazugriff des Browsers).'
    ),
    errNotFound: ml(
      'No camera found on this PC. Plug in a USB camera (or enable the built-in webcam), then click Retry.',
      'Aucune caméra trouvée sur ce PC. Branchez une caméra USB (ou activez la webcam intégrée), puis cliquez sur Réessayer.',
      'Keine Kamera an diesem PC gefunden. Schließen Sie eine USB-Kamera an (oder aktivieren Sie die eingebaute Webcam) und klicken Sie auf Erneut versuchen.'
    ),
    errBusy: ml(
      'The camera is busy: another application (video call, camera app) or another browser is using it. Close it, then click Retry.',
      'La caméra est occupée : une autre application (visio, appli caméra) ou un autre navigateur l’utilise. Fermez-la, puis cliquez sur Réessayer.',
      'Die Kamera ist belegt: eine andere Anwendung (Videoanruf, Kamera-App) oder ein anderer Browser verwendet sie. Schließen Sie diese und klicken Sie auf Erneut versuchen.'
    ),
    errOverconstrained: ml(
      'The selected camera is no longer available. Pick another one in the list.',
      'La caméra sélectionnée n’est plus disponible. Choisissez-en une autre dans la liste.',
      'Die gewählte Kamera ist nicht mehr verfügbar. Wählen Sie eine andere in der Liste.'
    ),
    errUnknown: ml('The camera could not be opened.', 'La caméra n’a pas pu être ouverte.', 'Die Kamera konnte nicht geöffnet werden.'),
    ended: ml(
      'The camera stopped (unplugged or released by the system). Click Retry.',
      'La caméra s’est arrêtée (débranchée ou libérée par le système). Cliquez sur Réessayer.',
      'Die Kamera wurde gestoppt (abgesteckt oder vom System freigegeben). Klicken Sie auf Erneut versuchen.'
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
