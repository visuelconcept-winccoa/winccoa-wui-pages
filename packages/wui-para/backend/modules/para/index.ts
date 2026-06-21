// Backend module descriptor for the PARA page — auto-discovered by
// @visuelconcept/wui-webserver (mountModuleRoutes). Provides the /api/para
// engineering API (datapoint-type / DP create-set-rename-delete).
import { WsjAccessControlList } from '@winccoa/backend';

import { ParaRoute } from './paraRoute';

export default {
  mount: '/api/para',
  // Unauthenticated for demo. Tighten before production, e.g. { allowUsers: ['root', 'engineer'] }.
  acl: WsjAccessControlList.fullAccess,
  routes: () => ParaRoute.routes()
};
