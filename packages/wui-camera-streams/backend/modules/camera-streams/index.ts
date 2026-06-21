// Backend module descriptor for the Camera Streams (RTSP) page — auto-discovered
// by @visuelconcept/wui-webserver (mountModuleRoutes + mountModuleRelays).
//
// HTTP side  (/api/rtsp/health|clients|status)  -> RtspRoute.routes()
// WebSocket  (/api/rtsp/ws?id=<cameraId>)        -> registerRtspRelay(app.uwsApp)
//
// The live MPEG1-TS stream is pulled & fanned out by the separate `rtspProxy`
// JavaScript manager (manager/rtspProxy) on 127.0.0.1:9999; this relay is a dumb
// same-origin ws↔ws pipe to it (so the browser inherits the dashboard TLS+auth).
import { WsjAccessControlList } from '@winccoa/backend';

import { RtspRoute } from './rtspRoute';
import { registerRtspRelay } from './rtspRelay';

export default {
  mount: '/api/rtsp',
  // Unauthenticated for demo. Tighten before production, e.g. { allowUsers: ['root', 'engineer'] }.
  acl: WsjAccessControlList.fullAccess,
  routes: () => RtspRoute.routes(),
  registerRaw: (app: unknown) => registerRtspRelay(app)
};
