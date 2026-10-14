# wui-auth-badge — badge login

A login provider for the WebUI shell: it provides the shell's **alternative
login page** through wui-toolkit's login extension (`package.json#wuiPage.login`,
see the toolkit's `docs/REFERENCE.md`, "A module's login page"). A site selects
**one** login provider; wui refuses two.

- **Login page**: an RFID reader in keyboard emulation, badge → user through
  the `RFID_UID` user setting, the page locked 15 min after 3 unknown badges, an
  audit line per event.
- **Mon badge** (`/auth-badge`): the logged-in user associates their badge with
  their account.
- **Switch user** in the menu (the extension's `wui-switch-user-menu-item`).
- Backend `/api/auth-badge` (`backend/badgeRoute.ts`, `badgeAuth.ts`,
  `oaAuth.ts`).

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
- Webserver environment: `WUI_BADGE_PREFIX` (the reader's frame prefix;
  `MSP_BADGE_PREFIX` still read).
- The audit lines' `_AuditTrail` DP (written only when it exists): `auditDp` in
  the project's `config/config`, section `[wui-auth]`
  (`auditDp = "AuditTrail_MSP"`), else `WUI_AUTH_AUDIT_DP` in the webserver's
  environment, else `AuditTrail_Auth`. Read at the webserver's start.

## Here

`npx wui dev` runs the **Mon badge** page with its mock (`mock/api.mjs`), not
the login element: the harness has no login page. `npm test` checks its types
(page and backend) and runs `src/badge-frame-detector.spec.ts`.

## Not done

- A badge association by an administrator (only the user's own, here).
- The extension for runtimes other than 2.0.1.
