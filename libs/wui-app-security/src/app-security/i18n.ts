// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Application Security page (EN / FR / DE).
 * Same pattern as every page: MSG catalog + localize/localizeDir re-exports.
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
  header: ml('Application Security', 'Sécurité applicative', 'Anwendungssicherheit'),
  page: {
    intro: ml(
      'Map the roles each module expects to your WinCC OA user groups. A role with no group stays open to every connected user.',
      'Associez les rôles attendus par chaque module à vos groupes d’utilisateurs WinCC OA. Un rôle sans groupe reste ouvert à tous les utilisateurs connectés.',
      'Ordnen Sie die von jedem Modul erwarteten Rollen Ihren WinCC-OA-Benutzergruppen zu. Eine Rolle ohne Gruppe bleibt für alle verbundenen Benutzer offen.'
    ),
    offline: ml(
      'Offline mode: assignments cannot be persisted — the PARA backend (/api/para) is unreachable or you lack write rights. Deploy the wui-para backend module, then Refresh.',
      'Mode hors-ligne : les associations ne peuvent pas être enregistrées — le backend PARA (/api/para) est injoignable ou vous n’avez pas les droits d’écriture. Déployez le module backend wui-para, puis Actualiser.',
      'Offline-Modus: Zuordnungen können nicht gespeichert werden — das PARA-Backend (/api/para) ist nicht erreichbar oder Schreibrechte fehlen. Das wui-para-Backend-Modul bereitstellen, dann Aktualisieren.'
    ),
    noIdentity: ml(
      'Identity service unreachable (/api/app-security) — deploy the app-security backend so assigned roles can be enforced.',
      'Service d’identité injoignable (/api/app-security) — déployez le backend app-security pour que les rôles assignés soient appliqués.',
      'Identitätsdienst nicht erreichbar (/api/app-security) — App-Security-Backend bereitstellen, damit zugewiesene Rollen durchgesetzt werden.'
    ),
    discover: ml('Discover modules', 'Découvrir les modules', 'Module erkennen'),
    discoverHint: ml(
      'Create/refresh the role declaration of every known module (also covers pages never visited).',
      'Créer/rafraîchir la déclaration de rôles de tous les modules connus (couvre aussi les pages jamais visitées).',
      'Rollendeklaration aller bekannten Module anlegen/aktualisieren (auch nie besuchte Seiten).'
    ),
    refresh: ml('Refresh', 'Actualiser', 'Aktualisieren'),
    empty: ml(
      'No module declared yet. Click “Discover modules” to seed the catalog.',
      'Aucun module déclaré. Cliquez sur « Découvrir les modules » pour initialiser le catalogue.',
      'Noch kein Modul deklariert. Klicken Sie auf „Module erkennen“, um den Katalog zu erzeugen.'
    ),
    forbidden: ml(
      'Your groups do not hold the “Manage role assignments” role of this page.',
      'Vos groupes ne possèdent pas le rôle « Gérer les associations de rôles » de cette page.',
      'Ihre Gruppen besitzen die Rolle „Rollenzuordnungen verwalten“ dieser Seite nicht.'
    )
  },
  me: {
    connectedAs: ml('Connected as', 'Connecté en tant que', 'Angemeldet als'),
    admin: ml('root (all roles granted)', 'root (tous les rôles accordés)', 'root (alle Rollen gewährt)'),
    groups: ml('Groups', 'Groupes', 'Gruppen'),
    noGroups: ml('no group', 'aucun groupe', 'keine Gruppe')
  },
  table: {
    module: ml('Module', 'Module', 'Modul'),
    role: ml('Role', 'Rôle', 'Rolle'),
    groups: ml('Assigned groups', 'Groupes associés', 'Zugeordnete Gruppen'),
    openToAll: ml('Open to all connected users', 'Ouvert à tous les connectés', 'Offen für alle Verbundenen'),
    stale: ml(
      'Not declared by the module anymore (assignment kept)',
      'Plus déclaré par le module (association conservée)',
      'Vom Modul nicht mehr deklariert (Zuordnung beibehalten)'
    ),
    edit: ml('Edit groups', 'Modifier les groupes', 'Gruppen bearbeiten'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    clear: ml('Clear (open to all)', 'Vider (ouvert à tous)', 'Leeren (für alle offen)'),
    addGroupPlaceholder: ml('Add a group name…', 'Ajouter un nom de groupe…', 'Gruppennamen hinzufügen…'),
    add: ml('Add', 'Ajouter', 'Hinzufügen'),
    noDirectory: ml(
      'OA group directory unavailable — type the exact group name below (deploy the app-security backend for the list; details in the browser console).',
      'Annuaire des groupes OA indisponible — saisissez le nom exact du groupe ci-dessous (déployez le backend app-security pour la liste ; détails dans la console du navigateur).',
      'OA-Gruppenverzeichnis nicht verfügbar — geben Sie den exakten Gruppennamen unten ein (App-Security-Backend für die Liste bereitstellen; Details in der Browser-Konsole).'
    )
  }
} as const;

/** "N modules · M roles" toolbar count (plain string). */
export function catalogCountMsg(modules: number, roles: number): string {
  return localize(ml(`${modules} module(s) · ${roles} role(s)`, `${modules} module(s) · ${roles} rôle(s)`, `${modules} Modul(e) · ${roles} Rolle(n)`));
}

/** "Discovered/refreshed N modules" toast (plain string). */
export function discoveredMsg(count: number): string {
  return localize(ml(`${count} module(s) declared.`, `${count} module(s) déclaré(s).`, `${count} Modul(e) deklariert.`));
}
