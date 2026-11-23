<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# wui-tutorials — the tutorials' guide

Plays the modules' **tutorials** over the site: Sigma, a mascot, says each step, lights up its
target and waits for the operator to do it. The tutorials themselves are not this module's:
**each module ships its own**, `tutorial/<id>.json` beside its `package.json`, and wui-toolkit
does the rest:

| | Where |
| --- | --- |
| The format, its schema (`wui-tutorial.schema.json`) | wui-toolkit 0.30.0 or later — its `docs/REFERENCE.md`, "A module's tutorials" |
| Writing them: functional scenarios per main feature and per role first | the toolkit's `wui-tutorial` AI skill, copied into every site by `npm install` |
| Checking them | `npm test` (`wui test`): the schema, one action per step, ids unique, roles declared |
| Replaying them on the mock, as a film | `npx wui tour --tutorial <id>` (Playwright and ffmpeg in the site) |
| Deploying them | `wui build` writes the selected modules' tutorials to `data/dashboard-wc/wui-tutorials.json` |
| **Showing them** | **this module** |

A site selects it like any page: `npx wui use tutorials`, then `npx wui build`.

## What it does

- **The guide**, on every page: the module's shell boot script (`wuiPage.shell.boot`,
  `src/shell/boot.ts`) puts `<wui-tutorials-guide>` on `document.body` as the application loads.
  For each step: the bubble writes what the tutorial says, the step's target is lit up (the rest
  dimmed, everything still clickable), and the step goes on when the operator has done its
  action — `menu` (the entry clicked, or its `route` reached), `route` (the page reached, its
  query's parameters there), `click`, `type` (the field holds the text). `open` opens a page
  itself; a step without action waits for "Next". A `hint` after a while, "Skip" when stuck,
  "–" to minimize, "✕" to quit.
- **The page** `/tutorials`: the tutorials, their roles, the badges earned, "Start".
- **Resuming**: the tutorial being played and its step survive a reload (localStorage), as the
  badges do — the workstation's, not the user's.
- **Roles**: a tutorial with `roles` (`<module>/<role>`) is listed for a user who holds one of
  them (wui-kit `hasRole$`: open until an admin assigns groups to the role). The labels come from
  `app-security-manifest.json`. `app-security` and `para` are `wuiPage.optional`: without them,
  every tutorial is listed. The module declares no role of its own: it shows nothing a user
  cannot open.
- **Its own tutorial**: `tutorial/first-steps.json`, how to follow a tutorial (en, fr, de).

## How it finds a target

`src/guide/deep-query.ts`: a selector is looked for in the document and in every open shadow
root, each alternative within one root (`.tile[title='Configuration']` inside the page's
element — not `wui-msp .tile`, which crosses a root). `:has-text('…')` at the end filters on the
shown text; commas separate alternatives — a `menu` step looks for `nav a:has-text('…')`
(`wui dev`'s menu) and `ix-menu-item:has-text('…')` (the shell's).

Navigation is watched by reading the address regularly: the shell's router moves by
`history.pushState`, which fires no `hashchange`.

## In `wui dev`

The harness runs no boot script: the guide appears once the `/tutorials` page has been
opened, and stays for the session. `wui dev` serves `wui-tutorials.json` from the selected
modules, rebuilt at each request: a `tutorial/*.json` edited shows up on the next reload.

## Look

The iX theme's tokens. A site may set `--wui-tutorials-accent`, `--wui-tutorials-surface` and
`--wui-tutorials-ink` (in its charter's stylesheet) to dress the guide and Sigma.

## Files

| File | Role |
| --- | --- |
| `src/tutorials.ts` | The page: the list, the roles, the badges |
| `src/shell/boot.ts` | The boot script: the guide on every page |
| `src/guide/guide-overlay.ts` | `<wui-tutorials-guide>`: the bubble, the lit target, the buttons |
| `src/guide/mascot.ts` | `<wui-tutorials-mascot>`: Sigma in SVG, its moods (`idle`, `talk`, `happy`, `cheer`, `think`) |
| `src/guide/engine.ts` | The tutorial being played, the wait for each action, resuming, badges |
| `src/guide/tutorial.ts` | The format: what a step waits for, what it lights up |
| `src/guide/deep-query.ts` | Finding a target through the shadow roots |
| `src/i18n.ts` | The module's own strings (en, fr, de) |
| `tutorial/first-steps.json` | Its own tutorial |
