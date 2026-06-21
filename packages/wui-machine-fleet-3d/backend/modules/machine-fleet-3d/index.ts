// Backend module descriptor for the Machine Fleet 3D page — auto-discovered by
// @visuelconcept/wui-webserver (mountModuleRoutes).
import { WsjAccessControlList } from '@winccoa/backend';

import { AiRoute } from './aiRoute';

export default {
  mount: '/api/ai',
  // Unauthenticated for demo. Tighten before production, e.g. { allowUsers: ['root', 'engineer'] }.
  acl: WsjAccessControlList.fullAccess,
  routes: () => AiRoute.routes()
};
