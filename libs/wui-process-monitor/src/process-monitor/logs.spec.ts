// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WinCC OA log parsing and the Logs tab's filters (issue 37), on log samples shaped like
 * a real project's `<project>/log`: multi-line CTRL errors, lines that are not entries,
 * `.bak` rotation, several files merged by time.
 */
import { describe, expect, it } from 'vitest';
import {
  appendLog,
  categoriesOf,
  exportFileName,
  filterEntries,
  highlightSegments,
  isMatcherError,
  keepLastLines,
  lineCount,
  makeMatcher,
  mergeByTime,
  mergeWithBak,
  parseHeader,
  parseLog,
  toCsv,
  toLogText,
  type LogFilter
} from './logs.js';

const PVSS_II = [
  'WCCILpmon     (0), 2026.10.29 06:02:14.512, SYS,   INFO,       0, , Manager started',
  'WCCILdata     (0), 2026.10.29 06:02:15.020, PARAM, WARNING,   54, Parameter incorrect, config file entry ignored: "maxBcmBufferSize"',
  'WCCOActrl     (1), 2026.10.29 10:12:33.123, CTRL,  WARNING,    5/ctrl, Location of the error: Module: CTRL',
  '    Script: pvss_scripts.lst',
  '    Line: 42',
  'In libs/wui/processMonitor.ctl, function main',
  'WCCOActrl     (1), 2026.10.29 10:12:34.001, CTRL,  SEVERE,    72/ctrl, Syntax error, user "operator1" from 10.0.4.17',
  'WCCOAvalarch  (0), 2026.10.29 10:13:00.500, REDU,  INFO,      12, Redundancy switched: SRV-SCADA-02 is active',
  'WCCILevent    (0), 2026.10.29 10:14:02.000, IMPL,  FATAL,      3, Out of memory, exiting',
  ''
].join('\r\n');

const ALL: LogFilter = { categories: [], minSeverity: '', text: '', regex: false };

describe('parsing', () => {
  it('reads the header fields', () => {
    const e = parseHeader('WCCOActrl     (1), 2026.10.29 10:12:33.123, CTRL, WARNING,    5/ctrl, Location of the error: Module: CTRL', 'PVSS_II.log');
    expect(e).toMatchObject({
      manager: 'WCCOActrl',
      manNum: 1,
      time: '2026.10.29 10:12:33.123',
      timeMs: new Date(2026, 9, 29, 10, 12, 33, 123).getTime(),
      category: 'CTRL',
      severity: 'warning',
      code: '5/ctrl',
      text: 'Location of the error: Module: CTRL'
    });
    expect(parseHeader('WCCILpmon     (0), 2026.10.29 06:02:14.512, SYS,   INFO,       0, , Manager started', 'x')?.text).toBe('Manager started');
    expect(parseHeader('In libs/wui/processMonitor.ctl, function main', 'x')).toBeNull();
  });

  it('keeps a multi-line entry together and every unknown line', () => {
    const entries = parseLog(PVSS_II, 'PVSS_II.log');
    expect(entries).toHaveLength(6);
    expect(entries[2].lines).toHaveLength(4);
    expect(entries[2].lines[3]).toBe('In libs/wui/processMonitor.ctl, function main');
    expect(lineCount(entries)).toBe(9);
    expect(entries.map((e) => e.severity)).toEqual(['info', 'warning', 'warning', 'severe', 'info', 'fatal']);
  });

  it('lines before the first header are entries of their own', () => {
    const entries = parseLog('Starting node manager\nlistening on 8443\nWCCOAjavascript (5), 2026.10.29 10:00:00.000, SYS, INFO, 0, ready\n', 'node_5.log');
    expect(entries.map((e) => e.lines.length)).toEqual([1, 1, 1]);
    expect(entries[0]).toMatchObject({ severity: '', category: '', text: 'Starting node manager' });
  });

  it('a live increment that starts mid-entry continues the last entry', () => {
    const first = parseLog(PVSS_II.split('\r\n').slice(0, 4).join('\n') + '\n', 'PVSS_II.log');
    const next = appendLog(first, '    Line: 42\nIn libs/wui/processMonitor.ctl, function main\nWCCILevent (0), 2026.10.29 10:14:02.000, IMPL, FATAL, 3, Out of memory\n', 'PVSS_II.log');
    expect(first[2].lines).toHaveLength(2); // the entries given are not changed
    expect(next).toHaveLength(4);
    expect(next[2].lines).toHaveLength(4);
    expect(next[3].severity).toBe('fatal');
  });
});

describe('.bak rotation and several files', () => {
  it('puts the .bak before the current file with a marker', () => {
    const bak = parseLog('WCCOActrl (1), 2026.10.28 23:59:58.000, CTRL, INFO, 0, before rotation\n', 'WCCOActrl1.bak');
    const cur = parseLog('WCCOActrl (1), 2026.10.29 00:00:01.000, CTRL, INFO, 0, after rotation\n', 'WCCOActrl1.log');
    const merged = mergeWithBak(bak, cur, 'WCCOActrl1.log', 'WCCOActrl1.bak');
    expect(merged.map((e) => e.marker ?? e.text)).toEqual(['before rotation', 'rotation', 'after rotation']);
    expect(merged.every((e) => e.source === 'WCCOActrl1.log')).toBe(true);
    expect(mergeWithBak([], cur, 'WCCOActrl1.log', 'WCCOActrl1.bak')).toHaveLength(1);
  });

  it('interleaves files by time, an entry without time staying after its predecessor', () => {
    const a = parseLog('A (1), 2026.10.29 10:00:00.000, CTRL, INFO, 0, a1\nA (1), 2026.10.29 10:00:02.000, CTRL, INFO, 0, a2\n  detail of a2\n', 'a.log');
    const b = parseLog('B (2), 2026.10.29 10:00:01.000, SYS, INFO, 0, b1\nB (2), 2026.10.29 10:00:02.000, SYS, INFO, 0, b2\n', 'b.log');
    expect(mergeByTime([a, b]).map((e) => e.text)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });
});

describe('filters', () => {
  const entries = parseLog(PVSS_II, 'PVSS_II.log');

  it('category and minimum severity', () => {
    expect(filterEntries(entries, { ...ALL, categories: ['ctrl'] }).entries).toHaveLength(2);
    expect(filterEntries(entries, { ...ALL, minSeverity: 'severe' }).entries.map((e) => e.severity)).toEqual(['severe', 'fatal']);
    expect(filterEntries(entries, { ...ALL, categories: ['CTRL', 'PARAM'], minSeverity: 'warning' }).entries).toHaveLength(3);
    expect(categoriesOf(entries)).toEqual(['CTRL', 'IMPL', 'PARAM', 'REDU', 'SYS']);
  });

  it('free text: case-insensitive, over every line of an entry, which stays whole', () => {
    const r = filterEntries(entries, { ...ALL, text: 'PROCESSMONITOR.CTL' });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].lines).toHaveLength(4);
  });

  it('optional regular expression; an invalid one filters nothing and says why', () => {
    expect(filterEntries(entries, { ...ALL, text: '\\d+\\.\\d+\\.\\d+\\.\\d+', regex: true }).entries).toHaveLength(1);
    expect(filterEntries(entries, { ...ALL, text: '10.0.4.17', regex: false }).entries).toHaveLength(1);
    const bad = filterEntries(entries, { ...ALL, text: '(', regex: true });
    expect(bad.error).not.toBe('');
    expect(bad.entries).toHaveLength(entries.length);
  });

  it('highlights every match', () => {
    const m = makeMatcher('ctrl', false);
    expect(isMatcherError(m)).toBe(false);
    const segments = highlightSegments('WCCOActrl (1) CTRL', isMatcherError(m) ? null : m);
    expect(segments).toEqual([
      { text: 'WCCOA', hit: false },
      { text: 'ctrl', hit: true },
      { text: ' (1) ', hit: false },
      { text: 'CTRL', hit: true }
    ]);
    expect(highlightSegments('abc', null)).toEqual([{ text: 'abc', hit: false }]);
  });

  it('the live tail keeps the last N lines, whole entries', () => {
    const kept = keepLastLines(entries, 5);
    expect(kept.map((e) => e.text)).toEqual(['Syntax error, user "operator1" from 10.0.4.17', 'Redundancy switched: SRV-SCADA-02 is active', 'Out of memory, exiting']);
    expect(keepLastLines(entries, 1)).toHaveLength(1);
  });
});

describe('export', () => {
  const entries = parseLog(PVSS_II, 'PVSS_II.log');

  it('.log: the raw lines', () => {
    expect(toLogText(entries)).toBe(PVSS_II.replace(/\r\n/g, '\n'));
  });

  it('CSV: time;manager;category;severity;text, a multi-line entry quoted in one field', () => {
    const rows = toCsv(entries.slice(1, 3)).split('\r\n');
    expect(rows[0]).toBe('time;manager;category;severity;text');
    expect(rows[1]).toBe('2026.10.29 06:02:15.020;WCCILdata (0);PARAM;warning;"Parameter incorrect, config file entry ignored: ""maxBcmBufferSize"""');
    expect(rows[2]).toBe('2026.10.29 10:12:33.123;WCCOActrl (1);CTRL;warning;"Location of the error: Module: CTRL\n    Script: pvss_scripts.lst\n    Line: 42\nIn libs/wui/processMonitor.ctl, function main"');
  });

  it('names the file after the host and the date', () => {
    expect(exportFileName('SRV-SCADA-01', 'csv', new Date(2026, 9, 29, 10, 5, 9))).toBe('logs_SRV-SCADA-01_20261029-100509.csv');
    expect(exportFileName('a/b', 'log', new Date(2026, 0, 2, 3, 4, 5))).toBe('logs_a_b_20260102-030405.log');
  });
});
