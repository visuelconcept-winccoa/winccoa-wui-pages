// Deleting a host instance (issue 39): the route is guarded by its own role, declared in the
// module's fragment, and the controller refuses a body that does not name exactly one node DP.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { instanceDeleteTarget } from '../backend/processMonitorController.ts';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('POST /instance/delete', () => {
  it('is wrapped with requireRole(process-monitor, manage-instances) — a caller without the role gets 403', () => {
    const route = read('../backend/processMonitorRoute.ts');
    expect(route).toMatch(/const MODULE_ID = 'process-monitor';/);
    expect(route).toMatch(/router\.post\('\/instance\/delete', requireRole\(MODULE_ID, 'manage-instances'\), controller\.instanceDelete\);/);
  });

  it('the role is declared in the module fragment, in en / fr / de', () => {
    const roles = JSON.parse(read('../src/app-security.roles.json'));
    const role = roles.roles.find((r) => r.id === 'manage-instances');
    expect(role).toBeTruthy();
    expect(Object.keys(role.label).sort()).toEqual(['de.utf8', 'en_US.utf8', 'fr.utf8']);
    expect(Object.keys(role.description).sort()).toEqual(['de.utf8', 'en_US.utf8', 'fr.utf8']);
  });

  it('the controller only forwards one named node DP, never "all" or an empty target', () => {
    expect(instanceDeleteTarget({ node: 'System1:ProcessMonitor_Node_PC2' })).toBe('System1:ProcessMonitor_Node_PC2');
    expect(instanceDeleteTarget({ node: '  ProcessMonitor_Node_PC2 ' })).toBe('ProcessMonitor_Node_PC2');
    for (const body of [undefined, null, {}, { node: '' }, { node: 'all' }, { node: 'ALL' }, { node: 42 }, { node: 'PC2' }]) {
      expect(instanceDeleteTarget(body)).toBeNull();
    }
  });
});

describe('who asks (issue 53)', () => {
  it('forwards the session user first, the host the page was served from, and the user the page declares', async () => {
    const { actorOf } = await import('../backend/processMonitorController.ts');
    expect(actorOf({ headers: { host: 'scada.local:8443' }, body: { clientUser: { name: 'page', id: 9 } } }, { username: 'srv', userId: 7 })).toEqual({
      username: 'srv',
      userId: 7,
      host: 'scada.local',
      clientUser: { name: 'page', id: 9 }
    });
    expect(actorOf({ headers: {}, body: {} }, { username: '', userId: -1 })).toEqual({ username: '', userId: -1, host: '' });
  });
});
