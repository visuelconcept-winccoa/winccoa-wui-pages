// `wui dev`: the /api/tag-importer backend, mocked (wui-toolkit ≥ 0.20). Two OPC UA connections of
// a demo project (one connected, browsable: a small bottle-filler address space) on one running
// OPC UA client driver, and the project's own datapoint types. `apply` answers what the real
// backend would do — a dry run says "would be created" for every new type, datapoint and address,
// a real run says "created" — and writes nothing. Creating or editing a connection is accepted
// and changes nothing.

const OBJECTS_FOLDER = 'ns=0;i=85';
const NS = 'ns=4';

const CONNECTIONS = [
  { name: 'Remplisseuse', dp: 'System1:_Remplisseuse', connected: true },
  { name: 'Etiqueteuse', dp: 'System1:_Etiqueteuse', connected: false }
];

const CONFIGS = {
  Remplisseuse: { endpoint: 'opc.tcp://192.168.10.42:4840', user: '', securityPolicy: 'Basic256Sha256', messageMode: 'SignAndEncrypt' },
  Etiqueteuse: { endpoint: 'opc.tcp://192.168.10.43:4840', user: 'operateur', securityPolicy: 'None', messageMode: 'None' }
};

const DP_TYPES = ['Equip_Four', 'GIS_Site', 'ProcessMonitor_History', 'RtspCamera_Stream', 'STD_PackML'];

const object = (name, id, children) => ({ displayName: name, nodeId: `${NS};i=${id}`, nodeClass: 'Object', children });
const variable = (name, key, dataType, valueRank = -1) => ({ displayName: name, nodeId: `${NS};s=${key}`, nodeClass: 'Variable', dataType, valueRank });

/** The connected server's address space, below the Objects folder. */
const ADDRESS_SPACE = [
  object('Remplisseuse', 1000, [
    object('Etat', 1100, [
      variable('EnMarche', 'Remplisseuse.Etat.EnMarche', 'Boolean'),
      variable('Defaut', 'Remplisseuse.Etat.Defaut', 'Boolean'),
      variable('CodeDefaut', 'Remplisseuse.Etat.CodeDefaut', 'UInt16')
    ]),
    object('Mesures', 1200, [
      variable('Cadence', 'Remplisseuse.Mesures.Cadence', 'Int32'),
      variable('NiveauCuve', 'Remplisseuse.Mesures.NiveauCuve', 'Double'),
      variable('TemperatureProduit', 'Remplisseuse.Mesures.TemperatureProduit', 'Float'),
      variable('CompteurBouteilles', 'Remplisseuse.Mesures.CompteurBouteilles', 'UInt32'),
      variable('PoidsBecs', 'Remplisseuse.Mesures.PoidsBecs', 'Float', 1)
    ]),
    object('Consignes', 1300, [
      variable('Cadence', 'Remplisseuse.Consignes.Cadence', 'Int32'),
      variable('Format', 'Remplisseuse.Consignes.Format', 'String')
    ])
  ]),
  object('Server', 2253, [])
];

const status = (code, message) => Object.assign(new Error(message), { status: code });
const ENDPOINT = /^opc\.tcp:\/\/[^\s:/]+:\d+$/;

/** The node `nodeId` names, or null (the Objects folder is the root). */
const childrenOf = (nodeId) => {
  if (!nodeId || nodeId === OBJECTS_FOLDER) return { nodes: ADDRESS_SPACE, path: '' };
  const visit = (nodes, path) => {
    for (const node of nodes) {
      const here = `${path}/${node.displayName}`;
      if (node.nodeId === nodeId) return { nodes: node.children ?? [], path: here };
      const found = visit(node.children ?? [], here);
      if (found) return found;
    }
    return null;
  };
  return visit(ADDRESS_SPACE, '');
};

/** The flat list the driver's GetBranch answers: `depth` levels below the start node. */
const branch = (nodes, path, depth) =>
  nodes.flatMap((node) => {
    const browsePath = `${path}/${node.displayName}`;
    const own = {
      displayName: node.displayName,
      nodeId: node.nodeId,
      browsePath,
      nodeClass: node.nodeClass,
      dataType: node.dataType ?? '',
      valueRank: node.valueRank ?? -1,
      hasChildren: node.nodeClass === 'Object'
    };
    return depth > 1 ? [own, ...branch(node.children ?? [], browsePath, depth - 1)] : [own];
  });

const connectionNamed = (name) => CONNECTIONS.find((c) => c.name === name || c.dp === name || c.dp.endsWith(`:_${name}`));
const savedConnection = (body) => {
  if (!ENDPOINT.test(String(body?.endpoint ?? ''))) throw status(400, 'endpoint must be of the form opc.tcp://host:port');
};

export default {
  'GET /api/tag-importer/health': () => ({ ok: true, service: 'tag-importer', mock: true }),
  'GET /api/tag-importer/connections': () => ({ ok: true, connections: structuredClone(CONNECTIONS) }),
  'GET /api/tag-importer/drivers': () => ({ ok: true, drivers: [4] }),
  'GET /api/tag-importer/dptypes': () => ({ ok: true, types: DP_TYPES }),

  'POST /api/tag-importer/connection': ({ body }) => {
    savedConnection(body);
    const name = String(body.name ?? '').trim() || 'OPCUA_Serveur1';
    return { ok: true, connection: { name, dp: `System1:_${name}`, connected: false }, warnings: [] };
  },
  'POST /api/tag-importer/connection/read': ({ body }) => {
    if (!body?.dp) throw status(400, 'dp is required');
    const connection = connectionNamed(body.dp);
    if (!connection) throw status(400, `connection '${body.dp}' does not exist`);
    return { ok: true, config: { ...CONFIGS[connection.name] } };
  },
  'POST /api/tag-importer/connection/update': ({ body }) => {
    if (!body?.dp) throw status(400, 'dp is required');
    savedConnection(body);
    const connection = connectionNamed(body.dp);
    if (!connection) throw status(404, `connection '${body.dp}' does not exist`);
    return { ok: true, connection: { name: connection.name, dp: connection.dp, connected: false } };
  },

  // Only the connected server answers, as on a project whose second driver connection is down.
  'POST /api/tag-importer/browse': ({ body }) => {
    if (!body?.connection) throw status(400, 'connection is required');
    const connection = connectionNamed(body.connection);
    if (!connection?.connected) throw status(502, 'browse timed out after 30s (large address space or connectivity issue)');
    const level = Math.min(Math.max(Number(body.depth) || 1, 1), 3);
    const start = childrenOf(body.nodeId);
    return { ok: true, nodes: start ? branch(start.nodes, start.path, level) : [] };
  },

  'POST /api/tag-importer/apply': ({ body }) => {
    const plan = body?.plan;
    if (!plan || !Array.isArray(plan.types) || !Array.isArray(plan.dps)) throw status(400, 'a plan with types[] and dps[] is required');
    const dryRun = body.dryRun === true;
    const created = (kind, name, exists) => ({ kind, name, status: exists ? 'skipped' : 'created' });
    // A reused type is only changed by a real run that extends it.
    const typeKept = (type) => (type.reuse ? dryRun || !type.extend : type.exists === true || DP_TYPES.includes(type.typeName));
    return {
      ok: true,
      dryRun,
      results: [
        ...plan.types.map((type) => created('type', type.typeName, typeKept(type))),
        ...plan.dps.map((dp) => created('dp', dp.dpName, dp.exists === true)),
        ...(plan.addresses ?? []).map((address) => created('address', address.dpe, false))
      ]
    };
  }
};
