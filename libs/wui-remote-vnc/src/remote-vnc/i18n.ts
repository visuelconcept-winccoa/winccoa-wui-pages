// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Remote VNC page.
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
    connectionsCount: (n: number): MultiLangString =>
      ml(`${n} connection(s)`, `${n} connexion(s)`, `${n} Verbindung(en)`),
    import: ml('Import', 'Importer', 'Importieren'),
    exportAll: ml('Export all', 'Exporter tout', 'Alle exportieren'),
    newConnection: ml('New connection', 'Nouvelle connexion', 'Neue Verbindung'),
    empty: ml(
      'No VNC connection registered.',
      'Aucune connexion VNC enregistrée.',
      'Keine VNC-Verbindung registriert.'
    ),
    generateDemo: ml(
      'Generate demo connections',
      'Générer des connexions de démonstration',
      'Demo-Verbindungen erzeugen'
    ),
    offline: ml(
      'Offline mode: changes are not persisted to the datapoints (backend unavailable or missing write rights).',
      "Mode hors-ligne : modifications non persistées dans les datapoints (backend indisponible ou droits d'écriture manquants).",
      'Offline-Modus: Änderungen werden nicht in den Datenpunkten gespeichert (Backend nicht verfügbar oder fehlende Schreibrechte).'
    ),
    importFailed: ml('Import failed.', 'Import échoué.', 'Import fehlgeschlagen.')
  },
  table: {
    statusTitle: ml(
      'Reachability of the configured socket (cyclic server-side test)',
      'Joignabilité du socket configuré (test serveur cyclique)',
      'Erreichbarkeit des konfigurierten Sockets (zyklischer serverseitiger Test)'
    ),
    state: ml('State', 'État', 'Status'),
    name: ml('Name', 'Nom', 'Name'),
    hostPort: ml('Host:port', 'Hôte:port', 'Host:Port'),
    group: ml('Group', 'Groupe', 'Gruppe'),
    mode: ml('Mode', 'Mode', 'Modus'),
    lastConnected: ml('Last connection', 'Dernière connexion', 'Letzte Verbindung'),
    addFavorite: ml('Add to favourites', 'Ajouter aux favoris', 'Zu Favoriten hinzufügen'),
    removeFavorite: ml('Remove from favourites', 'Retirer des favoris', 'Aus Favoriten entfernen'),
    viewOnly: ml('Read-only', 'Lecture seule', 'Nur Ansicht'),
    control: ml('Control', 'Contrôle', 'Steuerung'),
    connect: ml('Connect', 'Connecter', 'Verbinden'),
    edit: ml('Edit', 'Modifier', 'Bearbeiten'),
    exportOne: ml('Export this connection', 'Exporter cette connexion', 'Diese Verbindung exportieren'),
    remove: ml('Delete', 'Supprimer', 'Löschen'),
    statusUnknown: ml(
      'Reachability unknown (test pending)',
      'Joignabilité inconnue (test en attente)',
      'Erreichbarkeit unbekannt (Test ausstehend)'
    ),
    socketReachable: ml('Socket reachable', 'Socket joignable', 'Socket erreichbar'),
    socketUnreachable: ml('Socket unreachable', 'Socket injoignable', 'Socket nicht erreichbar'),
    never: ml('never', 'jamais', 'nie')
  },
  dialog: {
    newConnection: ml('New VNC connection', 'Nouvelle connexion VNC', 'Neue VNC-Verbindung'),
    editPrefix: ml('Edit', 'Édition', 'Bearbeiten'),
    fName: ml('Name', 'Nom', 'Name'),
    fGroup: ml('Group', 'Groupe', 'Gruppe'),
    fHost: ml('Host / IP', 'Hôte / IP', 'Host / IP'),
    fPort: ml('Port', 'Port', 'Port'),
    fPassword: ml('VNC password (optional)', 'Mot de passe VNC (optionnel)', 'VNC-Passwort (optional)'),
    show: ml('Show', 'Afficher', 'Anzeigen'),
    hide: ml('Hide', 'Masquer', 'Ausblenden'),
    passwordWarning: ml(
      'The password is stored in clear text in the datapoint. Reserve this for a trusted environment.',
      'Le mot de passe est enregistré en clair dans le datapoint. À réserver à un environnement de confiance.',
      'Das Passwort wird im Klartext im Datenpunkt gespeichert. Nur für eine vertrauenswürdige Umgebung verwenden.'
    ),
    fDescription: ml('Description', 'Description', 'Beschreibung'),
    secSession: ml('Session options', 'Options de session', 'Sitzungsoptionen'),
    viewOnly: ml(
      'Read-only (no keyboard/mouse to the remote machine)',
      'Lecture seule (pas de clavier/souris vers le poste distant)',
      'Nur Ansicht (keine Tastatur/Maus zum entfernten Rechner)'
    ),
    shared: ml(
      'Shared session (do not disconnect other clients)',
      'Session partagée (ne pas déconnecter les autres clients)',
      'Gemeinsame Sitzung (andere Clients nicht trennen)'
    ),
    secReconnect: ml('Timeout & reconnection', 'Délai & reconnexion', 'Zeitlimit & Wiederverbindung'),
    autoReconnect: ml(
      'Automatic reconnection after a drop or a timeout',
      'Reconnexion automatique après coupure ou délai dépassé',
      'Automatische Wiederverbindung nach Abbruch oder Zeitüberschreitung'
    ),
    fConnectTimeout: ml('Connection timeout (s)', 'Délai de connexion (s)', 'Verbindungszeitlimit (s)'),
    fReconnectDelay: ml('Delay between attempts (s)', 'Délai entre tentatives (s)', 'Verzögerung zwischen Versuchen (s)'),
    fMaxAttempts: ml('Max attempts (0 = unlimited)', 'Tentatives max (0 = illimité)', 'Max. Versuche (0 = unbegrenzt)'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    save: ml('Save', 'Enregistrer', 'Speichern')
  },
  viewer: {
    back: ml('‹ Back', '‹ Retour', '‹ Zurück'),
    viewOnlySuffix: ml(' · read-only', ' · lecture seule', ' · nur Ansicht'),
    ctrlAltDel: ml('Ctrl+Alt+Del', 'Ctrl+Alt+Suppr', 'Strg+Alt+Entf'),
    fullscreen: ml('Fullscreen', 'Plein écran', 'Vollbild'),
    disconnect: ml('Disconnect', 'Déconnecter', 'Trennen'),
    reconnect: ml('Reconnect', 'Reconnecter', 'Erneut verbinden'),
    statusIdle: ml('Idle', 'Inactif', 'Inaktiv'),
    statusConnecting: ml('Connecting…', 'Connexion…', 'Verbindung…'),
    statusConnected: ml('Connected', 'Connecté', 'Verbunden'),
    statusReconnecting: ml('Reconnecting…', 'Reconnexion…', 'Wiederverbindung…'),
    statusDisconnected: ml('Disconnected', 'Déconnecté', 'Getrennt'),
    statusError: ml('Error', 'Erreur', 'Fehler'),
    noHost: ml('Host not provided.', 'Hôte non renseigné.', 'Host nicht angegeben.'),
    connectFailed: ml('Connection failed', 'Échec de la connexion', 'Verbindung fehlgeschlagen'),
    connectionLost: ml('Connection lost', 'Connexion interrompue', 'Verbindung unterbrochen'),
    connectTimeout: ml('Connection timed out', 'Délai de connexion dépassé', 'Verbindungszeitlimit überschritten')
  }
} as const;

/** Confirm-delete prompt for one connection (plain string — transient dialog). */
export function confirmDeleteMsg(name: string): string {
  return localize(
    ml(`Delete connection “${name}”?`, `Supprimer la connexion « ${name} » ?`, `Verbindung „${name}“ löschen?`)
  );
}

/** Reachability tooltip "checked at <time>" / "<time>" tail (plain string — title attribute). */
export function checkedAtMsg(reachable: boolean, when: string): string {
  return localize(
    reachable ? ml(`checked at ${when}`, `vérifié à ${when}`, `geprüft um ${when}`) : ml(when, when, when)
  );
}

/** VNC authentication-failure message with optional reason (plain string — set into reactive state). */
export function authFailureMsg(reason: string): string {
  const suffix = reason ? ` : ${reason}` : '';
  return localize(
    ml(
      `VNC authentication failed${suffix}.`,
      `Échec d'authentification VNC${suffix}.`,
      `VNC-Authentifizierung fehlgeschlagen${suffix}.`
    )
  );
}

/** "give up" tail after the max number of reconnection attempts (plain string — set into reactive state). */
export function giveUpMsg(max: number): string {
  return localize(
    ml(
      ` Reconnection abandoned after ${max} attempt(s).`,
      ` Reconnexion abandonnée après ${max} tentative(s).`,
      ` Wiederverbindung nach ${max} Versuch(en) abgebrochen.`
    )
  );
}

/** Reconnection countdown message (plain string — set into reactive state). */
export function reconnectMsg(reason: string, attempt: number, total: string, delaySec: number): string {
  return localize(
    ml(
      `${reason} — reconnection ${attempt}${total} in ${delaySec}s…`,
      `${reason} — reconnexion ${attempt}${total} dans ${delaySec}s…`,
      `${reason} — Wiederverbindung ${attempt}${total} in ${delaySec}s…`
    )
  );
}
