# `@visuelconcept/wui-webserver` — prerequisite dashboard webserver

A ready-to-run WinCC OA dashboard webserver (the `customer-webserver-example`
base) **with backend-module auto-discovery** baked in. Install it **once** per
project; afterwards every redistributable page module installs its backend by
simply dropping a folder — no per-module code edit.

## Package contents
```
run.js                       JavaScript-Manager entry (starts the server)
package.json / tsconfig.json build config
src/index.ts                 entry exports
src/customerDashboardServer.ts  bootstrap (mounts routes + module relays)
src/customerRoutes.ts        HTTP router (static example + auto-discovery)
src/wui-module-routes.ts     the auto-loader (mountModuleRoutes / mountModuleRelays)
src/modules/                 backend modules land here (auto-discovered)
install.mjs                  one-command installer
```

## Install (one command)
```bash
node install.mjs --project <winccoa-project-root> [--name customer-webserver] [--winccoa <WinCCOA-install-path>] [--register-pmon]
```
It copies the webserver into `<project>/javascript/<name>/`, runs `npm install`
+ `npm run build` (tsc → `dist/`), and prints the pmon manager line.

- `--winccoa <path>` retargets the `file:` deps (`@winccoa/backend`,
  `@types/winccoa-manager`) if your WinCC OA install isn't at the default
  `C:/Siemens/Automation/WinCC_OA/3.21`.
- `--register-pmon` appends the manager line to `config/progs` (else it's
  printed — register it in the WinCC OA console, parameter `<name>/run.js`).
- `--no-build` copies only (build later with `npm install` + `npm run build`).

> ⚠️ This manager **is** the dashboard webserver. Ensure no other webserver
> manager (e.g. `webserver-js/run.js`) runs on the same `httpsPort`.

## How page modules plug in (no code edit)
A module's `install.mjs` drops its backend at `src/modules/<name>/index.ts`:
```ts
import { WsjAccessControlList } from '@winccoa/backend';
import { XRoute } from './xRoute';
export default {
  mount: '/api/x',
  acl: WsjAccessControlList.fullAccess,   // tighten before prod
  routes: () => XRoute.routes(),          // HTTP sub-router (optional)
  registerRaw: (app) => { /* raw uWS ws relay (optional) */ }
};
```
After `npm run build`, the loader mounts each `dist/modules/<name>/index.js` on
startup — `routes()` at `mount` (+ ACL) and `registerRaw(app)` for WebSocket
relays. To add a module's backend after install:
```bash
# from the page-module package:
node install.mjs --project <root> --webserver <root>/javascript/<name>/src
# then rebuild the webserver:  (cd <root>/javascript/<name> && npm run build)  + restart the manager
```

> **Module system:** the loader uses CommonJS `require()` + `__dirname`
> (standard WinCC OA JS-manager output). For ESM output, swap to a cached
> dynamic `import()`.

## Redeploy page backends from this repo (dev) — `deploy:backend`

During development the backend sources live in this repo under `backend/routes/`
(HTTP controllers/routes) and `backend/managers/` (JS managers); the page→module
and page→manager mapping is declared in `tools/specs.json`. To push them into an
already-installed project webserver, use the specs-driven deployer instead of
copying files by hand (the manual `Copy-Item` approach is error-prone — an unset
shell variable silently copies nothing, which then 404s the new routes):

```bash
# all pages:
npm run deploy:backend -- --project "D:/WinCC_OA_Proj_321/WebDemo2"
# one or more pages, leaving managers/progs untouched (srcFiles only):
npm run deploy:backend -- --project "D:/WinCC_OA_Proj_321/WebDemo2" --only para,machine-fleet-3d --no-managers
# preview without changing anything:
npm run deploy:backend -- --project "D:/..." --dry-run
```

It copies each selected page's `backend.srcFiles` into
`<project>/javascript/<name>/src/modules/<page>/` (never the module `index.ts`,
which each page's own installer creates once), copies its managers into
`<project>/javascript/<m>/`, idempotently appends any missing manager line to
`config/progs`, then runs the webserver `npm run build` (tsc). Options:
`--name <dir>` (webserver folder, default `customer-webserver`), `--only`,
`--no-managers`, `--no-progs`, `--no-build`, `--dry-run`.

> ⚠️ It does **not** restart managers (a live-system action). After it finishes,
> in the WinCC OA console (pmon): **restart the webserver manager** so the rebuilt
> modules load, and **start any newly-added managers**. Verify a new route with
> `curl -k https://<host>:<httpsPort>/api/para/dpl/health`.
