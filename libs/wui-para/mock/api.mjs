// `wui dev`: the /api/para backend, mocked from the mock data (wui-toolkit ≥ 0.20: :params,
// fixtures). A datapoint type EXISTS when the fixtures declare it ("types"): its structure is
// answered, and the DpJsonStore / DpSingleJsonStore pages read their datapoints from the
// fixtures — a site's own data. Any other type is missing, and creating one is refused, so
// those stores fall back to their in-memory mode, as without this mock. Writes (dp/create,
// dp/set, deletes) are accepted and change nothing: the datapoints live in the browser's mock.

// The mock's element types (`float`, `int`…) as PARA names them (backend/paraTypeNode.ts).
const ELEMENT_TYPES = ['Struct', 'Int', 'Float', 'Bool', 'Bit32', 'String', 'Time', 'Dpid', 'Char', 'UInt', 'Typeref', 'LangString', 'Blob', 'Long', 'ULong', 'Bit64', 'DynChar', 'DynUInt', 'DynInt', 'DynFloat', 'DynBool', 'DynBit32', 'DynString', 'DynTime', 'DynDpid', 'DynLangString', 'DynBlob', 'DynBit64', 'DynLong', 'DynULong'];
const elementType = (name) => ELEMENT_TYPES.find((type) => type.toLowerCase() === String(name).toLowerCase()) ?? 'String';

/** `{ speed: 'float', state: { code: 'int' } }` → PARA's `{ name, type, children }`. */
const structureOf = (name, structure) =>
  structure && typeof structure === 'object'
    ? { name, type: 'Struct', children: Object.entries(structure).map(([child, type]) => structureOf(child, type)) }
    : { name, type: elementType(structure) };

const status = (code, message) => Object.assign(new Error(message), { status: code });
const declared = (fixtures, name) => fixtures?.types?.[name];

export default {
  'GET /api/para/health': () => ({ ok: true, service: 'para', mock: true }),

  'GET /api/para/dptype/:name': ({ params, fixtures }) => {
    const type = declared(fixtures, params.name);
    if (!type) throw status(404, `DP type '${params.name}' does not exist (mock: not in the fixtures' "types")`);
    return { ok: true, typeName: params.name, structure: structureOf(params.name, type.structure ?? {}) };
  },

  // 400 when the type exists (what the stores accept), 503 otherwise: the mock holds no new types.
  'POST /api/para/dptype/create': ({ body, fixtures }) => {
    if (declared(fixtures, body?.typeName)) throw status(400, `DP type '${body.typeName}' already exists`);
    throw status(503, 'mock: datapoint types come from the fixtures ("types"), none is created');
  },
  'POST /api/para/dptype/change': () => {
    throw status(503, 'mock: datapoint types come from the fixtures, none is changed');
  },
  'DELETE /api/para/dptype/:name': () => {
    throw status(503, 'mock: datapoint types come from the fixtures, none is deleted');
  },

  'POST /api/para/dp/create': ({ body }) => ({ ok: true, dpName: body?.dpName, mock: true }),
  'POST /api/para/dp/set': () => ({ ok: true, mock: true }),
  'POST /api/para/dp/rename': ({ body }) => ({ ok: true, dpName: body?.newName, mock: true }),
  'DELETE /api/para/dp/:name': ({ params }) => ({ ok: true, dpName: params.name, mock: true }),

  'GET /api/para/dpl/health': () => ({ ok: false, error: 'mock: no dplAscii manager' })
};
