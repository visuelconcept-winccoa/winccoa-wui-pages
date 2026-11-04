// Edit and delete of a pmon entry (issue 40): the roles each route needs, and the controller's
// validation of an update.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { managerUpdateRequest, whenBodyFlag } from '../backend/processMonitorController.ts';

const route = fs.readFileSync(fileURLToPath(new URL('../backend/processMonitorRoute.ts', import.meta.url)), 'utf8');
const compact = route.replaceAll(/\s+/g, ' ');

/** A fake requireRole: records the role and lets the request through only when it is granted. */
const roleGuard = (granted, role, seen) => (_req, res, next) => {
  seen.push(role);
  if (granted.includes(role)) return next();
  res.status(403);
  return undefined;
};

/** Run a middleware chain the way the router does; resolves the HTTP status (200 when it reaches the end). */
function run(chain, body) {
  let status = 200;
  const res = { status: (n) => ((status = n), res), json: () => undefined };
  let i = 0;
  const next = () => {
    const mw = chain[i++];
    if (mw) mw({ body }, res, next);
  };
  next();
  return status;
}

describe('roles of the edit / delete routes', () => {
  it('update and remove need edit-managers; stopFirst and restart also need control', () => {
    expect(compact).toContain("router.post( '/manager/remove', requireRole(MODULE_ID, 'edit-managers'), whenBodyFlag('stopFirst', requireRole(MODULE_ID, 'control')), controller.managerRemove );");
    expect(compact).toContain("router.post( '/manager/update', requireRole(MODULE_ID, 'edit-managers'), whenBodyFlag('restart', requireRole(MODULE_ID, 'control')), controller.managerUpdate );");
    expect(compact).toContain("router.post('/manager/add', requireRole(MODULE_ID, 'edit-managers'), controller.managerAdd);");
  });

  it('a missing role refuses each action (403), the control role is only asked for a stop-first delete', () => {
    const chain = (granted, seen) => [roleGuard(granted, 'edit-managers', seen), whenBodyFlag('stopFirst', roleGuard(granted, 'control', seen)), () => undefined];
    let seen = [];
    expect(run(chain([], seen), { index: 3 })).toBe(403);
    seen = [];
    expect(run(chain(['edit-managers'], seen), { index: 3 })).toBe(200);
    expect(seen).toEqual(['edit-managers']);
    seen = [];
    expect(run(chain(['edit-managers'], seen), { index: 3, stopFirst: true })).toBe(403);
    expect(seen).toEqual(['edit-managers', 'control']);
    expect(run(chain(['edit-managers', 'control'], []), { index: 3, stopFirst: true })).toBe(200);
    expect(run(chain(['control'], []), { index: 3, stopFirst: true })).toBe(403);
  });

  it('only a literal true sets the flag', () => {
    const seen = [];
    const chain = [whenBodyFlag('restart', roleGuard([], 'control', seen)), () => undefined];
    expect(run(chain, { restart: 'true' })).toBe(200);
    expect(run(chain, { restart: 1 })).toBe(200);
    expect(seen).toEqual([]);
  });
});

describe('managerUpdateRequest', () => {
  const body = { node: 'System1:ProcessMonitor_Node_PC1', index: 4, name: 'WCCOActrl', startMode: 'manual', secKill: 60, restartCount: 5, resetMin: 10, options: ' -num 1\n-f x.lst ' };

  it('forwards a complete, bounded update; the name is only a check, never a new value', () => {
    expect(managerUpdateRequest({ ...body, restart: true })).toEqual({
      node: 'System1:ProcessMonitor_Node_PC1',
      index: 4,
      name: 'WCCOActrl',
      restart: true,
      manager: { startMode: 'manual', secKill: 60, restartCount: 5, resetMin: 10, options: '-num 1 -f x.lst' }
    });
    expect(managerUpdateRequest({ ...body, restart: 'yes' })).not.toHaveProperty('restart');
  });

  it('refuses pmon itself, a missing start mode and any value out of bounds — nothing is defaulted', () => {
    expect(managerUpdateRequest({ ...body, index: 0 })).toHaveProperty('error');
    expect(managerUpdateRequest({ ...body, startMode: undefined })).toHaveProperty('error');
    expect(managerUpdateRequest({ ...body, startMode: 'auto' })).toHaveProperty('error');
    expect(managerUpdateRequest({ ...body, secKill: 0 })).toHaveProperty('error');
    expect(managerUpdateRequest({ ...body, restartCount: 101 })).toHaveProperty('error');
    expect(managerUpdateRequest({ ...body, resetMin: undefined })).toHaveProperty('error');
    expect(managerUpdateRequest({ ...body, secKill: 1.5 })).toHaveProperty('error');
    expect(managerUpdateRequest(null)).toHaveProperty('error');
  });
});
