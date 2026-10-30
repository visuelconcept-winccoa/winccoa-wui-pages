// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation of the Users page (EN / FR / DE), on the shared
 * `lit-translate` singleton: `localizeDir(...)` in templates (reactive),
 * `localize(...)` for plain-string attributes.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { getLanguage } from '@wincc-oa/wui-i18n-shared/localize-base.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLanguage());
}

/** Replace `{name}` placeholders. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replaceAll(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

export const MSG = {
  title: ml('Users', 'Utilisateurs', 'Benutzer'),
  tabs: {
    users: ml('Users', 'Utilisateurs', 'Benutzer'),
    groups: ml('Groups', 'Groupes', 'Gruppen'),
    areas: ml('Domains', 'Domaines', 'Domänen'),
    ad: ml('AD import', 'Import AD', 'AD-Import'),
    settings: ml('Settings', 'Paramètres', 'Einstellungen')
  },
  common: {
    search: ml('Search…', 'Rechercher…', 'Suchen…'),
    add: ml('New', 'Nouveau', 'Neu'),
    edit: ml('Edit', 'Modifier', 'Bearbeiten'),
    delete: ml('Delete', 'Supprimer', 'Löschen'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    refresh: ml('Refresh', 'Rafraîchir', 'Aktualisieren'),
    name: ml('Name', 'Nom', 'Name'),
    fullName: ml('Full name', 'Nom complet', 'Vollständiger Name'),
    comment: ml('Comment', 'Commentaire', 'Kommentar'),
    origin: ml('Origin', 'Origine', 'Herkunft'),
    originAd: ml('Active Directory', 'Active Directory', 'Active Directory'),
    originLocal: ml('Local', 'Local', 'Lokal'),
    permissions: ml('Permissions', 'Droits', 'Rechte'),
    none: ml('None', 'Aucun', 'Keine'),
    empty: ml('Nothing to show.', 'Rien à afficher.', 'Nichts anzuzeigen.'),
    all: ml('All', 'Tous', 'Alle'),
    nothing: ml('None', 'Aucun', 'Keine'),
    readOnly: ml('Read-only: your role does not allow changes.', 'Lecture seule : votre rôle ne permet pas de modifier.', 'Nur lesen: Ihre Rolle erlaubt keine Änderungen.'),
    confirmDelete: ml('Delete', 'Supprimer', 'Löschen')
  },
  page: {
    reserved: ml(
      'This page is reserved: the "View" role of the Users module is required.',
      'Page réservée : le rôle « Consulter » du module Utilisateurs est requis.',
      'Diese Seite ist reserviert: die Rolle „Anzeigen“ des Moduls Benutzer ist erforderlich.'
    ),
    authLabel: ml('Authentication', 'Authentification', 'Authentifizierung'),
    authStandard: ml('WinCC OA', 'WinCC OA', 'WinCC OA'),
    authAd: ml('Active Directory', 'Active Directory', 'Active Directory'),
    managerDown: ml(
      'The usersService manager does not answer: start it (or restart it after a deploy) in the WinCC OA console.',
      'Le manager usersService ne répond pas : démarrez-le (ou redémarrez-le après un déploiement) dans la console WinCC OA.',
      'Der Manager usersService antwortet nicht: starten Sie ihn (oder starten Sie ihn nach einem Deploy neu) in der WinCC OA-Konsole.'
    ),
    noPermission: ml(
      'The usersService manager runs as "{user}", who lacks the user-administration permission (level {level}): every change will be refused. Start it with an administrator (-user in pmon).',
      'Le manager usersService tourne sous « {user} », sans le droit de gestion des utilisateurs (niveau {level}) : toute modification sera refusée. Démarrez-le avec un administrateur (-user dans pmon).',
      'Der Manager usersService läuft als „{user}“ ohne das Recht der Benutzerverwaltung (Stufe {level}): jede Änderung wird abgelehnt. Starten Sie ihn mit einem Administrator (-user in pmon).'
    ),
    loadError: ml('The user administration could not be read', 'L’administration des utilisateurs n’a pas pu être lue', 'Die Benutzerverwaltung konnte nicht gelesen werden'),
    writeError: ml('The change was refused', 'La modification a été refusée', 'Die Änderung wurde abgelehnt'),
    saved: ml('Saved.', 'Enregistré.', 'Gespeichert.')
  },
  users: {
    add: ml('New user', 'Nouvel utilisateur', 'Neuer Benutzer'),
    colGroups: ml('Groups', 'Groupes', 'Gruppen'),
    colEnabled: ml('Active', 'Actif', 'Aktiv'),
    disabled: ml('Disabled', 'Désactivé', 'Deaktiviert'),
    enabled: ml('Active', 'Actif', 'Aktiv'),
    confirmDelete: ml(
      'Delete the user "{name}"? Their WinCC OA account is removed (an AD account is not touched).',
      'Supprimer l’utilisateur « {name} » ? Son compte WinCC OA est supprimé (un compte AD n’est pas touché).',
      'Benutzer „{name}“ löschen? Sein WinCC OA-Konto wird entfernt (ein AD-Konto bleibt unberührt).'
    ),
    adHint: ml(
      'Active Directory: AD users come from the AD import tab; a user created here is a local (emergency) account with a WinCC OA password.',
      'Active Directory : les utilisateurs AD viennent de l’onglet Import AD ; un utilisateur créé ici est un compte local (de secours) avec un mot de passe WinCC OA.',
      'Active Directory: AD-Benutzer kommen aus dem Reiter AD-Import; ein hier angelegter Benutzer ist ein lokales (Notfall-)Konto mit WinCC OA-Kennwort.'
    )
  },
  userDialog: {
    titleNew: ml('New user', 'Nouvel utilisateur', 'Neuer Benutzer'),
    titleEdit: ml('User', 'Utilisateur', 'Benutzer'),
    language: ml('Language', 'Langue', 'Sprache'),
    enabled: ml('Account active', 'Compte actif', 'Konto aktiv'),
    password: ml('Password', 'Mot de passe', 'Kennwort'),
    newPassword: ml('New password (empty: unchanged)', 'Nouveau mot de passe (vide : inchangé)', 'Neues Kennwort (leer: unverändert)'),
    confirm: ml('Confirm password', 'Confirmer le mot de passe', 'Kennwort bestätigen'),
    mismatch: ml('The passwords differ.', 'Les mots de passe diffèrent.', 'Die Kennwörter stimmen nicht überein.'),
    policy: ml(
      'The project\'s password policy applies (by default 12 characters, upper and lower case, digit, special character).',
      'La politique de mot de passe du projet s’applique (par défaut 12 caractères, majuscule, minuscule, chiffre, caractère spécial).',
      'Die Kennwortrichtlinie des Projekts gilt (standardmäßig 12 Zeichen, Groß- und Kleinbuchstaben, Ziffer, Sonderzeichen).'
    ),
    adPassword: ml(
      'Active Directory account: its password is the AD\'s, it is not set here.',
      'Compte Active Directory : son mot de passe est celui de l’AD, il ne se définit pas ici.',
      'Active Directory-Konto: sein Kennwort ist das des AD, es wird hier nicht gesetzt.'
    ),
    groups: ml('Groups', 'Groupes', 'Gruppen'),
    rootHint: ml('root cannot be renamed, disabled nor deleted.', 'root ne peut être ni renommé, ni désactivé, ni supprimé.', 'root kann weder umbenannt, deaktiviert noch gelöscht werden.')
  },
  groups: {
    add: ml('New group', 'Nouveau groupe', 'Neue Gruppe'),
    names: ml('Permission names', 'Noms des droits', 'Namen der Rechte'),
    colAreas: ml('Domains', 'Domaines', 'Domänen'),
    colMembers: ml('Members', 'Membres', 'Mitglieder'),
    confirmDelete: ml(
      'Delete the group "{name}"? Its {count} member(s) leave it.',
      'Supprimer le groupe « {name} » ? Ses {count} membre(s) en sont retirés.',
      'Gruppe „{name}“ löschen? Ihre {count} Mitglied(er) werden entfernt.'
    )
  },
  groupDialog: {
    titleNew: ml('New group', 'Nouveau groupe', 'Neue Gruppe'),
    titleEdit: ml('Group', 'Groupe', 'Gruppe'),
    permissions: ml('Permissions (system)', 'Droits (système)', 'Rechte (System)'),
    areas: ml('Domains', 'Domaines', 'Domänen'),
    areasHint: ml(
      'A domain restricts the group\'s permissions to it: the bits ticked for the domain apply there.',
      'Un domaine restreint les droits du groupe à ce domaine : les bits cochés pour le domaine s’y appliquent.',
      'Eine Domäne beschränkt die Rechte der Gruppe auf sie: die für die Domäne angekreuzten Bits gelten dort.'
    ),
    members: ml('Members', 'Membres', 'Mitglieder'),
    adGroup: ml('Imported from the Active Directory (OSID {osId})', 'Importé de l’Active Directory (OSID {osId})', 'Aus dem Active Directory importiert (OSID {osId})')
  },
  namesDialog: {
    title: ml('Permission names', 'Noms des droits', 'Namen der Rechte'),
    hint: ml(
      'The names of the 32 permission levels, shown wherever a permission is chosen (saved in the active language).',
      'Les noms des 32 niveaux de droits, affichés partout où un droit se choisit (enregistrés dans la langue active).',
      'Die Namen der 32 Rechtestufen, überall angezeigt, wo ein Recht gewählt wird (in der aktiven Sprache gespeichert).'
    )
  },
  areas: {
    add: ml('New domain', 'Nouveau domaine', 'Neue Domäne'),
    titleNew: ml('New domain', 'Nouveau domaine', 'Neue Domäne'),
    titleEdit: ml('Domain', 'Domaine', 'Domäne'),
    defaultBits: ml('Default permissions (given to a group added to it)', 'Droits par défaut (donnés à un groupe qu’on y ajoute)', 'Standardrechte (einer hinzugefügten Gruppe gegeben)'),
    colGroups: ml('Groups', 'Groupes', 'Gruppen'),
    confirmDelete: ml(
      'Delete the domain "{name}"? It is removed from its {count} group(s).',
      'Supprimer le domaine « {name} » ? Il est retiré de ses {count} groupe(s).',
      'Domäne „{name}“ löschen? Sie wird aus ihren {count} Gruppe(n) entfernt.'
    )
  },
  ad: {
    notAd: ml(
      'The project authenticates with WinCC OA: switch it to Active Directory (Settings tab) to import from the AD.',
      'Le projet s’authentifie par WinCC OA : passez-le en Active Directory (onglet Paramètres) pour importer depuis l’AD.',
      'Das Projekt authentifiziert über WinCC OA: stellen Sie es auf Active Directory um (Reiter Einstellungen), um aus dem AD zu importieren.'
    ),
    modeTitle: ml('Import of the new AD users', 'Import des nouveaux utilisateurs AD', 'Import neuer AD-Benutzer'),
    modeManual: ml('Manual — import the users I select', 'Manuel — importer les utilisateurs que je sélectionne', 'Manuell — die ausgewählten Benutzer importieren'),
    modeAuto: ml('Automatic — import the new users of the AD groups cyclically', 'Automatique — importer cycliquement les nouveaux utilisateurs des groupes AD', 'Automatisch — neue Benutzer der AD-Gruppen zyklisch importieren'),
    autoHint: ml(
      'Every AD user who is not yet a WinCC OA user and belongs to an AD-linked group (below) is created in those groups. Existing users are not touched: their groups are kept up to date by the standard WCCOAupdateUserGroups script. No group is created.',
      'Chaque utilisateur AD qui n’est pas encore utilisateur WinCC OA et appartient à un groupe lié à l’AD (ci-dessous) est créé dans ces groupes. Les utilisateurs existants ne sont pas touchés : leurs groupes sont tenus à jour par le script standard WCCOAupdateUserGroups. Aucun groupe n’est créé.',
      'Jeder AD-Benutzer, der noch kein WinCC OA-Benutzer ist und zu einer AD-verknüpften Gruppe (unten) gehört, wird in diesen Gruppen angelegt. Bestehende Benutzer bleiben unberührt: ihre Gruppen hält das Standardskript WCCOAupdateUserGroups aktuell. Es wird keine Gruppe angelegt.'
    ),
    interval: ml('Interval (minutes, 60 at least)', 'Intervalle (minutes, 60 au moins)', 'Intervall (Minuten, mindestens 60)'),
    scope: ml('Groups concerned', 'Groupes concernés', 'Betroffene Gruppen'),
    scopeAll: ml('Every AD-linked group (none ticked)', 'Tous les groupes liés à l’AD (aucun coché)', 'Alle AD-verknüpften Gruppen (keine angekreuzt)'),
    noLinkedGroup: ml('No group is imported from the AD yet: import the groups first (below).', 'Aucun groupe n’est encore importé de l’AD : importez d’abord les groupes (ci-dessous).', 'Noch keine Gruppe aus dem AD importiert: importieren Sie zuerst die Gruppen (unten).'),
    runNow: ml('Run now', 'Lancer maintenant', 'Jetzt ausführen'),
    running: ml('Import running…', 'Import en cours…', 'Import läuft…'),
    lastRun: ml('Last run', 'Dernière exécution', 'Letzte Ausführung'),
    nextRun: ml('Next run', 'Prochaine exécution', 'Nächste Ausführung'),
    report: ml(
      '{created} created · {existing} already in WinCC OA · {noGroup} in no group concerned · {errors} error(s)',
      '{created} créé(s) · {existing} déjà dans WinCC OA · {noGroup} dans aucun groupe concerné · {errors} erreur(s)',
      '{created} angelegt · {existing} bereits in WinCC OA · {noGroup} in keiner betroffenen Gruppe · {errors} Fehler'
    ),
    triggerAuto: ml('automatic', 'automatique', 'automatisch'),
    triggerManual: ml('on demand', 'à la demande', 'auf Anforderung'),
    usersTitle: ml('Manual import of users', 'Import manuel d’utilisateurs', 'Manueller Benutzerimport'),
    usersHint: ml(
      'Each selected user is created in the WinCC OA groups they belong to in the AD; a user in no such group is not imported.',
      'Chaque utilisateur sélectionné est créé dans les groupes WinCC OA dont il est membre dans l’AD ; un utilisateur d’aucun de ces groupes n’est pas importé.',
      'Jeder ausgewählte Benutzer wird in den WinCC OA-Gruppen angelegt, denen er im AD angehört; ein Benutzer ohne solche Gruppe wird nicht importiert.'
    ),
    groupsTitle: ml('Import of AD groups', 'Import de groupes AD', 'Import von AD-Gruppen'),
    list: ml('Read the Active Directory', 'Lire l’Active Directory', 'Active Directory lesen'),
    listing: ml('Reading the Active Directory…', 'Lecture de l’Active Directory…', 'Active Directory wird gelesen…'),
    import: ml('Import the selection ({count})', 'Importer la sélection ({count})', 'Auswahl importieren ({count})'),
    imported: ml('Imported', 'Importé', 'Importiert'),
    showImported: ml('Show the imported ones', 'Afficher les déjà importés', 'Bereits importierte anzeigen'),
    result: ml(
      '{created} imported · {noGroup} without a WinCC OA group (not imported){errors}',
      '{created} importé(s) · {noGroup} sans groupe WinCC OA (non importé(s)){errors}',
      '{created} importiert · {noGroup} ohne WinCC OA-Gruppe (nicht importiert){errors}'
    ),
    groupsResult: ml('{created} group(s) imported.', '{created} groupe(s) importé(s).', '{created} Gruppe(n) importiert.')
  },
  settings: {
    authTitle: ml('Authentication method', 'Méthode d’authentification', 'Authentifizierungsmethode'),
    authHint: ml(
      'As in the WinCC OA user administration (_WinUserAdmin.External). With Active Directory, the users log in with their AD account; local users stay as emergency accounts.',
      'Comme dans l’administration des utilisateurs WinCC OA (_WinUserAdmin.External). En Active Directory, les utilisateurs se connectent avec leur compte AD ; les utilisateurs locaux restent des comptes de secours.',
      'Wie in der WinCC OA-Benutzerverwaltung (_WinUserAdmin.External). Mit Active Directory melden sich die Benutzer mit ihrem AD-Konto an; lokale Benutzer bleiben Notfallkonten.'
    ),
    apply: ml('Apply', 'Appliquer', 'Anwenden'),
    confirmAuth: ml(
      'Switch the project\'s authentication to "{mode}"? Every login of the project follows it at once.',
      'Basculer l’authentification du projet en « {mode} » ? Toutes les connexions du projet la suivent immédiatement.',
      'Die Authentifizierung des Projekts auf „{mode}“ umstellen? Alle Anmeldungen des Projekts folgen ihr sofort.'
    ),
    managerTitle: ml('usersService manager', 'Manager usersService', 'Manager usersService'),
    runsAs: ml('Runs as', 'Tourne sous', 'Läuft als'),
    canManage: ml('User-administration permission', 'Droit de gestion des utilisateurs', 'Recht der Benutzerverwaltung'),
    yes: ml('yes', 'oui', 'ja'),
    no: ml('no', 'non', 'nein'),
    audit: ml('Audit trail DP', 'DP d’audit', 'Audit-DP'),
    auditMissing: ml('(absent: no audit line is written)', '(absent : aucune ligne d’audit n’est écrite)', '(fehlt: keine Auditzeile wird geschrieben)'),
    configTitle: ml('Project configuration (config/config, read-only)', 'Configuration du projet (config/config, lecture seule)', 'Projektkonfiguration (config/config, nur lesen)'),
    colSection: ml('Section', 'Section', 'Abschnitt'),
    colKey: ml('Entry', 'Entrée', 'Eintrag'),
    colValue: ml('Value', 'Valeur', 'Wert'),
    colDefault: ml('Default', 'Défaut', 'Standard'),
    notSet: ml('(not set)', '(non défini)', '(nicht gesetzt)'),
    userSettingsTitle: ml('User settings (read-only)', 'Paramètres utilisateur (lecture seule)', 'Benutzereinstellungen (nur lesen)'),
    colSetting: ml('Setting', 'Paramètre', 'Einstellung'),
    colBase: ml('Base value', 'Valeur de base', 'Basiswert'),
    colPerGroup: ml('Per group', 'Par groupe', 'Pro Gruppe'),
    colPerUser: ml('Per user', 'Par utilisateur', 'Pro Benutzer'),
    masked: ml('hidden', 'masqué', 'verborgen')
  }
};
