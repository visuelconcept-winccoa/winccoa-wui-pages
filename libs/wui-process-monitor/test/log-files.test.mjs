// Log files of <project>/log for the Logs tab (issue 37): discovery, names checked against
// the listing, tail read from the end, incremental reads by offset, .bak merge.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The manager is CommonJS (deployed outside this "type": "module" package): copied to .cjs for the test.
const src = fileURLToPath(new URL('../managers/processMonitor/log-files.js', import.meta.url));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'log-files-')), 'log-files.cjs');
fs.copyFileSync(src, tmp);
const require = createRequire(import.meta.url);
const { BLOCK_BYTES, bakBase, listLogFiles, managerOfLog, readLogFiles } = require(tmp);

const line = (i) => `WCCOActrl     (1), 2026.10.29 10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000, CTRL, INFO, 0, , line ${i}`;
const lines = (from, to) => Array.from({ length: to - from }, (_, k) => line(from + k)).join('\n') + '\n';

const PMON_LIST = [
  { index: 0, name: 'WCCILpmon', manNum: 0 },
  { index: 4, name: 'WCCOActrl', manNum: 1 },
  { index: 8, name: 'WCCOAjavascript', manNum: 5 }
];

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-log-'));
  fs.writeFileSync(path.join(dir, 'PVSS_II.log'), lines(0, 10));
  fs.writeFileSync(path.join(dir, 'WCCOActrl1.log'), lines(100, 110));
  fs.writeFileSync(path.join(dir, 'WCCOActrl1.bak'), lines(0, 100));
  fs.writeFileSync(path.join(dir, 'node_5.log'), 'listening\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a log');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'hidden.log'), 'x\n');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('discovery', () => {
  it('lists the .log / .bak files of the folder, with their .bak and their manager', async () => {
    const files = await listLogFiles(dir, PMON_LIST);
    expect(files.map((f) => f.name)).toEqual(['node_5.log', 'PVSS_II.log', 'WCCOActrl1.bak', 'WCCOActrl1.log']);
    const ctrl = files.find((f) => f.name === 'WCCOActrl1.log');
    expect(ctrl).toMatchObject({ bak: 'WCCOActrl1.bak', manager: { name: 'WCCOActrl', manNum: 1, index: 4 } });
    expect(files.find((f) => f.name === 'WCCOActrl1.bak')).toMatchObject({ bakOf: 'WCCOActrl1.log', bak: '' });
    expect(files.find((f) => f.name === 'node_5.log').manager).toEqual({ name: 'WCCOAjavascript', manNum: 5, index: 8 });
    expect(files.find((f) => f.name === 'PVSS_II.log').manager).toBeNull();
  });

  it('maps manager names and rotations', () => {
    expect(managerOfLog('WCCILpmon.log', PMON_LIST)).toEqual({ name: 'WCCILpmon', manNum: 0, index: 0 });
    expect(managerOfLog('WCCOAs7plus4.log')).toEqual({ name: 'WCCOAs7plus', manNum: 4, index: null });
    expect(bakBase('PVSS_II.log.bak')).toBe('PVSS_II.log');
    expect(bakBase('WCCOActrl1.bak')).toBe('WCCOActrl1.log');
    expect(bakBase('WCCOActrl1.log')).toBe('');
  });
});

describe('reading', () => {
  it('refuses a name that is not in the listing: no path, no other folder', async () => {
    for (const name of ['../config/config', 'sub/hidden.log', 'notes.txt', 'missing.log']) {
      const r = await readLogFiles(dir, { files: [name], maxLines: 10 });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/unknown log file/);
    }
  });

  it('the tail gives the last N lines and the offset of the end', async () => {
    const r = await readLogFiles(dir, { files: ['WCCOActrl1.log'], maxLines: 3 });
    const [f] = r.files;
    expect(f.text).toBe(lines(107, 110));
    expect(f.truncated).toBe(true);
    expect(f.offset).toBe(fs.statSync(path.join(dir, 'WCCOActrl1.log')).size);
  });

  it('reads a big file from the end in blocks', async () => {
    const big = lines(0, 20000);
    expect(big.length).toBeGreaterThan(4 * BLOCK_BYTES);
    fs.writeFileSync(path.join(dir, 'WCCILevent.log'), big);
    const [f] = (await readLogFiles(dir, { files: ['WCCILevent.log'], maxLines: 5 })).files;
    expect(f.text).toBe(lines(19995, 20000));
  });

  it('an incremental read sends only what was written, a line being written waits', async () => {
    const file = path.join(dir, 'WCCOActrl1.log');
    const [first] = (await readLogFiles(dir, { files: ['WCCOActrl1.log'], maxLines: 2 })).files;
    fs.appendFileSync(file, `${line(110)}\n${line(111)}\nIn ctrl_script.ctl line 4`);
    const [next] = (await readLogFiles(dir, { files: ['WCCOActrl1.log'], fromOffset: { 'WCCOActrl1.log': first.offset } })).files;
    expect(next.text).toBe(`${line(110)}\n${line(111)}\n`);
    expect(next.reset).toBe(false);
    fs.appendFileSync(file, ', function main\n');
    const [last] = (await readLogFiles(dir, { files: ['WCCOActrl1.log'], fromOffset: { 'WCCOActrl1.log': next.offset } })).files;
    expect(last.text).toBe('In ctrl_script.ctl line 4, function main\n');
  });

  it('a file shorter than the offset was rotated: its tail comes again, marked reset', async () => {
    const file = path.join(dir, 'WCCOActrl1.log');
    fs.writeFileSync(file, lines(200, 202));
    const [f] = (await readLogFiles(dir, { files: ['WCCOActrl1.log'], fromOffset: { 'WCCOActrl1.log': 99999 }, maxLines: 10, mergeBak: true })).files;
    expect(f).toMatchObject({ reset: true, text: lines(200, 202) });
    expect(f.bak.name).toBe('WCCOActrl1.bak');
  });

  it('merges the .bak: the lines the current file lacks, or all of it for a whole read', async () => {
    const [tail] = (await readLogFiles(dir, { files: ['WCCOActrl1.log'], maxLines: 15, mergeBak: true })).files;
    expect(tail.text).toBe(lines(100, 110));
    expect(tail.bak).toEqual({ name: 'WCCOActrl1.bak', text: lines(95, 100), truncated: true });
    const [whole] = (await readLogFiles(dir, { files: ['WCCOActrl1.log'], maxLines: 0, mergeBak: true })).files;
    expect(whole.bak.text).toBe(lines(0, 100));
    expect(whole.text).toBe(lines(100, 110));
    const [noBak] = (await readLogFiles(dir, { files: ['WCCOActrl1.log'], maxLines: 15 })).files;
    expect(noBak.bak).toBeUndefined();
  });

  it('decodes a Latin-1 log (non-UTF-8 project)', async () => {
    fs.writeFileSync(path.join(dir, 'WCCILdata.log'), Buffer.from('Paramètre incorrect\n', 'latin1'));
    const [f] = (await readLogFiles(dir, { files: ['WCCILdata.log'], maxLines: 0 })).files;
    expect(f.text).toBe('Paramètre incorrect\n');
  });
});
