// pmon replies → the managers table fields (issue 33): MGRLIST:LIST keeps the start mode
// and the restart settings, MGRLIST:STATI gives the start time (parsed to ISO once, in the
// manager) and the manager number.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The manager is CommonJS (deployed outside this "type": "module" package): copied to .cjs for the test.
const src = fileURLToPath(new URL('../managers/processMonitor/pmon-client.js', import.meta.url));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pmon-parse-')), 'pmon-client.cjs');
fs.copyFileSync(src, tmp);
const require = createRequire(import.meta.url);
const { mergeManagers, parseList, parsePmonTime, parseStati } = require(tmp);

// A pmon reply, CRLF line ends included (pmon on Windows).
const LIST = [
  'LIST:6',
  'WCCILpmon;manual;30;3;1;',
  'WCCILdata;always;30;3;1;',
  'WCCOAvalarch;always;30;3;1;-num 0',
  'WCCOActrl;once;30;3;1;-num 1 -f pvss_scripts.lst',
  'WCCOAs7plus;manual;45;5;2;-num 4',
  'WCCOAjavascript;always;30;3;5;-num 5 processMonitor/index.js;extra',
  ';'
].join('\r\n');

const STATI = [
  'LIST:6',
  '2;4120;0;2026.10.17 06:02:14.512;0',
  '2;4188;2;2026.10.17 06:02:15.020;0',
  '2;4204;2;2026.10.17 06:02:16.731;0',
  '2;4302;1;2026.10.29 10:12:33.123;1',
  '0;-1;0;1970.01.01 01:00:00.000;4',
  '2;4452;2;;5',
  ' 2 RUNNING 0 0 0;'
].join('\r\n');

const local = (y, mo, d, h, mi, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).toISOString();

describe('parseList', () => {
  it('keeps the start mode and the restart settings (columns 2 to 5)', () => {
    const list = parseList(LIST);
    expect(list).toHaveLength(6);
    expect(list[4]).toEqual({ index: 4, manager: 'WCCOAs7plus', startMode: 'manual', secKill: 45, restartCount: 5, resetMin: 2, commandlineOptions: '-num 4' });
    expect(list[5].commandlineOptions).toBe('-num 5 processMonitor/index.js;extra');
  });

  it('reads a numeric start mode as its config/progs word', () => {
    expect(parseList('LIST:1\nWCCILdata;2;30;3;1;\n;')[0].startMode).toBe('always');
  });
});

describe('parseStati', () => {
  it('reads one line per manager and skips the closing mode line', () => {
    const stat = parseStati(STATI);
    expect(stat).toHaveLength(6);
    expect(stat[3]).toEqual({ state: 2, pid: 4302, startMode: 1, startTime: '2026.10.29 10:12:33.123', manNum: 1 });
    expect(stat[5].startTime).toBe('');
  });
});

describe('parsePmonTime', () => {
  it('reads pmon\'s format as the host\'s local time', () => {
    expect(parsePmonTime('2026.10.29 10:12:33.123')).toBe(local(2026, 10, 29, 10, 12, 33, 123));
  });

  it('is tolerant: other separators, no milliseconds, no seconds, day first', () => {
    expect(parsePmonTime('2026-10-29 10:12:33')).toBe(local(2026, 10, 29, 10, 12, 33));
    expect(parsePmonTime('2026/10/29T10:12')).toBe(local(2026, 10, 29, 10, 12));
    expect(parsePmonTime('29.10.2026 10:12:33,5')).toBe(local(2026, 10, 29, 10, 12, 33, 500));
  });

  it('no time: empty, or the 1970 epoch of a manager that never ran', () => {
    expect(parsePmonTime('')).toBe('');
    expect(parsePmonTime('   ')).toBe('');
    expect(parsePmonTime('1970.01.01 01:00:00.000')).toBe('');
  });

  it('keeps the raw text when it cannot be read', () => {
    expect(parsePmonTime('yesterday')).toBe('yesterday');
    expect(parsePmonTime('2026.02.30 10:00:00')).toBe('2026.02.30 10:00:00');
  });
});

describe('mergeManagers', () => {
  it('gives the page every pmon field, a stopped manager without start time', () => {
    const managers = mergeManagers(parseList(LIST), parseStati(STATI));
    expect(managers[3]).toEqual({
      index: 3,
      name: 'WCCOActrl',
      options: '-num 1 -f pvss_scripts.lst',
      startModeCfg: 'once',
      secKill: 30,
      restartCount: 3,
      resetMin: 1,
      state: 2,
      stateLabel: 'running',
      pid: 4302,
      startMode: 1,
      startTime: local(2026, 10, 29, 10, 12, 33, 123),
      manNum: 1
    });
    expect(managers[4]).toMatchObject({ name: 'WCCOAs7plus', state: 0, stateLabel: 'stopped', startTime: '', manNum: 4 });
    expect(managers[5]).toMatchObject({ startTime: '', manNum: 5, resetMin: 5 });
  });

  it('a manager missing from STATI reads as stopped', () => {
    const [m] = mergeManagers(parseList('LIST:1\nWCCILdata;always;30;3;1;\n;'), []);
    expect(m).toMatchObject({ state: 0, stateLabel: 'stopped', pid: -1, startTime: '', manNum: 0 });
  });
});
