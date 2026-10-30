<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# wui-users — user administration (WinCC OA / Active Directory)

The `/users` page does what the WinCC OA user administration panel does:

- **Users**: create a local user (with a password), edit (name, full name,
  comment, language, active), groups, set a local user's password, delete.
- **Groups**: the 32 system permission bits, the domains each with its own bits,
  the members, the names of the permission bits.
- **Domains** (WinCC OA *areas*) and their default bits.
- **Authentication method**: WinCC OA (`Standard`) or Active Directory
  (`Windows`), or a user-defined method available on the project.
- **AD import**: import AD groups (linked by their OSID), import AD users
  manually, or let the manager import the **new** AD users cyclically.
- **Read-only**: the config/config entries of the user administration and the
  user settings (`_UserDefinedSettings`), with sensitive contents masked.

Backend `/api/users` (`backend/usersRoute.ts`, `usersController.ts`): an HTTP →
MSA vRPC bridge to the **`usersService`** JS manager (service `WuiUsers`,
`managers/usersService/`).

## How a write reaches the project

```
page ─HTTP─▶ /api/users (role gate, who asks) ─vRPC─▶ usersService (validation, one write at a time, audit)
     ─WinccoaCtrlScript─▶ UserManagement / OaAuthFactory / UpdateUserGroups (CTRL, vendor classes)
     ─_CommandChannel (RSA-sealed commands)─▶ commandChannel manager ─▶ _Users / _Groups / _Areas
```

- **No dpSet on `_Users`, `_Groups`, `_Areas`**: everything goes through
  `UserManagement.saveChangesError()`, like the panel. `ctrl.js` holds the CTRL
  code; it was written against the 3.21 sources (`scripts/libs/classes/userManagement/*`,
  `classes/auth/*`, `classes/UpdateUserGroups.ctl`, `libs/userMan.ctl`,
  `scripts/commandChannel.ctl`).
- The authentication method is the value of `_WinUserAdmin.External`, which
  `OaAuthFactory::getAuthName()` reads. The page lists the methods
  `OaAuthFactory::listAuths()` offers on that project and refuses any other.
- **The manager's user**: the commandChannel manager checks every command against
  the **user the sending manager runs as**. That user needs the
  user-administration permission level (`_System.Auth.UserManagement`). Start
  `usersService` with such a user (`-user <name>:<password>` in pmon), or as root
  on a project without server-side authentication. The page shows a warning when
  that permission is missing (`GET /health` → `canManage`), and so does the
  manager's log at start.
- Permission level *L* (1..32) is bit *L−1* of WinCC OA's `bit32`
  (`userMan.ctl`, `getUserPermissionForArea`). The page sends 32 booleans,
  level 1 first.
- A new user or group gets its id only once saved. Its groups, domains and
  members are therefore assigned in a second save, as `importADGroupUsers.ctl` and
  `UserSelect::saveUsers` do. If the second save is refused, the object stays
  created and the answer says so.
- The writes are **serialised** in the manager: one `UserManagement` instance,
  whose local changes another save would otherwise send. AD listings run beside
  them.

## Active Directory import

Only with the AD authentication. AD users and groups are listed through
`OaAuthMethod.getNextUsers` / `getNextGroups` (`GET_NEXT_*`). A user's groups come
from `UpdateUserGroups::getGroupListForUser(…, modifyGroups = false)`: only the
groups that already exist in WinCC OA, and none is created.

**Import of AD groups** (`manage-groups`): the selected AD groups become WinCC OA
groups linked by their OSID (`GroupSelect::saveGroups`). These are the
*AD-linked groups*.

**New AD users** — the choice is made on the AD import tab (`configure`):

| Mode | What happens |
| --- | --- |
| **Manual** (default) | Nothing automatic. *Manual import of users* (`manage-users`): read the AD, tick users, import. Each one is created in the WinCC OA groups they belong to in the AD; a user in no such group is not imported (as the panel refuses them). |
| **Automatic** | Every `intervalMin` minutes (60 at least, 7 days at most) and on *Run now*, the manager creates every AD user who is **not yet** a WinCC OA user and belongs to at least one AD-linked group (all of them, or the ticked ones), in those groups, linked by their OSID. Manual import stays available. |

- **Existing users are never touched**: their groups and their state are kept up
  to date by WinCC OA's standard `WCCOAupdateUserGroups` script (`updateUserGroups.ctl`,
  `[ui] checkADAuthIntervall`). This module only **creates** what is missing.
- No group is created by a user import; root is never touched.
- An AD user found in no target group is not asked again while the set of target
  groups does not change (cache of the manager's lifetime). An error on a user is
  not cached: they are asked again at the next cycle.
- Settings and last report are in the DP **`WuiUsers_Config`** (`.settings`,
  `.status`, type created at the manager's start). The import is **off** until it
  is turned on in the page. The last report (created, already in WinCC OA, in no
  group concerned, errors) and the next run are shown on the tab.
- This replaces the standalone `importADGroupUsers.ctl` manager and its
  `[importADGroupUsers] interval` config entry (shown read-only when it is still
  set). Do not run both.

## Roles (Application Security, module `users`)

Open to every user until an admin assigns groups in `/app-security`.
`src/app-security.roles.json`:

| Role | Gives |
| --- | --- |
| `view` | the page and its lists, the import report, the read-only settings (`GET /state`, `/import`, `/settings`) |
| `manage-users` | users: create, edit, password, delete; AD users: list and import |
| `manage-groups` | groups, domains, permission names; AD groups: list and import |
| `configure` | authentication method; automatic import: mode, interval, groups, *Run now* |

The backend checks the same roles (`requireRole` of the shared
`appSecurityGuard.ts`) on the webserver session's user. That user is also the
one written in the audit trail.

## Audit

Every change is written by the manager to an `_AuditTrail` DP **when it exists**:
`auditDp` of the `[wui-users]` section of config/config, else `WUI_USERS_AUDIT_DP`,
else `AuditTrail_Users`. Each line has the user who asked, the target as item,
`oldval` (the object before) and `newval` (the request). No line ever holds a
password. Actions: `UTILISATEUR_CREE`, `UTILISATEUR_MODIFIE`,
`MOT_DE_PASSE_DEFINI`, `UTILISATEUR_SUPPRIME`, `GROUPE_CREE`, `GROUPE_MODIFIE`,
`GROUPE_SUPPRIME`, `DOMAINE_CREE`, `DOMAINE_MODIFIE`, `DOMAINE_SUPPRIME`,
`NOMS_DROITS_MODIFIES`, `MODE_AUTHENTIFICATION_MODIFIE`, `GROUPE_IMPORTE_AD`,
`UTILISATEUR_IMPORTE_AD`, `IMPORT_AD_CONFIGURE`.

## On a site

```powershell
npx wui use users           # npm install @visuelconcept-winccoa/wui-users + select it
npx wui build prod          # page, /api/users, managers/usersService
```

Then, in the WinCC OA console:

1. Register the manager:
   `node | always | 30 | 3 | 1 |usersService/index.js -user <admin>:<password>`
   (a user with the user-administration permission). Start it.
2. Restart the webserver manager (new routes).
3. In `/app-security`, assign the `users` roles: until then, any connected user
   can administer the users.

After an update of the module, restart `usersService` too: like every manager,
it keeps its old code in memory.

One `usersService` per project. The vRPC service name `WuiUsers` is unique
across the system. On a redundant pair, register it like the other
single-instance managers of the project.

## API (`/api/users`)

See the header of `backend/usersRoute.ts`. A refusal of the WinCC OA user
administration (name taken, password policy, missing permission…) answers
**409** with its reason. A validation error answers 400. **502** means the
manager does not answer: start it, or restart it after a deploy.

## To check on a real 3.21 project

These points were written against the sources but not run here (no WinCC OA in
the development environment):

- `WinccoaCtrlScript` running the vendor classes inside the JS manager. This
  includes `CtrlOSConnector`, the extension `OaAuthMethodAD` loads for the AD
  enumeration.
- The payload encryption of the vRPC service: the manager sets it to mandatory
  when its `winccoa-manager` exposes the option, and otherwise says in its log
  that passwords travel in clear on the vRPC channel.
- That switching `_WinUserAdmin.External` is all the panel does to change the
  method on your version.

## Here

`npx wui dev` runs the page on its mock (`mock/api.mjs`): an AD-authenticated
project, an AD of six users and four groups, and *Run now* importing the new
users the way the manager does. `npm test` runs `test/logic.test.mjs` (settings,
validation, import decision, masked settings) and `src/users/model.spec.ts`.
