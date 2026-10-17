// `wui dev`: the /api/app-security backend, mocked. The session user is the fixtures' own
// ("user": { "userName" }, else "dev"), an administrator in every group below — so every
// role reads as granted, as on a deployment where no admin has assigned groups yet.

const GROUPS = [
  { id: 1, name: 'Administrateurs' },
  { id: 2, name: 'Exploitants' },
  { id: 3, name: 'Maintenance' }
];

export default {
  'GET /api/app-security/health': () => ({ ok: true, service: 'app-security', mock: true }),

  'GET /api/app-security/me': ({ fixtures }) => ({
    ok: true,
    username: fixtures?.user?.userName ?? 'dev',
    userId: 0,
    admin: true,
    groups: GROUPS.map((group) => group.name)
  }),

  'GET /api/app-security/groups': () => ({ ok: true, groups: GROUPS })
};
