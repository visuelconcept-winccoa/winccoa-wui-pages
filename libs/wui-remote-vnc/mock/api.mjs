// `wui dev`: the HTTP side of the /api/vnc backend, mocked (wui-toolkit ≥ 0.20). The page's demo
// connections (src/remote-vnc/data/demo-connections.ts) get the TCP reachability the vncProxy
// manager's cyclic socket test would publish, and `resolve` answers their host:port. The session
// itself is a WebSocket (/api/vnc/ws) relayed to the VNC server: it is not mocked, so the viewer
// reports that it cannot connect.

const TARGETS = {
  'vnc-demo-hmi-ligne1': { host: '10.0.3.21', port: 5900, name: 'IHM Ligne 1', reachable: true, detail: '' },
  'vnc-demo-poste-supervision': { host: '10.0.3.10', port: 5901, name: 'Poste supervision', reachable: true, detail: '' },
  'vnc-demo-four-nitruration': { host: '10.0.4.42', port: 5900, name: 'Pupitre four nitruration', reachable: true, detail: '' },
  'vnc-demo-robot-soudage': { host: '10.0.3.55', port: 5900, name: 'Baie robot soudage', reachable: false, detail: 'ECONNREFUSED' }
};

const status = (code, message) => Object.assign(new Error(message), { status: code });

export default {
  'GET /api/vnc/health': () => ({ ok: true, service: 'vnc', vrpc: true, mock: true }),

  // { "<connId>": { reachable, checkedAt, detail } } — tested a few seconds ago.
  'GET /api/vnc/status': () => {
    const checkedAt = new Date(Date.now() - 8_000).toISOString();
    return Object.fromEntries(Object.entries(TARGETS).map(([id, { reachable, detail }]) => [id, { reachable, checkedAt, detail }]));
  },

  // Diagnostics: the VncProxy service resolves only the connections it knows (the demo ones here).
  'GET /api/vnc/resolve': ({ query }) => {
    const id = String(query?.id ?? '').trim();
    if (!id) throw status(400, 'id requis');
    const target = TARGETS[id];
    if (!target) throw status(502, `connexion inconnue : ${id}`);
    return { ok: true, host: target.host, port: target.port, name: target.name };
  }
};
