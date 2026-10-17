import { describe, expect, test } from 'vitest';
import routes from './api.mjs';

const fixtures = { types: { GIS_Site: { structure: { name: 'string', json: 'string', geo: { lat: 'float', lon: 'float' } } } } };
const call = async (route, request) => {
  try {
    return { status: 200, body: await routes[route]({ query: {}, params: {}, ...request }) };
  } catch (error) {
    return { status: error.status ?? 500, body: { error: error.message } };
  }
};

describe('the /api/para mock', () => {
  test('a type the fixtures declare exists, with its structure as PARA names it', async () => {
    expect(await call('GET /api/para/dptype/:name', { params: { name: 'GIS_Site' }, fixtures })).toEqual({
      status: 200,
      body: {
        ok: true,
        typeName: 'GIS_Site',
        structure: {
          name: 'GIS_Site',
          type: 'Struct',
          children: [
            { name: 'name', type: 'String' },
            { name: 'json', type: 'String' },
            { name: 'geo', type: 'Struct', children: [{ name: 'lat', type: 'Float' }, { name: 'lon', type: 'Float' }] }
          ]
        }
      }
    });
  });

  test('any other type is missing, and is not created: the stores keep their in-memory mode', async () => {
    expect((await call('GET /api/para/dptype/:name', { params: { name: 'Mosaic_Board' }, fixtures })).status).toBe(404);
    expect((await call('POST /api/para/dptype/create', { body: { typeName: 'Mosaic_Board' }, fixtures })).status).toBe(503);
    expect((await call('POST /api/para/dptype/create', { body: { typeName: 'GIS_Site' }, fixtures })).status).toBe(400);
  });

  test('writes are accepted and change nothing', async () => {
    expect(await call('POST /api/para/dp/set', { body: { dpeName: 'GIS_1.json', value: '{}' }, fixtures })).toEqual({ status: 200, body: { ok: true, mock: true } });
    expect((await call('DELETE /api/para/dp/:name', { params: { name: 'GIS_1' }, fixtures })).body).toMatchObject({ ok: true, dpName: 'GIS_1' });
  });

  test('without fixtures (an older wui-toolkit) every type is missing', async () => {
    expect((await call('GET /api/para/dptype/:name', { params: { name: 'GIS_Site' } })).status).toBe(404);
  });
});
