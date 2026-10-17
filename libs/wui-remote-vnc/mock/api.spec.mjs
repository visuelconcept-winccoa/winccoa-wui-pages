import { describe, expect, test } from 'vitest';
import routes from './api.mjs';

const call = async (route, request) => {
  try {
    return { status: 200, body: await routes[route]({ query: {}, params: {}, ...request }) };
  } catch (error) {
    return { status: error.status ?? 500, body: { error: error.message } };
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

  test('health reports the MSA client', async () => {
    expect((await call('GET /api/vnc/health')).body).toMatchObject({ ok: true, service: 'vnc', vrpc: true });
  });
});
