// The /api/ai/fleet mock of `wui dev`: the demonstration atelier without mock data (the same as
// the page's in-memory fallback, checked against its source), the mock data's own ateliers when
// it declares the type, and a 404 the element turns into "atelier not found".

import { describe, expect, test } from 'vitest';
import { DEMO_ATELIER } from '../../wui-fleet-core/src/data/demo-layout.ts';
import demo from './demo-ateliers.json';
import routes from './api.mjs';

const call = async (route, request) => {
  try {
    return { status: 200, body: await routes[route]({ query: {}, params: {}, fixtures: {}, ...request }) };
  } catch (error) {
    return { status: error.status ?? 500, body: error.body ?? { error: error.message } };
  }
};

const FIXTURES = {
  types: { MachineFleet3D_Config: { structure: { name: 'string', json: 'string' }, dps: ['System1:MachineFleet3D_usinage', 'MachineFleet3D_broken'] } },
  values: {
    'System1:MachineFleet3D_usinage.json': JSON.stringify({ id: 'x', name: 'Usinage', machines: [{ id: 'm1' }, { id: 'm2' }] }),
    'System1:MachineFleet3D_broken.json': 'not json',
    'System1:MachineFleet3D_StopCauses.json': JSON.stringify([{ code: 'NC', description: 'Hors catalogue', classification: 'unplanned', isDefault: true }])
  }
};

describe('the /api/ai/fleet mock', () => {
  test('the demo copy is the page’s demonstration atelier (wui-fleet-core DEMO_ATELIER)', () => {
    expect(demo).toEqual([JSON.parse(JSON.stringify(DEMO_ATELIER))]);
  });

  test('without mock data, the listing serves the demonstration atelier: id, name, machine count only', async () => {
    const { status, body } = await call('GET /api/ai/fleet/workshops');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, ateliers: [{ id: 'demo', name: DEMO_ATELIER.name, machineCount: DEMO_ATELIER.machines.length }] });
  });

  test('one atelier in full, with its dp and an empty catalog; 404 for an unknown id', async () => {
    const one = await call('GET /api/ai/fleet/workshops/:id', { params: { id: 'demo' } });
    expect(one.body.ok).toBe(true);
    expect(one.body.atelier).toMatchObject({ id: 'demo', dp: 'MachineFleet3D_demo', name: DEMO_ATELIER.name });
    expect(one.body.atelier.machines).toHaveLength(DEMO_ATELIER.machines.length);
    expect(one.body.stopCauses).toEqual([]);
    const missing = await call('GET /api/ai/fleet/workshops/:id', { params: { id: 'nope' } });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ ok: false, error: 'not-found' });
  });

  test('mock data that declares the type wins: its ateliers (id from the dp), its catalog', async () => {
    const list = await call('GET /api/ai/fleet/workshops', { fixtures: FIXTURES });
    expect(list.body.ateliers).toEqual([{ id: 'usinage', name: 'Usinage', machineCount: 2 }]);
    const one = await call('GET /api/ai/fleet/workshops/:id', { params: { id: 'usinage' }, fixtures: FIXTURES });
    expect(one.body.atelier).toMatchObject({ id: 'usinage', dp: 'MachineFleet3D_usinage', name: 'Usinage' });
    expect(one.body.stopCauses).toEqual([expect.objectContaining({ code: 'NC' })]);
    expect((await call('GET /api/ai/fleet/workshops/:id', { params: { id: 'demo' }, fixtures: FIXTURES })).status).toBe(404);
  });
});
