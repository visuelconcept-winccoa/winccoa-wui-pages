# Development

This repo holds **the source of the pages + the distributable packages**, not an
executable workspace. A page is developed **inside a `@wincc-oa/webui-runtime`
workspace** (the shell), then ships in two forms.

## 0. Who owns what

Two folders, and the boundary matters:

```
<this repo>/
  libs/wui-<page>/     the pages and the kits          — yours, versioned
  backend/ webserver/  routes and WinCC OA managers    — yours, versioned
  tools/               the wiring and the deploy chain — yours, versioned
  tsconfig.base.json   see below                       — yours, versioned
  .runtime/            the @wincc-oa/webui-runtime workspace — THIRD-PARTY, gitignored
```

The runtime brings three distinct things people tend to conflate: the **app shell**
(`libs/default-components/`: web components, Vaadin router, tsyringe DI container,
`OaRxJsApi` & friends), the **build chain** (`apps/dashboard-wc/`: the three Vite
configs, the shared-bundle generator, the service worker), and a **workspace
skeleton** (`nx.json`, `package.json`, its own `tsconfig.base.json`, lint/format
configs, `oa-data/`).

Two consequences to keep in mind:

- **`webui-runtime-init` regenerates `apps/` and `libs/default-components/`
  pristine, every time.** Anything customised there is transient by design. That is
  why `tools/wire-workspace.mjs` is not a setup script but a **reappliable patch
  set**, and why its sources of truth are versioned here while the patched files
  are not.
- **Run the scaffold inside `.runtime/`, never at a repo root.** Its postinstall
  copies itself over the calling directory with `force: true` and overwrites
  `LICENSE` (AGPL → MIT), `README.md`, `AGENTS.md`, `CLAUDE.md` and `.gitignore`.
  Keeping it in its own folder makes that impossible rather than merely unlikely.

## 1. Bootstrap the workspace — one command

```bash
# once, inside .runtime/
cd .runtime
npm install @wincc-oa/webui-runtime
npx webui-runtime-init
npm install --save-dev --no-audit --no-fund
npm run init:oa-data
cd ..
```
Then, from this repo, **a single command** — no flag, it finds `.runtime/` itself:
```bash
node tools/wire-workspace.mjs
```
Re-run it after **every** re-scaffold and after adding or removing a page lib. It
is idempotent, so re-running costs nothing. What it does, in order:

1. deploys `tools/dev-wiring/*` into `apps/dashboard-wc/scripts/`
2. writes `wui-pages-root.json` — the one place that says where the pages are
3. copies the runtime's `winccoa-*` assistant skills into this repo
4. links `node_modules` → `.runtime/node_modules`
5. patches the Vite configs (page discovery, menu + roles merge, `server.fs.allow`)
6. regenerates the `@visuelconcept/*` tsconfig paths
7. re-applies the three shell fixes we own
8. installs the pages' third-party deps (`--no-deps` to skip)

`--check` reports without writing. It chains its edits in memory, so a patch that
anchors on an earlier patch's output is judged correctly instead of raising a false
`anchor not found` on a perfectly fine fresh scaffold.

### No links for the pages — config instead
The pages are never copied or linked into the workspace. Their location lives in
`apps/dashboard-wc/scripts/wui-pages-root.json`, read by the three deployed
plugins (see `tools/dev-wiring/wui-pages-root.mjs`). The reason is concrete: a
junction makes `readdir` report a page lib as `isSymbolicLink`, **not**
`isDirectory`, which silently empties every scan filtering on `isDirectory()` — and
the build then succeeds with no pages, no menu entries and no roles. Config cannot
be mis-detected, behaves the same on every OS, and survives a zip or a CI checkout.

### The one exception: `node_modules`
`<repo>/node_modules` is a junction into `.runtime/node_modules`, created by the
same script. It is the only link in the layout, and it earns its place: the pages'
bare imports are resolved by walking up from the **importer**, i.e. from this repo.
Aliasing the packages instead was tried and rejected — an alias to a directory path
**bypasses the package's `exports` conditions**, which silently loads browser
builds and makes vitest die on `self is not defined` under the `node` environment.
With the junction, ordinary Node resolution applies, each lib's own
`vitest.config.ts` runs unchanged, and a spec that walks up looking for
`node_modules/…` finds it (`libs/wui-gis/src/gis/icons.spec.ts` does exactly that).

Nothing here scans `node_modules` looking for pages, so no `isDirectory()` filter
can mis-detect it, and its failure mode is a loud `Cannot find package` — never a
silent empty build.

### This repo owns `tsconfig.base.json`
Every `libs/wui-<page>/tsconfig.json` does `extends: "../../tsconfig.base.json"`,
and Vite compiles the pages at their real path — here — so esbuild looks for the
base config here too. It is therefore versioned and ours. `experimentalDecorators`,
`useDefineForClassFields: false` and `target` mirror the runtime's on purpose:
esbuild reads them at build time and a drift breaks `@customElement` / `@property`
**at runtime**, not at compile time. `.runtime` is in its `exclude`, otherwise a
`tsc -p tsconfig.base.json` here pulls in ~59 files of scaffold.
### The wiring, in detail
What `wire-workspace.mjs` actually patches, and why each one matters:

| Patch | Without it |
| --- | --- |
| `vite.shared.ts`: `...discoverPageLibs()` into `standalonePages` | no page is served in dev nor built |
| `vite.config.ts` + `vite.config.pages.ts`: `pageMenuMergePlugin` | no menu entry — the page exists but nothing links to it |
| the same two: `pageAppsecMergePlugin` | empty role manifest, nothing is gateable |
| `tsconfig.base.json` paths `@visuelconcept/wui-*` | the pages cannot resolve the kits |
| `vite.config.pages.ts`: content-hashed chunk names | the service worker mixes an old chunk with a new one → `does not provide an export named`, intermittent blank pages |
| `webui-app-ix.ts`: chromeless `?embed` | Mosaic tiles show the full app chrome in every iframe |
| `route-generator-utils.ts`: always try `import()` | blank page on first navigation |
| `webui-ix-routes.service.ts`: honour the loader's redirect | an empty element is rendered instead of redirecting |

The menu merge is idempotent by `routeId` and never touches the committed
`menuconfig.jsonc`: in dev it merges in memory at request time, at build it
rewrites `OUT_DIR/menuconfig.json` in `closeBundle`. Same merge that
`tools/install.template.mjs` performs per page at packaging time.

`install-page-dependencies.mjs` (chained by `wire-workspace`) installs what the
pages pull **beyond** the runtime — `three`, `@novnc/novnc`,
`@cycjimmy/jsmpeg-player`, `maplibre-gl`. It reads each
`libs/wui-*/package.json` plus
[`tools/external-dependencies.mjs`](tools/external-dependencies.mjs) for the pinned
versions (the libs pin `*`), skips whatever the workspace already provides, and
installs prefix-less versions with `--save-exact`.

> The wiring sources of truth (`tools/wire-workspace.mjs` + `tools/dev-wiring/`)
> are **versioned**; the patched files (`apps/`, `libs/default-components/`, the
> workspace's `tsconfig.base.json`) come from `webui-runtime-init` and are not.
> An anchor that cannot be found is a **hard error** — the runtime version probably
> moved it, so patch by hand rather than deploy something half-wired.


> In production, the shell is served by `webserver.js` / `@visuelconcept/wui-webserver`
> against the built `data/dashboard-wc/`. The dev server below only serves the frontend.

### Adding a new page (convention)
Everything is driven by the `wui-<page>` convention — no config file to edit:
1. Create `libs/wui-<page>/` with the **`src/<page>.ts`** entry (file name = folder
   name without the `wui-` prefix). This `@customElement('wui-<page>')` file is the
   standalone entry point → auto-discovered by `discoverPageLibs()`.
2. Add `libs/wui-<page>/menu.fragment.jsonc`: an array of menu entries with
   `routeId`, `path`, `title`, `icon`, `component: "wui-<page>"`,
   `module: "/data/dashboard-wc/pages/<page>.js"` → automatically merged into the
   dev nav.
3. Optionally add `libs/wui-<page>/src/app-security.roles.json` — the module's own
   role declaration, single source of truth (the page imports the same file for its
   `registerModuleRoles`). Aggregated automatically; there is no central manifest.
4. If the page pulls a **new third-party npm package**, declare it in the
   `dependencies` of `libs/wui-<page>/package.json` (version `*`) **and** add its
   pinned version to [`tools/external-dependencies.mjs`](tools/external-dependencies.mjs).
5. `node tools/wire-workspace.mjs` — always, unconditionally. It regenerates the
   tsconfig `paths` (needed as soon as another lib imports this one) and installs
   any new dependency. Running it when nothing changed costs nothing, so do not try
   to remember whether this case needs it.
6. `npm start` from `.runtime/` → the page is served and shows up in the menu.

Copy the four boilerplate files (`package.json`, `project.json`, `tsconfig.json`,
`tsconfig.lib.json`) from a neighbouring lib; only the name changes.

A **kit** lib like `wui-kit` / `wui-fleet-core` / `wui-ai-kit` has **no**
`src/<page>.ts` matching its folder name: it is therefore ignored as a page, but
stays importable via the `@visuelconcept/wui-*` paths.

## 2. Develop (HMR)
The Vite dev server serves the frontend with HMR; **all live data comes from a
running WinCC OA**, proxied (`/UI_WebSocket` ws, `/api/*`, `/data`, login) to
`BASE_URL`:
```bash
# Linux / macOS (bash)
BASE_URL=https://<oa-host>:<httpsPort> npm start   # vite serve, https://127.0.0.1:4300
```
```powershell
# Windows (PowerShell) — from .runtime/
$env:BASE_URL="https://<oa-host>:<httpsPort>"; npm start   # vite serve, https://127.0.0.1:4300
```
⚠️ `npm start` is a **workspace** script: run it from `.runtime/`, not from here.
The "Dev server (vite, HMR)" config in [.vscode/launch.json](.vscode/launch.json)
does that and asks for `BASE_URL`.

You edit the components in `libs/wui-<page>/src/` **here** → hot reload. The
`/api/<module>` you test must exist on the targeted OA backend.

## Lint and test
`nx run-many --target=lint` does **not** work: nx never sees the page libs as
projects, since they are not inside its workspace. Run the tools directly.

**Tests** run natively per lib, with each lib's own unchanged `vitest.config.ts` —
the `node_modules` junction is what makes that work:
```bash
cd libs/wui-para && npx vitest run
```

**Lint** needs the workspace's config and plugins, applied to sources living here:
```bash
cd .runtime
npx eslint ../libs --ext .ts --no-eslintrc --config .eslintrc.json --resolve-plugins-relative-to .
```
Both are also "Qualité : …" tasks in [.vscode/tasks.json](.vscode/tasks.json).

## 3. Two outputs from the SAME source
### (a) Build & deploy into a project
The one command that packages a selection of modules into a target — build, menu
and role filtering, pruning, verification, then the backends:
```powershell
node tools/scripts/deploy-release.mjs                    # interactive, remembers everything
node tools/scripts/deploy-release.mjs --yes              # replays the last deploy, zero arguments
```
It reads the sources here and runs the npm build in `.runtime/`. **Every answer is
remembered** in `.deploy-release-cache.json` (gitignored): the workspace and the
project globally, and — per project, because a dev target and a customer target
rarely want the same thing — the module selection, the landing route and the
AI-assistant flag. An explicit flag always beats the cache; a remembered landing
route falls back to `/dashboard` when its module is no longer selected, so you
cannot redirect "/" to an undeployed page; answers are saved **before** the build,
so a build that dies halfway costs nothing.

Before the build it runs three preflights, each guarding a failure that would
otherwise be silent: the pages are reachable (`wui-pages-root.json` points here and
`node_modules` resolves), the scaffold is wired, the external deps are installed.
After it, `verifyDeploy` requires a freshly written bundle **and** a menu entry for
every selected module.

The raw build, without the filtering (run **from `.runtime/`**):
```bash
OUT_DIR=<project>/data/dashboard-wc npm run build:pages   # pages only
OUT_DIR=<project>/data/dashboard-wc npm run build         # shell + shared-bundles + pages + deploy:oa-data
```
⚠️ **Build on the TARGET's runtime version**: a page bundle is welded to the import
map of the shell that built it. A `.js` built against another version will not work.
That is why `.runtime/` is a folder you keep *per runtime version*, and why every
tool takes `--workspace`.

⚠️ The build always builds **every** page lib, not just the selected ones —
`discoverPageLibs()` scans the whole `libs/`, and `deploy-release.mjs` prunes the
non-selected bundles afterwards. So one broken page fails the whole deploy.

⚠️ The target directory name is **not free**: all 28 `menu.fragment.jsonc` hardcode
`/data/dashboard-wc/pages/<page>.js`, and so does the webserver's static mount.

> The page menu entries are merged into the deployed `menuconfig.json`
> automatically — the `pageMenuMergePlugin` build hook merges every
> `libs/wui-<page>/menu.fragment.jsonc` (idempotent by `routeId`), so no manual
> menu edit is needed. The same hook bumps `index.html`'s `Last-Modified`, which
> makes the service worker purge its runtime caches → a plain **F5** is enough on
> a deployed target (`Clear site data` is no longer required).

### (b) Distributable package per page
```bash
node tools/build-package.mjs tools/specs.json
```
→ (re)generates a standalone `packages/wui-<page>/` (kits vendored under `_vendor/`,
backend + descriptor, manager(s), `module.json`, `install.mjs`). Installation: see
[packages/README.md](packages/README.md).

## Gotchas to know
- **A link is not a directory** — the trap that shaped this whole layout.
  `readdir(..., {withFileTypes:true})` reports a Windows junction (and a POSIX
  symlink) as `isSymbolicLink`, **not** `isDirectory`. Five scans filtered on
  `isDirectory()` and each failed *silently*, with a green build:
  `wire-workspace` (zero tsconfig paths), `discover-page-libs` (no page built),
  `page-menu-merge` (no menu entry), `page-appsec-merge` (empty role manifest),
  `install-page-dependencies` ("nothing to install" while `three` was missing).
  This is why the pages are located by **config**, not by a link. **If you add a
  new scan over the page libs, read the path from `wui-pages-root.mjs`.**
- **An alias to a directory bypasses `exports`.** Mapping `@wincc-oa/*` to
  `.runtime/node_modules/@wincc-oa/` made the build pass but loaded *browser*
  builds, so vitest under `environment: 'node'` died on `self is not defined`. The
  `node_modules` junction avoids the whole class of problem — do not replace it
  with aliases.
- **`NX_WORKSPACE_ROOT_PATH` overrides everything.** nx reads it *before* walking
  up for `nx.json`, so a value inherited from the shell makes nx target the wrong
  workspace from any directory, silently. The `.vscode` npm configs pin it.
- **Dashboard deployed WITHOUT the additional pages** (only the runtime's own
  pages, menu reduced to the shell entries) = the **scaffold is not wired**.
  `webui-runtime-init` regenerates `apps/` and `libs/default-components/`
  pristine (both untracked), and a restore from a stash/backup can drop them too:
  `discoverPageLibs()` and `pageMenuMergePlugin` disappear, so the build emits
  only `libs/default-components/.../standalone-pages/` and the base
  `menuconfig.jsonc` — a *successful* build with an empty dashboard. It is **not**
  a browser-cache problem. Repair with the one idempotent command, then redeploy:
  `node tools/wire-workspace.mjs`. `tools/scripts/deploy-release.mjs` refuses to
  build in that state — `assertPagesRoot` + `assertWiring` run before the build —
  and verifies afterwards that every selected module has a freshly written bundle
  and a menu entry pointing at it.
- **Backend deployed but NOT compiled** = the other "I redeployed and nothing
  changed". `deploy-backend.mjs` copies the route sources into
  `<ws>/src/modules/<page>/` and then runs the webserver's `npm run build` (tsc);
  a tsc failure used to be a mere *warning*, so the deploy reported success while
  the webserver kept serving the **previous** compiled routes (new endpoints 404).
  It is now **fatal** (non-zero → `deploy-release.mjs` stops), and even a build that
  exits 0 is checked per module: every `src/modules/<page>/*.ts` must have a
  `dist/modules/<page>/*.js` that is **not older** than it. Remember that compiling
  is still not loading — the `customer-webserver` manager must be restarted in pmon.
- **Service worker**: page bundles are served **CacheFirst for ~15 days**; the SW
  only purges when the cached `index.html`'s `Last-Modified` differs from the
  origin's. `pageMenuMergePlugin` bumps it at the end of every build, so **F5** is
  enough (a second reload may be needed for the purge to show). _In dev_ the SW is
  disabled and the fragments are re-merged on every request.
- **`@novnc/novnc` pinned `1.4.0`** (remote-vnc): `^1.4.0` floats to 1.7.0 whose
  `exports` forbid the deep import `@novnc/novnc/core/rfb.js`.
  `node tools/install-page-dependencies.mjs` installs it **exact** (`--save-exact`);
  never write `^1.4.0` by hand in `package.json`.
- **`three`** is pulled by `wui-fleet-core/types.ts` → required to build any fleet
  page (installed by `node tools/install-page-dependencies.mjs`).
- **No secrets in the repo**: PIH key (`ProductInfo_Config` DP / `PRODUCT_INFO_API_KEY`),
  LLM tokens (`AI_Assistant_Config` DP) → provided on the target, never committed.

## Runtime API reference

A page or widget resolves host services from the runtime through the
[tsyringe](https://github.com/microsoft/tsyringe) DI container — `container.resolve(...)`.
The runtime registers the singletons below; resolve them in `connectedCallback`,
keep your subscriptions, and unsubscribe in `disconnectedCallback`.

### Available services

| Token | Class | Description |
| --- | --- | --- |
| `OaRxJsApi` | `OaRxJsApi` | WinCC OA backend API (dpGet, dpSet, dpConnect, …) |
| `WuiBackendConnectionToken` | `WuiBackendConnection` | WebSocket connection state monitoring |
| `WuiSettingsService` | `WuiSettingsService` | Backend settings (OIDC, WebSocket servers, …) |
| `WuiUserService` | `WuiUserService` | Current user information and permissions |
| `DateService` | `DateService` | Date/time utilities with backend time sync |
| `WuiRouterServiceToken` | `WuiRouterFacade` | Router navigation and route management |
| `WuiToastService` | `WuiToastService` | Toast notifications (success, error, warning) |
| `WuiCleanupService` | `WuiCleanupService` | Resource cleanup on logout/session end |
| `WuiConfigServiceToken` | `WebuiConfigService` | App and menu configuration from JSON files |
| `RuntimeComponentService` | `RuntimeComponentService` | Runtime component installation and management |

### Service usage

<details>
<summary>OaRxJsApi — backend communication</summary>

```typescript
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { container } from 'tsyringe';

const api = container.resolve(OaRxJsApi);

// Read a single datapoint
api.dpGet(['System1:ExampleDP_Arg1.']).subscribe((data) => {
  console.log('Value:', data.value);
});

// Subscribe to datapoint changes
const subscription = api.dpConnect('System1:ExampleDP_Arg1.').subscribe((data) => {
  console.log('New value:', data.value);
});

// Write to a datapoint
api.dpSet('System1:ExampleDP_Arg1.', 42).subscribe((result) => {
  console.log('Write successful:', result);
});

// Execute a custom command
api.customCommand('myFunction', { param1: 'value' }).subscribe((result) => {
  console.log('Result:', result);
});
```

</details>

<details>
<summary>WuiBackendConnection — connection monitoring</summary>

```typescript
import { WuiBackendConnection } from '@wincc-oa/wui-oarxjs-data';
import { WuiBackendConnectionToken } from '@wincc-oa/wui-shared/tokens/wui-backend-connection.token.js';
import { container } from 'tsyringe';

container.registerSingleton(WuiBackendConnectionToken, WuiBackendConnection);
const connection = container.resolve(WuiBackendConnectionToken);

// Monitor connection state
connection.status$.subscribe((state) => {
  // state: 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'error'
  console.log('Connection state:', state);
});

// Check if currently connected
if (connection.status$.value === 'connected') {
  // Safe to perform operations
}
```

</details>

<details>
<summary>WuiUserService — user information</summary>

```typescript
import { WuiUserService } from '@wincc-oa/wui-iam-data';
import { container } from 'tsyringe';

const userService = container.resolve(WuiUserService);

console.log('User ID:', userService.id);
console.log('Username:', userService.name);
console.log('Locale:', userService.locale);

if (userService.canWrite) {
  // Show edit UI
}
if (userService.canEdit) {
  // Enable edit mode
}
if (userService.canPublish) {
  // Show publish button
}

const favorites = userService.favorites; // number[]

// Wait for user data to load
userService.ready$.subscribe((ready) => {
  if (ready) {
    console.log('User data loaded');
  }
});
```

</details>

<details>
<summary>WuiToastService — notifications</summary>

```typescript
import { WuiToastService } from '@wincc-oa/wui-shared/services/wui-toast/wui-toast.service.js';
import { container } from 'tsyringe';

const toastService = container.resolve(WuiToastService);

await toastService.success('Operation completed successfully');
await toastService.error('Failed to save data', 'Error Title');
await toastService.warning('Please check your input');

await toastService.toast({
  message: 'Custom message',
  type: 'info',
  autoClose: true,
  position: 'top-right'
});
```

</details>

<details>
<summary>WuiRouterFacade — navigation</summary>

```typescript
import { WuiRouterFacade } from '@wincc-oa/wui-models/interfaces/wui-router/wui-router.facade.js';
import { WuiRouterServiceToken } from '@wincc-oa/wui-shared/tokens/wui-router-service.token.js';
import { container } from 'tsyringe';

const router = container.resolve<WuiRouterFacade>(WuiRouterServiceToken);

// Navigate to a route
router.render('/dashboard/overview');

// Navigate with parameters
const pathname = router.getPathname('dashboard', { id: '123' });
router.render(pathname, true);

// Read current route information
const routeId = router.getRouteId();
const params = router.getParam('id');
const searchParams = router.searchParams;
```

</details>

<details>
<summary>DateService — time synchronization</summary>

```typescript
import { DateService } from '@wincc-oa/wui-shared/services/date/date.service.js';
import { container } from 'tsyringe';

const dateService = container.resolve(DateService);

const backendTime = await dateService.getBackendUTCTime();
const offset = dateService.getTimeOffsetToBackend(); // ms

const exceedsThreshold = await dateService.doesOffsetExceedThreshold(); // 30s threshold
if (exceedsThreshold) {
  console.warn('Time offset too large!');
}

dateService.doesOffsetExceedThreshold$.subscribe((exceeds) => {
  if (exceeds) {
    // Show warning to user
  }
});
```

</details>

### Utilities

<details>
<summary>Translations and localization</summary>

```typescript
// Reactive Lit templates (auto-update on language change)
import { translate } from 'lit-translate';
import { html } from 'lit';

html`<h1>${translate('WUI_General.App.Title')}</h1>`;

// Static usage (JavaScript/TypeScript)
import { get } from 'lit-translate';

const title = get('WUI_General.App.Title'); // => 'WinCC OA Dashboard'

// Multi-language strings (objects with locale keys)
import { translateOrLocalize, translateOrLocalizeStatic } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

html`<h1>${translateOrLocalize('WUI_General.App.Title')}</h1>`;
html`<h1>${translateOrLocalize({ en_US: 'Title', de_DE: 'Titel' })}</h1>`;

const text = translateOrLocalizeStatic('WUI_General.App.Title'); // static, non-Lit
```

For translations the runtime uses [lit-translate](https://github.com/andreasbm/lit-translate);
`@wincc-oa/wui-i18n` adds helpers/directives for localizing dates, numbers, etc.

</details>

<details>
<summary>OA colors → HTML</summary>

```typescript
import { getCssCustomPropertyValue } from '@wincc-oa/wui-shared/helper-css.js';

getCssCustomPropertyValue('--oa-color--FwGreen');        // => resolved hex
getCssCustomPropertyValue('var(--oa-color--FwRed)');     // works with var() too
getCssCustomPropertyValue('#123456');                    // passes through unchanged

// In Lit styles, OA colors are available as CSS variables:
// color: var(--oa-color--FwGreen);
```

</details>

<details>
<summary>Date and number formatting</summary>

```typescript
import { localizeDate } from '@wincc-oa/wui-i18n-shared/localize-date.js';

localizeDate(new Date()); // "12/31/2023" or "31.12.2023" per locale
```

</details>

### Routing

The application uses Vaadin Router with hash-based routing and config-driven routes
from `menuconfig.json`. Routes are generated at startup from the menu configuration
and registered through the DI container; workspace-supplied route generators
contribute named subtrees. Authentication routes (`/login`, `/logout`) and the
error/404 routes are part of the runtime's static frame and cannot be overridden by
menu configuration.
