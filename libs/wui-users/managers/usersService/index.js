// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * Users — WinCC OA JavaScript manager hosting the MSA vRPC service "WuiUsers": the
 * ONE writer of the project's user administration for the /users page, and the
 * automatic Active Directory import (importADGroupUsers.ctl, rebuilt here).
 *
 *   WebUI (browser) ──HTTP /api/users/*──▶ dashboard webserver (role gate, vRPC stub)
 *                                               │  MSA vRPC
 *                                               ▼
 *                                     this manager: service "WuiUsers"
 *                                               │  WinccoaCtrlScript (ctrl.js)
 *                                               ▼
 *                     UserManagement / OaAuthFactory / UpdateUserGroups (CTRL)
 *                                               │  _CommandChannel (encrypted commands)
 *                                               ▼
 *                     commandChannel manager → _Users / _Groups / _Areas
 *
 * Users, groups, domains (areas), permission bits and their names are changed
 * through the vendor's UserManagement classes only — never a dpSet on _Users.
 * The commandChannel manager checks the permission of the user THIS manager runs
 * as: start it with a user that has the user-administration permission level
 * (`_System.Auth.UserManagement`), e.g. `-user <name>:<password>` in pmon, or root
 * on a project without server-side authentication. `Health` says whether it has it.
 *
 * Writes are serialised (one UserManagement instance, whose local changes a
 * concurrent save would otherwise send); AD listings run beside them.
 *
 * The automatic import (settings and last report in the DP WuiUsers_Config):
 *   - off by default; every `intervalMin` minutes (60 at least) when on, and on demand;
 *   - target groups: the WinCC OA groups imported from the AD (OSID set),
 *     restricted to a selection when one is saved;
 *   - every AD user that is not a WinCC OA user yet and belongs to at least one
 *     target group is created, linked by its OSID, in those groups;
 *   - existing users are left alone (WCCOAupdateUserGroups maintains them), no
 *     group is created, root is never touched;
 *   - AD users found in no target group are not asked again while the target group
 *     set does not change.
 *
 * Every change is written to an `_AuditTrail` DP when it exists: `auditDp` of the
 * [wui-users] section of config/config, else WUI_USERS_AUDIT_DP, else AuditTrail_Users.
 *
 * Register in config/progs:
 *   node | always | 30 | 3 | 1 |usersService/index.js -user <admin>:<password>
 *
 * After editing this file, restart the manager.
 */
const fs = require('node:fs');
const { WinccoaCtrlScript, WinccoaCtrlType, WinccoaDpTypeNode, WinccoaManager, Vrpc } = require('winccoa-manager');
const { createCtrl } = require('./ctrl.js');
const {
  DEFAULT_SETTINGS,
  groupSetKey,
  groupUserSettings,
  importCandidates,
  matchGroups,
  normalizeSettings,
  settingsRequest,
  targetGroups,
  validate
} = require('./logic.js');

const VERSION = '0.1.0';
const SERVICE_NAME = 'WuiUsers';
const CONFIG_TYPE = 'WuiUsers_Config';
const CONFIG_DP = 'WuiUsers_Config';
const ELEM = { Struct: 1, String: 25 };
/** AD users asked for their groups per CTRL call. */
const GROUP_BATCH = 50;
/** An AD listing is reused this long by the manual imports (the page lists, then imports). */
const AD_CACHE_MS = 5 * 60 * 1000;
const TICK_MS = 60 * 1000;

const winccoa = new WinccoaManager();
const ctrl = createCtrl(winccoa, WinccoaCtrlScript, WinccoaCtrlType);

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[WuiUsers] ${msg}`);
}

// ---- serialised writes ----------------------------------------------------------------

let chain = Promise.resolve();

/** Run `fn` after every write queued before it. */
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

const write = (fn, req) => serial(() => ctrl.call(fn, req));

// ---- project config file ----------------------------------------------------------------

/**
 * The project's config file (PVSS_II, `config/config`) as section → key → value,
 * the last occurrence winning as WinCC OA reads it.
 */
function readProjectConfig() {
  const file = process.env.PVSS_II;
  const sections = {};
  if (!file) return sections;
  let textContent;
  try {
    textContent = fs.readFileSync(file, 'utf8');
  } catch {
    return sections;
  }
  let current = '';
  for (const raw of textContent.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) continue;
    const header = /^\[([^\]]+)\]/.exec(line);
    if (header) {
      current = header[1].trim();
      continue;
    }
    const entry = /^([A-Za-z_][\w.]*)\s*=\s*(?:"([^"]*)"|(\S+))/.exec(line);
    if (entry) (sections[current] ??= {})[entry[1]] = entry[2] ?? entry[3];
  }
  return sections;
}

/** The entries of config/config that drive the user administration, shown read-only. */
const CONFIG_KEYS = [
  ['auth', 'passwordPolicy', '1'],
  ['auth', 'lowestUserId', '0'],
  ['ui', 'checkADAuthIntervall', '60'],
  ['ui', 'modifyGroups', '1'],
  ['ui', 'modifyUsers', '1'],
  ['ui', 'assignUserGroups', '1'],
  ['webClient', 'allowUnknownUsers', '1'],
  ['webClient', 'checkPassword', '0'],
  ['webClient', 'allowDisabledUsers', '0'],
  ['importADGroupUsers', 'interval', '—'],
  ['wui-users', 'auditDp', 'AuditTrail_Users']
];

// ---- audit -------------------------------------------------------------------------------

const AUDIT_DP = readProjectConfig()['wui-users']?.auditDp ?? process.env.WUI_USERS_AUDIT_DP ?? 'AuditTrail_Users';
const AUDIT_LEAVES = ['time', 'username', 'uinum', 'batchid', 'item', 'itemtype', 'action', 'oldval', 'newval', 'reason', 'host'];
let lastAuditTime = 0;

/** One line in the audit trail — never a password. Never throws. */
async function audit({ actor, action, item = '', oldval = '', newval = '', reason = '' }) {
  try {
    if (!winccoa.dpExists(AUDIT_DP)) return;
    lastAuditTime = Math.max(Date.now(), lastAuditTime + 1);
    const values = [
      new Date(lastAuditTime),
      actor?.username || 'WuiUsers',
      Number.isInteger(actor?.userId) ? actor.userId : 0,
      0,
      item,
      'Utilisateurs',
      action,
      typeof oldval === 'string' ? oldval : JSON.stringify(oldval),
      typeof newval === 'string' ? newval : JSON.stringify(newval),
      reason,
      actor?.host ?? ''
    ];
    await winccoa.dpSetWait(
      AUDIT_LEAVES.map((leaf) => `${AUDIT_DP}.${leaf}`),
      values
    );
  } catch (error) {
    log(`audit line not written: ${error.message}`);
  }
}

// ---- settings and status DP ----------------------------------------------------------------

let settings = { ...DEFAULT_SETTINGS };
let status = { running: false, lastRun: null, nextRunAt: null };

async function ensureConfigDp() {
  if (!winccoa.dpTypeExists?.(CONFIG_TYPE)) {
    try {
      await winccoa.dpTypeCreate(
        new WinccoaDpTypeNode(CONFIG_TYPE, ELEM.Struct, '', [new WinccoaDpTypeNode('settings', ELEM.String), new WinccoaDpTypeNode('status', ELEM.String)])
      );
      log(`type ${CONFIG_TYPE} created`);
    } catch {
      // already exists
    }
  }
  if (!winccoa.dpExists(CONFIG_DP)) {
    await winccoa.dpCreate(CONFIG_DP, CONFIG_TYPE);
    log(`DP ${CONFIG_DP} created`);
  }
}

function unwrap(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw ? raw.value : raw;
}

async function loadSettings() {
  try {
    const raw = unwrap(await winccoa.dpGet(`${CONFIG_DP}.settings`));
    settings = normalizeSettings(typeof raw === 'string' && raw.trim() ? JSON.parse(raw) : {});
  } catch (error) {
    log(`settings not read, defaults used: ${error.message}`);
    settings = { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings() {
  await winccoa.dpSetWait(`${CONFIG_DP}.settings`, JSON.stringify(settings));
}

async function saveStatus() {
  try {
    await winccoa.dpSetWait(`${CONFIG_DP}.status`, JSON.stringify(status));
  } catch (error) {
    log(`status not written: ${error.message}`);
  }
}

// ---- Active Directory listings --------------------------------------------------------------

const adCache = { groups: null, users: null };

/** The AD groups or users, from the cache when fresh (or when `fresh` is false). */
async function adListing(kind, fresh) {
  const cached = adCache[kind];
  if (!fresh && cached && Date.now() - cached.at < AD_CACHE_MS) return cached.list;
  const res = await ctrl.call(kind === 'groups' ? 'adGroups' : 'adUsers', {});
  if (!res.ok) throw new Error(res.error);
  const list = res[kind] ?? [];
  adCache[kind] = { at: Date.now(), list };
  return list;
}

async function snapshot() {
  const snap = await serial(() => ctrl.call('snapshot'));
  if (!snap.ok) throw new Error(snap.error ?? 'snapshot refused');
  return snap;
}

/** The groups of AD users that exist in WinCC OA, by batch: name → { ok, groups, error }. */
async function adGroupsOf(users) {
  const out = new Map();
  for (let i = 0; i < users.length; i += GROUP_BATCH) {
    const batch = users.slice(i, i + GROUP_BATCH).map((u) => ({ name: u.name, osId: u.osId }));
    const res = await ctrl.call('adUserGroups', { users: batch });
    if (!res.ok) throw new Error(res.error);
    for (const r of res.users ?? []) out.set(r.name, r);
  }
  return out;
}

/** Create one AD user in its groups; audited. */
async function createAdUser(user, groups, actor, reason) {
  const res = await write('adCreateUser', { name: user.name, osId: user.osId, comment: user.comment ?? '', groups });
  if (res.ok) await audit({ actor, action: 'UTILISATEUR_IMPORTE_AD', item: user.name, newval: { osId: user.osId, groups }, reason });
  return res;
}

// ---- automatic import ------------------------------------------------------------------------

const noGroupSeen = new Set();
let lastGroupSetKey = '';

async function runImport(trigger, actor) {
  if (status.running) return;
  const startedAt = new Date().toISOString();
  status = { ...status, running: true };
  await saveStatus();
  const report = { trigger, by: actor?.username ?? '', startedAt, finishedAt: '', ok: false, created: [], skippedExisting: 0, skippedNoGroup: 0, errors: [], message: '' };
  try {
    const snap = await snapshot();
    const target = targetGroups(snap.groups, settings.groups);
    if (target.size === 0) {
      report.ok = true;
      report.message = 'no-target-group';
      return;
    }
    const key = groupSetKey(target);
    if (key !== lastGroupSetKey) {
      noGroupSeen.clear();
      lastGroupSetKey = key;
    }
    const adUsers = await adListing('users', true);
    const { candidates, skippedExisting, skippedNoGroup } = importCandidates(adUsers, snap.users, noGroupSeen);
    report.skippedExisting = skippedExisting;
    report.skippedNoGroup = skippedNoGroup;
    const groupsOf = await adGroupsOf(candidates);
    for (const user of candidates) {
      const found = groupsOf.get(user.name);
      if (!found?.ok) {
        // not cached: asked again at the next cycle
        report.errors.push(`${user.name}: ${found?.error || 'groups not read'}`);
        continue;
      }
      const matched = matchGroups(found.groups ?? [], target);
      if (matched.length === 0) {
        noGroupSeen.add(user.name.toLowerCase());
        report.skippedNoGroup++;
        continue;
      }
      const res = await createAdUser(user, matched, actor, trigger === 'auto' ? 'import AD automatique' : 'import AD lancé à la demande');
      if (res.ok) report.created.push(user.name);
      else report.errors.push(`${user.name}: ${res.error}`);
    }
    report.ok = report.errors.length === 0;
  } catch (error) {
    report.errors.push(error.message);
    report.message = 'failed';
  } finally {
    report.finishedAt = new Date().toISOString();
    log(
      `import (${trigger}): created ${report.created.length}, skipped (no target group) ${report.skippedNoGroup}, ` +
        `skipped (already in OA) ${report.skippedExisting}, errors ${report.errors.length}${report.message ? ` — ${report.message}` : ''}`
    );
    report.errors = report.errors.slice(0, 50);
    status = { running: false, lastRun: report, nextRunAt: nextRun(Date.parse(report.finishedAt)) };
    await saveStatus();
  }
}

function nextRun(from) {
  return settings.enabled ? new Date(from + settings.intervalMin * 60 * 1000).toISOString() : null;
}

function tick() {
  if (!settings.enabled || status.running) return;
  if (status.nextRunAt === null) {
    status.nextRunAt = new Date(Date.now() + TICK_MS).toISOString();
    void saveStatus();
    return;
  }
  if (Date.now() >= Date.parse(status.nextRunAt)) void runImport('auto', null);
}

// ---- the service ------------------------------------------------------------------------------

/** Remove what never goes to the audit trail. */
function withoutSecrets(req) {
  const { password: _password, ...rest } = req;
  return rest;
}

const ITEM_OF = {
  user: (snap, id) => snap.users.find((u) => u.id === id),
  group: (snap, id) => snap.groups.find((g) => g.id === id),
  area: (snap, id) => snap.areas.find((a) => a.id === id)
};

/** What each write is audited as: [action, kind of the object it targets]. */
const AUDIT_OF = {
  userCreate: ['UTILISATEUR_CREE', 'user'],
  userUpdate: ['UTILISATEUR_MODIFIE', 'user'],
  userPassword: ['MOT_DE_PASSE_DEFINI', 'user'],
  userDelete: ['UTILISATEUR_SUPPRIME', 'user'],
  groupCreate: ['GROUPE_CREE', 'group'],
  groupUpdate: ['GROUPE_MODIFIE', 'group'],
  groupDelete: ['GROUPE_SUPPRIME', 'group'],
  areaCreate: ['DOMAINE_CREE', 'area'],
  areaUpdate: ['DOMAINE_MODIFIE', 'area'],
  areaDelete: ['DOMAINE_SUPPRIME', 'area'],
  permissionNames: ['NOMS_DROITS_MODIFIES', null],
  authMode: ['MODE_AUTHENTIFICATION_MODIFIE', null]
};

/** One write of the page: validated, executed in turn, audited with the state before. */
async function writeOp({ op, body, actor, reason }) {
  if (!AUDIT_OF[op]) return { ok: false, error: `opération inconnue : ${op}` };
  const v = validate(op, body);
  if (v.error) return { ok: false, error: v.error, status: 400 };
  return serial(async () => {
    const before = await ctrl.call('snapshot');
    if (!before.ok) return before;
    const [action, kind] = AUDIT_OF[op];
    const old = kind && v.req.id !== undefined ? ITEM_OF[kind](before, v.req.id) : undefined;
    if (kind && v.req.id !== undefined && !old) return { ok: false, error: 'introuvable', status: 404 };
    const oldval = op === 'permissionNames' ? before.permissionNames : op === 'authMode' ? before.authName : (old ?? '');
    const res = await ctrl.call(op, v.req);
    if (res.ok) {
      const item = old?.name ?? v.req.name ?? (op === 'authMode' ? v.req.mode : '');
      await audit({ actor, action, item, oldval, newval: withoutSecrets(v.req), reason: reason ?? '' });
      if (op === 'authMode') adCache.groups = adCache.users = null;
    }
    return res;
  });
}

async function listAdGroups({ fresh }) {
  const [list, snap] = await Promise.all([adListing('groups', fresh !== false), snapshot()]);
  const byOsId = new Set(snap.groups.map((g) => g.osId).filter(Boolean));
  const byName = new Set(snap.groups.map((g) => g.name.toLowerCase()));
  return {
    ok: true,
    groups: list
      .map((g) => ({ ...g, imported: byOsId.has(g.osId) || byName.has(String(g.name).toLowerCase()) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}

async function listAdUsers({ fresh }) {
  const [list, snap] = await Promise.all([adListing('users', fresh !== false), snapshot()]);
  const existing = new Set(snap.users.map((u) => u.name.toLowerCase()));
  return {
    ok: true,
    users: list.map((u) => ({ ...u, imported: existing.has(String(u.name).toLowerCase()) })).sort((a, b) => a.name.localeCompare(b.name))
  };
}

async function importAdGroups({ body, actor }) {
  const v = validate('adImportGroups', body);
  if (v.error) return { ok: false, error: v.error, status: 400 };
  const wanted = new Set(v.req.names);
  const picked = (await adListing('groups', false)).filter((g) => wanted.has(g.name));
  if (picked.length === 0) return { ok: false, error: 'aucun de ces groupes dans l’AD', status: 404 };
  const res = await write('adImportGroups', { groups: picked });
  if (res.ok) {
    for (const name of res.created ?? []) {
      const g = picked.find((p) => p.name === name);
      await audit({ actor, action: 'GROUPE_IMPORTE_AD', item: name, newval: { osId: g?.osId ?? '' } });
    }
  }
  return res;
}

/** Manual import of AD users: each in the WinCC OA groups it already belongs to; none without a group (the panel refuses them too). */
async function importAdUsers({ body, actor }) {
  const v = validate('adImportUsers', body);
  if (v.error) return { ok: false, error: v.error, status: 400 };
  const wanted = new Set(v.req.names);
  const picked = (await adListing('users', false)).filter((u) => wanted.has(u.name));
  if (picked.length === 0) return { ok: false, error: 'aucun de ces utilisateurs dans l’AD', status: 404 };
  const groupsOf = await adGroupsOf(picked);
  const result = { ok: true, created: [], noGroup: [], errors: [] };
  for (const user of picked) {
    const found = groupsOf.get(user.name);
    if (!found?.ok) result.errors.push(`${user.name}: ${found?.error || 'groups not read'}`);
    else if ((found.groups ?? []).length === 0) result.noGroup.push(user.name);
    else {
      const res = await createAdUser(user, found.groups, actor, 'import AD manuel');
      if (res.ok) result.created.push(user.name);
      else result.errors.push(`${user.name}: ${res.error}`);
    }
  }
  result.ok = result.errors.length === 0;
  return result;
}

async function setImportSettings({ body, actor }) {
  const v = settingsRequest(body);
  if (v.error) return { ok: false, error: v.error, status: 400 };
  const before = settings;
  settings = v.settings;
  await saveSettings();
  status = { ...status, nextRunAt: settings.enabled ? (before.enabled ? status.nextRunAt : null) : null };
  if (settings.enabled && before.enabled && before.intervalMin !== settings.intervalMin && status.lastRun?.finishedAt) {
    status.nextRunAt = nextRun(Date.parse(status.lastRun.finishedAt));
  }
  await saveStatus();
  await audit({ actor, action: 'IMPORT_AD_CONFIGURE', item: CONFIG_DP, oldval: before, newval: settings });
  return { ok: true, settings, status };
}

async function startImport({ actor }) {
  if (status.running) return { ok: true, started: false, status };
  void runImport('manual', actor);
  return { ok: true, started: true, status: { ...status, running: true } };
}

/** The user settings (`_UserDefinedSettings`), read-only, sensitive contents masked. */
async function userSettings() {
  const dps = ['_uss_*', '_usg_*', '_usr_*'].flatMap((pattern) => winccoa.dpNames(pattern, '_UserDefinedSettings'));
  if (dps.length === 0) return { ok: true, settings: [] };
  const [contents, fullNames, formats] = await Promise.all(
    ['Content', 'FullName', 'Format'].map(async (leaf) => [].concat(unwrap(await winccoa.dpGet(dps.map((dp) => `${dp}.${leaf}`)))))
  );
  const entries = dps.map((dp, i) => ({
    dp,
    content: [].concat(unwrap(contents[i]) ?? []).filter((v) => String(v).trim() !== ''),
    fullName: asText(unwrap(fullNames[i])),
    format: String(unwrap(formats[i]) ?? '')
  }));
  return { ok: true, settings: groupUserSettings(entries) };
}

function asText(raw) {
  if (raw && typeof raw === 'object') {
    const first = Object.values(raw)[0];
    return first === undefined ? '' : String(first);
  }
  return raw === undefined || raw === null ? '' : String(raw);
}

function projectSettings() {
  const config = readProjectConfig();
  return {
    ok: true,
    config: CONFIG_KEYS.map(([section, key, fallback]) => ({ section, key, value: config[section]?.[key] ?? null, default: fallback }))
  };
}

async function health() {
  const res = await ctrl.call('health');
  return { ...res, version: VERSION, service: SERVICE_NAME, auditDp: AUDIT_DP, auditDpExists: winccoa.dpExists(AUDIT_DP) };
}

function parseReq(request) {
  if (!request.isString() || request.isNull()) throw new Error('la requête doit être une chaîne JSON');
  return JSON.parse(request.getString() || '{}');
}

function reply(obj) {
  return Vrpc.Variant.createString(JSON.stringify(obj));
}

function jsonHandler(fn) {
  return async (ctx, request) => {
    ctx.cancelSignal.throwIfAborted();
    try {
      return reply(await fn(parseReq(request)));
    } catch (error) {
      return reply({ ok: false, error: error.message });
    }
  };
}

class UsersService extends Vrpc.ServiceBase {
  constructor() {
    super(SERVICE_NAME);
    this.registerFunction('Health', jsonHandler(() => health()));
    this.registerFunction('Snapshot', jsonHandler(() => snapshot()));
    this.registerFunction('Write', jsonHandler((r) => writeOp(r)));
    this.registerFunction('AdGroups', jsonHandler((r) => listAdGroups(r)));
    this.registerFunction('AdUsers', jsonHandler((r) => listAdUsers(r)));
    this.registerFunction('AdImportGroups', jsonHandler((r) => importAdGroups(r)));
    this.registerFunction('AdImportUsers', jsonHandler((r) => importAdUsers(r)));
    this.registerFunction('GetImport', jsonHandler(() => ({ ok: true, settings, status })));
    this.registerFunction('SetImport', jsonHandler((r) => setImportSettings(r)));
    this.registerFunction('RunImport', jsonHandler((r) => startImport(r)));
    this.registerFunction('UserSettings', jsonHandler(() => userSettings()));
    this.registerFunction('ProjectSettings', jsonHandler(() => projectSettings()));
  }
}

/**
 * Passwords travel in these payloads: require payload encryption when this
 * winccoa-manager exposes the option (the CTRL vRPC framework's
 * MsaPayloadEncryptionMode::Mandatory); else say so in the log.
 */
function serviceOptions() {
  const options = new Vrpc.ServiceOptions();
  const mode = Vrpc.PayloadEncryptionMode?.Mandatory;
  if (mode !== undefined && 'payloadEncryptionMode' in options) {
    options.payloadEncryptionMode = mode;
    log('payload encryption: mandatory');
  } else {
    log('payload encryption: not available in this winccoa-manager — passwords travel in clear on the vRPC channel');
  }
  return options;
}

async function run() {
  log(`starting ${SERVICE_NAME} ${VERSION} (MSA vRPC)…`);
  try {
    await ensureConfigDp();
    await loadSettings();
  } catch (error) {
    log(`config DP unavailable, defaults used: ${error.message}`);
  }
  const h = await ctrl.call('health').catch((error) => ({ ok: false, error: error.message }));
  if (h.ok) {
    log(
      `running as "${h.userName}" (id ${h.userId}) — user administration permission (level ${h.level}): ${h.canManage ? 'yes' : 'NO, every write will be refused'}; authentication: ${h.authName}`
    );
  } else {
    log(`CTRL health failed: ${h.error}`);
  }
  status.nextRunAt = null;
  setInterval(tick, TICK_MS);
  const container = new Vrpc.ServiceContainer();
  container.registerService(new UsersService(), serviceOptions());
  try {
    await container.startAllServices();
    log(`service "${SERVICE_NAME}" started`);
  } catch (error) {
    log(`service not started: ${error}`);
  }
}

run().catch((error) => log(`fatal: ${error}`));
