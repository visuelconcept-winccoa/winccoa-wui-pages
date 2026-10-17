import { describe, expect, test } from 'vitest';
import routes from './api.mjs';

const call = async (route, request) => {
  try {
    return { status: 200, body: await routes[route]({ query: {}, params: {}, ...request }) };
  } catch (error) {
    return { status: error.status ?? 500, body: { error: error.message } };
  }
};

const get = async (route, request) => (await call(route, request)).body;

describe('the /api/eng mock', () => {
  test('every route the page loads on its first screen answers', async () => {
    for (const route of ['roles', 'devices', 'devices/state', 'books', 'connections', 's7plus/connections', 's7plus/health', 's7/connections', 'drivers', 'config-options', 'dptypes', 'models', 'workspace', 'live']) {
      expect((await call(`GET /api/eng/${route}`)).status, route).toBe(200);
    }
    expect((await get('GET /api/eng/roles')).roles).toEqual(['view', 'edit-model', 'manage-devices', 'checkin']);
  });

  test('the demo is consistent: every catalog a device or a model names exists', async () => {
    const { devices } = await get('GET /api/eng/devices');
    const { books } = await get('GET /api/eng/books');
    const { models } = await get('GET /api/eng/models');
    const ids = new Set(books.map((book) => book.id));
    expect(devices.map((device) => device.name)).toEqual(['S7_Four1', 'Ligne_Embouteillage', 'Z01_Pompe1', 'Z01_Pompe2']);
    for (const device of devices) for (const id of device.bookIds) expect(ids.has(id), id).toBe(true);
    for (const model of models) for (const { bookId } of model.sources) expect(ids.has(bookId), bookId).toBe(true);
  });

  test('the state refresh carries the live fields only', async () => {
    const { states } = await get('GET /api/eng/devices/state');
    expect(states[0]).toEqual({ id: 's7-four1', state: 'connected', stateSource: 'connstate', stateConnection: '192.168.10.21', stateCode: 257 });
    expect(states[2]).toEqual({ id: 'z01-pompe1', state: 'unknown', stateSource: 'unprobed' });
  });

  test('the live read honours its scope', async () => {
    const scoped = (await get('POST /api/eng/live', { body: { types: ['Equip_Four'], dpes: ['Z01_FOUR001.Mesures.Temperature', 'Z01_FOUR002.Mesures.Temperature'] } })).snapshot;
    expect(scoped.dps).toEqual([{ dpName: 'Z01_FOUR001', dpType: 'Equip_Four' }]);
    expect(Object.keys(scoped.configs)).toEqual(['Z01_FOUR001.Mesures.Temperature']);
    expect((await get('POST /api/eng/live', { body: { types: ['Autre'] } })).snapshot).toEqual({ types: [], dps: [], configs: {} });
  });

  test('writes answer the registry after the save, and the next read is the seed again', async () => {
    const created = await get('POST /api/eng/devices', { body: { device: { name: 'Presse 3', protocol: 'modbus', accessModes: ['modbus'], bookIds: [] } } });
    expect(created.device).toMatchObject({ id: 'presse-3', name: 'Presse 3', state: 'unknown' });
    expect(created.devices).toHaveLength(5);
    expect((await get('DELETE /api/eng/devices/:id', { params: { id: 'z01-pompe2' } })).devices).toHaveLength(3);
    expect((await get('GET /api/eng/devices')).devices).toHaveLength(4);
    expect((await call('DELETE /api/eng/devices/:id', { params: { id: 'inconnu' } })).status).toBe(404);
    const deletion = await get('DELETE /api/eng/books/:id', { params: { id: 'book-catalogue-pompe' } });
    expect(deletion.devices.find((device) => device.id === 'z01-pompe1').bookIds).toEqual([]);
  });

  test('check-in reports every plan item, conflicts skipped', async () => {
    const plan = { workspace: 'Atelier_Fours', warnings: [], items: [{ kind: 'type', op: 'update', name: 'Equip_Four' }, { kind: 'dp', op: 'create', name: 'Z01_FOUR002', conflict: true }] };
    expect(await get('POST /api/eng/checkin', { body: { plan, dryRun: true } })).toEqual({
      ok: true,
      dryRun: true,
      results: [
        { kind: 'type', op: 'update', name: 'Equip_Four', status: 'applied' },
        { kind: 'dp', op: 'create', name: 'Z01_FOUR002', status: 'skipped' }
      ]
    });
  });

  test('what needs a live driver answers 503; searches and test-reads answer the demo project', async () => {
    expect((await call('POST /api/eng/browse/level', { body: { connection: 'Etiqueteuse' } })).status).toBe(503);
    expect((await call('POST /api/eng/books/ingest', { body: {} })).status).toBe(503);
    expect((await get('GET /api/eng/dps', { query: { pattern: '_NGA*' } })).dps).toEqual(['_NGA_G_EVENT', '_NGA_G_MEASURE', '_NGA_G_SLOW']);
    expect((await get('GET /api/eng/dps', { query: { pattern: 'Z01_*' } })).dps).toEqual(['Z01_FOUR001']);
    expect((await get('POST /api/eng/test-read', { body: { dpes: ['Z01_FOUR001.Mesures.Temperature', 'Z01_FOUR003.Etat.EnChauffe'] } })).results).toEqual([
      { dpe: 'Z01_FOUR001.Mesures.Temperature', value: 187.4, ok: true },
      { dpe: 'Z01_FOUR003.Etat.EnChauffe', value: null, ok: false }
    ]);
  });
});
