// -----------------------------------------------------------------------------
// CustomerDashboardServer — @visuelconcept/wui-webserver base
// -----------------------------------------------------------------------------
// Minimal WsjDashboardServer subclass: mounts the customer router (which
// auto-discovers backend modules) and registers any module-contributed raw uWS
// WebSocket relays. Add project-specific WebSocket request handlers by
// overriding registerStandardHandlers() (call super first).
// -----------------------------------------------------------------------------

import { WsjDashboardServer } from '@winccoa/backend';

import { CustomerRoutes } from './customerRoutes';
import { mountModuleRelays } from './wui-module-routes';

export class CustomerDashboardServer extends WsjDashboardServer {
  protected defineRoutes() {
    super.defineRoutes();
    this.app!.use(CustomerRoutes.routes());
    // Raw uWS WebSocket relays contributed by backend modules (e.g. RTSP / VNC).
    // UltimateExpress only models HTTP routes, so relays attach to the uWS app
    // here — before the server starts listening.
    mountModuleRelays(this.app);
  }
}
