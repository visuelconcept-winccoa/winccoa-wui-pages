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

## Step 2 — Declare them in the page (self-registration)

In the page's `connectedCallback` (labels through the module's own `ml`):

```ts
import { hasRole$, registerModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';

registerModuleRoles({
  module: '<page-id>', // the specs.json/menuconfig page id, e.g. 'ampere'
  title: ml('My Module', 'Mon module', 'Mein Modul'),
  roles: [
    { id: 'view', label: ml('View', 'Consulter', 'Ansehen') },
    { id: 'edit', label: ml('Edit', 'Éditer', 'Bearbeiten') }
  ]
});
```

Best-effort by design (no-op offline / without write rights) — that is why
Step 3 exists.

## Step 3 — Mirror the declaration in the manifest

Add/refresh the SAME declaration in
`libs/wui-app-security/src/app-security/manifest.ts` (`MODULE_MANIFEST`).
The admin's **"Discover modules"** seeds from it, covering pages never visited.
**Any time a role is added/renamed/removed in Step 2, update the manifest in
the same commit** — a drift shows up as a "stale" badge in `/app-security`.

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
  declaration (Step 2) + manifest (Step 3) + gating (Steps 4–5).
- **Removed capability ⇒ remove the role** from declaration + manifest; never
  delete its assignment programmatically (the admin page shows it as *stale*
  and the admin decides).
- **Never rename a role id silently** — a rename is remove + add: existing
  assignments do not follow. Say so in the commit message.
- **Never write `.assignments` from a module** — that element belongs to the
  admin page only.
