# wui-auth-badge — badge login

A login provider for the WebUI shell: it provides the shell's **alternative
login page** through wui-toolkit's login extension (`package.json#wuiPage.login`,
see the toolkit's `docs/REFERENCE.md`, "A module's login page"). A site selects
**one** login provider; wui refuses two.

- **Login page**: an RFID reader in keyboard emulation, badge → user through
  the `RFID_UID` user setting, the page locked 15 min after 3 unknown badges, an
  audit line per event.
- **Mon badge** (`/auth-badge`): the logged-in user associates their badge with
  their account — when self-service is on; else the page shows the badge and
  sends the user to someone with the `enrol` role (self-service off, the
  page lets no one change a badge, whatever their roles).
- **Badges** (`/auth-badge/admin`): the settings and every user's badge, by
  role (below).
- **Switch user** in the menu (the extension's `wui-switch-user-menu-item`).
- Backend `/api/auth-badge` (`backend/badgeRoute.ts`, `badgeAuth.ts`,
  `badgeSettings.ts`, `oaAuth.ts`).

Taken from fra-stma, then developed in `winccoa-wui-auth` beside
`wui-auth-hello` (Windows Hello). The two share three files — keep them equal:
`src/login-provider.ts` (the login element's base: the extension's contract),
`src/session.ts` (the user's token for their own account's pages) and
`backend/oaAuth.ts` (WebUI token signed by the CTRL function `/WebUI_Token`
uses, token check, users, user settings, audit).

## On a site

```powershell
npx wui use auth-badge      # npm install @visuelconcept-winccoa/wui-auth-badge + select it
```

Runtime **2.0.1** (the shell extension exists for it only), wui-toolkit 0.11
or later. `wui build` deploys the shell with the extension, the page, the login
element and the routes; restart the webserver manager after.

- A station that opens on the badge page: `https://<host>/?login=auth-badge`
  (`&login-test=1`: a button presents the test badge 12345678). The module
  also reads fra-stma's former addresses (`wuiPage.login.aliases`): `?badge=1`
  (the badge page), `?badge=0` (the standard form), `badgetest=1`.
- The page after login and the audit line's item are the site's: a module of
  the site sets them through the shell (`wuiPage.shell`: `setLoginHome`,
  `setLoginContext({ item })`). auth-badge writes the `item` it gets in its
  audit lines; it knows nothing of the module that sets it.
- Webserver environment: `WUI_BADGE_PREFIX` (the reader's frame prefix until
  one is saved on Badges; `MSP_BADGE_PREFIX` still read).
- The audit lines' `_AuditTrail` DP (written only when it exists): `auditDp` in
  the project's `config/config`, section `[wui-auth]`
  (`auditDp = "AuditTrail_MSP"`), else `WUI_AUTH_AUDIT_DP` in the webserver's
  environment, else `AuditTrail_Auth`. Read at the webserver's start.

## Badges page and roles

Application Security roles of the module `auth-badge`
(`src/app-security.roles.json`), open to every user until an admin assigns
groups to them in `/app-security`:

| Role | Gives |
| --- | --- |
| `configure` | the page's settings (shown read-only without it) |
| `enrol` | the users list: associate a badge with any WinCC OA user (presented to the reader, a number another user has refused) or remove it — one's own included, here and not on Mon badge |

The page has two tabs: **Utilisateurs** (shown with `enrol` only) and
**Configuration** (the settings below; read-only without `configure`). A user
with neither role sees only that the page is reserved. The settings:

- **Connexion par badge activée** (`badgeLoginEnabled`, default on): off, the
  login page says so and `/login` answers `disabled` (audit
  `BADGE_REFUSE_DESACTIVE`); the password form is untouched.
- **Page « Mon badge » ouverte à tous** (`selfEnrolment`, default on — the
  behaviour of before 0.3): off, Mon badge only shows the badge and
  `PUT`/`DELETE /me` answer 403 to every user, `enrol` included (audit
  `BADGE_REFUSE_ENROLEMENT`): the badges are then enrolled on Badges only.
- **Lecteur de badge** — the reader's frame, saved together (Enregistrer):
  the **prefix** typed before the number (16 characters at most, default
  `WUI_BADGE_PREFIX`), the **longest burst** from the first character to the
  end key (20–2000 ms, default 150), the **shortest number**, prefix excluded
  (1–64, default 4; the server checks it again when a badge is associated),
  the **end key** (Entrée or Tabulation, default Entrée). `GET /config` hands
  them to the pages; `PUT /settings` answers 400 on a value out of bounds.

The login page, Mon badge and the users list read the badge with one
component, `wui-auth-badge-reader` (`src/badge-reader.ts`): the prompt (heading
and message) and an invisible field that keeps the focus while a badge is
awaited, only a reader's frame kept — a number typed on the keyboard is
ignored. The field is a text field: a password field makes the browser fill the
text field before it (the users filter) with a saved login.

Stored as JSON in the DP `WuiAuthBadge_Config.settings`; the backend creates
its type and the DP at the first change — without them, the defaults. Audit
lines: `CONFIG_BADGE_MODIFIEE`, and `BADGE_ASSOCIE` / `BADGE_RETIRE` with the
target account and who did it.

The roles are checked by the backend against the user of the request's WebUI
token (`identityOfUsername` of the shared `appSecurityGuard.ts`): a badge
session has no webserver session, so `requireRole`, which reads the latter,
would let every call through. The module therefore requires `para` and
`app-security` (role registration, `hasRole$`) and the shared guard
(`wui-app-security` 0.1.3 or later).

`oaAuth.ts` now exports `users()` (the whole `_Users` directory): give
`wui-auth-hello`'s copy the same export when it is next synced.

## Here

`npx wui dev` runs the **Mon badge** page with its mock (`mock/api.mjs`), not
the login element: the harness has no login page. The mock's Mon badge acts
as a user without `enrol` (turn self-service off with
`PUT /api/auth-badge/settings`); **Badges** is in the same bundle
(`wui-auth-badge-admin`) but not in the harness menu, which shows one entry
per page. `npm test` checks its types
(page and backend) and runs `src/badge-frame-detector.spec.ts`.

## Not done

- The extension for runtimes other than 2.0.1.
