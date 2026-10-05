// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pure alarm domain. Every test here is about a rule that, read the wrong way
 * round, silently inverts what an operator sees:
 * WinCC OA's CAME/WENT direction, its ack-state encoding, occurrence pairing,
 * datapoint scoping and the EEMUA histogram.
 */
import { AckState } from '@wincc-oa/wui-models/enums/wui-alert/ack-state.js';
import type { Alert } from '@wincc-oa/wui-models/interfaces/wui-alert/alert.js';
import { describe, expect, it } from 'vitest';
import { isAckable, isAcked, isCame, mergeAlerts, occurrenceKey, toAlarm, ackDpe, toEpochMs } from './mapping.js';
import { resolvePeriod, parseDateInput, toDateInput } from './period.js';
import { applyQuery, inSource, selectAll } from './query.js';
import { mergeOccurrences } from './occurrences.js';
import { inScope, matchesScopeEntry, scopeFromDpes, parseScopeAttribute, scopeFromSearch, splitDpe } from './scope.js';
import { compareAlarms, criticality, mostCritical } from './severity.js';
import { alarmHistogram, bucketFor, countAlarms, thresholdFor, topActors, BUCKET_MS, EEMUA_THRESHOLD } from './statistics.js';
import { canAcknowledge, rankFor, rangeFor, normaliseRanges, type Alarm, type AlarmRange } from './types.js';

const T0 = Date.parse('2026-03-10T08:00:00.000Z');
const MINUTE = 60_000;

function alert(over: Partial<Alert> = {}): Alert {
  return {
    dpeName: 'System1:Press01.temp',
    dpeDescription: 'Press 01 temperature',
    text: 'High temperature',
    time: T0,
    color: '#FF0000',
    prior: 60,
    ackState: AckState.DpAttrActTypeNot,
    direction: true,
    value: 91.5,
    ackable: true,
    abbr: 'A',
    ackTime: 0,
    ackUserName: '',
    atime: { count: 1, dpid: 'dp', time: T0 },
    oldestAck: false,
    formattedValue: '91.5 °C',
    ...over
  };
}

function alarm(over: Partial<Alarm> = {}): Alarm {
  return { ...toAlarm(alert()), ...over };
}

describe('direction and ack state', () => {
  it('reads direction=true as CAME (standing) and false as WENT (cleared)', () => {
    expect(isCame(alert({ direction: true }))).toBe(true);
    expect(toAlarm(alert({ direction: true })).cleared).toBeNull();
    expect(toAlarm(alert({ direction: false, time: T0 + MINUTE })).cleared).toBe(T0 + MINUTE);
  });

  it('reads ackState 0 as NOT acknowledged, anything else as acknowledged', () => {
    expect(isAcked(alert({ ackState: AckState.DpAttrActTypeNot }))).toBe(false);
    expect(isAcked(alert({ ackState: AckState.DpAttrActTypeSingle }))).toBe(true);
    expect(toAlarm(alert()).status).toBe('ACTIVE');
    expect(toAlarm(alert({ ackState: AckState.DpAttrActTypeSingle })).status).toBe('ACTIVE_ACK');
    expect(toAlarm(alert({ direction: false })).status).toBe('CLEARED');
  });

  it('keeps the alert class colour and abbreviation as the project set them', () => {
    const mapped = toAlarm(alert({ color: '#123456', abbr: 'I' }));
    expect(mapped.color).toBe('#123456');
    expect(mapped.abbr).toBe('I');
  });

  it('splits the datapoint element into system / datapoint', () => {
    const mapped = toAlarm(alert({ dpeName: 'System2:Oven07.zone1.temp' }));
    expect(mapped.system).toBe('System2');
    expect(mapped.dp).toBe('Oven07');
    expect(splitDpe('System2:Oven07.zone1.temp').element).toBe('zone1.temp');
  });

  it('acknowledges through the alarm-handling attribute of the element', () => {
    expect(ackDpe({ dpe: 'System1:Press01.temp' })).toBe('System1:Press01.temp:_alert_hdl.._ack');
  });

  it('handles WinCC OA INTERNAL datapoints, whose name starts with an underscore', () => {
    // `System1:_Event.License.RemainingTime` — the system separator is followed
    // by the underscore of an internal DP. Anything that mistakes that for a
    // config path (`:_alert_hdl`) makes those alarms unacknowledgeable; the
    // server-side guard counts COLONS for exactly this reason.
    const internal = 'System1:_Event.License.RemainingTime';
    const mapped = toAlarm(alert({ dpeName: internal }));
    expect(mapped.dp).toBe('_Event');
    expect(ackDpe(mapped)).toBe(`${internal}:_alert_hdl.._ack`);
    expect(scopeFromDpes([internal])).toEqual(['System1:_Event']);
    expect(inScope(mapped, ['_Event'])).toBe(true);
  });

  it('reads ackability from the backend flag, whatever shape it arrives in', () => {
    expect(isAckable(alert({ ackable: true }))).toBe(true);
    expect(isAckable(alert({ ackable: false }))).toBe(false);
    // A tuple field can arrive as 1 / "true"; `=== true` used to disable the
    // acknowledge action for the whole plant.
    expect(isAckable(alert({ ackable: 1 as unknown as boolean }))).toBe(true);
    expect(isAckable(alert({ ackable: 'true' as unknown as boolean }))).toBe(true);
    expect(toAlarm(alert({ ackable: 1 as unknown as boolean })).ackable).toBe(true);
  });

  it('falls back to "an unacknowledged alert is acknowledgeable" when the flag is absent', () => {
    expect(isAckable(alert({ ackable: undefined as unknown as boolean }))).toBe(true);
    expect(
      isAckable(alert({ ackable: undefined as unknown as boolean, ackState: AckState.DpAttrActTypeSingle }))
    ).toBe(false);
  });

  it('offers the acknowledge action only where it would do something', () => {
    expect(canAcknowledge(alarm({ ackable: true, acked: false }))).toBe(true);
    expect(canAcknowledge(alarm({ ackable: true, acked: true }))).toBe(false);
    expect(canAcknowledge(alarm({ ackable: false, acked: false }))).toBe(false);
  });

  it('accepts second-based timestamps as well as millisecond ones', () => {
    expect(toEpochMs(T0)).toBe(T0);
    expect(toEpochMs(Math.floor(T0 / 1000))).toBe(T0);
    expect(toEpochMs('')).toBe(0);
  });
});

describe('occurrence pairing', () => {
  it('pairs the CAME and WENT events of one occurrence into a single row', () => {
    const came = alert();
    const went = alert({ direction: false, time: T0 + 5 * MINUTE });
    const rows = mergeAlerts([came, went]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.raised).toBe(T0);
    expect(rows[0]!.cleared).toBe(T0 + 5 * MINUTE);
    expect(rows[0]!.status).toBe('CLEARED');
  });

  it('keeps two occurrences of the same alarm apart', () => {
    const first = alert({ atime: { count: 1, dpid: 'dp', time: T0 } });
    const second = alert({ time: T0 + MINUTE, atime: { count: 2, dpid: 'dp', time: T0 + MINUTE } });
    expect(occurrenceKey(first)).not.toBe(occurrenceKey(second));
    expect(mergeAlerts([first, second])).toHaveLength(2);
  });

  it('does NOT read a live acknowledgement of a standing alarm as "it went"', () => {
    const standing = alert();
    const acknowledged = alert({ ackState: AckState.DpAttrActTypeSingle, ackUserName: 'op1', ackTime: T0 + MINUTE });
    const rows = mergeAlerts([standing, acknowledged]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cleared).toBeNull();
    expect(rows[0]!.status).toBe('ACTIVE_ACK');
    expect(rows[0]!.ackBy).toBe('op1');
  });

  it('sorts newest first and skips rows without a datapoint element', () => {
    const older = alert({ time: T0 - MINUTE, atime: { count: 9, dpid: 'dp', time: T0 - MINUTE } });
    const rows = mergeAlerts([older, alert(), alert({ dpeName: '' })]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.raised).toBe(T0);
  });
});

describe('priority ranges', () => {
  it('ranks the WinCC OA priority through the seed ranges, highest first', () => {
    expect(rankFor(80)).toBe(1);
    expect(rankFor(60)).toBe(1);
    expect(rankFor(59)).toBe(2);
    expect(rankFor(20)).toBe(3);
    expect(rankFor(0)).toBe(4);
  });

  it('honours the project-specific ranges', () => {
    const ranges: AlarmRange[] = [
      { id: 'crit', abbr: 'CRIT', color: '#ff0000', minPrior: 3 },
      { id: 'low', abbr: 'LOW', color: '#888888', minPrior: 0 }
    ];
    expect(rankFor(3, ranges)).toBe(1);
    expect(rangeFor(3, ranges).abbr).toBe('CRIT');
    expect(rankFor(2, ranges)).toBe(2);
    expect(rangeFor(2, ranges).color).toBe('#888888');
  });

  it('puts a priority below every range into the lowest one, never nowhere', () => {
    const ranges: AlarmRange[] = [{ id: 'high', abbr: 'H', color: '#f00', minPrior: 50 }];
    expect(rankFor(-5, ranges)).toBe(1);
    expect(rangeFor(-5, ranges).id).toBe('high');
  });

  it('normalises what the configuration datapoint returns', () => {
    const ranges = normaliseRanges([
      { id: 'b', abbr: '', color: '#0f0', minPrior: 10 },
      { id: 'a', abbr: 'A', color: '#f00', minPrior: 70 }
    ]);
    // Sorted worst-first, and an empty abbreviation falls back to the id.
    expect(ranges.map((range) => range.id)).toEqual(['a', 'b']);
    expect(ranges[1]!.abbr).toBe('B');
    // A garbage list must not leave the view without any range at all.
    expect(normaliseRanges([]).length).toBe(4);
  });

  it('maps an alarm onto the configured range', () => {
    const ranges: AlarmRange[] = [
      { id: 'crit', abbr: 'CRIT', color: '#f00', minPrior: 50 },
      { id: 'info', abbr: 'INFO', color: '#888', minPrior: 0 }
    ];
    expect(toAlarm(alert({ prior: 60 }), ranges).rank).toBe(1);
    expect(toAlarm(alert({ prior: 10 }), ranges).rank).toBe(2);
  });
});

describe('scoping', () => {
  it('matches a plain datapoint name and everything under it', () => {
    expect(matchesScopeEntry('System1:Press01.temp', 'Press01')).toBe(true);
    expect(matchesScopeEntry('System1:Press01.temp', 'System1:Press01')).toBe(true);
    expect(matchesScopeEntry('System1:Press01.temp', 'System1:Press01.temp')).toBe(true);
    expect(matchesScopeEntry('System1:Press02.temp', 'Press01')).toBe(false);
  });

  it('supports the glob the backend refuses', () => {
    expect(matchesScopeEntry('System1:Line1_Press.state', 'Line1_*')).toBe(true);
    expect(matchesScopeEntry('System1:Line2_Press.state', 'Line1_*')).toBe(false);
    expect(matchesScopeEntry('System1:Press01.temp', 'Press0?')).toBe(true);
  });

  it('treats an empty scope as the whole system', () => {
    expect(inScope(alarm(), [])).toBe(true);
    expect(inScope(alarm())).toBe(true);
    expect(inScope(alarm(), ['Other'])).toBe(false);
  });

  it('derives a machine scope from its bound elements, one entry per datapoint', () => {
    const scope = scopeFromDpes(['System1:Press01.state', 'System1:Press01.temp', '', undefined, 'System1:Oven07.temp']);
    expect(scope).toEqual(['System1:Press01', 'System1:Oven07']);
  });

  it('parses the dps attribute', () => {
    expect(parseScopeAttribute('Press01, Oven07;Line1_*')).toEqual(['Press01', 'Oven07', 'Line1_*']);
    expect(parseScopeAttribute('  ')).toEqual([]);
  });

  it('reads the scope out of a route query string, decoded', () => {
    // What a drill-down link actually looks like: the `:` of the system prefix is
    // percent-encoded, and an entry still carrying `%3A` matches no datapoint at all.
    expect(scopeFromSearch('?dp=System1%3AGisSim_saint_alban_defaut')).toEqual([
      'System1:GisSim_saint_alban_defaut'
    ]);
    expect(
      matchesScopeEntry(
        'System1:GisSim_saint_alban_defaut.',
        scopeFromSearch('?dp=System1%3AGisSim_saint_alban_defaut')[0] as string
      )
    ).toBe(true);
  });

  it('reads a query string with or without its leading ?, and several entries', () => {
    expect(scopeFromSearch('dp=Press01,Oven07')).toEqual(['Press01', 'Oven07']);
    expect(scopeFromSearch('?filter=x&dp=Press01')).toEqual(['Press01']);
  });

  it('yields no scope when the route carries none', () => {
    // No scope means the whole system, so this has to be empty rather than [''].
    expect(scopeFromSearch('')).toEqual([]);
    expect(scopeFromSearch('?tab=live')).toEqual([]);
    expect(scopeFromSearch('?dp=')).toEqual([]);
  });
});

describe('query', () => {
  const rows: Alarm[] = [
    alarm({ id: 'a', raised: T0, rank: 1, acked: false, cleared: null, text: 'High temperature' }),
    alarm({ id: 'b', raised: T0 + MINUTE, rank: 3, acked: true, cleared: null, text: 'Low pressure' }),
    alarm({ id: 'c', raised: T0 - MINUTE, rank: 2, acked: true, cleared: T0, text: 'Door open', dpe: 'System1:Oven07.door', dp: 'Oven07' })
  ];

  it('KEEPS a gone-but-unacknowledged alarm in the active list', () => {
    // It left the field, not the operator's responsibility: it only leaves the
    // list once someone takes it over.
    const gone = alarm({ id: 'g', cleared: T0, acked: false });
    expect(inSource(gone, 'active')).toBe(true);
    expect(applyQuery([gone], { source: 'active' }, T0).filtered).toBe(1);
    expect(countAlarms([gone], T0).unacknowledged).toBe(1);

    const takenOver = alarm({ id: 'g', cleared: T0, acked: true });
    expect(inSource(takenOver, 'active')).toBe(false);
    expect(countAlarms([takenOver], T0).unacknowledged).toBe(0);
  });

  it('keeps only standing alarms on the active source, everything on history', () => {
    expect(inSource(rows[2]!, 'active')).toBe(false);
    expect(applyQuery(rows, { source: 'active' }, T0).filtered).toBe(2);
    expect(applyQuery(rows, { source: 'history' }, T0).filtered).toBe(3);
  });

  it('filters on band, acknowledgement, free text and scope', () => {
    expect(applyQuery(rows, { source: 'active', ranks: [1] }, T0).filtered).toBe(1);
    expect(applyQuery(rows, { source: 'active', unacknowledgedOnly: true }, T0).filtered).toBe(1);
    expect(applyQuery(rows, { source: 'history', search: 'door' }, T0).filtered).toBe(1);
    expect(applyQuery(rows, { source: 'history', scope: ['Oven07'] }, T0).filtered).toBe(1);
  });

  it('reports the snapshot total next to the filtered count', () => {
    const page = applyQuery(rows, { source: 'history', ranks: [1] }, T0);
    expect(page.filtered).toBe(1);
    expect(page.total).toBe(3);
  });

  it('paginates and clamps the page to the available range', () => {
    const page = applyQuery(rows, { source: 'history', pageSize: 2, page: 9 }, T0);
    expect(page.pages).toBe(2);
    expect(page.page).toBe(2);
    expect(page.rows).toHaveLength(1);
  });

  it('selects every matching row, page or not', () => {
    expect(selectAll(rows, { source: 'history', pageSize: 1 })).toHaveLength(3);
  });
});

describe('ordering', () => {
  it('ranks worst first: band, then unacknowledged, then standing, then recent', () => {
    const worst = alarm({ id: 'w', rank: 1, acked: false, cleared: null, raised: T0 });
    const acked = alarm({ id: 'k', rank: 1, acked: true, cleared: null, raised: T0 });
    const gone = alarm({ id: 'g', rank: 1, acked: false, cleared: T0, raised: T0 });
    const minor = alarm({ id: 'm', rank: 4, acked: false, cleared: null, raised: T0 });
    expect(mostCritical([acked, minor, gone, worst])?.id).toBe('w');
    expect(criticality(worst)[0]).toBe(1);
  });

  it('breaks every tie on the id so two workstations show one order', () => {
    const left = alarm({ id: 'a', raised: T0 });
    const right = alarm({ id: 'b', raised: T0 });
    expect(compareAlarms(left, right, 'raised', 'desc')).toBeLessThan(0);
    expect(compareAlarms(right, left, 'raised', 'desc')).toBeGreaterThan(0);
  });

  it('sorts standing alarms after cleared ones on the cleared column', () => {
    const standing = alarm({ id: 's', cleared: null });
    const cleared = alarm({ id: 'c', cleared: T0 });
    expect(compareAlarms(cleared, standing, 'cleared', 'asc')).toBeLessThan(0);
  });
});

describe('statistics', () => {
  const rows: Alarm[] = [
    alarm({ id: 'a', raised: T0, rank: 1, acked: false, cleared: null }),
    alarm({ id: 'b', raised: T0 - MINUTE, rank: 1, acked: true, cleared: null }),
    alarm({ id: 'c', raised: T0 - 2 * MINUTE, rank: 3, acked: false, cleared: T0 })
  ];

  it('counts the rows it is given, per band, and how many are taken over', () => {
    const counters = countAlarms(rows, T0);
    expect(counters.active).toBe(2);
    // 'a' is standing and unacknowledged, 'c' went WITHOUT an acknowledgement —
    // both are on the shift's backlog, so "target 0" must read 2, not 1.
    expect(counters.unacknowledged).toBe(2);
    expect(counters.byRank[1]).toBe(2);
    expect(counters.ackedByRank[1]).toBe(1);
    expect(counters.byRank[3]).toBe(1);
    expect(counters.cleared).toBe(1);
    expect(counters.last?.id).toBe('a');
  });

  it('buckets on ten aligned minutes and flags the EEMUA overload', () => {
    // All inside ONE ten-minute bucket, clear of the boundary at T0.
    const flood = Array.from({ length: EEMUA_THRESHOLD + 1 }, (_, index) =>
      alarm({ id: `f${index}`, raised: T0 - MINUTE - index * 1000 })
    );
    const histogram = alarmHistogram(flood, T0);
    expect(histogram.bucketMs).toBe(BUCKET_MS);
    expect(histogram.threshold).toBe(EEMUA_THRESHOLD);
    expect(histogram.buckets.some((bucket) => bucket.overThreshold)).toBe(true);
  });

  it('scales the bucket AND the threshold for a wide period', () => {
    const week = 7 * 24 * 60 * MINUTE;
    expect(bucketFor(week)).toBeGreaterThan(BUCKET_MS);
    expect(thresholdFor(bucketFor(week))).toBeGreaterThan(EEMUA_THRESHOLD);
    const histogram = alarmHistogram(rows, T0, week, bucketFor(week));
    expect(histogram.threshold).toBe(thresholdFor(histogram.bucketMs));
  });

  it('tops the recurring alarms by text or by datapoint, worst band kept', () => {
    const repeated = [
      alarm({ id: '1', text: 'High temperature', rank: 3 }),
      alarm({ id: '2', text: 'High temperature', rank: 1 }),
      alarm({ id: '3', text: 'Door open', dpe: 'System1:Oven07.door', dp: 'Oven07' })
    ];
    const byText = topActors(repeated, 'text');
    expect(byText[0]?.count).toBe(2);
    expect(byText[0]?.rank).toBe(1);
    expect(topActors(repeated, 'dp')).toHaveLength(2);
  });
});

describe('occurrence window', () => {
  it('keeps counting an occurrence after it cleared — the tally is not the live set', () => {
    // The live subscription drops an alarm when it goes; the window must not,
    // otherwise "most frequent" walks backwards every time the plant recovers.
    const archived = [alarm({ id: 'x', raised: T0 - MINUTE, cleared: T0 })];
    const live: Alarm[] = [];
    expect(mergeOccurrences(archived, live, T0 - 10 * MINUTE)).toHaveLength(1);
  });

  it('lets the live row supersede its archived copy of the same occurrence', () => {
    const archived = [alarm({ id: 'x', raised: T0, acked: false })];
    const live = [alarm({ id: 'x', raised: T0, acked: true })];
    const merged = mergeOccurrences(archived, live, T0 - MINUTE);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.acked).toBe(true);
  });

  it('drops what aged out of the window', () => {
    const rows = [alarm({ id: 'old', raised: T0 - 60 * MINUTE }), alarm({ id: 'new', raised: T0 })];
    expect(mergeOccurrences(rows, [], T0 - 10 * MINUTE).map((row) => row.id)).toEqual(['new']);
  });
});

describe('periods', () => {
  const now = Date.parse('2026-03-10T14:30:00.000Z');

  it('resolves a rolling window that ends now', () => {
    const range = resolvePeriod('24h', now);
    expect(range.end).toBe(now);
    expect(now - range.start).toBe(24 * 60 * MINUTE);
  });

  it('shifts back by whole periods', () => {
    const current = resolvePeriod('7d', now);
    const previous = resolvePeriod('7d', now, { shift: 1 });
    expect(previous.end).toBeLessThan(current.start + 1);
    expect(previous.end - previous.start).toBe(current.end - current.start);
  });

  it('reads the ix-date-input format and orders an inverted custom range', () => {
    expect(toDateInput(parseDateInput('2026-03-01'))).toBe('2026-03-01');
    const range = resolvePeriod('custom', now, { customStart: '2026-03-05', customEnd: '2026-03-01' });
    expect(range.start).toBeLessThan(range.end);
    expect(Number.isNaN(parseDateInput('nope'))).toBe(true);
  });

  it('falls back to the day when a custom range is incomplete', () => {
    const range = resolvePeriod('custom', now, { customStart: '2026-03-05' });
    expect(range.end).toBeGreaterThan(range.start);
  });
});
