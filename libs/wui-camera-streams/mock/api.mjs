// `wui dev`: the HTTP side of the /api/rtsp backend, mocked (wui-toolkit ≥ 0.20). The page's demo
// cameras (src/camera-streams/data/demo-streams.ts) get the reachability the rtspProxy manager's
// cyclic ffmpeg probe would publish, and nobody is watching them. The stream itself is a
// WebSocket (/api/rtsp/ws) relayed to ffmpeg: it is not mocked, so the viewer reports that it
// cannot connect.

/** Last probe per demo camera id, as the manager's `statusById` holds it. */
const PROBES = {
  'cam-demo-public-test': { reachable: true, detail: '' },
  'cam-demo-usinage-entree': { reachable: true, detail: '' },
  'cam-demo-soudage-cellule': { reachable: true, detail: '' },
  'cam-demo-four-nitruration': { reachable: false, detail: 'délai dépassé (injoignable)' }
};

export default {
  'GET /api/rtsp/health': () => ({ ok: true, service: 'rtsp', manager: '127.0.0.1:9999', mock: true }),

  // { "<cameraId>": <connectedClients> } — only ids with viewers: none in the mock.
  'GET /api/rtsp/clients': () => ({}),

  // { "<cameraId>": { reachable, checkedAt, detail } } — probed a few seconds ago.
  'GET /api/rtsp/status': () => {
    const checkedAt = new Date(Date.now() - 12_000).toISOString();
    return Object.fromEntries(Object.entries(PROBES).map(([id, probe]) => [id, { ...probe, checkedAt }]));
  }
};
