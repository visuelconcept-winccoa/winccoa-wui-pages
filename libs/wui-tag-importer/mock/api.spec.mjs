import { describe, expect, test } from 'vitest';
import routes from './api.mjs';

const call = async (route, request) => {
  try {
    return { status: 200, body: await routes[route]({ query: {}, params: {}, ...request }) };
  } catch (error) {
    return { status: error.status ?? 500, body: { error: error.message } };
  }
};

describe('the /api/tag-importer mock', () => {
  test('lists the connections, the running driver and the project types', async () => {
    const connections = (await call('GET /api/tag-importer/connections')).body.connections;
    expect(connections).toEqual([
      { name: 'Remplisseuse', dp: 'System1:_Remplisseuse', connected: true },
      { name: 'Etiqueteuse', dp: 'System1:_Etiqueteuse', connected: false }
    ]);
    expect((await call('GET /api/tag-importer/drivers')).body).toEqual({ ok: true, drivers: [4] });
    expect((await call('GET /api/tag-importer/dptypes')).body.types).toContain('Equip_Four');
  });

  test('browses the connected server level by level', async () => {
    const root = (await call('POST /api/tag-importer/browse', { body: { connection: 'Remplisseuse' } })).body.nodes;
    expect(root.map((node) => node.displayName)).toEqual(['Remplisseuse', 'Server']);
    expect(root[0]).toMatchObject({ nodeClass: 'Object', hasChildren: true, browsePath: '/Remplisseuse' });
    const mesures = (await call('POST /api/tag-importer/browse', { body: { connection: 'System1:_Remplisseuse', nodeId: 'ns=4;i=1200' } })).body.nodes;
    expect(mesures[1]).toEqual({
      displayName: 'NiveauCuve',
      nodeId: 'ns=4;s=Remplisseuse.Mesures.NiveauCuve',
      browsePath: '/Remplisseuse/Mesures/NiveauCuve',
      nodeClass: 'Variable',
      dataType: 'Double',
      valueRank: -1,
      hasChildren: false
    });
    const deep = (await call('POST /api/tag-importer/browse', { body: { connection: 'Remplisseuse', nodeId: 'ns=4;i=1000', depth: 2 } })).body.nodes;
    expect(deep).toHaveLength(13);
  });

  test('the disconnected server does not answer', async () => {
    expect((await call('POST /api/tag-importer/browse', { body: { connection: 'Etiqueteuse' } })).status).toBe(502);
    expect((await call('POST /api/tag-importer/browse', { body: {} })).status).toBe(400);
  });

  test('apply reports what it would create, and writes nothing', async () => {
    const plan = {
      source: 'opcua-online',
      types: [{ typeName: 'Remplisseuse' }, { typeName: 'Equip_Four', reuse: true, extend: true }],
      dps: [{ dpName: 'Remplisseuse_1' }, { dpName: 'Remplisseuse_0', exists: true }],
      addresses: [{ dpe: 'Remplisseuse_1.Mesures.Cadence' }],
      warnings: []
    };
    expect((await call('POST /api/tag-importer/apply', { body: { plan, dryRun: true } })).body).toEqual({
      ok: true,
      dryRun: true,
      results: [
        { kind: 'type', name: 'Remplisseuse', status: 'created' },
        { kind: 'type', name: 'Equip_Four', status: 'skipped' },
        { kind: 'dp', name: 'Remplisseuse_1', status: 'created' },
        { kind: 'dp', name: 'Remplisseuse_0', status: 'skipped' },
        { kind: 'address', name: 'Remplisseuse_1.Mesures.Cadence', status: 'created' }
      ]
    });
    expect((await call('POST /api/tag-importer/apply', { body: { plan, dryRun: false } })).body.results[1].status).toBe('created');
    expect((await call('POST /api/tag-importer/apply', { body: {} })).status).toBe(400);
  });

  test('connections: read pre-fills the form, a create needs an opc.tcp endpoint', async () => {
    expect((await call('POST /api/tag-importer/connection/read', { body: { dp: 'System1:_Remplisseuse' } })).body.config).toMatchObject({ endpoint: 'opc.tcp://192.168.10.42:4840' });
    expect((await call('POST /api/tag-importer/connection', { body: { endpoint: 'http://x' } })).status).toBe(400);
    expect((await call('POST /api/tag-importer/connection', { body: { name: 'Presse', endpoint: 'opc.tcp://10.0.0.5:4840' } })).body.connection).toEqual({ name: 'Presse', dp: 'System1:_Presse', connected: false });
  });
});
