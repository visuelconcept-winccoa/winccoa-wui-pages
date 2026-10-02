# WinCC OA WebUI Pages — `@visuelconcept-winccoa/wui-*`

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

A collection of **redistributable standalone pages** for the WinCC OA
[WebUI Runtime](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Basics.html)
dashboard. Each page is a Lit 3 / [Siemens iX](https://ix.siemens.io/) web component that
plugs into the dashboard shell, displays live WinCC OA process data over WebSocket
([OaRxJsApi](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/apis/oarxjsapi/oarxjsapi_overview.html)),
and — when needed — ships its own webserver module and WinCC OA manager(s).

This repo is the **source of truth**: pages live in `libs/wui-<page>/`, each one an
independent npm package. Each lib is published **as is** — sources, backend,
managers — on GitHub Packages, and a WinCC OA project consumes it with
[wui-toolkit](https://github.com/visuelconcept-winccoa/winccoa-wui-tools) (see
[Use the modules in a WinCC OA project](#use-the-modules-in-a-wincc-oa-project--wui-toolkit)).
The repo is itself a wui-toolkit site with no WinCC OA target: `wui dev` and
`wui test` run here, deploying is a WinCC OA site's job (see [Develop](#develop)).

## Modules

All pages are published under the `@visuelconcept-winccoa/` scope (e.g.
`@visuelconcept-winccoa/wui-para`). Source: `libs/wui-<page>/`. Per-page docs, where the
module has them: `docs/wui-<page>/{README,INTEGRATION,NOTES}.md` — `wui-agv-fleet`,
`wui-diagnosis` and `wui-process-monitor` currently document themselves in their
source header and their `wuiPage` manifest in `libs/wui-<page>/package.json`
(backend + managers), which wui-toolkit reads. A visual tour of the pages is in
[docs/MANUAL.md](./docs/MANUAL.md).

| Module                    | Route                  | What it does                                                                                                                                                                                                                                                | Backend                                                                                                           |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `wui-agv-fleet`           | `/agv-fleet`           | Read-only supervision of an AGV fleet: KPI strip, status list, warehouse floor plan with live position and heading, detail card per vehicle (one `AGV_Vehicle` DP each)                                                                                     | `agvSim` mgr (demo fleet)                                                                                         |
| `wui-alarms`              | `/alarms`              | The plant's alarm list, live or over an archived period: unacknowledged counter, project-configurable priority ranges as a filter, EEMUA-191 flood histogram, bad actors, search, paging, acknowledge (WinCC OA's own API, hidden without write permission) | —                                                                                                                 |
| `wui-ampere`              | `/ampere`              | Single-line (mono-filaire) electrical distribution diagrams — switchboards, breakers, busbars, transformers, railway electrification — with in-place edit, IEC 60617 symbols and live wire energisation                                                     | `ampereSim` mgr (demo network)                                                                                    |
| `wui-app-security`        | `/app-security`        | Map each module's declared roles to WinCC OA user groups (one `AppSecurity_<module>` DP per module). Open by default: a role with no group stays open to every connected user                                                                               | `/api/app-security`                                                                                               |
| `wui-audit-trail`         | `/audit-trail`         | Pivot table of a datapoint's NGA-archived value history (configurable period, columns, refresh)                                                                                                                                                             | —                                                                                                                 |
| `wui-camera-streams`      | `/camera-streams`      | View RTSP IP cameras in-browser over a WebSocket relay (JSMpeg, no plugin)                                                                                                                                                                                  | `/api/rtsp` + `rtspProxy` mgr                                                                                     |
| `wui-eng-studio`          | `/eng-studio`          | Engineering studio: model DP types, datapoints and their configs from communicating equipment (address books from an OPC UA browse / SimaticML / Control Expert export, roles → configs, live diff, transactional check-in)                                 | `/api/eng`                                                                                                        |
| `wui-fleet-closures`      | `/fleet-closures`      | Manage fleet non-working days (year / atelier / machine filters, JSON import-export)                                                                                                                                                                        | —                                                                                                                 |
| `wui-fleet-kpi-analysis`  | `/fleet-kpi`           | Per-machine availability & TRS charts, computed live by a manager over opening time minus closures                                                                                                                                                          | `kpiCalc` mgr                                                                                                     |
| `wui-fleet-stop-analysis` | `/fleet-stops`         | Downtime decomposition per stop cause (table + ECharts views)                                                                                                                                                                                               | —                                                                                                                 |
| `wui-gis`                 | `/gis`, `/gis/:siteid` | Map-based monitoring on MapLibre GL over OpenStreetMap: geo-located assets bound to datapoints, live values and alarm colour on the marker, areas as polygons, decluttering when zoomed out, in-place edit, GeoJSON interop                                 | `gisSim` mgr (optional network simulator)                                                                         |
| `wui-gis-plants`          | `/gis-plants`          | Operating parameters of the simulated power plants (`GisSim_*`), one card per plant ranked live by output (alarms not shown yet)                                                                                                                      | `gisSim` mgr of `wui-gis`                                                                                         |
| `wui-machine-fleet-3d`    | `/fleet-3d`            | Three.js 3D fleet view with per-machine state/KPI bubbles, contextual Gantt/Pareto, and AI assistant (hub page)                                                                                                                                             | `/api/ai` + `machineSim`, `kpiCalc`, `aiAssistant` mgrs (assistant MCP tools via an optional external MCP server) |
| `wui-mosaic`              | `/mosaic`              | Display-wall page embedding other dashboard views as chromeless, same-origin iframes                                                                                                                                                                        | —                                                                                                                 |
| `wui-para`                | `/para`                | Datapoint-parametrization page                                                                                                                                                                                                                              | `/api/para`                                                                                                       |
| `wui-process-monitor`     | `/process-monitor`     | pmon manager console, one tab per connected server: status, start/stop/restart, pmon configuration entries, project ZIP upload and deploy across servers                                                                                                    | `/api/process-monitor` + `processMonitor` mgr                                                                     |
| `wui-production-orders`   | `/production-orders`   | Production orders CRUD + status workflow + ECharts Gantt + server-side KPI                                                                                                                                                                                  | `productionOrdersKpi` mgr                                                                                         |
| `wui-remote-vnc`          | `/remote-vnc`          | Manage VNC connections and open them in-browser via bundled noVNC over a WebSocket relay                                                                                                                                                                    | `/api/vnc` + `vncProxy` mgr                                                                                       |
| `wui-report-builder`      | `/report-builder`      | Build report instances from templates (data filling, archive aggregations, multi-level signing, print)                                                                                                                                                      | —                                                                                                                 |
| `wui-report-templates`    | `/report-templates`    | Author report templates (parameterised sections, multi-level signature workflow)                                                                                                                                                                            | —                                                                                                                 |
| `wui-tag-importer`        | `/tag-importer`        | Import device tags into DP types + datapoints from an OPC UA NodeSet2 file or a live server browse (repeated instances of one ObjectType mutualised into a single DP type)                                                                                  | `/api/tag-importer`                                                                                               |
| `wui-thermal-reports`     | `/thermal-reports`     | Per-charge heat-treatment reports (recipe stages, furnace curves vs. tolerance bands)                                                                                                                                                                       | —                                                                                                                 |
| `wui-diagnosis`           | `/status`              | Read-only system health: time, licences, OA version, API heartbeat, browser, service worker, memory and disk                                                                                                                                                | —                                                                                                                 |

The table is ordered alphabetically; `wui-diagnosis` sits last because its route
(`/status`) is the shell's own diagnostics entry rather than a page of its own name.

- **Frontend-only** pages (`Backend = —`) deploy with just a page build onto the
  shell — no extra webserver module, no manager.
- **Backend** pages additionally ship a webserver module (`/api/*`) and/or one or
  more WinCC OA managers. They require the dashboard webserver (`wui init target`),
  and managers must be started in the WinCC OA console. `wui build` deploys both;
  the extra npm deps a page bundles (`three`, `@cycjimmy/jsmpeg-player`,
  `@novnc/novnc`, `maplibre-gl`) are `dependencies` of its package, so
  `npm install` brings them.

### Shared kits

`libs/` also holds libraries that are **not pages** (no `src/<id>.ts` entry). They
are not deployed on their own: they are `dependencies` of the pages using them,
and wui-toolkit bundles what a page imports into that page's bundle.

| Kit               | What it holds                                                                                                                                                                               | Used by                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `wui-kit`         | Datapoint JSON stores (`DpJsonStore` / `DpSingleJsonStore`), the GxP audit-trail writer, the `hasRole$` role gate, shared dialog styles and the datapoint-name input                        | every page that persists JSON in a DP or gates on a role                                   |
| `wui-alarms-core` | The alarm domain (Alert→Alarm mapping, priority ranges, query, EEMUA statistics) **and** `<wui-alarm-view>`, the embeddable list                                                            | `wui-alarms`, and any page showing scoped alarms (`wui-machine-fleet-3d`)                  |
| `wui-fleet-core`  | The atelier / machine / stop-cause model, the `FleetStore`, the stop-cause analysis engine and the closures model                                                                           | the four fleet pages                                                                       |
| `wui-eng-core`    | Pure, WinCC-OA-free engineering domain: device and address-book model, check-in diff and plan applier, config write builders, protocol address builders, SimaticML / CSV / NodeSet2 readers | `wui-eng-studio`                                                                           |
| `wui-ai-kit`      | The AI prompt bar and its config dialog, the `/api/ai/chat` client store, live progress and a dependency-free markdown renderer                                                             | pages embedding an assistant (`wui-machine-fleet-3d`, `wui-gis`, `wui-ampere`, `wui-para`) |

## Use the modules in a WinCC OA project — wui-toolkit

The libs are **private** npm packages of the `visuelconcept-winccoa` organisation on
GitHub Packages, published from their sources by this repo's CI: a WinCC OA project compiles them
against its own runtime, with the kits they need (`wui-para` brings `wui-kit`,
`wui-ai-kit` and `wui-app-security`).

> The first `0.1.0` of `wui-kit`, `wui-ai-kit`, `wui-app-security` and `wui-para`
> went out under the former `@visuelconcept/` scope (organisation `visuelconcept`);
> they are superseded by the `@visuelconcept-winccoa/` packages.

In the WinCC OA project's site (`<project>/web`, created by `wui init project`):

```powershell
# once per machine: a token with read:packages (a classic PAT works too; fine-grained tokens are refused)
gh auth refresh -h github.com -s read:packages
npm config set "//npm.pkg.github.com/:_authToken" (gh auth token)

# the site's .npmrc (committed, no token): @visuelconcept-winccoa:registry=https://npm.pkg.github.com
npx wui use para            # npm install @visuelconcept-winccoa/wui-para + select it
npx wui build prod          # compile and deploy pages + backends into the WinCC OA project
```

The packages are linked to this repo (`"repository"`) and inherit its access by
default; extra readers are granted per package (*Package settings → Manage
access*, to a team). A CI workflow can read them with its `GITHUB_TOKEN` from a
repo of `visuelconcept-winccoa` given access (*Manage Actions access*); elsewhere
it needs a classic PAT secret with `read:packages`.

### Publish a module (maintainers)

A publishable lib's `package.json` carries:

- `"files"`: `src`, `backend`, `managers`, `menu.fragment.jsonc`, `mock` — what
  exists; no tsconfig/Nx wiring, no tests (`!**/*.spec.ts`);
- `"dependencies"` on the other libs it imports **or whose backend files it
  copies or whose managers it deploys** (`wuiPage.backend.shared`,
  `vendorPackages`, `managers`), with real ranges
  (`^0.1.0`), never `"*"` — and on the third-party packages its page bundles
  (`three`, `maplibre-gl`, `@novnc/novnc`, `@cycjimmy/jsmpeg-player`);
- the platform it imports (`lit`, `rxjs`, `tsyringe`, `echarts`, `@siemens/*`,
  `@wincc-oa/*`, the OA API) as `peerDependencies` marked **optional**
  (`peerDependenciesMeta`): the WebUI runtime provides it, npm must not install it;
- `"publishConfig": { "registry": "https://npm.pkg.github.com", "access": "restricted" }`
  and `"repository"` with `"directory": "libs/wui-<id>"`.

**Publishing is the CI's job** — [`.github/workflows/publish-libs.yml`](./.github/workflows/publish-libs.yml):
bump `"version"` in `libs/wui-<id>/package.json` (and the ranges of the libs
depending on it, when the change breaks them), merge to `main`, and the workflow
packs and publishes every lib whose version is not on the registry yet, kits
before the pages using them. It refuses to publish when a lib's range on another
lib does not match that lib's version in the repo. On a pull request it runs the
same checks with `npm publish --dry-run`; *Actions → Publish libs → Run workflow*
runs it by hand. The logic is in `.github/scripts/publish-changed.mjs`; locally:

```powershell
npm pack ./libs/wui-<id> --dry-run                    # check the file list
node .github/scripts/publish-changed.mjs --dry-run    # what the CI would publish (token with read:packages)
```

A published version is immutable: a change ships only with a new version.

Two version constraints to keep when bumping a page's third-party dependency:

- `@novnc/novnc` stays pinned **exactly** at `1.4.0` (`wui-remote-vnc`): `^1.4.0`
  floats to 1.7.0, whose `exports` forbid the deep import `@novnc/novnc/core/rfb.js`;
- `maplibre-gl` stays on **5.x** (`wui-gis`): 5.x inlines its tile worker as a
  `blob:` URL, so the page stays one self-contained chunk; 6.x emits the worker as
  a separate URL and drops WebGL1 (see `docs/wui-gis/NOTES.md`).

## Requirements

A page is a **leaf**: it plugs into the WebUI shell of a WinCC OA project.

- WinCC OA **3.21+**, **Node 22 LTS**, **npm 10+**.
- A project with **webserver.js enabled (WebSocket support)**.
- `config/config`: `[webserverjs] httpsPort` + TLS certificates (the dashboard is served over https).
- A valid **UI license**: **Client** = read/write (view, edit, publish), **Light** = view-only.
  ([Requirements and Licensing](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/Dashboard/topics/Dashboard_Requirements.html).)

> A page bundle **externalizes** lit / `@siemens/ix` / `@wincc-oa/*` / rxjs — they
> come from the shell's **import map**, so a page is compiled against the shell it
> is deployed onto. That is why the libs are published **in source**, and why
> `npx wui init target` (WebUI shell + dashboard webserver) comes before any page.

### After a deploy

1. **Backend pages**: restart the dashboard webserver and start the manager(s)
   `wui build` lists, in the WinCC OA console.
2. **Browser**: DevTools → Application → Storage → **`Clear site data`**, then reload
   while logged in. The service worker caches `menuconfig.json`, so **`Ctrl+Shift+R`
   is not enough** — only `Clear site data` purges it.

> **No secrets in the repo**: the PIH key (`ProductInfo_Config` DP / `PRODUCT_INFO_API_KEY`)
> and LLM tokens (`AI_Assistant_Config` DP) are provided on the target, never committed.

## Develop

This repo is a **wui-toolkit site** (the shape `npx wui init project --no-winccoa`
creates): `package.json` with the `libs/*` workspaces, `wui.project.jsonc`
(every page selected, a mock `dev` target, no WinCC OA target), `.npmrc`,
`.githooks/pre-commit`, `mock/`. PowerShell, from the repo root:

```powershell
npm install        # once, after a clone: links the libs, wires the pre-commit hook, copies the runtime's skills
npx wui dev        # → http://127.0.0.1:4300, every page with mock data, hot reload
npm test           # wui test (also the pre-commit hook): pages declare the backends they call,
                   # they compile like a build, the types check (libs + backends), the unit tests pass
npx wui modules    # the pages, and the modules they require (headless)

npx wui test --watch --lib gis   # one lib's unit tests, rerun on every change
npx wui tsconfig                 # after changing a lib's internal dependencies (npm test asks for it)
```

On a real WinCC OA instead of the mocks — a target with a `"backend"` in
`wui.project.jsonc` (local, not committed), the credentials in the environment:

```powershell
# wui.project.jsonc → "targets": { "live": { "backend": "https://<host>:8443", "write": true } }
$env:WUI_USER = '<user>'; $env:WUI_PASS = '<password>'
npx wui dev live                 # the pages on live data
npx wui screenshots live         # docs/images/manual/<id>.png (needs: npm i -D playwright; npx playwright install chromium)
```

`npx wui add module <id>` creates a new page in `libs/wui-<id>/`. Nothing is
deployed from here: a WinCC OA site installs the published packages (or points a
`"sources"` entry at this checkout's `libs/` to try unpublished changes). See the
[wui-toolkit reference](https://github.com/visuelconcept-winccoa/winccoa-wui-tools/blob/main/docs/REFERENCE.md)
for the module contract (`package.json`, `src/<id>.ts`, `menu.fragment.jsonc`,
`mock/`, `backend/`, `managers/`).

Each lib has its own `tsconfig.json`, written by `npx wui tsconfig` (editor and the
type check of `npm test`; the build does not read it). Unit tests are `*.spec.ts`
next to the sources (or `*.test.*`), written with vitest and run by `npm test` from
the root — `wui test` ships vitest, a lib has no test config of its own (a test
needing a DOM starts with `// @vitest-environment jsdom`).
The Engineering Studio has its own offline demo with its i18n check and screenshot
script (`libs/wui-eng-studio/demo/`, see `docs/wui-eng-studio/README.md`).

## Documentation

- **Per-module** — `docs/wui-<page>/README.md` (overview), `INTEGRATION.md` (install),
  `NOTES.md` (design notes).
- **Technical guides** — `docs/knowledge/` (widget development, customization,
  standalone pages, architecture, Siemens iX, backend integration).
- **Official WinCC OA WebUI Runtime docs**:
  [Overview](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Basics.html) ·
  [Setup & Deployment](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Setup_Deployment.html) ·
  [Customization](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Customization.html) ·
  [Standalone Pages](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Standalone_Pages.html) ·
  [Datapoint Connectivity](https://www.winccoa.com/documentation/WinCCOA/latest/en_US/WebUIRuntime/topics/WebUIRuntime_Datapoint_Connectivity.html)

## License

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

The VISUEL CONCEPT code in this repository is licensed under the **GNU Affero
General Public License v3.0 only** (AGPL-3.0-only) — see [LICENSE](./LICENSE) and
[NOTICE](./NOTICE).

**Network use counts as distribution.** Under the AGPL, if you run a modified
version of these pages on a server and let users interact with it over a network,
you must make the complete corresponding source code of that version available to
those users.

**Commercial license available.** If the AGPL's obligations don't fit your use case
(for example, shipping a closed-source product), a commercial license is available —
contact **contact@visuelconcept.com**.

> **Scope.** This license covers only the VISUEL CONCEPT code in this repository.
> **WinCC OA and its components remain the property of Siemens** and are governed by
> their own licenses; the third-party dependencies (Siemens iX, `@wincc-oa/*`,
> `@etm-professional-control/*`, …) likewise keep their respective licenses. Running
> the pages requires a valid WinCC OA base package and UI license as described under
> [Requirements](#requirements).

