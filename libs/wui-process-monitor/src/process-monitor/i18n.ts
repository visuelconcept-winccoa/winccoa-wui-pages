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
    history: ml('History', 'Historique', 'Verlauf')
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
    actionManager: ml('Manager control', 'Contrôle manager', 'Manager-Steuerung')
  },
  common: {
    success: ml('Success', 'Succès', 'Erfolg'),
    failed: ml('Failed', 'Échec', 'Fehler'),
    forbidden: ml('You lack the permission for this action.', 'Permission manquante pour cette action.', 'Fehlende Berechtigung für diese Aktion.')
  }
} as const;

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
