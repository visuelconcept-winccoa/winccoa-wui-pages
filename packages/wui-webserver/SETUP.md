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
