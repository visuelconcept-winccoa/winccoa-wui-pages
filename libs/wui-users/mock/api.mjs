// `wui dev`: the /api/users backend, mocked — a project authenticating with the Active
// Directory, a few users (root, two local, two from the AD), groups (two imported from the
// AD), two domains, and an AD of six users and four groups. Every write changes the in-memory
// state until the dev server restarts; "Run now" imports the new AD users of the AD-linked
// groups as the usersService manager does (existing users untouched).

const bits = (...levels) => Array.from({ length: 32 }, (_, i) => levels.includes(i + 1));
const httpError = (status, message) => Object.assign(new Error(message), { status });

const PERMISSION_NAMES = ['Visualisation', 'Conduite', 'Acquittement', 'Paramétrage', 'Administration', ...Array.from({ length: 27 }, () => '')];

const state = {
  authName: 'Windows',
  auths: ['Standard', 'Windows'],
  permissionNames: PERMISSION_NAMES,
  areas: [
    { id: 1, name: 'Atelier_A', fullName: 'Atelier A', comment: '', permissions: bits(1) },
    { id: 2, name: 'Utilites', fullName: 'Utilités', comment: 'Air, eau, vapeur', permissions: bits(1, 2) }
  ],
  groups: [
    { id: 1, name: 'Administrateurs', fullName: 'Administrateurs', comment: '', osId: '', permissions: bits(1, 2, 3, 4, 5), areas: [] },
    { id: 2, name: 'Exploitants', fullName: 'Exploitants', comment: 'Groupe AD', osId: 'S-1-5-21-100-201', permissions: bits(1, 2, 3), areas: [{ id: 1, permissions: bits(1, 2) }] },
    { id: 3, name: 'Maintenance', fullName: 'Maintenance', comment: 'Groupe AD', osId: 'S-1-5-21-100-202', permissions: bits(1, 4), areas: [{ id: 2, permissions: bits(1, 2, 4) }] }
  ],
  users: [
    { id: 0, name: 'root', fullName: 'Root', comment: '', enabled: true, language: '', osId: '', domain: '', groupIds: [1] },
    { id: 1, name: 'secours', fullName: 'Compte de secours', comment: 'Local', enabled: true, language: 'fr_FR.utf8', osId: '', domain: '', groupIds: [1] },
    { id: 2, name: 'para', fullName: 'Ingénieur PARA', comment: '', enabled: false, language: 'fr_FR.utf8', osId: '', domain: '', groupIds: [] },
    { id: 3, name: 'jdupont', fullName: 'Jean Dupont', comment: '', enabled: true, language: 'fr_FR.utf8', osId: 'S-1-5-21-100-1001', domain: 'USINE', groupIds: [2] },
    { id: 4, name: 'mmartin', fullName: 'Marie Martin', comment: '', enabled: true, language: 'fr_FR.utf8', osId: 'S-1-5-21-100-1002', domain: 'USINE', groupIds: [3] }
  ]
};

const AD_GROUPS = [
  { name: 'Exploitants', osId: 'S-1-5-21-100-201', comment: 'Conduite des lignes', local: false },
  { name: 'Maintenance', osId: 'S-1-5-21-100-202', comment: 'Maintenance', local: false },
  { name: 'Qualite', osId: 'S-1-5-21-100-203', comment: 'Service qualité', local: false },
  { name: 'Domain Users', osId: 'S-1-5-21-100-513', comment: '', local: false }
];

const AD_USERS = [
  { name: 'jdupont', osId: 'S-1-5-21-100-1001', comment: '', groups: ['Exploitants', 'Domain Users'] },
  { name: 'mmartin', osId: 'S-1-5-21-100-1002', comment: '', groups: ['Maintenance', 'Domain Users'] },
  { name: 'pdurand', osId: 'S-1-5-21-100-1003', comment: 'Équipe de nuit', groups: ['Exploitants', 'Domain Users'] },
  { name: 'lbernard', osId: 'S-1-5-21-100-1004', comment: '', groups: ['Maintenance', 'Domain Users'] },
  { name: 'cpetit', osId: 'S-1-5-21-100-1005', comment: 'Qualité', groups: ['Qualite', 'Domain Users'] },
  { name: 'svc_backup', osId: 'S-1-5-21-100-1006', comment: 'Compte de service', groups: ['Domain Users'] }
];

const importState = {
  settings: { enabled: false, intervalMin: 60, groups: [] },
  status: { running: false, lastRun: null, nextRunAt: null }
};

const nextId = (list) => Math.max(0, ...list.map((x) => x.id)) + 1;
const byId = (list, id, what) => list.find((x) => x.id === id) ?? (() => { throw httpError(404, `${what} introuvable`); })();
const lower = (s) => String(s).toLowerCase();
const groupIdsOf = (names) => state.groups.filter((g) => names.some((n) => lower(n) === lower(g.name))).map((g) => g.id);
const pick = (body, keys) => Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

function setMembers(groupId, memberIds) {
  for (const u of state.users) {
    const member = u.groupIds.includes(groupId);
    const wanted = memberIds.includes(u.id);
    if (member && !wanted) u.groupIds = u.groupIds.filter((id) => id !== groupId);
    if (!member && wanted) u.groupIds = [...u.groupIds, groupId];
  }
}

function createAdUser(adUser, groupNames) {
  const user = { id: nextId(state.users), name: adUser.name, fullName: adUser.name, comment: adUser.comment, enabled: true, language: '', osId: adUser.osId, domain: 'USINE', groupIds: groupIdsOf(groupNames) };
  state.users.push(user);
  return user;
}

/** The automatic import, as usersService runs it. */
function runImport(trigger) {
  const target = state.groups.filter((g) => g.osId && (importState.settings.groups.length === 0 || importState.settings.groups.includes(g.name)));
  const report = { trigger, by: trigger === 'manual' ? 'dev' : '', startedAt: new Date().toISOString(), finishedAt: '', ok: true, created: [], skippedExisting: 0, skippedNoGroup: 0, errors: [], message: target.length === 0 ? 'no-target-group' : '' };
  for (const ad of target.length === 0 ? [] : AD_USERS) {
    if (state.users.some((u) => lower(u.name) === lower(ad.name))) report.skippedExisting++;
    else {
      const matched = ad.groups.filter((g) => target.some((t) => lower(t.name) === lower(g)));
      if (matched.length === 0) report.skippedNoGroup++;
      else report.created.push(createAdUser(ad, matched).name);
    }
  }
  report.finishedAt = new Date().toISOString();
  importState.status = {
    running: false,
    lastRun: report,
    nextRunAt: importState.settings.enabled ? new Date(Date.now() + importState.settings.intervalMin * 60_000).toISOString() : null
  };
}

const ok = (extra = {}) => ({ ok: true, ...extra });

export default {
  'GET /api/users/health': () => ({
    ok: true,
    serviceAvailable: true,
    vrpc: true,
    service: 'WuiUsers',
    version: '0.1.0 (mock)',
    system: 'System1:',
    userId: 0,
    userName: 'root',
    level: 5,
    canManage: true,
    commandChannel: true,
    authName: state.authName,
    auths: state.auths,
    auditDp: 'AuditTrail_Users',
    auditDpExists: false
  }),

  'GET /api/users/state': () => ok(structuredClone(state)),

  'POST /api/users/users/create': ({ body }) => {
    if (!body?.name) throw httpError(400, 'name requis');
    if (state.users.some((u) => lower(u.name) === lower(body.name))) throw httpError(409, `user exists: ${body.name}`);
    if (!body.password || body.password.length < 12) throw httpError(409, 'Password does not meet the password policy');
    const user = { id: nextId(state.users), fullName: '', comment: '', language: '', osId: '', domain: '', groupIds: [], enabled: true, ...pick(body, ['name', 'fullName', 'comment', 'language', 'enabled', 'groupIds']) };
    state.users.push(user);
    return ok({ id: user.id });
  },
  'POST /api/users/users/update': ({ body }) => {
    const user = byId(state.users, body?.id, 'utilisateur');
    Object.assign(user, pick(body, ['name', 'fullName', 'comment', 'language', 'enabled', 'groupIds']));
    return ok({ id: user.id });
  },
  'POST /api/users/users/password': ({ body }) => {
    const user = byId(state.users, body?.id, 'utilisateur');
    if (user.osId) throw httpError(409, 'No permission to change password');
    if (!body.password || body.password.length < 12) throw httpError(409, 'Password does not meet the password policy');
    return ok();
  },
  'POST /api/users/users/delete': ({ body }) => {
    if (body?.id === 0) throw httpError(400, 'root ne se supprime pas');
    byId(state.users, body?.id, 'utilisateur');
    state.users = state.users.filter((u) => u.id !== body.id);
    return ok();
  },

  'POST /api/users/groups/create': ({ body }) => {
    if (state.groups.some((g) => lower(g.name) === lower(body?.name))) throw httpError(409, `group exists: ${body.name}`);
    const group = { id: nextId(state.groups), fullName: body.name, comment: '', osId: '', permissions: bits(), areas: [], ...pick(body, ['name', 'fullName', 'comment', 'permissions', 'areas']) };
    state.groups.push(group);
    if (body.memberIds) setMembers(group.id, body.memberIds);
    return ok({ id: group.id });
  },
  'POST /api/users/groups/update': ({ body }) => {
    const group = byId(state.groups, body?.id, 'groupe');
    Object.assign(group, pick(body, ['name', 'fullName', 'comment', 'permissions', 'areas']));
    if (body.memberIds) setMembers(group.id, body.memberIds);
    return ok({ id: group.id });
  },
  'POST /api/users/groups/delete': ({ body }) => {
    byId(state.groups, body?.id, 'groupe');
    setMembers(body.id, []);
    state.groups = state.groups.filter((g) => g.id !== body.id);
    return ok();
  },
  'POST /api/users/permissions/names': ({ body }) => {
    if (!Array.isArray(body?.names) || body.names.length !== 32) throw httpError(400, 'names : 32 textes');
    state.permissionNames = body.names;
    return ok();
  },

  'POST /api/users/areas/create': ({ body }) => {
    const area = { id: nextId(state.areas), fullName: body.name, comment: '', permissions: bits(), ...pick(body, ['name', 'fullName', 'comment', 'permissions']) };
    state.areas.push(area);
    return ok({ id: area.id });
  },
  'POST /api/users/areas/update': ({ body }) => {
    Object.assign(byId(state.areas, body?.id, 'domaine'), pick(body, ['name', 'fullName', 'comment', 'permissions']));
    return ok();
  },
  'POST /api/users/areas/delete': ({ body }) => {
    byId(state.areas, body?.id, 'domaine');
    for (const g of state.groups) g.areas = g.areas.filter((a) => a.id !== body.id);
    state.areas = state.areas.filter((a) => a.id !== body.id);
    return ok();
  },

  'POST /api/users/auth/mode': ({ body }) => {
    if (!state.auths.includes(body?.mode)) throw httpError(409, `authentication method not available here: ${body?.mode}`);
    state.authName = body.mode;
    return ok({ authName: state.authName });
  },

  'GET /api/users/ad/groups': () => {
    if (state.authName !== 'Windows') throw httpError(409, 'the configured authentication is not Active Directory');
    return ok({ groups: AD_GROUPS.map((g) => ({ ...g, imported: state.groups.some((x) => x.osId === g.osId || lower(x.name) === lower(g.name)) })) });
  },
  'POST /api/users/ad/groups/import': ({ body }) => {
    const created = [];
    for (const g of AD_GROUPS.filter((x) => body?.names?.includes(x.name))) {
      if (state.groups.some((x) => lower(x.name) === lower(g.name))) continue;
      state.groups.push({ id: nextId(state.groups), name: g.name, fullName: g.name, comment: g.comment, osId: g.osId, permissions: bits(1), areas: [] });
      created.push(g.name);
    }
    return ok({ created });
  },
  'GET /api/users/ad/users': () => {
    if (state.authName !== 'Windows') throw httpError(409, 'the configured authentication is not Active Directory');
    return ok({ users: AD_USERS.map(({ groups: _groups, ...u }) => ({ ...u, imported: state.users.some((x) => lower(x.name) === lower(u.name)) })) });
  },
  'POST /api/users/ad/users/import': ({ body }) => {
    const result = { ok: true, created: [], noGroup: [], errors: [] };
    for (const ad of AD_USERS.filter((u) => body?.names?.includes(u.name))) {
      if (state.users.some((u) => lower(u.name) === lower(ad.name))) continue;
      const groups = ad.groups.filter((g) => state.groups.some((x) => lower(x.name) === lower(g)));
      if (groups.length === 0) result.noGroup.push(ad.name);
      else result.created.push(createAdUser(ad, groups).name);
    }
    return result;
  },

  'GET /api/users/import': () => ok(structuredClone(importState)),
  'POST /api/users/import/settings': ({ body }) => {
    if (typeof body?.enabled !== 'boolean' || !Number.isInteger(body?.intervalMin) || body.intervalMin < 60) throw httpError(400, 'intervalMin (60–10080 min) requis');
    importState.settings = { enabled: body.enabled, intervalMin: body.intervalMin, groups: body.groups ?? [] };
    importState.status.nextRunAt = body.enabled ? new Date(Date.now() + 60_000).toISOString() : null;
    return ok(structuredClone(importState));
  },
  'POST /api/users/import/run': () => {
    runImport('manual');
    return ok({ started: true, status: importState.status });
  },

  'GET /api/users/settings': () =>
    ok({
      config: [
        { section: 'auth', key: 'passwordPolicy', value: null, default: '1' },
        { section: 'auth', key: 'lowestUserId', value: null, default: '0' },
        { section: 'ui', key: 'checkADAuthIntervall', value: '120', default: '60' },
        { section: 'ui', key: 'modifyGroups', value: '0', default: '1' },
        { section: 'ui', key: 'modifyUsers', value: null, default: '1' },
        { section: 'ui', key: 'assignUserGroups', value: null, default: '1' },
        { section: 'webClient', key: 'allowUnknownUsers', value: '0', default: '1' },
        { section: 'webClient', key: 'checkPassword', value: '1', default: '0' },
        { section: 'webClient', key: 'allowDisabledUsers', value: null, default: '0' },
        { section: 'importADGroupUsers', key: 'interval', value: null, default: '—' },
        { section: 'wui-users', key: 'auditDp', value: null, default: 'AuditTrail_Users' }
      ],
      userSettings: [
        { name: 'RFID_UID', fullName: 'Badge', format: 'S', masked: true, base: null, groups: [], users: [{ id: 3, content: null }] },
        { name: 'TREND_PERIOD', fullName: 'Période des courbes', format: 'S', masked: false, base: ['1h'], groups: [{ id: 3, content: ['8h'] }], users: [{ id: 4, content: ['24h'] }] }
      ]
    })
};
