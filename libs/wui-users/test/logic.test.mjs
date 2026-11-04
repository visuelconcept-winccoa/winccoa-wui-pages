// The pure part of the usersService manager: import settings, request validation, the
// Active Directory import decision and the user settings view.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The manager is CommonJS (deployed outside this "type": "module" package): copied to .cjs for the test.
const src = fileURLToPath(new URL('../managers/usersService/logic.js', import.meta.url));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'users-logic-')), 'logic.cjs');
fs.copyFileSync(src, tmp);
const require = createRequire(import.meta.url);
const {
  DEFAULT_SETTINGS,
  groupSetKey,
  groupUserSettings,
  importCandidates,
  matchGroups,
  normalizeSettings,
  parseSettingDp,
  settingsRequest,
  targetGroups,
  validate
} = require(tmp);

const bits = (...levels) => Array.from({ length: 32 }, (_, i) => levels.includes(i + 1));

describe('import settings', () => {
  it('are off by default, every hour, on every AD-linked group', () => {
    expect(normalizeSettings(undefined)).toEqual({ enabled: false, intervalMin: 60, groups: [] });
    expect(DEFAULT_SETTINGS.enabled).toBe(false);
  });

  it('are bounded when read back: 60 min at least, a week at most', () => {
    expect(normalizeSettings({ enabled: true, intervalMin: 5 }).intervalMin).toBe(60);
    expect(normalizeSettings({ intervalMin: 99999 }).intervalMin).toBe(7 * 24 * 60);
    expect(normalizeSettings({ groups: [' Ops ', 'Ops', '', 3] }).groups).toEqual(['Ops']);
  });

  it('refuse an out-of-bounds change from the page instead of clamping it', () => {
    expect(settingsRequest({ enabled: true, intervalMin: 30 }).error).toMatch(/intervalMin/);
    expect(settingsRequest({ enabled: 'yes', intervalMin: 60 }).error).toMatch(/enabled/);
    expect(settingsRequest({ enabled: true, intervalMin: 120, groups: ['A'] })).toEqual({ settings: { enabled: true, intervalMin: 120, groups: ['A'] } });
  });
});

describe('validate', () => {
  it('forwards only the known fields of a user creation, enabled by default', () => {
    expect(validate('userCreate', { name: 'jdoe', fullName: 'John\nDoe', password: 'x', groupIds: [3], extra: 1 })).toEqual({
      req: { name: 'jdoe', fullName: 'John Doe', password: 'x', enabled: true, groupIds: [3] }
    });
  });

  it('refuses a name with blanks around it or control characters', () => {
    expect(validate('userCreate', { name: ' jdoe' }).error).toBeTruthy();
    expect(validate('groupCreate', { name: 'a\tb' }).error).toBeTruthy();
  });

  it('never deletes, disables nor renames root', () => {
    expect(validate('userDelete', { id: 0 }).error).toBeTruthy();
    expect(validate('userUpdate', { id: 0, enabled: false }).error).toBeTruthy();
    expect(validate('userUpdate', { id: 0, name: 'admin' }).error).toBeTruthy();
    expect(validate('userUpdate', { id: 0, fullName: 'Root' })).toEqual({ req: { id: 0, fullName: 'Root' } });
  });

  it('wants 32 permission bits on a group and on each of its domains', () => {
    expect(validate('groupUpdate', { id: 2, permissions: [true] }).error).toMatch(/32/);
    expect(validate('groupUpdate', { id: 2, areas: [{ id: 1, permissions: bits(1) }], memberIds: [5] })).toEqual({
      req: { id: 2, areas: [{ id: 1, permissions: bits(1) }], memberIds: [5] }
    });
  });

  it('wants 32 permission names and an empty password is no password', () => {
    expect(validate('permissionNames', { names: ['a'] }).error).toBeTruthy();
    expect(validate('userPassword', { id: 4, password: '' }).error).toBeTruthy();
  });

  it('refuses an unknown operation', () => {
    expect(validate('dpSet', {}).error).toMatch(/inconnue/);
  });
});

describe('Active Directory import', () => {
  const oaGroups = [
    { name: 'Operators', osId: 'S-1-5-21-1' },
    { name: 'Maintenance', osId: 'S-1-5-21-2' },
    { name: 'LocalAdmins', osId: '' }
  ];

  it('targets the AD-linked groups only, restricted to a selection when given', () => {
    expect([...targetGroups(oaGroups).values()]).toEqual(['Operators', 'Maintenance']);
    expect([...targetGroups(oaGroups, ['maintenance', 'LocalAdmins']).values()]).toEqual(['Maintenance']);
  });

  it('skips the users already in WinCC OA (any case), root and those known to have no target group', () => {
    const ad = [{ name: 'JDOE' }, { name: 'root' }, { name: 'asmith' }, { name: 'bnew' }, { name: '' }];
    const { candidates, skippedExisting, skippedNoGroup } = importCandidates(ad, [{ name: 'jdoe' }], new Set(['asmith']));
    expect(candidates.map((u) => u.name)).toEqual(['bnew']);
    expect(skippedExisting).toBe(2);
    expect(skippedNoGroup).toBe(1);
  });

  it('keeps the OA names of the target groups the user is in', () => {
    const target = targetGroups(oaGroups);
    expect(matchGroups(['operators', 'Domain Users', 'LocalAdmins', 'Operators'], target)).toEqual(['Operators']);
    expect(matchGroups(['Domain Users'], target)).toEqual([]);
  });

  it('changes its group-set key when the target groups change', () => {
    expect(groupSetKey(targetGroups(oaGroups))).not.toBe(groupSetKey(targetGroups(oaGroups, ['Operators'])));
    expect(groupSetKey(targetGroups(oaGroups))).toBe(groupSetKey(targetGroups([...oaGroups].reverse())));
  });
});

describe('user settings', () => {
  it('reads base, group and user setting DPs, system prefix or not', () => {
    expect(parseSettingDp('System1:_uss_TREND')).toEqual({ kind: 'base', name: 'TREND' });
    expect(parseSettingDp('_usg_3_TREND')).toEqual({ kind: 'group', id: 3, name: 'TREND' });
    expect(parseSettingDp('_usr_12_MY_SETTING')).toEqual({ kind: 'user', id: 12, name: 'MY_SETTING' });
    expect(parseSettingDp('_wsn_PC1_X')).toBeNull();
  });

  it('groups them by setting and never shows a badge number', () => {
    const view = groupUserSettings([
      { dp: '_uss_RFID_UID', content: [''], fullName: 'Badge', format: 'S' },
      { dp: '_usr_5_RFID_UID', content: ['12345678'] },
      { dp: '_uss_LANG', content: ['fr'], fullName: 'Langue', format: 'S' },
      { dp: '_usr_5_LANG', content: ['de'] }
    ]);
    expect(view.map((s) => s.name)).toEqual(['LANG', 'RFID_UID']);
    expect(view[0]).toMatchObject({ masked: false, base: ['fr'], users: [{ id: 5, content: ['de'] }] });
    expect(view[1]).toMatchObject({ masked: true, base: null, users: [{ id: 5, content: null }] });
  });
});
