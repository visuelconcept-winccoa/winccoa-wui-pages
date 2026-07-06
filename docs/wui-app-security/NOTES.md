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
  load) and by the admin page's **Discover** seeding (static manifest);
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
  hint; the manifest + Discover is the authoritative seeding path.
- Menu-entry gating by role is NOT covered (the shell guard only knows
  connected/canEdit/canPublish/canWrite) — page/feature-level gating only.
- Frontend gating without the backend module deployed: unassigned roles stay
  open, assigned roles **lock** (fail closed) because `/me` is unreachable.
  Deploy the backend before assigning roles in production.
