// `wui dev`: the HTTP side of the /api/vnc backend, mocked (wui-toolkit ≥ 0.20) — for the Remote VNC
// page and for any host module that embeds <wui-vnc-viewer> (`wui dev` merges this mock when the site
// selects remote-vnc or deploys it headless). The demo connections (as src/remote-vnc/data/demo-connections.ts) are served
// by the connection routes, in memory (writes last until `wui dev` restarts), never with a password;
// `status` gives them the TCP reachability the vncProxy manager's cyclic socket test would publish
// and `resolve` answers their host:port. The mock knows no roles: every route answers.
//
// The session itself is a WebSocket (/api/vnc/ws) relayed to a VNC server: it is not mocked, so
// `POST /api/vnc/session` answers 503 `relay-unavailable` and the viewer shows that state.

const TARGETS = {
  'vnc-demo-hmi-ligne1': { host: '10.0.3.21', port: 5900, name: 'IHM Ligne 1', reachable: true, detail: '' },
  'vnc-demo-poste-supervision': { host: '10.0.3.10', port: 5901, name: 'Poste supervision', reachable: true, detail: '' },
  'vnc-demo-four-nitruration': { host: '10.0.4.42', port: 5900, name: 'Pupitre four nitruration', reachable: true, detail: '' },
  'vnc-demo-robot-soudage': { host: '10.0.3.55', port: 5900, name: 'Baie robot soudage', reachable: false, detail: 'ECONNREFUSED' }
};

const DEFAULTS = {
  password: '',
  description: '',
  group: '',
  viewOnly: false,
  shared: true,
  connectTimeoutSec: 15,
  autoReconnect: true,
  reconnectDelaySec: 5,
  maxReconnectAttempts: 3,
  favorite: false,
  lastConnectedAt: ''
};

const SEEDS = [
  { id: 'vnc-demo-hmi-ligne1', group: 'Atelier usinage', description: 'Panel IHM de la ligne d’usinage 1 (Comfort Panel).', favorite: true, password: 'demo' },
  { id: 'vnc-demo-poste-supervision', group: 'Salle de contrôle', description: 'PC de supervision WinCC OA (UI client).' },
  { id: 'vnc-demo-four-nitruration', group: 'Traitement thermique', description: 'Pupitre opérateur du four de nitruration (lecture seule).', viewOnly: true },
  { id: 'vnc-demo-robot-soudage', group: 'Atelier soudage', description: 'Teach-pendant déporté de la cellule de soudage robotisée.' }
];

/** The in-memory store, password included (as the DPs hold it) — never answered as is. */
let connections = SEEDS.map((seed) => {
  const { host, port, name } = TARGETS[seed.id];
  return { ...DEFAULTS, ...seed, name, host, port, dp: `RemoteVnc_${seed.id}` };
});

const status = (code, message) => Object.assign(new Error(message), { status: code, body: { ok: false, error: code === 404 ? 'not-found' : code === 400 ? 'invalid' : 'failed', message } });

/** What every route answers: the password replaced by `hasPassword`. */
const publicView = ({ password, ...rest }) => ({ ...rest, hasPassword: Boolean(password) });

const find = (id) => {
  const conn = connections.find((c) => c.id === id);
  if (!conn) throw status(404, `unknown connection: ${id}`);
  return conn;
};

/** The fields a client may set (the backend's applyInput, simplified). */
function apply(base, body = {}) {
  const out = { ...base };
  for (const key of ['name', 'host', 'description', 'group']) if (typeof body[key] === 'string') out[key] = body[key].trim();
  for (const key of ['viewOnly', 'shared', 'favorite', 'autoReconnect']) if (body[key] !== undefined) out[key] = Boolean(body[key]);
  for (const key of ['port', 'connectTimeoutSec', 'reconnectDelaySec', 'maxReconnectAttempts']) if (body[key] !== undefined) out[key] = Number(body[key]);
  if (typeof body.password === 'string') out.password = body.password;
  if (!out.name || !out.host) throw status(400, 'name and host are required');
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) throw status(400, 'port must be 1..65535');
  return out;
}

export default {
  'GET /api/vnc/health': () => ({ ok: true, service: 'vnc', vrpc: true, relay: false, mock: true }),

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
  },

  'GET /api/vnc/connections': () => ({ ok: true, connections: connections.map(publicView) }),

  'GET /api/vnc/connection/:id': ({ params }) => ({ ok: true, connection: publicView(find(params.id)) }),

  'POST /api/vnc/connection': ({ body }) => {
    const draft = apply({ ...DEFAULTS, id: '', name: '', host: '', port: 5900 }, body);
    const slug = (draft.name || draft.host).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/(^-|-$)/g, '').slice(0, 28) || 'vnc';
    const id = `${slug}-${Date.now().toString(36)}`;
    const created = { ...draft, id, dp: `RemoteVnc_${id}`, lastConnectedAt: '' };
    connections = [...connections, created];
    return { ok: true, connection: publicView(created) };
  },

  'PUT /api/vnc/connection/:id': ({ params, body }) => {
    const updated = apply(find(params.id), body);
    connections = connections.map((c) => (c.id === updated.id ? updated : c));
    return { ok: true, connection: publicView(updated) };
  },

  'DELETE /api/vnc/connection/:id': ({ params }) => {
    find(params.id);
    connections = connections.filter((c) => c.id !== params.id);
    return { ok: true };
  },

  'POST /api/vnc/connection/:id/favorite': ({ params, body }) => {
    const updated = { ...find(params.id), favorite: Boolean(body?.favorite) };
    connections = connections.map((c) => (c.id === updated.id ? updated : c));
    return { ok: true, connection: publicView(updated) };
  },

  // No relay under `wui dev`: the viewer shows "relay unavailable" once it has the connection.
  'POST /api/vnc/session': ({ body }) => {
    find(String(body?.id ?? ''));
    throw Object.assign(new Error('wui dev: the VNC relay (/api/vnc/ws) is not mocked'), {
      status: 503,
      body: { ok: false, error: 'relay-unavailable', message: 'wui dev: the VNC relay (/api/vnc/ws) is not mocked' }
    });
  }
};
