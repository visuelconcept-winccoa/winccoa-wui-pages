import { describe, expect, test } from 'vitest';
import routes from './api.mjs';

const call = async (route, request) => {
  try {
    return { status: 200, body: await routes[route]({ query: {}, params: {}, ...request }) };
  } catch (error) {
    return { status: error.status ?? 500, body: { error: error.message } };
  }
};

describe('the /api/rtsp mock', () => {
  test('nobody is watching a camera', async () => {
    expect(await call('GET /api/rtsp/clients')).toEqual({ status: 200, body: {} });
  });

  test('the demo cameras carry a fresh probe result, one unreachable with its reason', async () => {
    const { status, body } = await call('GET /api/rtsp/status');
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(['cam-demo-public-test', 'cam-demo-usinage-entree', 'cam-demo-soudage-cellule', 'cam-demo-four-nitruration']);
    expect(body['cam-demo-usinage-entree']).toMatchObject({ reachable: true, detail: '' });
    expect(body['cam-demo-four-nitruration']).toMatchObject({ reachable: false, detail: 'délai dépassé (injoignable)' });
    for (const probe of Object.values(body)) expect(Date.now() - Date.parse(probe.checkedAt)).toBeLessThan(60_000);
  });

  test('health names the manager endpoint', async () => {
    expect((await call('GET /api/rtsp/health')).body).toMatchObject({ ok: true, service: 'rtsp', manager: '127.0.0.1:9999' });
  });
});
