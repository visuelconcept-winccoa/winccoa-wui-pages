// `wui dev`: the /api/eng backend, mocked (wui-toolkit ≥ 0.20: :params). The data is a subset of
// the page's offline demo (src/eng-studio/data/demo-*.ts) as the demo gateway reports it, frozen
// into eng-demo.json: four equipments (an S7-1500 oven, an OPC UA line, two pumps sharing a
// catalog), their three catalogs, the STD_Four model and the Atelier_Fours workspace checked out
// from a project where Equip_Four already exists. Every role is granted.
//
// Reads answer that data; writes are accepted and change nothing: a save answers the registry as
// it would be after the save (so the page shows what it just did), the next read answers the seed
// again. What needs a live driver or a parser of the backend (online browse, S7 inventory and
// probe, catalog ingestion) answers 503 — those are actions, never the first screen.

import fs from 'node:fs';

const DEMO = JSON.parse(fs.readFileSync(new URL('./eng-demo.json', import.meta.url), 'utf8'));
const ROLES = ['view', 'edit-model', 'manage-devices', 'checkin'];

/** Live values the test-read answers (the demo's DEMO_LIVE_VALUES). */
const LIVE_VALUES = {
  'Z01_FOUR001.Mesures.Temperature': 187.4,
  'Z01_FOUR001.Consignes.Temperature': 190,
  'Z01_FOUR001.Etat.EnChauffe': true,
  'Z01_FOUR001.Etat.PorteOuverte': false,
  'Z01_FOUR002.Mesures.Temperature': 22.1,
  'Z01_FOUR002.Consignes.Temperature': 0
};

const status = (code, message) => Object.assign(new Error(message), { status: code });
const unavailable = (what) => () => {
  throw status(503, `mock: ${what} needs a live WinCC OA project (wui dev)`);
};
const copy = (value) => structuredClone(value);
const slug = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'equipement';

/** `engController.deviceStateOf`: the live fields of a device only. */
const stateOf = ({ id, state, stateSource, stateConnection, stateCode }) => ({
  id,
  state,
  ...(stateSource === undefined ? {} : { stateSource }),
  ...(stateConnection === undefined ? {} : { stateConnection }),
  ...(stateCode === undefined ? {} : { stateCode })
});

/** A saved device, as the backend stores it before its connection is read. */
const savedDevice = (id, draft) => ({ ...draft, id, state: 'unknown', stateSource: 'unprobed' });

const findBook = (id) => DEMO.books.find((book) => book.id === id);
const bookOr404 = (id) => {
  const book = findBook(id);
  if (!book) throw status(404, 'unknown book');
  return copy(book);
};

/** Wildcards as WinCC OA reads them (`*`, `?`), whole name. */
const matcher = (pattern) => {
  const source = String(pattern || '*').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 'i');
};

/** The demo gateway's live read: it honours the scope, like the backend. */
const liveSnapshot = ({ types, dpes } = {}) => {
  const live = copy(DEMO.live);
  const scoped = Array.isArray(types) && types.length > 0 ? new Set(types) : null;
  const wanted = Array.isArray(dpes) ? dpes : [];
  return {
    types: scoped === null ? live.types : live.types.filter((type) => scoped.has(type.typeName)),
    dps: scoped === null ? live.dps : live.dps.filter((dp) => scoped.has(dp.dpType)),
    configs: Object.fromEntries(wanted.filter((dpe) => dpe in live.configs).map((dpe) => [dpe, live.configs[dpe]]))
  };
};

export default {
  'GET /api/eng/health': () => ({
    ok: true,
    service: 'eng',
    store: 'mock',
    manager: { reachable: true, mock: true },
    s7Browse: { reachable: false }
  }),
  'GET /api/eng/roles': () => ({ ok: true, roles: ROLES }),

  // --- devices --------------------------------------------------------------
  'GET /api/eng/devices': () => ({ ok: true, devices: copy(DEMO.devices) }),
  'GET /api/eng/devices/state': () => ({ ok: true, states: DEMO.devices.map(stateOf) }),
  'POST /api/eng/devices': ({ body }) => {
    if (!body?.device?.name) throw status(400, 'device {name, protocol, …} is required');
    const device = savedDevice(slug(body.device.name), body.device);
    return { ok: true, device, devices: [...copy(DEMO.devices), device] };
  },
  'POST /api/eng/devices/:id': ({ params, body }) => {
    const existing = DEMO.devices.find((device) => device.id === params.id);
    if (!existing) throw status(404, `unknown device '${params.id}'`);
    if (!body?.device) throw status(400, 'device {name, protocol, …} is required');
    const device = { ...copy(existing), ...body.device, id: params.id };
    return { ok: true, device, devices: DEMO.devices.map((d) => (d.id === params.id ? device : copy(d))) };
  },
  'PUT /api/eng/devices': ({ body }) => {
    if (!Array.isArray(body?.devices)) throw status(400, 'devices[] is required');
    return { ok: true, devices: body.devices };
  },
  'DELETE /api/eng/devices/:id': ({ params }) => {
    if (!DEMO.devices.some((device) => device.id === params.id)) throw status(404, `unknown device '${params.id}'`);
    return { ok: true, devices: copy(DEMO.devices.filter((device) => device.id !== params.id)) };
  },

  // --- project: connections, drivers, options, datapoints --------------------
  'GET /api/eng/connections': () => ({ ok: true, connections: copy(DEMO.connections) }),
  'GET /api/eng/drivers': () => ({ ok: true, drivers: copy(DEMO.drivers) }),
  'GET /api/eng/config-options': () => ({ ok: true, ...copy(DEMO.configOptions) }),
  'GET /api/eng/dps': ({ query }) => {
    const { alarmClasses, archiveGroups } = DEMO.configOptions;
    const pool =
      query.type === '_AlertClass'
        ? alarmClasses
        : query.type === '_NGA_Group'
          ? archiveGroups
          : [...alarmClasses, ...archiveGroups, ...DEMO.live.dps.map((dp) => dp.dpName)];
    const test = matcher(query.pattern);
    return { ok: true, dps: pool.filter((name) => test.test(name)), truncated: false };
  },
  'GET /api/eng/dptypes': () => ({ ok: true, types: DEMO.live.types.map((type) => type.typeName) }),
  'GET /api/eng/dptypes/:name': ({ params }) => {
    const type = DEMO.live.types.find((candidate) => candidate.typeName === params.name);
    if (!type) throw status(404, `DP type '${params.name}' does not exist`);
    return { ok: true, type: copy(type) };
  },
  'POST /api/eng/browse/level': unavailable('an OPC UA browse'),

  // --- S7Plus: the manager and the connections are listed, browsing is not ----
  'GET /api/eng/s7plus/health': () => ({ ok: true, manager: copy(DEMO.s7plusManager) }),
  'GET /api/eng/s7plus/connections': () => ({ ok: true, connections: copy(DEMO.s7plusConnections) }),
  'POST /api/eng/s7plus/projects': unavailable('an S7Plus browse'),
  'POST /api/eng/s7plus/stations': unavailable('an S7Plus browse'),
  'POST /api/eng/s7plus/level': unavailable('an S7Plus browse'),

  // --- address books ----------------------------------------------------------
  'GET /api/eng/books': () => ({ ok: true, books: copy(DEMO.books) }),
  'GET /api/eng/books/:id': ({ params }) => ({ ok: true, book: findBook(params.id) ? copy(findBook(params.id)) : null }),
  'POST /api/eng/books': ({ body }) => {
    if (!body?.bookId) throw status(400, 'bookId is required');
    if (findBook(body.bookId)) throw status(409, `a catalog '${body.bookId}' already exists`);
    const book = {
      id: body.bookId,
      name: body.name ?? body.bookId,
      provenance: { kind: 'manual', generatedAt: new Date().toISOString(), detail: 'declared, not yet generated' },
      ...(body.interface === undefined ? {} : { interface: body.interface }),
      entries: [],
      types: [],
      warnings: []
    };
    return { ok: true, book, books: [...copy(DEMO.books), book] };
  },
  'PUT /api/eng/books/:id': ({ params, body }) => {
    if (!body?.book || !Array.isArray(body.book.entries)) throw status(400, 'book {provenance, entries[], …} is required');
    const book = { ...body.book, id: params.id };
    return { ok: true, book, books: [...DEMO.books.filter((b) => b.id !== params.id).map(copy), book] };
  },
  'DELETE /api/eng/books/:id': ({ params }) => {
    bookOr404(params.id);
    return {
      ok: true,
      books: copy(DEMO.books.filter((book) => book.id !== params.id)),
      devices: DEMO.devices.map((device) => ({ ...copy(device), bookIds: device.bookIds.filter((id) => id !== params.id) }))
    };
  },
  'POST /api/eng/books/ingest': unavailable('a catalog ingestion'),
  'POST /api/eng/books/browse': unavailable('an OPC UA browse'),
  'POST /api/eng/books/browse-s7plus': unavailable('an S7Plus browse'),
  'GET /api/eng/s7/connections': () => ({ ok: true, connections: copy(DEMO.s7Connections) }),
  'POST /api/eng/s7/probe': unavailable('the s7Browse manager'),
  'POST /api/eng/books/:id/s7-inventory': unavailable('the s7Browse manager'),
  'POST /api/eng/books/:id/refresh': ({ params }) => ({
    ok: true,
    book: bookOr404(params.id),
    rebrowsed: false,
    note: 'mock: the source is not re-read in wui dev'
  }),
  'POST /api/eng/books/:id/roles': ({ params }) => ({ ok: true, book: bookOr404(params.id) }),
  'POST /api/eng/books/:id/access': ({ params }) => ({ ok: true, book: bookOr404(params.id) }),
  'POST /api/eng/books/:id/exclude': ({ params }) => ({ ok: true, book: bookOr404(params.id) }),

  // --- models -----------------------------------------------------------------
  'GET /api/eng/models': () => ({ ok: true, models: copy(DEMO.models) }),
  'POST /api/eng/models': ({ body }) => {
    const model = body?.model;
    if (!model?.name || typeof model.typeName !== 'string') throw status(400, 'model {name, typeName, structure, bindings} is required');
    return { ok: true, model: { ...model, id: model.id || slug(model.name), savedAt: new Date().toISOString() } };
  },
  'DELETE /api/eng/models/:id': ({ params }) => {
    if (!DEMO.models.some((model) => model.id === params.id)) throw status(404, `unknown model '${params.id}'`);
    return { ok: true };
  },

  // --- workspace, live project, check-in ----------------------------------------
  'GET /api/eng/workspace': () => ({ ok: true, workspace: copy(DEMO.workspace) }),
  'POST /api/eng/workspace': ({ body }) => {
    if (typeof body?.workspace?.name !== 'string') throw status(400, 'workspace {name,…} is required');
    return { ok: true };
  },
  'POST /api/eng/checkout': ({ body }) => {
    const live = liveSnapshot(body ?? {});
    return { ok: true, workspace: { ...copy(DEMO.workspace), name: body?.name ?? 'default', ...live, checkedOutAt: new Date().toISOString() } };
  },
  'GET /api/eng/live': () => ({ ok: true, snapshot: liveSnapshot() }),
  'POST /api/eng/live': ({ body }) => ({ ok: true, snapshot: liveSnapshot(body ?? {}) }),
  'POST /api/eng/test-read': ({ body }) => ({
    ok: true,
    results: (body?.dpes ?? []).map((dpe) =>
      dpe in LIVE_VALUES ? { dpe, value: LIVE_VALUES[dpe], ok: true } : { dpe, value: null, ok: false }
    )
  }),
  // Nothing is written: every item reports what a check-in would do, conflicts skipped.
  'POST /api/eng/checkin': ({ body }) => {
    if (!Array.isArray(body?.plan?.items)) throw status(400, 'a plan with items[] is required');
    return {
      ok: true,
      dryRun: body.dryRun === true,
      results: body.plan.items.map(({ kind, op, name, conflict }) => ({ kind, op, name, status: conflict ? 'skipped' : 'applied' }))
    };
  }
};
