<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# @visuelconcept/wui-app-security — Application Security (roles ↔ WinCC OA groups)

Standalone WebUI page (`/app-security`, Tier 3) to **discover the ROLES each
page module expects** (view, edit, deploy, control, sign…) and **map every role
to WinCC OA user GROUPS**. Pages gate their UI live through the shared
`hasRole$` primitive; sensitive backend routes enforce the same rules
server-side.

**Open by default**: a role with **no assigned group is granted to every
connected user** — deploying this module locks nothing until an administrator
assigns groups. Assign the page's own `manage` role first: it protects the
page itself.

## How it fits together

| Piece | Where | Job |
| --- | --- | --- |
| `AppSecurity_<module>` DP (type `AppSecurity_Module`) | one per module | `.roles` = declaration (written by the module), `.assignments` = `{role: [groups]}` (written ONLY by this page) |
| `hasRole$(module, role)` / `registerModuleRoles(decl)` | `@visuelconcept/wui-kit/data/app-security.js` | live UI gating + self-registration at page load |
| `/api/app-security` (`/me`, `/groups`) | webserver module | resolves the SESSION user + their OA groups server-side (`_Users`/`_Groups`) |
| `requireRole(module, role)` | `backend/routes/appSecurityGuard.ts` (copied into each consuming module) | express middleware → 403 server-side |
| Static manifest | `libs/wui-app-security/src/app-security/manifest.ts` | "Discover modules" seeding — covers pages never visited |

## Install

Standard page-module flow: `node packages/wui-app-security/install.mjs
--workspace <runtime-workspace> --project <project>`, rebuild the
customer-webserver, restart it. **Prerequisite**: the `wui-para` backend
(`/api/para`) — it creates the DP type/instances and writes values (like every
DP-JSON-store page).

## Usage

1. Open `/app-security` → **Discover modules** (seeds/refreshes every known
   module's declaration).
2. Per role, **Edit groups** → tick OA groups (directory from `/groups`, with
   a direct `_Groups` fallback) or type a group name.
3. Every assignment change writes a GxP audit row (`AuditTrail_AppSecurity`).

**To secure YOUR module (or let an AI agent do it): follow
[INTEGRATION.md](./INTEGRATION.md).** Architecture details and pitfalls:
[NOTES.md](./NOTES.md).
