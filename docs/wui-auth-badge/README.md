# wui-auth-badge — badge login

A login provider for the WebUI shell: it provides the shell's **alternative
login page** through wui-toolkit's login extension (`package.json#wuiPage.login`,
see the toolkit's `docs/REFERENCE.md`, "A module's login page"). A site selects
**one** login provider; wui refuses two.

- **Login page**: an RFID reader in keyboard emulation, badge → user through
  the `RFID_UID` user setting, a user's badge locked after N refused logins
  (below, "Badge lock"), an audit line per event.
- **Session close**: `POST /logout` writes the audit line of a logout, a
  switch user or an idle expiry, for the token's user (below, "Session close").
- **Mon badge** (`/auth-badge`): the logged-in user associates their badge with
  their account — when self-service is on; else the page shows the badge and
  sends the user to someone with the `enrol` role (self-service off, the
  page lets no one change a badge, whatever their roles).
- **Badges** (`/auth-badge/admin`): the settings and every user's badge, by
  role (below).
- **Switch user** in the menu (the extension's `wui-switch-user-menu-item`).
- Backend `/api/auth-badge` (`backend/badgeRoute.ts`, `badgeAuth.ts`,
  `badgeHash.ts`, `badgeSettings.ts`, `oaAuth.ts`).

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
| `enrol` | the users list: associate a badge with any WinCC OA user (presented to the reader, a number another user has refused), **test** that a presented badge opens that user's session (the login's own rules, nothing written: `POST /users/:userId/test` → `match`, `other` + the owner's name, `none`), or remove it — one's own included, here and not on Mon badge; see each user's badge lock and **unlock** it, with a reason |

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
- **Chiffrer les codes badge** (`hashBadges`, default off): below.
- **Lecteur de badge** — the reader's frame, saved together (Enregistrer):
  the **prefix** typed before the number (16 characters at most, default
  `WUI_BADGE_PREFIX`), the **longest burst** from the first character to the
  end key (20–2000 ms, default 150), the **shortest number**, prefix excluded
  (1–64, default 4; the server checks it again when a badge is associated),
  the **end key** (Entrée or Tabulation, default Entrée). `GET /config` hands
  them to the pages; `PUT /settings` answers 400 on a value out of bounds.
- **Verrouillage des comptes** — saved together (Enregistrer): the **refused
  logins** before a user's badge is locked (`lockAfterFailures`, 1–20, 0 =
  never, default 3) and **how long** (`lockDurationMin`, 1–1440 min, 0 = until
  unlocked on this page, default 15). Bounded by the server as the reader's
  settings, taken into account at the next badge (no restart).

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

## Badge lock

Per **user**, never per station (`backend/badgeLock.ts`):

- Only refusals imputable to a user count: their badge is recognised but the
  account is disabled, or has no WebUI login permission (audit
  `SESSION_REFUSEE`). At `lockAfterFailures` in a row their badge is locked
  (`BADGE_VERROUILLE`) for `lockDurationMin`, or until unlocked; a login
  resets the count.
- Kept in the user's setting `BADGE_LOCK` (`_usr_<UserId>_BADGE_LOCK`, created
  at first need as `RFID_UID` is): `{ failures, lockedAt, lockedUntil, host }`
  — `lockedUntil` null: until unlocked. The lock survives a webserver restart
  and holds on every station.
- While locked, the user's badge gets `{ status: 'locked', lockedUntil,
  username, fullName }` (`BADGE_REFUSE_VERROU`); the login page shows the
  user's name a moment, then waits for the next badge. The expiry is audited
  when the badge is next presented (`BADGE_VERROU_EXPIRE`).
- An **unknown badge locks nothing** — not the page, not the station, not a
  user: `{ status: 'unknown' }` and an audit line (`BADGE_INCONNU`, station,
  item) every time. The 0.4 station lock (`MIRE_VERROUILLEE`) is gone. This
  departs from fra-stma's SL-BDG-09 wording ("3 badges / 15 min"): to be
  recorded in the site's SDS or tracking register.
- **Badges › Utilisateurs** shows each user's lock (locked until when, or the
  failures counted) and, with `enrol`, **Déverrouiller**: a confirmation that
  requires a reason. `POST /users/:userId/unlock { reason }` — 401 without a
  token, 403 without `enrol`, 400 without a reason (200 characters kept) —
  clears the lock and the count; audit `BADGE_DEVERROUILLE` with who unlocked,
  whom, and the reason.

No audit line ever holds a badge number.

## Session close

`POST /api/auth-badge/logout { reason, item?, provider?, idleMinutes? }` with
the session's WebUI token (`Authorization: Bearer`): one audit line for the
token's user — never a name sent by the page —, whatever the module that
opened the session (`provider`, written in the line):

| `reason` | Audit action |
| --- | --- |
| `logout` | `SESSION_FERMEE` |
| `switch-user` | `SESSION_CHANGEMENT_UTILISATEUR` |
| `idle` | `SESSION_EXPIREE_INACTIVITE` (with `idleMinutes`, the delay applied) |

401 without a valid token, 400 on another reason; a failed audit write is
logged by the webserver. The browser's side, `src/session-close.ts`:

```ts
import { auditSessionClose } from '@visuelconcept-winccoa/wui-auth-badge/src/session-close.js';

auditSessionClose('idle', { item, provider: sessionProvider(), idleMinutes: 30 });
```

It sends the request `keepalive`, with the stored token (or `token`), and
never throws nor rejects: the logout does not wait for it. Call it before the
shell clears the token.

**Not wired yet**: the call belongs in the shell's logout hook
(visuelconcept-winccoa/winccoa-wui-tools#27, in development), called just
before every close with the reason, `sessionProvider()` and the login context
(`item`). Once its API is known, the module declares it in its shell boot
script (`wuiPage.shell.boot`) or its login extension, e.g.:

```ts
// a hook as onLogout(cb), or a `wui:logout` event — whichever wui-toolkit ships
onLogout(({ reason, provider, context, idleMinutes }) =>
  void auditSessionClose(reason, { item: context?.item, provider, idleMinutes })
);
```

The module has no shell boot script today.

The roles are checked by the backend against the user of the request's WebUI
token (`identityOfUsername` of the shared `appSecurityGuard.ts`): a badge
session has no webserver session, so `requireRole`, which reads the latter,
would let every call through. The module therefore requires `para` and
`app-security` (role registration, `hasRole$`) and the shared guard
(`wui-app-security` 0.1.3 or later).

`oaAuth.ts` now exports `users()` (the whole `_Users` directory): give
`wui-auth-hello`'s copy the same export when it is next synced.

## Badge numbers as fingerprints (`hashBadges`)

Stored as `$hmac-sha256$<hex>` (`backend/badgeHash.ts`): HMAC-SHA256 of the
number with a server secret key — one-way (it cannot be read back),
deterministic (a badge is still looked up, a duplicate still refused), and
keyed: a badge has few possible numbers (10^8 for eight digits), a plain hash
would be reversed by trying them all.

- **Turned on** (confirmed on the page): every number stored in clear is
  rewritten as its fingerprint first (audit `BADGES_CHIFFRES`, the count), then
  the setting is stored — a failure leaves it off. From then on new badges are
  stored hashed, and **only fingerprints match** at login, on test and for
  `taken`. Asked again, it rewrites whatever was left in clear.
- **Turned off**: nothing is decrypted — it cannot be. The fingerprints stay
  and still match; new badges are stored in clear; a stored value matches in
  clear or as a fingerprint.
- Duplicates are refused in either form, whatever the setting.
- The pages never get digits of a hashed badge: `hashed: true`, `badge: null`
  ("Associé (chiffré)", "code chiffré").

The key: `WUI_BADGE_HASH_KEY` in the webserver's environment (its text as the
key), else `wui-auth-badge.key` beside the project's config file (PVSS_II),
32 random bytes in hex, generated (mode 0600) at the first activation — never
just to compare: a lost key is not silently replaced. **Back it up with the
project**: without it the hashed badges no longer open anything and must be
enrolled again. Several webservers of one project share the file; give each
other project the same `WUI_BADGE_HASH_KEY` to share badges.

## Here

`npx wui dev` runs the **Mon badge** page with its mock (`mock/api.mjs`), not
the login element: the harness has no login page. The mock's Mon badge acts
as a user without `enrol` (turn self-service off with
`PUT /api/auth-badge/settings`); **Badges** is in the same bundle
(`wui-auth-badge-admin`) but not in the harness menu, which shows one entry
per page. `npm test` checks its types
(page and backend) and runs `src/badge-frame-detector.spec.ts` and the
backend's specs: `badgeHash`, `badgeLock` (count, expiry, persistence's
format), `badgeSettings` (the lock's bounds) and `badgeAuth` (the login's lock
across a restart, unknown badges never locking, unlock refused without the
role or a reason, the session close's audit line — against a mocked WinCC OA).
The mock's user `former` is locked (Déverrouiller). The mock hashes with a fixed dev key.

## Not done

- The extension for runtimes other than 2.0.1.
- The session close's call from the shell's logout hook (above), waiting for
  wui-toolkit's hook (visuelconcept-winccoa/winccoa-wui-tools#27).
