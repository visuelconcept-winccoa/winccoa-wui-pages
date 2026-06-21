// Backend module descriptor for the Asset Lifecycle Intelligence page — auto-discovered by
// @visuelconcept/wui-webserver (mountModuleRoutes).
import { WsjAccessControlList } from '@winccoa/backend';

import { ProductInfoRoute } from './productInfoRoute';

export default {
  mount: '/api/product-info',
  // Unauthenticated for demo. Tighten before production, e.g. { allowUsers: ['root', 'engineer'] }.
  acl: WsjAccessControlList.fullAccess,
  routes: () => ProductInfoRoute.routes()
};
