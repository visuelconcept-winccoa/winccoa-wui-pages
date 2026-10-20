// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The customisation layer: profiles (layering, validation, link filters), the
 * filters they drive, the extensions' reading of a row and the split of an
 * acknowledgement between an override and the kit's own write.
 */
import { AckState } from '@wincc-oa/wui-models/enums/wui-alert/ack-state.js';
import type { Alert } from '@wincc-oa/wui-models/interfaces/wui-alert/alert.js';
import { describe, expect, it } from 'vitest';
import { combinedClassifier, partitionAck, registerAlarmExtension, registeredExtensions } from './extensions.js';
import { mergeAlerts, toAlarm } from './mapping.js';
import { resolvePeriod } from './period.js';
import {
  DEFAULT_PROFILE,
  filtersFromSearch,
  mergeProfiles,
  normaliseProfiles,
  parseProfile,
  profileNameFromSearch
} from './profile.js';
import { applyQuery, fold, matchesClasses, matchesSearch } from './query.js';
import { compareAlarms } from './severity.js';
import { normaliseRanges, type Alarm } from './types.js';

const T0 = Date.parse('2026-03-10T08:00:00.000Z');

function alert(over: Partial<Alert> = {}): Alert {
  return {
    dpeName: 'System1:stma/line1.alert.x',
    dpeDescription: 'Ligne 1 — température',
    text: 'Température haute',
    time: T0,
    color: '#FF0000',
    prior: 60,
    ackState: AckState.DpAttrActTypeNot,
    direction: true,
    value: 91.5,
    ackable: true,
    abbr: 'OOS',
    ackTime: 0,
    ackUserName: '',
    atime: { count: 2, dpid: 'System1:stma/line1.alert.x:_alert_hdl.1', time: T0 },
    oldestAck: false,
    formattedValue: '91.5 °C',
    ...over
  };
}

function alarm(over: Partial<Alarm> = {}): Alarm {
  return { ...toAlarm(alert()), ...over };
}

describe('profiles', () => {
  it('layers code then engineering: switches merge, lists are replaced', () => {
    const resolved = mergeProfiles(
      { columns: ['severity', 'text', { id: 'of', label: 'OF' }], filters: { classes: false }, ack: { all: false } },
      { tiles: false, ack: { confirm: false } }
    );
    expect(resolved.columns.map((column) => column.id)).toEqual(['severity', 'text', 'of']);
    expect(resolved.filters.classes).toBe(false);
    expect(resolved.filters.search).toBe(true);
    expect(resolved.tiles).toBe(false);
    expect(resolved.ack).toEqual({ selection: true, all: false, confirm: false });
  });

  it('derives the history columns from the active ones, with the clearing time and who acknowledged', () => {
    const resolved = mergeProfiles({ columns: ['severity', 'raised', 'text'] });
    expect(resolved.historyColumns.map((column) => column.id)).toEqual(['severity', 'raised', 'cleared', 'text', 'ackBy']);
  });

  it('keeps the defaults without any layer, and never mutates them', () => {
    const resolved = mergeProfiles();
    resolved.columns.push({ id: 'x' });
    expect(mergeProfiles().columns).toEqual(DEFAULT_PROFILE.columns);
  });

  it('keeps what it understands of untrusted JSON and reports the rest', () => {
    const { profile, errors } = parseProfile({
      columns: ['severity', { id: 'of', label: { 'fr.utf8': 'OF' } }, 42],
      filters: { severity: 'yes', fields: [{ id: 'origin', label: 'Origine', options: [{ value: 'ua', label: 'OPC UA' }] }] },
      tiles: false,
      defaults: { classes: ['OOS'], ranks: [1, 'x', 2], unackOnly: true }
    });
    expect(profile.columns).toEqual(['severity', { id: 'of', label: { 'fr.utf8': 'OF' } }]);
    expect(profile.filters?.fields?.[0]?.options).toEqual([{ value: 'ua', label: 'OPC UA' }]);
    expect(profile.filters?.severity).toBeUndefined();
    expect(profile.tiles).toBe(false);
    expect(profile.defaults).toEqual({ classes: ['OOS'], ranks: [1, 2], unackOnly: true });
    expect(errors).toHaveLength(2);
    expect(parseProfile('nope').errors).toHaveLength(1);
  });

  it('re-validates the stored profiles and drops unnamed ones', () => {
    expect(normaliseProfiles({ msp: { tiles: false, bogus: 1 }, '': { tiles: true } })).toEqual({ msp: { tiles: false } });
    expect(normaliseProfiles(null)).toEqual({});
  });

  it('reads the filters a link carries', () => {
    expect(filtersFromSearch('?dp=stma/*&class=OOS,AOS&rank=1,2&q=four&unack=1&source=history&f.origin=ua')).toEqual({
      classes: ['OOS', 'AOS'],
      ranks: [1, 2],
      search: 'four',
      unackOnly: true,
      source: 'history',
      fields: { origin: 'ua' }
    });
    expect(filtersFromSearch('')).toEqual({});
    expect(profileNameFromSearch('?profile=msp')).toBe('msp');
  });
});

describe('filters', () => {
  it('keeps the classes by abbreviation, case-insensitive, globs allowed', () => {
    expect(matchesClasses({ abbr: 'OOS' }, ['oos'])).toBe(true);
    expect(matchesClasses({ abbr: 'OOC' }, ['OO*'])).toBe(true);
    expect(matchesClasses({ abbr: 'A' }, ['OOS', 'AOS'])).toBe(false);
    expect(matchesClasses({ abbr: 'A' }, [])).toBe(true);
  });

  it('searches every word, accents and case ignored, extra values included', () => {
    const row = alarm({ extra: { of: 'OF-1234' } });
    expect(fold('Température')).toBe('temperature');
    expect(matchesSearch(row, 'temperature ligne')).toBe(true);
    expect(matchesSearch(row, 'of-1234')).toBe(true);
    expect(matchesSearch(row, 'temperature pompe')).toBe(false);
  });

  it('filters on a field value, an empty value keeping every row', () => {
    const rows = [alarm({ id: 'a', extra: { origin: 'ua' } }), alarm({ id: 'b', extra: { origin: 'tag' } })];
    const query = { source: 'active' as const, fields: { origin: 'ua' } };
    expect(applyQuery(rows, query, T0).rows.map((row) => row.id)).toEqual(['a']);
    expect(applyQuery(rows, { ...query, fields: { origin: '' } }, T0).filtered).toBe(2);
  });

  it('sorts an additional column on its extra value', () => {
    const first = alarm({ id: 'a', extra: { of: 'OF-2' } });
    const second = alarm({ id: 'b', extra: { of: 'OF-10' } });
    expect(compareAlarms(first, second, 'x:of', 'asc')).toBeLessThan(0);
  });

  it('resolves the one-hour and eight-hour shortcuts', () => {
    expect(resolvePeriod('1h', T0)).toEqual({ start: T0 - 3_600_000, end: T0 });
    expect(resolvePeriod('8h', T0)).toEqual({ start: T0 - 8 * 3_600_000, end: T0 });
  });
});

describe('levels', () => {
  it('keeps a level name and an empty colour (the theme token)', () => {
    const [level] = normaliseRanges([{ id: 'danger', abbr: 'D', label: 'Danger', color: '', minPrior: 80 }]);
    expect(level).toEqual({ id: 'danger', abbr: 'D', label: 'Danger', color: '', minPrior: 80 });
  });
});

describe('extensions', () => {
  it('keeps the occurrence identity the acknowledgement override needs', () => {
    expect(toAlarm(alert()).atime).toEqual({ time: T0, count: 2, dpid: 'System1:stma/line1.alert.x:_alert_hdl.1' });
    expect(toAlarm(alert({ atime: { count: 0, dpid: '', time: 0 } })).atime).toBeNull();
  });

  it('lets a classifier re-rank a row and add extra values, in order', () => {
    const classify = combinedClassifier([
      { id: 'one', classify: (row) => ({ ...row, rank: 1, extra: { ...row.extra, origin: 'tag' } }) },
      { id: 'two', classify: (row, source) => ({ ...row, extra: { ...row.extra, class: source.abbr } }) },
      { id: 'none' }
    ]);
    const [row] = mergeAlerts([alert({ prior: 10 })], undefined, classify);
    expect(row?.rank).toBe(1);
    expect(row?.extra).toEqual({ origin: 'tag', class: 'OOS' });
    expect(combinedClassifier([{ id: 'none' }])).toBeUndefined();
  });

  it('keeps the extra values when the CAME and WENT halves are paired', () => {
    const classify = combinedClassifier([{ id: 'x', classify: (row) => ({ ...row, extra: { of: 'OF-1' } }) }]);
    const [row] = mergeAlerts([alert(), alert({ direction: false, time: T0 + 60_000 })], undefined, classify);
    expect(row?.cleared).toBe(T0 + 60_000);
    expect(row?.extra).toEqual({ of: 'OF-1' });
  });

  it('gives each alarm to the first override that claims it, the rest to the kit', () => {
    const msp = { applies: (row: Alarm) => row.abbr === 'OOS', acknowledge: () => Promise.resolve({ ok: true }) };
    const rows = [alarm({ id: 'a', abbr: 'OOS' }), alarm({ id: 'b', abbr: 'A' }), alarm({ id: 'c', abbr: 'OOS' })];
    const { handled, native } = partitionAck(rows, [{ id: 'msp', acknowledge: msp }, { id: 'plain' }]);
    expect(handled).toHaveLength(1);
    expect(handled[0]?.alarms.map((row) => row.id)).toEqual(['a', 'c']);
    expect(native.map((row) => row.id)).toEqual(['b']);
  });

  it('finds a registered extension from any bundle, by id', () => {
    registerAlarmExtension({ id: 'spec-ext' });
    expect(registeredExtensions(['unknown', 'spec-ext']).map((extension) => extension.id)).toEqual(['spec-ext']);
  });
});
