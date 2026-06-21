# `modules/` — backend modules (auto-discovered)

Each page module's `install.mjs` drops its backend here as `modules/<name>/`,
exposing `index.ts`:

```ts
import { WsjAccessControlList } from '@winccoa/backend';
import { XRoute } from './xRoute';
export default {
  mount: '/api/x',                  // HTTP mount path
  acl: WsjAccessControlList.fullAccess,
  routes: () => XRoute.routes(),    // ultimate-express sub-router (optional)
  registerRaw: (app) => { /* raw uWS ws relay (optional) */ }
};
```

After `npm run build` (tsc) the loader (`../wui-module-routes.ts`) mounts each
`dist/modules/<name>/index.js` on startup — `routes()` at `mount` (+ ACL) and
`registerRaw(app)` for WebSocket relays. No edit to `customerRoutes.ts`.
