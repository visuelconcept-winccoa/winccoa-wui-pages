import { describe, expect, test } from 'vitest';
import routes from './api.mjs';

const call = async (route, request) => {
  try {
    return { status: 200, body: await routes[route]({ query: {}, params: {}, ...request }) };
  } catch (error) {
    return { status: error.status ?? 500, body: error.body ?? { error: error.message } };
  }
};

describe('the /api/vnc mock', () => {
  test('the demo connections carry a fresh TCP test result', async () => {
    const { status, body } = await call('GET /api/vnc/status');
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(['vnc-demo-hmi-ligne1', 'vnc-demo-poste-supervision', 'vnc-demo-four-nitruration', 'vnc-demo-robot-soudage']);
    expect(body['vnc-demo-hmi-ligne1']).toMatchObject({ reachable: true, detail: '' });
    expect(body['vnc-demo-robot-soudage']).toMatchObject({ reachable: false, detail: 'ECONNREFUSED' });
  });

  test('resolve answers a known connection and refuses the others', async () => {
    expect((await call('GET /api/vnc/resolve', { query: { id: 'vnc-demo-poste-supervision' } })).body).toEqual({ ok: true, host: '10.0.3.10', port: 5901, name: 'Poste supervision' });
    expect((await call('GET /api/vnc/resolve', { query: { id: 'inconnue' } })).status).toBe(502);
    expect((await call('GET /api/vnc/resolve', { query: {} })).status).toBe(400);
  });

  test('health reports the MSA client and no relay', async () => {
    expect((await call('GET /api/vnc/health')).body).toMatchObject({ ok: true, service: 'vnc', vrpc: true, relay: false });
  });

  test('the listing serves the demo connections, never a password', async () => {
    const { status, body } = await call('GET /api/vnc/connections');
    expect(status).toBe(200);
    expect(body.connections.map((c) => c.id)).toContain('vnc-demo-hmi-ligne1');
    for (const conn of body.connections) expect(conn).not.toHaveProperty('password');
    expect(body.connections.find((c) => c.id === 'vnc-demo-hmi-ligne1')).toMatchObject({ name: 'IHM Ligne 1', hasPassword: true });
    expect(JSON.stringify(body)).not.toContain('"demo"');
  });

  test('one connection by id, for an embedding host; 404 for an unknown one', async () => {
    const one = await call('GET /api/vnc/connection/:id', { params: { id: 'vnc-demo-four-nitruration' } });
    expect(one.body.connection).toMatchObject({ id: 'vnc-demo-four-nitruration', host: '10.0.4.42', viewOnly: true, hasPassword: false });
    expect(one.body.connection).not.toHaveProperty('password');
    const missing = await call('GET /api/vnc/connection/:id', { params: { id: 'nope' } });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ ok: false, error: 'not-found' });
  });

  test('create, update (password kept unless sent), favourite and delete, in memory', async () => {
    const created = await call('POST /api/vnc/connection', { body: { name: 'Banc test', host: '10.9.9.9', port: 5902, password: 's3cret' } });
    expect(created.body.connection).toMatchObject({ name: 'Banc test', hasPassword: true });
    expect(created.body.connection).not.toHaveProperty('password');
    const id = created.body.connection.id;
    const renamed = await call('PUT /api/vnc/connection/:id', { params: { id }, body: { name: 'Banc essai', host: '10.9.9.9', port: 5902 } });
    expect(renamed.body.connection).toMatchObject({ name: 'Banc essai', hasPassword: true });
    const cleared = await call('PUT /api/vnc/connection/:id', { params: { id }, body: { name: 'Banc essai', host: '10.9.9.9', password: '' } });
    expect(cleared.body.connection.hasPassword).toBe(false);
    expect((await call('POST /api/vnc/connection/:id/favorite', { params: { id }, body: { favorite: true } })).body.connection.favorite).toBe(true);
    expect((await call('PUT /api/vnc/connection/:id', { params: { id }, body: { name: '', host: 'x' } })).status).toBe(400);
    expect((await call('DELETE /api/vnc/connection/:id', { params: { id } })).status).toBe(200);
    expect((await call('GET /api/vnc/connection/:id', { params: { id } })).status).toBe(404);
  });

  test('no session under wui dev: the relay is reported unavailable', async () => {
    const { status, body } = await call('POST /api/vnc/session', { body: { id: 'vnc-demo-hmi-ligne1' } });
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: 'relay-unavailable' });
    expect((await call('POST /api/vnc/session', { body: { id: 'nope' } })).status).toBe(404);
  });
});
