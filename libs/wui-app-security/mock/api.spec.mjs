import { expect, test } from 'vitest';
import routes from './api.mjs';

test('the session user is the fixtures\' one, an administrator in every group', () => {
  expect(routes['GET /api/app-security/me']({ fixtures: { user: { userName: 'exploitant' } } })).toEqual({
    ok: true,
    username: 'exploitant',
    userId: 0,
    admin: true,
    groups: ['Administrateurs', 'Exploitants', 'Maintenance']
  });
  expect(routes['GET /api/app-security/me']({}).username).toBe('dev');
  expect(routes['GET /api/app-security/groups']().groups.map((group) => group.name)).toEqual(['Administrateurs', 'Exploitants', 'Maintenance']);
});
