// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// The /api/ai routes of machine-fleet-3d against an in-memory WinCC OA: the
// MachineFleet3D_* DPs (in place of @winccoa/backend), the role guard (in place
// of the appSecurityGuard.ts copied at deploy time: a scripted requireRole that
// records what it guards), the AI controller (in place of wui-ai-kit's, copied
// at deploy time). Each route is called through the middleware chain
// aiRoute.ts builds, as ultimate-express would.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'ultimate-express';

const oa = vi.hoisted(() => ({
  /** dp → { type, values }. */
  dps: new Map<string, { type: string; values: Record<string, unknown> }>(),
  /** `<module>/<role>` refused to the caller. */
  denied: new Set<string>(),
  /** The guard's `(module, role)` calls, at route definition. */
  guarded: [] as [string, string][],
  fail: false
}));

vi.mock('@winccoa/backend', () => ({
  WsjServerGlobal: {
    winccoa: {
      dpTypes: (name: string) => ([...oa.dps.values()].some((dp) => dp.type === name) ? [name] : []),
      dpNames: (pattern: string, type: string) => {
        if (oa.fail) throw new Error('event manager gone');
        const re = new RegExp(`^${pattern.replaceAll('*', '.*')}$`);
        return [...oa.dps.entries()].filter(([dp, rec]) => re.test(dp) && rec.type === type).map(([dp]) => `System1:${dp}.`);
      },
      dpExists: (dp: string) => oa.dps.has(dp),
      dpGet: async (dpes: string | string[]) => {
        const read = (dpe: string): unknown => {
          const [dp, leaf] = dpe.split('.');
          return oa.dps.get(dp)?.values[leaf];
        };
        return Array.isArray(dpes) ? dpes.map(read) : read(dpes);
      }
    }
  }
}));

type Handler = (req: Request, res: Response, next: () => void) => unknown;

vi.mock('./appSecurityGuard', () => ({
  requireRole: (module: string, role: string): Handler => {
    oa.guarded.push([module, role]);
    return (_req, res, next) => {
      if (oa.denied.has(`${module}/${role}`)) res.status(403).json({ ok: false, error: `forbidden: role '${role}' of '${module}' required` });
      else next();
    };
  }
}));

vi.mock('./aiController', () => ({
  AiController: class {
    health: Handler = (_req, res) => res.json({ ok: true, service: 'ai' });
    chat: Handler = (_req, res) => res.json({ text: 'hi' });
  }
}));

const routes = vi.hoisted(() => new Map<string, Handler[]>());

vi.mock('ultimate-express', () => {
  const Router = () => {
    const add =
      (method: string) =>
      (path: string, ...handlers: Handler[]) =>
        routes.set(`${method} ${path}`, handlers);
    return { use: () => undefined, get: add('GET'), post: add('POST') };
  };
  return { Router, json: () => () => undefined };
});

const { AiRoute } = await import('./aiRoute');
AiRoute.routes();

interface Answer {
  status: number;
  body: Record<string, unknown>;
  reached: boolean;
}

async function call(route: string, params: Record<string, string> = {}): Promise<Answer> {
  const handlers = routes.get(route);
  if (!handlers) throw new Error(`no route ${route}`);
  const answer: Answer = { status: 200, body: {}, reached: false };
  const res = {
    status(code: number) {
      answer.status = code;
      return res;
    },
    json(value: Record<string, unknown>) {
      answer.body = value;
      return res;
    }
  };
  for (const [i, handler] of handlers.entries()) {
    let next = false;
    if (i === handlers.length - 1) answer.reached = true;
    await handler({ params, query: {}, headers: {} } as unknown as Request, res as unknown as Response, () => (next = true));
    if (i < handlers.length - 1 && !next) break;
  }
  return answer;
}

const atelier = (name: string, machines: number): string =>
  JSON.stringify({ id: 'stale', name, building: { length: 100 }, machines: Array.from({ length: machines }, (_, i) => ({ id: `m${i}`, name: `M${i}` })) });

beforeEach(() => {
  oa.dps.clear();
  oa.denied.clear();
  oa.fail = false;
  oa.dps.set('MachineFleet3D_usinage', { type: 'MachineFleet3D_Config', values: { name: 'Usinage', json: atelier('Usinage', 3) } });
  oa.dps.set('MachineFleet3D_soudage', { type: 'MachineFleet3D_Config', values: { name: 'Soudage', json: atelier('Soudage', 1) } });
  oa.dps.set('MachineFleet3D_vide', { type: 'MachineFleet3D_Config', values: { name: 'Vide', json: '' } });
  // Not ateliers: same prefix, other types.
  oa.dps.set('MachineFleet3D_StopCauses', { type: 'MachineFleet3D_StopCauses', values: { json: JSON.stringify([{ code: 'P1', description: 'Panne', classification: 'unplanned' }]) } });
  oa.dps.set('MachineFleet3D_Kpi_m0_trs', { type: 'MachineFleet3D_Kpi', values: { value: 87 } });
});

describe('/api/ai — the routes of machine-fleet-3d', () => {
  it('guards the atelier routes with the view role of machine-fleet-3d, and only them', () => {
    expect(oa.guarded).toEqual([
      ['machine-fleet-3d', 'view'],
      ['machine-fleet-3d', 'view']
    ]);
    expect(routes.get('GET /fleet/workshops')).toHaveLength(2);
    expect(routes.get('GET /fleet/workshops/:id')).toHaveLength(2);
    // The AI bridge stays as in wui-ai-kit.
    expect(routes.get('GET /health')).toHaveLength(1);
    expect(routes.get('POST /chat')).toHaveLength(1);
  });

  it('lists the ateliers server-side: id from the DP, name, machine count — sorted, nothing else', async () => {
    const { status, body } = await call('GET /fleet/workshops');
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      ateliers: [
        { id: 'soudage', name: 'Soudage', machineCount: 1 },
        { id: 'usinage', name: 'Usinage', machineCount: 3 }
      ]
    });
  });

  it('answers an empty list when the config type does not exist (nothing created)', async () => {
    for (const [dp, rec] of oa.dps) if (rec.type === 'MachineFleet3D_Config') oa.dps.delete(dp);
    expect((await call('GET /fleet/workshops')).body).toEqual({ ok: true, ateliers: [] });
  });

  it('serves one atelier in full with the stop-cause catalog', async () => {
    const { status, body } = await call('GET /fleet/workshops/:id', { id: 'usinage' });
    expect(status).toBe(200);
    expect(body.atelier).toMatchObject({ id: 'usinage', dp: 'MachineFleet3D_usinage', name: 'Usinage', building: { length: 100 } });
    expect((body.atelier as { machines: unknown[] }).machines).toHaveLength(3);
    expect(body.stopCauses).toEqual([{ code: 'P1', description: 'Panne', classification: 'unplanned' }]);
  });

  it('404 for an unknown id, a wildcard, an empty atelier, or a DP of another type', async () => {
    for (const id of ['nope', '*', 'usin*', 'vide', 'StopCauses', 'Kpi_m0_trs']) {
      const { status, body, reached } = await call('GET /fleet/workshops/:id', { id });
      expect(reached).toBe(true);
      expect(status, id).toBe(404);
      expect(body).toMatchObject({ ok: false, error: 'not-found' });
    }
  });

  it('403 without the view role: the reads are never reached', async () => {
    oa.denied.add('machine-fleet-3d/view');
    for (const [route, params] of [
      ['GET /fleet/workshops', {}],
      ['GET /fleet/workshops/:id', { id: 'usinage' }]
    ] as const) {
      const { status, body, reached } = await call(route, params);
      expect(status).toBe(403);
      expect(reached).toBe(false);
      expect(body).toMatchObject({ ok: false });
    }
  });

  it('503 { ok: false } when WinCC OA cannot be read', async () => {
    oa.fail = true;
    const { status, body } = await call('GET /fleet/workshops');
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: 'unavailable', message: 'event manager gone' });
  });
});
