// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Each user's own choices of the fleet pages, in WinCC OA's user settings, against a scripted WinCC OA.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@winccoa/backend', () => ({ WsjServerGlobal: { winccoa: {} } }));
vi.mock('./fleetGuard', () => ({ requestIdentity: async () => ({ username: '', userId: -1, admin: false, groups: [] }) }));

import { FLEET_SETTINGS, MAX_SETTING_CHARS, SETTINGS_DPT, UserSettingsStore, getSetting, putSetting, type OaSettingsApi } from './fleetSettings';

function fakeOa() {
  const dps = new Map<string, string>();
  const values = new Map<string, unknown>();
  const oa: OaSettingsApi = {
    dpExists: (dp) => dps.has(dp),
    dpCreate: vi.fn(async (dp: string, dpt: string) => {
      dps.set(dp, dpt);
      return true;
    }),
    dpGet: async (dpe) => values.get(dpe),
    dpSetWait: async (dpe, value) => {
      if (Array.isArray(dpe)) dpe.forEach((d, i) => values.set(d, (value as unknown[])[i]));
      else values.set(dpe, value);
      return true;
    }
  };
  return { oa, dps, values };
}

const alice = { username: 'alice', userId: 7 };
const bob = { username: 'bob', userId: 8 };

describe('fleet user settings', () => {
  it('writes _usr_<UserId>_WUI_MF_FILTER with its name, format and label, and creates _uss_WUI_MF_FILTER once', async () => {
    const { oa, dps, values } = fakeOa();
    const store = new UserSettingsStore(() => oa);
    const r = await putSetting(store, alice, 'fleet-filter', { value: { tags: { Line: ['L3'] }, states: [] } });
    expect(r).toEqual({ status: 200, body: { ok: true, key: 'fleet-filter', user: 'alice' } });
    expect(dps.get('_uss_WUI_MF_FILTER')).toBe(SETTINGS_DPT);
    expect(dps.get('_usr_7_WUI_MF_FILTER')).toBe(SETTINGS_DPT);
    expect(values.get('_usr_7_WUI_MF_FILTER.Content')).toEqual(['{"tags":{"Line":["L3"]},"states":[]}']);
    // The user's DP is complete, as usr_addNewSetting writes it (unlike the work centres', #261).
    expect(values.get('_usr_7_WUI_MF_FILTER.SettingName')).toBe('WUI_MF_FILTER');
    expect(values.get('_usr_7_WUI_MF_FILTER.Format')).toBe('S');
    expect(values.get('_usr_7_WUI_MF_FILTER.FullName')).toBe(FLEET_SETTINGS['fleet-filter']!.fullName);
    expect(values.get('_uss_WUI_MF_FILTER.SettingName')).toBe('WUI_MF_FILTER');
    await putSetting(store, alice, 'fleet-filter', { value: { tags: {}, states: ['arret'] } });
    expect(values.get('_usr_7_WUI_MF_FILTER.Content')).toEqual(['{"tags":{},"states":["arret"]}']);
    const created = (oa.dpCreate as ReturnType<typeof vi.fn>).mock.calls.map(([dp]) => dp);
    expect(created.filter((dp) => dp === '_uss_WUI_MF_FILTER')).toHaveLength(1);
    expect(created.filter((dp) => dp === '_usr_7_WUI_MF_FILTER')).toHaveLength(1);
  });

  it("reads only the caller's own value, null when they have none or it is unreadable", async () => {
    const { oa, values } = fakeOa();
    const store = new UserSettingsStore(() => oa);
    await putSetting(store, alice, 'fleet-ateliers', { value: { a1: { lines: {}, hidden: ['M1'] } } });
    expect((await getSetting(store, alice, 'fleet-ateliers')).body['value']).toEqual({ a1: { lines: {}, hidden: ['M1'] } });
    expect((await getSetting(store, bob, 'fleet-ateliers')).body['value']).toBeNull();
    values.set('_usr_7_WUI_MF_ATELIERS.Content', ['{nope']);
    expect((await getSetting(store, alice, 'fleet-ateliers')).body['value']).toBeNull();
    // A value split over several elements is joined.
    values.set('_usr_7_WUI_MF_ATELIERS.Content', { value: ['{"a1":', '{"lines":{},"hidden":[]}}'] });
    expect((await getSetting(store, alice, 'fleet-ateliers')).body['value']).toEqual({ a1: { lines: {}, hidden: [] } });
  });

  it('refuses an unknown key, an unidentified caller, a missing or oversized value', async () => {
    const { oa, dps } = fakeOa();
    const store = new UserSettingsStore(() => oa);
    expect((await getSetting(store, alice, 'wc-list')).status).toBe(404);
    expect((await putSetting(store, alice, '../x', { value: 1 })).status).toBe(404);
    expect((await getSetting(store, null, 'fleet-filter')).status).toBe(401);
    expect((await putSetting(store, null, 'fleet-filter', { value: 1 })).status).toBe(401);
    expect((await putSetting(store, alice, 'fleet-filter', {})).status).toBe(400);
    expect((await putSetting(store, alice, 'fleet-filter', { value: 'x'.repeat(MAX_SETTING_CHARS) })).status).toBe(413);
    expect(dps.size).toBe(0);
  });
});
