# wui-auth-badge — badge login

A login provider for the WebUI shell: it provides the shell's **alternative
login page** through wui-toolkit's login extension (`package.json#wuiPage.login`,
see the toolkit's `docs/REFERENCE.md`, "A module's login page"). A site selects
**one** login provider; wui refuses two.

- **Login page**: an RFID reader in keyboard emulation, badge → user through
  the `RFID_UID` user setting, a station's badge login locked after N refused
  badges from its IP address, kept in a blacklist with its history (below,
  "Station lock and blacklist"), an audit line per event.
- **Session close**: the module's shell boot script hooks every logout and
  "Switch user"; `POST /logout` writes its audit line for the token's user
  (below, "Session close").
- **Mon badge** (`/auth-badge`): the logged-in user associates their badge with
  their account — when self-service is on; else the page shows the badge and
  sends the user to someone with the `enrol` role (self-service off, the
  page lets no one change a badge, whatever their roles).
- **Badges** (`/auth-badge/admin`): the settings and every user's badge, by
  role (below).
- **Switch user** in the menu (the extension's `wui-switch-user-menu-item`).
- Backend `/api/auth-badge` (`backend/badgeRoute.ts`, `badgeAuth.ts`,
  `badgeBlacklist.ts`, `badgeHash.ts`, `badgeSettings.ts`, `oaAuth.ts`).

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

Runtime **2.0.1** (the shell extension exists for it only), wui-toolkit
0.23.0 or later (the logout hook; 0.11 for the rest). `wui build` deploys the shell with the extension, the page, the login
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
| `configure` | the page's settings (shown read-only without it); the blacklist, read-only |
| `enrol` | the users list: associate a badge with any WinCC OA user (presented to the reader, a number another user has refused), **test** that a presented badge opens that user's session (the login's own rules, nothing written: `POST /users/:userId/test` → `match`, `other` + the owner's name, `none`), or remove it — one's own included, here and not on Mon badge; the blacklist, and **unlock** a locked station, with a reason |

The page has three tabs: **Utilisateurs** (shown with `enrol` only), **Liste
noire** (the stations' locks, below; read with `enrol` or `configure`,
Déverrouiller with `enrol`) and **Configuration** (the settings below;
read-only without `configure`). A user with neither role sees only that the
page is reserved. The settings:

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
- **Verrouillage des postes** — saved together (Enregistrer): the **refused
  badges** in a row before a station's badge login is locked
  (`lockAfterFailures`, 1–20, 0 = never, default 3) and **how long**
  (`lockDurationMin`, 1–1440 min, 0 = until unlocked on this page, default
  15). Bounded by the server as the reader's settings, taken into account at
  the next badge (no restart).

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

## Station lock and blacklist

Per **station** — the request's IP address (`clientAddress`: the first
`X-Forwarded-For` address, else the socket's) —, never per user
(`backend/badgeBlacklist.ts`):

- **Every refused badge counts** for its station: an unknown badge
  (`BADGE_INCONNU`) or a recognised user refused — disabled account, no WebUI
  login permission (`SESSION_REFUSEE`). At `lockAfterFailures` in a row the
  station's badge login is locked (`MIRE_VERROUILLEE`: the address, the count)
  for `lockDurationMin`, or until unlocked. A login from the station resets
  its count. The other stations are not touched.
- While locked, **every** badge from that address gets
  `{ status: 'locked', lockedUntil }` before it is even looked up
  (`BADGE_REFUSE_VERROU`) — `lockedUntil` null: until unlocked. The login page
  shows « Connexion par badge verrouillée sur ce poste » with the deadline
  (`GET /config` tells it as it loads: `locked`, `lockedUntil`) and keeps
  reading: a badge asks the server again, so an unlock is taken at once. The
  password login stays open.
- **The blacklist**: every lock is a record `{ id, ip, lockedAt, lockedUntil,
  failures, item, state, liftedBy, liftedAt, reason }` — `item` the last one
  the station sent (its workcenter), `state` `active`, `expired` (its deadline
  passed: `VERROU_EXPIRE`, written at the next badge or the next look at the
  list) or `lifted` (unlocked by hand: who, when, why). The ended records stay
  as the history, **500 at most**: beyond, the oldest ended ones are purged —
  never an active lock. The counts of the stations not locked are kept beside
  (`pending`, 500 addresses at most).
- Kept as JSON in the DP **`WuiAuthBadge_Blacklist.state`** (type
  `WuiAuthBadge_Blacklist`, created with the DP at the first refusal, as
  `WuiAuthBadge_Config` is) and read again for every decision — nothing is
  kept in the webserver's memory: a lock survives a restart. One webserver
  serialises its own changes; several webservers of one project share the
  DP (a refusal counted at the same instant on two of them may be lost).
- **Badges › Liste noire**: the locks — active ones, or all of them with the
  history (read-only) —: address, state, locked since, until, refusals,
  station item, who lifted it, when and why; the refusals counted below. With
  `enrol`, **Déverrouiller** on an active lock: a confirmation that requires a
  reason.

| Route | Role | Answer |
| --- | --- | --- |
| `GET /blacklist` | `enrol` **or** `configure` (both see the tab: one sets the threshold, the other unlocks) | `{ records, pending }`, records newest first; the locks run out turned `expired` first |
| `POST /blacklist/:ip/unlock { reason }` | `enrol` | `{ status: 'ok', record }` — 401 without a token, 403 without `enrol`, 400 without a reason (200 characters kept), 404 when the address is not locked; the count reset, audit `VERROU_LEVE` (who, the address, the reason) |

The roles are checked on the request's WebUI token, as for the users list.

`clientAddress` (`oaAuth.ts`, shared with `wui-auth-hello`) trusts the
`X-Forwarded-For` header: behind no reverse proxy, a client that forges it
chooses the address its refusals count for. Where the stations reach the
webserver directly, have the network (or a proxy that overwrites the header)
guarantee it.

**Since 0.6.0** the lock per user of 0.5.0 is gone — the user settings `BADGE_LOCK`
(`_usr_<UserId>_BADGE_LOCK`, `_uss_BADGE_LOCK`) are no longer read nor
written (delete them by hand if wished), `GET /users` no longer gives a
`lock`, `POST /users/:userId/unlock` is gone, and so are the audit actions
`BADGE_VERROUILLE`, `BADGE_VERROU_EXPIRE` and `BADGE_DEVERROUILLE`. A station
holding three unknown badges is locked as fra-stma's SL-BDG-09 asks
("3 badges / 15 min" by default).

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

**Wired by the module's boot script** (`wuiPage.shell.boot`,
`src/shell/boot.ts`, wui-toolkit 0.23.0 or later): `shell.onLogout` calls
`auditSessionClose(info.reason, { item: info.context.item, provider })` once
just before every close — the logout, "Switch user", a connection the server
closed —, the session still open; `provider` is the shell's (`auth-badge`…),
`standard` for the standard form or OIDC. The shell waits for it 3 s at most
and never lets it block the logout. The boot script declares neither a header
element nor `loginHome`: it goes along with the site's own boot script (the
station's page and `item`). `idle` is not a reason the shell gives: it is
there for the module that closes an idle session itself.

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
backend's specs: `badgeHash`, `badgeBlacklist` (the count per address, expiry,
unlock, the history's bound, the DP read again and the changes serialised),
`badgeSettings` (the lock's bounds) and `badgeAuth` (the station's lock —
unknown and refused badges alike, that station only, reset by a login —
across a restart, its expiry, `GET /blacklist` and the unlock refused without
the role or a reason, the session close's audit line — against a mocked
WinCC OA),
and `src/shell/boot.spec.ts` (the logout hook's request). The boot script does
not run in `wui dev` (no shell there).
The mock's station 10.0.0.42 is locked (Liste noire › Déverrouiller), with
two past locks in the history. The mock hashes with a fixed dev key.

## Not done

- The extension for runtimes other than 2.0.1.
