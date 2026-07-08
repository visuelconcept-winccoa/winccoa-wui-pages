<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# wui-app-security — business & architecture notes

Tier 3 module: page `/app-security` (element `wui-app-security`) + webserver
backend `/api/app-security` (no manager). Prerequisite: the `wui-para` backend
(`/api/para`) for DP type/instance creation and value writes.

## DP model (validated design)

One DP per module — type `AppSecurity_Module` (Struct, 3 Strings), instance
`AppSecurity_<module>`:

- `.module` — the page id (redundant with the DP name, convenient for queries);
- `.roles` — declaration JSON `{ title: MultiLangString, roles: [{id, label, description?}] }`,
  written by the PROVIDING module (`registerModuleRoles`, best-effort at page
  load) and by the admin page's **Discover** seeding. Both read the SAME
  per-module `app-security.roles.json` fragment (aggregated into the
  `app-security-manifest.json` asset by the `page-appsec-merge` Vite plugin) —
  there is no central manifest;
- `.assignments` — `{roleId: [group names]}`, written **ONLY** by the admin page.

Two elements = two writers with **no contention** (the original single-JSON
idea was rejected for that reason). Role/group direction is role → groups
(many-to-many overall).

## Grant resolution (client `hasRole$` and server guard — identical rules)

1. Role **not assigned** (absent key or empty array) → **granted** to every
   connected user (open by default — deploying the module locks nothing).
2. Assigned → granted when the session user is **OA root** (`UserId 0`) or
   belongs (OA group membership) to **one** of the assigned groups.
3. Assigned + **identity unknown** (identity endpoint unreachable) →
   **denied** (fail closed: an assigned role means the admin opted in).
4. Guard internal error → **fail open** with a server log (an outage of the
   guard must not take the API down).

## Identity & the `_Users`/`_Groups` structure (3.21 — verified live)

- `/me` resolves the **session** user from the webserver's own authentication
  (passport session, basic/OIDC — never client-declared), then the groups from
  the system DPs through `WsjServerGlobal.winccoa` (full `WinccoaManager`).
- **There is NO `_Groups` DP type.** Users and groups are two DP **instances
  of the same `_Users` type**: on the `_Groups` DP, `UserName`/`UserId` carry
  the GROUP names/ids. A user's `_Users.GroupIds` entry is a `;`/`,`-separated
  id list mapped against them.
- Element names are resolved by introspection (`dpTypeGet('_Users')`,
  case-insensitive candidates, classic names as fallback) and each element is
  read in an **isolated** dpGet — one unreadable element degrades that field
  only (never "9399, multiple errors" wholesale). 5 s cache.
- The page's group picker falls back to a direct `_Groups.UserName`/`UserId`
  dpGet when `/groups` is not mounted; failures are logged as
  `[app-security] …` in the browser console.

## Page behaviours

- **No offline latch**: `list()` ensures the DP type exists first (same order
  as `DpJsonStore`), re-attempts the backend on every call; a successful
  list/discover clears the offline flag.
- **Stale assignments** (role assigned but no longer declared) are badged, kept,
  and never auto-deleted.
- **Audit**: every `.assignments` write logs one UPDATE row (old/new JSON) into
  `AuditTrail_AppSecurity` via the kit `AuditTrailWriter`.
- The page gates itself with its own `manage` role (assign it first).

## Pitfalls

- The kit `hasRole$` caches the identity fetch and one `dpConnect` per module
  (shareReplay) — cheap to call from many components.
- `registerModuleRoles` runs under the VISITING user's rights: treat it as a
  hint; the aggregated `app-security-manifest.json` + Discover is the
  authoritative seeding path (both derive from the per-module fragments).
- Menu-entry gating by role is NOT covered (the shell guard only knows
  connected/canEdit/canPublish/canWrite) — page/feature-level gating only.
- **Identity has two client paths**: `/me` first (server-side view); when it is
  unreachable OR answers anonymously (the webserver's HTTP layer has no session
  when server-side auth is disabled — the SPA authenticates at the websocket
  layer), the kit falls back to the SHELL's session user (`WuiUserService`) +
  a direct `_Users`/`_Groups` read. Only when BOTH paths fail does an assigned
  role deny (fail closed).
- **Server-side guard and anonymous requests**: when a request carries no
  session identity, `requireRole` SKIPS the check (fail open, logged
  `appSecurityGuard: … check skipped`) — otherwise a legitimately granted UI
  action would 403 incoherently. Real API enforcement therefore requires the
  webserver's own authentication (basic/OIDC session) to be enabled; without
  it the roles are UI-level protection.
- **Identity is REACTIVE** (`identity$`): cached per SHELL user and re-resolved
  whenever `WuiUserService.user$` emits (login/logout without a SPA reload,
  late user-settings load). `hasRole$` consumes it, so every module's gates
  re-evaluate on a user switch; the page banner subscribes to it too. Never
  cache `identity()` yourself at module scope.
