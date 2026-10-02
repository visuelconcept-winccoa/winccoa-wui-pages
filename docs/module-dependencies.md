# Module dependencies

Two kinds of dependency link the `libs/wui-<id>/` modules:

| Kind | Declared in | Checked by |
| --- | --- | --- |
| **Code** — a page imports a kit (`wui-kit`, `wui-ai-kit`, `wui-fleet-core`…) | `package.json#dependencies` | npm / Vite |
| **Runtime** — a page calls **another module's backend** over HTTP | `package.json#wuiPage.requires` (page ids) + that module's package in `dependencies`, or `wuiPage.optional` | wui-toolkit (`wui test`, `wui modules`, `wui build`) |

`wuiPage.backend.dependsOn` stays free text: a hint `wui use` prints, not enforced.

## `requires` and headless deployment

```jsonc
"dependencies": { "@visuelconcept-winccoa/wui-para": "^0.1.0", "@visuelconcept-winccoa/wui-app-security": "^0.1.0" },
"wuiPage": { "requires": ["para", "app-security"] }
```

A required module that the site does not select is deployed **headless** by
`wui build` / `wui pack`: its backend (routes, managers), no page bundle, no menu
entry. Selecting it (`npx wui use para`) brings its page back. `npx wui modules`
lists the headless modules and which pages require them. See the wui-toolkit
REFERENCE, "Required modules — headless".

Typical production case: an operator site runs `audit-trail` and `mosaic` but
must not expose the PARA engineering page — `para` is then deployed headless,
`/api/para` is mounted, the PARA menu entry is not.

## Who requires what

Almost every page reaches `/api/para` through **wui-kit**, not through its own
code: the kit's datapoint stores and the app-security role registration create
DP types / DPs and write values over the PARA REST API (`OaRxJsApi` is read-only
here). The kit also reads the identity from `/api/app-security/me`; without it,
a role that an admin assigned is denied (fail closed).

| Route | Called from | Pages that require the module |
| --- | --- | --- |
| `/api/para` (`para`) | `wui-kit/src/data/{dp-json-store,dp-single-json-store,app-security,audit-trail}.ts`, `wui-ai-kit/src/data/ai-store.ts`, `wui-fleet-core/src/data/fleet-store.ts`, `wui-audit-trail/src/audit-trail/dp-admin.ts`, `wui-production-orders/src/production-orders/data/fleet-link.ts` | alarms, ampere, app-security, audit-trail, camera-streams, fleet-closures, fleet-kpi-analysis, fleet-stop-analysis, gis, machine-fleet-3d, mosaic, process-monitor, production-orders, remote-vnc, report-builder, report-templates, tag-importer, thermal-reports |
| `/api/app-security` (`app-security`) | `wui-kit/src/data/app-security.ts` | the same pages, app-security excepted, plus para |

No requirement: agv-fleet, diagnosis, dp-watch, eng-studio.

**Optional** (`wuiPage.optional` — used when deployed, not deployed for the page):

| Route | Called from | Pages | Without it |
| --- | --- | --- | --- |
| `/api/ai` (`machine-fleet-3d`) | `wui-ai-kit/src/data/ai-store.ts` | ampere, gis, para | the AI assistant hides itself |
| `/api/alarms` (`alarms`) | `wui-alarms-core/src/data/alarm-store.ts` | machine-fleet-3d | acknowledging falls back to the browser's own write |

"Frontend-only" / "no backend module" in a module's README means it **owns** no
backend — not that it runs without the `para` and `app-security` ones.

## Keeping it right

`requires` / `optional` are written by hand, per page — and **`npm test` checks
them**: it follows each page's imports, kits included, and refuses a call to
another module's backend (`'/api/<mount>…'`) that the page declares neither way,
naming the file the call sits in. Typical sources of such a call:

- `DpJsonStore`, `DpSingleJsonStore` (`wui-kit/data/dp-*-store.js`), the kit's
  audit-trail helpers, `registerModuleRoles` / `hasRole$` (`wui-kit/data/app-security.js`);
- the stores of `wui-ai-kit`, `wui-alarms-core` or `wui-fleet-core`;
- any `fetch('/api/<other module>/…')`.

A kit cannot declare `requires` (it has no page): the pages using it do.
