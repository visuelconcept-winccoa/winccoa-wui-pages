// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * The pure part of the usersService manager — no WinCC OA here, unit-tested
 * (test/logic.test.mjs): the import settings and their bounds, the requests'
 * validation, the decision of the Active Directory import (which AD users become
 * WinCC OA users, in which groups) and the masking of sensitive user settings.
 */

/** Interval of the automatic import, minutes: AD enumeration is heavy — 1 h at least, as importADGroupUsers.ctl. */
const INTERVAL_MIN = 60;
const INTERVAL_MAX = 7 * 24 * 60;

const DEFAULT_SETTINGS = Object.freeze({
  /** Off until an administrator turns it on: deploying the module creates no user. */
  enabled: false,
  intervalMin: INTERVAL_MIN,
  /** WinCC OA group names the import is restricted to; empty = every AD-linked group (OSID set). */
  groups: []
});

/** The import settings, bounded; whatever is missing or wrong takes its default. */
function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const interval = Number(s.intervalMin);
  return {
    enabled: s.enabled === true,
    intervalMin: Number.isInteger(interval) ? Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, interval)) : INTERVAL_MIN,
    groups: Array.isArray(s.groups) ? [...new Set(s.groups.filter((g) => typeof g === 'string' && g.trim() !== '').map((g) => g.trim()))] : []
  };
}

/** A settings change from the page, or `{ error }` (out of bounds is refused, not clamped). */
function settingsRequest(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (typeof b.enabled !== 'boolean') return { error: 'enabled (boolean) requis' };
  if (!Number.isInteger(b.intervalMin) || b.intervalMin < INTERVAL_MIN || b.intervalMin > INTERVAL_MAX) {
    return { error: `intervalMin (${INTERVAL_MIN}–${INTERVAL_MAX} min) requis` };
  }
  if (b.groups !== undefined && (!Array.isArray(b.groups) || b.groups.some((g) => typeof g !== 'string'))) {
    return { error: 'groups : liste de noms de groupes' };
  }
  return { settings: normalizeSettings(b) };
}

// ---- requests ---------------------------------------------------------------------

/** WinCC OA names: no control characters, no leading/trailing blanks, 1–64 characters. */
const NAME_RE = /^[^\u0000-\u001f\u007f]{1,64}$/;

function isName(value) {
  return typeof value === 'string' && value === value.trim() && NAME_RE.test(value);
}

function isId(value) {
  return Number.isInteger(value) && value >= 0;
}

function isIdList(value) {
  return Array.isArray(value) && value.every(isId);
}

/** 32 permission bits as booleans (level 1 first). */
function isBits(value) {
  return Array.isArray(value) && value.length === 32 && value.every((v) => typeof v === 'boolean');
}

function isAreaList(value) {
  return Array.isArray(value) && value.every((a) => a && typeof a === 'object' && isId(a.id) && isBits(a.permissions));
}

function text(value, max = 255) {
  return typeof value === 'string' ? value.replaceAll(/[\r\n]+/g, ' ').slice(0, max) : undefined;
}

/** Copy the optional text fields that are present. */
function texts(b, keys) {
  const out = {};
  for (const key of keys) if (typeof b[key] === 'string') out[key] = text(b[key]);
  return out;
}

/**
 * Validation of each write, by CTRL function: the request the CTRL side gets, or
 * `{ error }`. What is not listed is not forwarded. Root (id 0) is never deleted,
 * disabled nor renamed from here.
 */
const VALIDATORS = {
  userCreate(b) {
    if (!isName(b.name)) return { error: 'name requis' };
    if (b.password !== undefined && typeof b.password !== 'string') return { error: 'password : texte' };
    if (b.groupIds !== undefined && !isIdList(b.groupIds)) return { error: 'groupIds : liste d’ids' };
    return {
      req: {
        name: b.name,
        ...texts(b, ['fullName', 'comment', 'language']),
        ...(b.password ? { password: b.password } : {}),
        enabled: b.enabled !== false,
        groupIds: b.groupIds ?? []
      }
    };
  },
  userUpdate(b) {
    if (!isId(b.id)) return { error: 'id requis' };
    if (b.name !== undefined && !isName(b.name)) return { error: 'name invalide' };
    if (b.groupIds !== undefined && !isIdList(b.groupIds)) return { error: 'groupIds : liste d’ids' };
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') return { error: 'enabled : booléen' };
    if (b.id === 0 && (b.name !== undefined || b.enabled === false)) return { error: 'root ne se renomme ni ne se désactive' };
    return {
      req: {
        id: b.id,
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...texts(b, ['fullName', 'comment', 'language']),
        ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
        ...(b.groupIds !== undefined ? { groupIds: b.groupIds } : {})
      }
    };
  },
  userPassword(b) {
    if (!isId(b.id)) return { error: 'id requis' };
    if (typeof b.password !== 'string' || b.password === '') return { error: 'password requis' };
    return { req: { id: b.id, password: b.password } };
  },
  userDelete(b) {
    if (!isId(b.id) || b.id === 0) return { error: 'id requis (root ne se supprime pas)' };
    return { req: { id: b.id } };
  },
  groupCreate(b) {
    if (!isName(b.name)) return { error: 'name requis' };
    return groupFields(b, { name: b.name });
  },
  groupUpdate(b) {
    if (!isId(b.id)) return { error: 'id requis' };
    if (b.name !== undefined && !isName(b.name)) return { error: 'name invalide' };
    return groupFields(b, { id: b.id, ...(b.name !== undefined ? { name: b.name } : {}) });
  },
  groupDelete(b) {
    return isId(b.id) ? { req: { id: b.id } } : { error: 'id requis' };
  },
  areaCreate(b) {
    if (!isName(b.name)) return { error: 'name requis' };
    if (b.permissions !== undefined && !isBits(b.permissions)) return { error: 'permissions : 32 booléens' };
    return { req: { name: b.name, ...texts(b, ['fullName', 'comment']), ...(b.permissions ? { permissions: b.permissions } : {}) } };
  },
  areaUpdate(b) {
    if (!isId(b.id)) return { error: 'id requis' };
    if (b.name !== undefined && !isName(b.name)) return { error: 'name invalide' };
    if (b.permissions !== undefined && !isBits(b.permissions)) return { error: 'permissions : 32 booléens' };
    return {
      req: {
        id: b.id,
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...texts(b, ['fullName', 'comment']),
        ...(b.permissions ? { permissions: b.permissions } : {})
      }
    };
  },
  areaDelete(b) {
    return isId(b.id) ? { req: { id: b.id } } : { error: 'id requis' };
  },
  permissionNames(b) {
    if (!Array.isArray(b.names) || b.names.length !== 32 || b.names.some((n) => typeof n !== 'string')) {
      return { error: 'names : 32 textes' };
    }
    return { req: { names: b.names.map((n) => text(n, 128)) } };
  },
  authMode(b) {
    return typeof b.mode === 'string' && b.mode !== '' ? { req: { mode: b.mode } } : { error: 'mode requis' };
  },
  adImportGroups(b) {
    if (!Array.isArray(b.names) || b.names.length === 0 || !b.names.every(isName)) return { error: 'names : liste de groupes AD' };
    return { req: { names: b.names } };
  },
  adImportUsers(b) {
    if (!Array.isArray(b.names) || b.names.length === 0 || !b.names.every(isName)) return { error: 'names : liste d’utilisateurs AD' };
    return { req: { names: b.names } };
  }
};

function groupFields(b, base) {
  if (b.permissions !== undefined && !isBits(b.permissions)) return { error: 'permissions : 32 booléens' };
  if (b.areas !== undefined && !isAreaList(b.areas)) return { error: 'areas : [{ id, permissions: 32 booléens }]' };
  if (b.memberIds !== undefined && !isIdList(b.memberIds)) return { error: 'memberIds : liste d’ids' };
  return {
    req: {
      ...base,
      ...texts(b, ['fullName', 'comment']),
      ...(b.permissions ? { permissions: b.permissions } : {}),
      ...(b.areas ? { areas: b.areas.map((a) => ({ id: a.id, permissions: a.permissions })) } : {}),
      ...(b.memberIds ? { memberIds: b.memberIds } : {})
    }
  };
}

/** `{ req }` to forward, or `{ error }`; an unknown operation is an error. */
function validate(op, body) {
  const validator = VALIDATORS[op];
  if (!validator) return { error: `opération inconnue : ${op}` };
  return validator(body && typeof body === 'object' ? body : {});
}

// ---- Active Directory import --------------------------------------------------------

const lower = (s) => String(s).toLowerCase();

/**
 * The groups an import targets: OA group name (lowercased) → OA group name.
 * Only AD-linked groups (OSID set), restricted to `settings.groups` when given.
 */
function targetGroups(oaGroups, selected = []) {
  const wanted = new Set(selected.map(lower));
  const set = new Map();
  for (const g of oaGroups) {
    if (!g.osId) continue;
    if (wanted.size > 0 && !wanted.has(lower(g.name))) continue;
    set.set(lower(g.name), g.name);
  }
  return set;
}

/**
 * The AD users worth asking for their groups: not in WinCC OA yet (by name, case
 * insensitive — existing users are left to WCCOAupdateUserGroups), never root, and
 * not already found to belong to no target group (`noGroupSeen`, a cache kept while
 * the set of target groups does not change).
 */
function importCandidates(adUsers, oaUsers, noGroupSeen = new Set()) {
  const existing = new Set(oaUsers.map((u) => lower(u.name)));
  existing.add('root');
  const candidates = [];
  let skippedExisting = 0;
  let skippedNoGroup = 0;
  for (const u of adUsers) {
    if (!u.name) continue;
    const key = lower(u.name);
    if (existing.has(key)) skippedExisting++;
    else if (noGroupSeen.has(key)) skippedNoGroup++;
    else candidates.push(u);
  }
  return { candidates, skippedExisting, skippedNoGroup };
}

/** The OA names of the user's groups that are target groups. */
function matchGroups(userGroups, target) {
  const matched = [];
  for (const g of userGroups) {
    const name = target.get(lower(g));
    if (name && !matched.includes(name)) matched.push(name);
  }
  return matched;
}

/** A stable key of the target group set: the "no group" cache is dropped when it changes. */
function groupSetKey(target) {
  return [...target.keys()].sort().join('\n');
}

// ---- user settings --------------------------------------------------------------------

/** User settings whose content is never shown (badge numbers, secrets). */
const SENSITIVE_SETTING = /uid|badge|pass|pwd|token|secret|key|pin/i;

function isSensitiveSetting(name) {
  return SENSITIVE_SETTING.test(name);
}

/**
 * Classify a `_UserDefinedSettings` DP name: `_uss_<name>` (base definition),
 * `_usg_<groupId>_<name>` (a group's value), `_usr_<userId>_<name>` (a user's),
 * else null (workstation settings `_wss_` / `_wsn_` are not user settings).
 */
function parseSettingDp(dp) {
  const bare = dp.includes(':') ? dp.slice(dp.indexOf(':') + 1) : dp;
  let m = /^_uss_(.+)$/.exec(bare);
  if (m) return { kind: 'base', name: m[1] };
  m = /^_usg_(\d+)_(.+)$/.exec(bare);
  if (m) return { kind: 'group', id: Number(m[1]), name: m[2] };
  m = /^_usr_(\d+)_(.+)$/.exec(bare);
  if (m) return { kind: 'user', id: Number(m[1]), name: m[2] };
  return null;
}

/** The user settings, grouped by setting name; sensitive contents replaced by `masked: true`. */
function groupUserSettings(entries) {
  const byName = new Map();
  const of = (name) => {
    if (!byName.has(name)) byName.set(name, { name, fullName: '', format: '', masked: isSensitiveSetting(name), base: null, groups: [], users: [] });
    return byName.get(name);
  };
  for (const e of entries) {
    const parsed = parseSettingDp(e.dp);
    if (!parsed) continue;
    const s = of(parsed.name);
    const content = s.masked ? null : (e.content ?? []).map(String);
    if (parsed.kind === 'base') {
      s.fullName = e.fullName ?? '';
      s.format = e.format ?? '';
      s.base = content;
    } else if (parsed.kind === 'group') s.groups.push({ id: parsed.id, content });
    else s.users.push({ id: parsed.id, content });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  DEFAULT_SETTINGS,
  INTERVAL_MAX,
  INTERVAL_MIN,
  groupSetKey,
  groupUserSettings,
  importCandidates,
  isSensitiveSetting,
  matchGroups,
  normalizeSettings,
  parseSettingDp,
  settingsRequest,
  targetGroups,
  validate
};
