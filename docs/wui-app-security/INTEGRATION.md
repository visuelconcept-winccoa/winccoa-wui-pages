<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Securing a module with Application Security roles — integration guide

> **FOR AI AGENTS AND DEVELOPERS.** Apply this guide **whenever you create a
> new page module**, whenever a user asks to "add roles" / "secure" a module,
> and — without being asked — **whenever a change adds or removes a capability
> worth restricting** (an edit mode, a deploy/control action, a signing step,
> a destructive operation…). Role security is part of the feature, not an
> afterthought: adding a sensitive feature without updating the module's role
> declaration and gating leaves it unrestrictable from `/app-security`.

## The model in one paragraph

Each module owns one DP `AppSecurity_<module>` with a `.roles` declaration
(written by the module) and `.assignments` (`{role: [group names]}`, written
only by the admin page). **A role with no assigned group is OPEN to every
connected user** — so declaring roles never breaks anything; it only makes the
capability assignable. Grant resolution: unassigned → granted; assigned →
granted when the session user belongs to one of the groups or is OA root;
assigned + identity unknown → denied (fail closed).

## Step 1 — Choose the roles

Convention: one `view` role (opening the page's data at all) + one role per
**capability**, named by what the USER does, not by implementation:
`edit`, `deploy`, `control`, `sign`, `connect`, `manage`, `dpl-import`…
3–5 roles per module is the sweet spot; don't create one role per button.

## Step 2 — Declare them in a per-module fragment (single source of truth)

Each module owns ONE fragment `libs/wui-<page>/src/app-security.roles.json` —
the single source of truth for its roles (there is **no** central manifest).
MultiLangString labels use the same keys as `ml()` (`en_US.utf8`, `fr.utf8`,
`de.utf8`):

```jsonc
// libs/wui-<page>/src/app-security.roles.json
{
  "module": "<page-id>",                       // the specs.json/menuconfig page id, e.g. "ampere"
  "title": { "en_US.utf8": "My Module", "fr.utf8": "Mon module", "de.utf8": "Mein Modul" },
  "roles": [
    { "id": "view", "label": { "en_US.utf8": "View", "fr.utf8": "Consulter", "de.utf8": "Ansehen" } },
    { "id": "edit", "label": { "en_US.utf8": "Edit", "fr.utf8": "Éditer", "de.utf8": "Bearbeiten" },
      "description": { "en_US.utf8": "…", "fr.utf8": "…", "de.utf8": "…" } }
  ]
}
```

## Step 3 — Self-register from the fragment (at page load)

In the page's `connectedCallback`, import the fragment and register it — the
SAME object also feeds the admin's discovery, so there is nothing to keep in
sync:

```ts
import { registerModuleRoles, type AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import appSecurityRoles from './app-security.roles.json';

registerModuleRoles(appSecurityRoles as AppModuleRoles);
```

Self-registration is best-effort (no-op offline / without write rights); the
admin's **"Discover modules"** seeds every module from the aggregated
`app-security-manifest.json` asset — built by the `page-appsec-merge` Vite
plugin from every `app-security.roles.json` present in the build (and merged
into the workspace by each module's installer). **A module built in another
repository never touches app-security**: it ships its fragment + calls
`registerModuleRoles`, and appears at runtime (first visit) or in Discover once
its fragment is merged into the asset.

## Step 4 — Gate the UI

Subscribe once, keep a `@state`, gate the affordances (never unrender data the
`view` role allows):

```ts
@state() private canEdit = true; // open until assigned

this.roleSub = hasRole$('<page-id>', 'edit').subscribe((granted) => {
  this.canEdit = granted;
  if (!granted && this.editing) this.setEditing(false); // drop out of a live session
});
```

Existing gates compose: `.canEdit=${this.canPublish && this.roleEdit}`
(see `wui-process-monitor`). Unsubscribe in `disconnectedCallback`.

## Step 5 — Enforce server-side (modules with a backend)

UI gating is UX, not security. For every sensitive route:

1. Add `"appSecurityGuard.ts"` to the module's `backend.srcFiles` in
   `tools/specs.json` (each module ships its own copy — no cross-module import).
2. Wrap the routes:

```ts
import { requireRole } from './appSecurityGuard';
router.post('/deploy', requireRole('<page-id>', 'deploy'), controller.deploy);
```

The guard resolves the SESSION user (passport — never client-declared data),
applies the same rules as the client, answers 403, and **fails open on its own
errors** (a guard outage must not take the API down).

## Step 6 — Verify

- `tsc -p libs/<lib>/tsconfig.lib.json` + `nx lint` = 0 errors; `build:pages` OK.
- In `/app-security` → Discover → the module and its roles appear.
- Assign a role to a group you are NOT in → the affordance locks, the API
  answers 403; unassign → everything opens again (no reload needed — live).

## Maintenance rules (the "automatic" part)

- **New sensitive capability ⇒ new/updated role** in the SAME change:
  the module's `app-security.roles.json` fragment (Steps 2–3) + gating (Steps 4–5).
  No central manifest to keep in sync anymore.
- **Removed capability ⇒ remove the role** from the fragment; never delete its
  assignment programmatically (the admin page shows it as *stale* and the admin
  decides).
- **Never rename a role id silently** — a rename is remove + add: existing
  assignments do not follow. Say so in the commit message.
- **Never write `.assignments` from a module** — that element belongs to the
  admin page only.
