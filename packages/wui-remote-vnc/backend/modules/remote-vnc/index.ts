// Backend module descriptor for the Remote VNC page — auto-discovered by
// @visuelconcept/wui-webserver (mountModuleRoutes + mountModuleRelays).
import { WsjAccessControlList } from '@winccoa/backend';

import { VncRoute } from './vncRoute';
import { registerVncRelay } from './vncRelay';

export default {
  mount: '/api/vnc',
  // Unauthenticated for demo. Tighten before production, e.g. { allowUsers: ['root', 'engineer'] }.
  acl: WsjAccessControlList.fullAccess,
  routes: () => VncRoute.routes(),
  registerRaw: (app: unknown) => registerVncRelay(app)
};
