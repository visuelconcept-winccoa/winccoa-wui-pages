// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Process Monitor page (EN / FR / DE), following the
 * shared `lit-translate` singleton. `localizeDir(...)` in templates (reactive),
 * `localize(...)` for plain-string attributes.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import { getLanguage } from '@wincc-oa/wui-i18n-shared/localize-base.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Format an ISO timestamp as a short date-time in the active UI language. */
export function dateLabel(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLanguage());
}

export const MSG = {
  tabs: {
    console: ml('Console', 'Console', 'Konsole'),
    upload: ml('Project upload', 'Upload projet', 'Projekt-Upload'),
    history: ml('History', 'Historique', 'Verlauf'),
    logs: ml('Logs', 'Journaux', 'Logs')
  },
  console: {
    title: ml('Managers', 'Managers', 'Manager'),
    refresh: ml('Refresh', 'Rafraîchir', 'Aktualisieren'),
    restartAll: ml('Restart all', 'Tout redémarrer', 'Alle neu starten'),
    colIndex: ml('#', '#', '#'),
    colName: ml('Manager', 'Manager', 'Manager'),
    colState: ml('State', 'État', 'Status'),
    colPid: ml('PID', 'PID', 'PID'),
    colStart: ml('Start', 'Démarrage', 'Start'),
    colOptions: ml('Options', 'Options', 'Optionen'),
    colManNum: ml('Mgr #', 'N° mgr', 'Mgr-Nr.'),
    colManNumTitle: ml(
      'Manager number (-num): finds its log file, tells two instances of one executable apart',
      'Numéro de manager (-num) : retrouve son fichier log, distingue deux instances d’un même exécutable',
      'Managernummer (-num): findet seine Logdatei, unterscheidet zwei Instanzen derselben Datei'
    ),
    colStarted: ml('Started', 'Démarré', 'Gestartet'),
    colStartMode: ml('Start mode', 'Mode de démarrage', 'Startmodus'),
    sortBy: ml('Sort by this column', 'Trier selon cette colonne', 'Nach dieser Spalte sortieren'),
    dayUnit: ml('d', 'j', 'T'),
    start: ml('Start', 'Démarrer', 'Starten'),
    stop: ml('Stop', 'Arrêter', 'Stoppen'),
    restart: ml('Restart', 'Redémarrer', 'Neu starten'),
    lastUpdate: ml('Last update', 'Dernière mise à jour', 'Letzte Aktualisierung'),
    confirmRestartAll: ml(
      'Restart ALL managers? This may interrupt production.',
      'Redémarrer TOUS les managers ? Cela peut interrompre la production.',
      'ALLE Manager neu starten? Dies kann die Produktion unterbrechen.'
    ),
    addManager: ml('Add manager', 'Ajouter un manager', 'Manager hinzufügen'),
    remove: ml('Remove from configuration', 'Supprimer de la configuration', 'Aus der Konfiguration entfernen'),
    removeStopFirst: ml(
      'Stop the manager before removing it',
      'Arrêtez le manager avant de le supprimer',
      'Manager vor dem Entfernen stoppen'
    )
  },
  instances: {
    title: ml('Instances', 'Instances', 'Instanzen'),
    invalidOnly: ml('Invalid instances only', 'Instances invalides uniquement', 'Nur ungültige Instanzen'),
    colHost: ml('Host', 'Hôte', 'Host'),
    colSystem: ml('System', 'Système', 'System'),
    colState: ml('State', 'État', 'Status'),
    colLastSeen: ml('Last seen', 'Vue la dernière fois', 'Zuletzt gesehen'),
    colVersion: ml('Agent version', 'Version de l’agent', 'Agent-Version'),
    local: ml('this server', 'ce serveur', 'dieser Server'),
    none: ml('No invalid instance.', 'Aucune instance invalide.', 'Keine ungültige Instanz.'),
    olderAgent: ml('< 0.3.0', '< 0.3.0', '< 0.3.0'),
    deleteInstance: ml('Delete instance', 'Supprimer l’instance', 'Instanz löschen'),
    longUnseen: ml('Not seen for more than 7 days', 'Non vue depuis plus de 7 jours', 'Seit mehr als 7 Tagen nicht gesehen'),
    staleSnapshot: ml(
      'Last snapshot published by this host — it is not up to date.',
      'Dernier instantané publié par cet hôte — il n’est pas à jour.',
      'Letzter von diesem Host veröffentlichter Stand — er ist nicht aktuell.'
    ),
    deleted: ml('Instance deleted.', 'Instance supprimée.', 'Instanz gelöscht.')
  },
  managerDialog: {
    title: ml('Add a manager', 'Ajouter un manager', 'Manager hinzufügen'),
    fName: ml('Manager (without .exe)', 'Manager (sans .exe)', 'Manager (ohne .exe)'),
    fStartMode: ml('Start mode', 'Mode de démarrage', 'Startmodus'),
    modeAlways: ml('always — auto-start & restart', 'always — démarrage/redémarrage auto', 'always — Auto-Start & Neustart'),
    modeOnce: ml('once — at project start only', 'once — au démarrage du projet uniquement', 'once — nur beim Projektstart'),
    modeManual: ml('manual — started by hand', 'manual — démarrage manuel', 'manual — manueller Start'),
    fOptions: ml('Command line options', 'Options de ligne de commande', 'Kommandozeilenoptionen'),
    fPosition: ml('Position (empty = end)', 'Position (vide = fin)', 'Position (leer = Ende)'),
    positionHint: ml(
      'Insert position in the pmon list; inserting between running managers may be refused by pmon.',
      'Position d’insertion dans la liste pmon ; une insertion entre des managers en cours peut être refusée par pmon.',
      'Einfügeposition in der pmon-Liste; das Einfügen zwischen laufenden Managern kann von pmon abgelehnt werden.'
    ),
    hint: ml(
      'The manager is added to the pmon configuration (config/progs) of the selected server. It is NOT started automatically.',
      'Le manager est ajouté à la configuration pmon (config/progs) du serveur sélectionné. Il n’est PAS démarré automatiquement.',
      'Der Manager wird der pmon-Konfiguration (config/progs) des ausgewählten Servers hinzugefügt. Er wird NICHT automatisch gestartet.'
    ),
    add: ml('Add', 'Ajouter', 'Hinzufügen'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen')
  },
  upload: {
    title: ml('Deploy a project', 'Déployer un projet', 'Projekt bereitstellen'),
    pick: ml('Drop a .zip here or click to browse', 'Déposez un .zip ici ou cliquez', '.zip hier ablegen oder klicken'),
    hint: ml('ZIP files only', 'Fichiers .zip uniquement', 'Nur .zip-Dateien'),
    purgeTitle: ml('Clear folders before extraction', 'Vider des dossiers avant extraction', 'Ordner vor dem Entpacken leeren'),
    purgeHint: ml(
      'Deletes the contents of the selected folders before the ZIP is extracted.',
      'Supprime le contenu des dossiers sélectionnés avant l’extraction du ZIP.',
      'Löscht den Inhalt der ausgewählten Ordner vor dem Entpacken des ZIP.'
    ),
    purgeSelfWarn: ml(
      'Purging "javascript" clears the running webserver and this monitor — deploy a ZIP that restores javascript/ and restart, or the servers become unmanageable.',
      'Vider « javascript » supprime le webserver en cours et ce moniteur — déployez un ZIP qui restaure javascript/ et redémarrez, sinon les serveurs deviennent ingérables.',
      'Das Leeren von „javascript“ entfernt den laufenden Webserver und diesen Monitor — stellen Sie ein ZIP bereit, das javascript/ wiederherstellt, und starten Sie neu, sonst werden die Server unsteuerbar.'
    ),
    protectedTitle: ml('Protected folders (never overwritten)', 'Dossiers protégés (jamais écrasés)', 'Geschützte Ordner (nie überschrieben)'),
    protectedHint: ml(
      'The ZIP can never be extracted into these folders — any such content is skipped.',
      'Le ZIP ne peut jamais être extrait dans ces dossiers — un tel contenu est ignoré.',
      'Das ZIP kann nie in diese Ordner entpackt werden — solche Inhalte werden übersprungen.'
    ),
    targetAll: ml('Target: all connected servers', 'Cible : tous les serveurs connectés', 'Ziel: alle verbundenen Server'),
    restart: ml('Restart project after deploy', 'Redémarrer le projet après déploiement', 'Projekt nach Bereitstellung neu starten'),
    restartWarn: ml(
      'This restarts ALL managers after the deploy — possible production loss.',
      'Ceci redémarre TOUS les managers après le déploiement — perte de production possible.',
      'Dies startet nach der Bereitstellung ALLE Manager neu — möglicher Produktionsausfall.'
    ),
    deploy: ml('Deploy', 'Déployer', 'Bereitstellen'),
    confirmTitle: ml('Confirm deployment', 'Confirmer le déploiement', 'Bereitstellung bestätigen'),
    confirmBody: ml(
      'The ZIP will be extracted into the project. Continue?',
      'Le ZIP sera extrait dans le projet. Continuer ?',
      'Das ZIP wird in das Projekt entpackt. Fortfahren?'
    ),
    confirmYes: ml('Yes, deploy', 'Oui, déployer', 'Ja, bereitstellen'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    uploading: ml('Uploading…', 'Envoi…', 'Hochladen…'),
    deploying: ml('Deploying…', 'Déploiement…', 'Bereitstellen…'),
    deployed: ml('Deployment successful.', 'Déploiement réussi.', 'Bereitstellung erfolgreich.'),
    failed: ml('Deployment failed.', 'Déploiement échoué.', 'Bereitstellung fehlgeschlagen.')
  },
  logs: {
    host: ml('Host', 'Hôte', 'Host'),
    files: ml('Log files', 'Fichiers journaux', 'Logdateien'),
    fileFilter: ml('Filter by name or manager', 'Filtrer par nom ou manager', 'Nach Name oder Manager filtern'),
    refreshFiles: ml('Refresh the list', 'Rafraîchir la liste', 'Liste aktualisieren'),
    noFiles: ml('No log file found.', 'Aucun fichier journal trouvé.', 'Keine Logdatei gefunden.'),
    selectHint: ml('Select one or more log files.', 'Sélectionnez un ou plusieurs fichiers journaux.', 'Eine oder mehrere Logdateien auswählen.'),
    mergeBak: ml('Merge with .bak (previous rotation)', 'Fusionner avec le .bak (rotation précédente)', 'Mit .bak zusammenführen (vorherige Rotation)'),
    live: ml('Live', 'Direct', 'Live'),
    pause: ml('Pause', 'Pause', 'Pause'),
    resume: ml('Resume live', 'Reprendre le direct', 'Live fortsetzen'),
    paused: ml(
      'Paused: the whole file is shown, the display no longer updates.',
      'En pause : le fichier entier est affiché, l’affichage n’est plus mis à jour.',
      'Pausiert: die ganze Datei wird angezeigt, die Anzeige wird nicht mehr aktualisiert.'
    ),
    interval: ml('Refresh every', 'Rafraîchir toutes les', 'Aktualisieren alle'),
    lastLines: ml('Last lines', 'Dernières lignes', 'Letzte Zeilen'),
    categories: ml('Categories', 'Catégories', 'Kategorien'),
    allCategories: ml('all', 'toutes', 'alle'),
    minSeverity: ml('Minimum severity', 'Sévérité minimale', 'Mindestschweregrad'),
    allSeverities: ml('all', 'toutes', 'alle'),
    search: ml('Search (case-insensitive)', 'Rechercher (sans casse)', 'Suchen (ohne Groß-/Kleinschreibung)'),
    regex: ml('Regular expression', 'Expression régulière', 'Regulärer Ausdruck'),
    badRegex: ml('Invalid regular expression', 'Expression régulière invalide', 'Ungültiger regulärer Ausdruck'),
    exportLog: ml('Export displayed (.log)', 'Exporter l’affichage (.log)', 'Anzeige exportieren (.log)'),
    exportCsv: ml('Export displayed (CSV)', 'Exporter l’affichage (CSV)', 'Anzeige exportieren (CSV)'),
    exportRaw: ml('Export raw files', 'Exporter les fichiers bruts', 'Rohdateien exportieren'),
    shown: ml('entries shown', 'entrées affichées', 'Einträge angezeigt'),
    truncated: ml(
      'Older lines are not loaded (file too large, or live tail).',
      'Les lignes plus anciennes ne sont pas chargées (fichier trop gros, ou direct).',
      'Ältere Zeilen sind nicht geladen (Datei zu groß oder Live-Ansicht).'
    ),
    renderCap: ml(
      'Only the most recent entries are drawn — refine the filters, or export to see them all.',
      'Seules les entrées les plus récentes sont dessinées — affinez les filtres, ou exportez pour tout voir.',
      'Nur die neuesten Einträge werden gezeichnet — Filter verfeinern oder exportieren, um alle zu sehen.'
    ),
    loadError: ml('Cannot read the logs', 'Impossible de lire les journaux', 'Die Logs können nicht gelesen werden')
  },
  history: {
    title: ml('Operations history', 'Historique des opérations', 'Vorgangsverlauf'),
    refresh: ml('Refresh', 'Rafraîchir', 'Aktualisieren'),
    colTime: ml('Date/Time', 'Date/Heure', 'Datum/Zeit'),
    colAction: ml('Operation', 'Opération', 'Vorgang'),
    colDetail: ml('Detail', 'Détail', 'Detail'),
    colUser: ml('User', 'Utilisateur', 'Benutzer'),
    colHost: ml('Host', 'Hôte', 'Host'),
    colStatus: ml('Status', 'Statut', 'Status'),
    empty: ml('No operations recorded yet.', 'Aucune opération enregistrée.', 'Noch keine Vorgänge erfasst.'),
    actionDeploy: ml('Project import', 'Import projet', 'Projektimport'),
    actionRestartAll: ml('Restart all', 'Redémarrage global', 'Alle neu gestartet'),
    actionManager: ml('Manager control', 'Contrôle manager', 'Manager-Steuerung'),
    actionLogsExport: ml('Logs export', 'Export de journaux', 'Log-Export'),
    actionDeleteInstance: ml('Instance deleted', 'Suppression d’instance', 'Instanz gelöscht')
  },
  common: {
    success: ml('Success', 'Succès', 'Erfolg'),
    failed: ml('Failed', 'Échec', 'Fehler'),
    forbidden: ml('You lack the permission for this action.', 'Permission manquante pour cette action.', 'Fehlende Berechtigung für diese Aktion.')
  },
  errors: {
    load: ml(
      'Cannot read the manager list',
      'Impossible de lire la liste des managers',
      'Die Managerliste kann nicht gelesen werden'
    ),
    action: ml('The action failed', 'L’action a échoué', 'Die Aktion ist fehlgeschlagen'),
    /** Add / remove applied by pmon, not found in config/progs afterwards (issue 35). */
    notPersisted: ml(
      'pmon configuration not saved',
      'Configuration pmon non enregistrée',
      'pmon-Konfiguration nicht gespeichert'
    ),
    /** Shown for a 502/503: the fault is on the manager side, and only a restart fixes it. */
    bridge: ml(
      'The "processMonitor" manager is not answering. Restart it in pmon: after a backend deployment a manager left running keeps executing its previous code, even though pmon shows it alive.',
      'Le manager « processMonitor » ne répond pas. Redémarrez-le dans pmon : après un déploiement backend, un manager laissé en place continue d’exécuter son code précédent, même si pmon l’affiche actif.',
      'Der Manager „processMonitor" antwortet nicht. Starten Sie ihn in pmon neu: nach einem Backend-Deployment führt ein weiterlaufender Manager weiterhin seinen alten Code aus, auch wenn pmon ihn als aktiv anzeigt.'
    )
  }
} as const;

/** Format an ISO timestamp as a short date + hour:minute in the active UI language (raw text kept). */
export function shortDateLabel(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLanguage(), { dateStyle: 'short', timeStyle: 'short' });
}

/** Tooltip of a manager's restart settings (`config/progs`: secKill, restart count, reset minutes). */
export function restartSettingsTitle(m: { secKill: number; restartCount: number; resetMin: number }): string {
  return localize(
    ml(
      `Kill after ${m.secKill} s · ${m.restartCount} restarts allowed · counter reset after ${m.resetMin} min`,
      `Arrêt forcé après ${m.secKill} s · ${m.restartCount} redémarrages autorisés · compteur remis à zéro après ${m.resetMin} min`,
      `Kill nach ${m.secKill} s · ${m.restartCount} Neustarts erlaubt · Zähler-Reset nach ${m.resetMin} min`
    )
  );
}

/** Tooltip of a start mode that pmon runs differently from `config/progs`. */
export function startModeDiffersTitle(configured: string, live: string): string {
  return localize(
    ml(
      `pmon runs it as "${live}", config/progs says "${configured}"`,
      `pmon l’exécute en « ${live} », config/progs indique « ${configured} »`,
      `pmon führt ihn als „${live}" aus, config/progs sagt „${configured}"`
    )
  );
}

/** Display label for a server/instance tab: hostname, else system name, else "local". */
export function serverLabel(instance: { hostname?: string; system?: string }): string {
  const sys = (instance.system ?? '').replace(/:$/, '');
  return instance.hostname || sys || localize(ml('local', 'local', 'lokal'));
}

/** Confirm prompt for removing one manager from the pmon configuration. */
export function confirmRemoveMsg(name: string, index: number): string {
  return localize(
    ml(
      `Remove manager "${name}" (#${index}) from the pmon configuration? The config/progs entry is deleted.`,
      `Supprimer le manager « ${name} » (#${index}) de la configuration pmon ? L'entrée config/progs est supprimée.`,
      `Manager „${name}" (#${index}) aus der pmon-Konfiguration entfernen? Der config/progs-Eintrag wird gelöscht.`
    )
  );
}

/** What a confirmation dialog of the Console tab confirms (issue 34). */
export type ConfirmIntent = 'start' | 'stop' | 'restart' | 'restart-all' | 'remove' | 'delete-instance';

/**
 * Heading and button of each Console confirmation. `<wui-confirm-dialog>` defaults to a
 * DELETION dialog ("Confirm deletion" / "Delete") when they are not given, so every dialog
 * of this page passes its own: stopping a manager must never read as deleting it.
 */
export const CONFIRM_TEXTS: Record<ConfirmIntent, { heading: MultiLangString; confirm: MultiLangString }> = {
  start: {
    heading: ml('Start the manager', 'Démarrer le manager', 'Manager starten'),
    confirm: ml('Start', 'Démarrer', 'Starten')
  },
  stop: {
    heading: ml('Stop the manager', 'Arrêter le manager', 'Manager stoppen'),
    confirm: ml('Stop', 'Arrêter', 'Stoppen')
  },
  restart: {
    heading: ml('Restart the manager', 'Redémarrer le manager', 'Manager neu starten'),
    confirm: ml('Restart', 'Redémarrer', 'Neu starten')
  },
  'restart-all': {
    heading: ml('Restart all managers', 'Redémarrer tous les managers', 'Alle Manager neu starten'),
    confirm: ml('Restart all', 'Tout redémarrer', 'Alle neu starten')
  },
  remove: {
    heading: ml('Remove from the configuration', 'Supprimer de la configuration', 'Aus der Konfiguration entfernen'),
    confirm: ml('Remove', 'Supprimer', 'Entfernen')
  },
  'delete-instance': {
    heading: ml('Delete instance', 'Supprimer l’instance', 'Instanz löschen'),
    confirm: ml('Delete instance', 'Supprimer l’instance', 'Instanz löschen')
  }
};

/** `heading` / `confirmLabel` of `<wui-confirm-dialog>` for one intent, in the active language. */
export function confirmDialogLabels(intent: ConfirmIntent): { heading: string; confirmLabel: string } {
  const texts = CONFIRM_TEXTS[intent];
  return { heading: localize(texts.heading), confirmLabel: localize(texts.confirm) };
}

/** Confirm prompt for a start/stop/restart action on one manager. */
export function confirmControlMsg(action: 'start' | 'stop' | 'restart', name: string): string {
  if (action === 'start') {
    return localize(ml(`Start manager "${name}"?`, `Démarrer le manager « ${name} » ?`, `Manager „${name}" starten?`));
  }
  if (action === 'stop') {
    return localize(ml(`Stop manager "${name}"?`, `Arrêter le manager « ${name} » ?`, `Manager „${name}" stoppen?`));
  }
  return localize(ml(`Restart manager "${name}"?`, `Redémarrer le manager « ${name} » ?`, `Manager „${name}" neu starten?`));
}

/** Label of an instance state (issue 39). */
export const STATE_LABELS: Record<string, MultiLangString> = {
  connected: ml('Connected', 'Connectée', 'Verbunden'),
  'pmon-unreachable': ml('pmon not reachable', 'pmon injoignable', 'pmon nicht erreichbar'),
  'agent-too-old': ml('Agent too old', 'Agent trop ancien', 'Agent zu alt'),
  'agent-unreachable': ml('Agent not reachable', 'Agent injoignable', 'Agent nicht erreichbar'),
  'not-checkable': ml('Not checkable over vRPC', 'Non vérifiable par vRPC', 'Per vRPC nicht prüfbar'),
  unknown: ml('Not checked', 'Non vérifiée', 'Nicht geprüft')
};

/** What each state means, for the badge tooltip. */
export const STATE_HINTS: Record<string, MultiLangString> = {
  connected: ml('The processMonitor agent of this host answers and reaches its pmon.', 'L’agent processMonitor de cet hôte répond et joint son pmon.', 'Der processMonitor-Agent dieses Hosts antwortet und erreicht seinen pmon.'),
  'pmon-unreachable': ml('The agent answers but cannot reach its local pmon.', 'L’agent répond mais ne joint pas son pmon local.', 'Der Agent antwortet, erreicht aber seinen lokalen pmon nicht.'),
  'agent-too-old': ml(
    'The agent answers but predates 0.3.0: update and restart its processMonitor manager.',
    'L’agent répond mais est antérieur à 0.3.0 : mettez à jour et redémarrez son manager processMonitor.',
    'Der Agent antwortet, ist aber älter als 0.3.0: processMonitor-Manager aktualisieren und neu starten.'
  ),
  'agent-unreachable': ml(
    'The agent does not answer: processMonitor manager stopped, host down, network failure, or a host renamed or decommissioned.',
    'L’agent ne répond pas : manager processMonitor arrêté, hôte arrêté, panne réseau, ou hôte renommé ou retiré.',
    'Der Agent antwortet nicht: processMonitor-Manager gestoppt, Host aus, Netzwerkfehler oder Host umbenannt oder stillgelegt.'
  ),
  'not-checkable': ml(
    'A host of another system: its agent cannot be reached by name over vRPC, so its state is unknown (it is not reported as disconnected).',
    'Un hôte d’un autre système : son agent n’est pas joignable par son nom en vRPC, son état est donc inconnu (il n’est pas signalé déconnecté).',
    'Ein Host eines anderen Systems: sein Agent ist per vRPC nicht über den Namen erreichbar, sein Zustand ist daher unbekannt (nicht als getrennt gemeldet).'
  ),
  unknown: ml('The server does not report the state (processMonitor older than 0.3.0).', 'Le serveur ne remonte pas l’état (processMonitor antérieur à 0.3.0).', 'Der Server meldet den Zustand nicht (processMonitor älter als 0.3.0).')
};

/** "seen 3 h 05 ago" — the age is already formatted. */
export function agoLabel(age: string): string {
  return localize(ml(`${age} ago`, `il y a ${age}`, `vor ${age}`));
}

/** Confirm prompt for deleting a host instance (issue 39). */
export function confirmDeleteInstanceMsg(host: string, system: string, lastSeen: string): string {
  const sys = system.replace(/:$/, '') || '—';
  return localize(
    ml(
      `Delete the instance of host "${host}" (system ${sys}, last seen ${lastSeen})? Its datapoint and its history are deleted. The server checks again that its agent does not answer; an agent that starts again recreates its instance.`,
      `Supprimer l’instance de l’hôte « ${host} » (système ${sys}, vue la dernière fois ${lastSeen}) ? Son point de données et son historique sont supprimés. Le serveur vérifie à nouveau que son agent ne répond pas ; un agent qui redémarre recrée son instance.`,
      `Instanz des Hosts „${host}" (System ${sys}, zuletzt gesehen ${lastSeen}) löschen? Ihr Datenpunkt und ihr Verlauf werden gelöscht. Der Server prüft erneut, dass ihr Agent nicht antwortet; ein neu startender Agent legt seine Instanz wieder an.`
    )
  );
}
