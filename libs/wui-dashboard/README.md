# wui-dashboard

The WebUI shell's **dashboards** — the dashboard overview, the dashboard
editor, a dashboard by id and the user's favorite dashboards — as a module a
site selects, without the shell's other demo pages (system overview, help).

```powershell
npx wui use dashboard          # installs @visuelconcept-winccoa/wui-dashboard and selects it
npx wui home dashboard         # optional: the dashboards open after login and at /
```

## What it is

A **menu-only** module (`"wuiPage": { "menuOnly": true }`, wui-toolkit 0.17 or
later): no page of its own, no bundle. Its `menu.fragment.jsonc` re-provides the
shell's own entries with a routeId:

| routeId | Entry |
| --- | --- |
| `dashboard-favorites` | the generator `wui-dashboard-favorites-menu`: one menu item per favorite dashboard (connected users) |
| `dashboard` | the dashboard overview at `/dashboard/overview`; its route generator `dashboard` creates every `/dashboard/*` route (connected users; add and edit need `canEdit`) |

`wui build` deploys a target without the shell's standard pages by default:
selecting this module brings the dashboards back, and nothing else. On a target
that keeps the standard pages (`"standardPages": true`), its entries take the
place of the shell's — never twice. Unselected, its entries go at the next
deployment. Its place in the menu: `"menu": { "order" }`.

The titles are the shell's catalog keys, translated by the shell.

## Not in `wui dev`

The dashboards are the shell's routes, not a page element: `wui dev`'s harness,
which mounts the selected pages, has none to show for this module.
