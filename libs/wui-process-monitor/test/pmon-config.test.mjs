// Editing a pmon entry (SINGLE_MGR:PROP_PUT) and stop-then-delete of a running manager (issue 40),
// against a fake pmon that keeps a state per entry.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

// The manager is CommonJS (deployed outside this "type": "module" package): copied to .cjs for the test.
const src = fileURLToPath(new URL('../managers/processMonitor/pmon-client.js', import.meta.url));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pmon-config-')), 'pmon-client.cjs');
fs.copyFileSync(src, tmp);
const require = createRequire(import.meta.url);
const { PmonClient, checkUpdated, progsMatches } = require(tmp);

const entry = (name, { mode = 'always', secKill = 30, restartCount = 3, resetMin = 1, options = '', state = 2 } = {}) => ({ name, mode, secKill, restartCount, resetMin, options, state });

/**
 * Fake pmon. `state.list` holds the entries; PROP_PUT is applied when `state.applyProp`; STOP
 * stops the entry, and `state.restartAfterStop` makes pmon start it again right away (an
 * "always" manager restarted between the stop and the delete); DEL of a running entry is refused.
 */
function fakePmon(state) {
  const received = [];
  const server = net.createServer((sock) => {
    sock.on('data', (buf) => {
      const cmd = buf.toString().trim().replace(/^[^#]*#[^#]*#/, '');
      received.push(cmd);
      const list = state.list;
      if (cmd === 'MGRLIST:LIST') {
        const rows = list.map((e) => `${e.name};${e.mode};${e.secKill};${e.restartCount};${e.resetMin};${e.options}`);
        sock.end(`LIST:${rows.length}\n${rows.join('\n')}\n;`);
      } else if (cmd === 'MGRLIST:STATI') {
        sock.end(`LIST:${list.length}\n${list.map((e) => `${e.state};${e.state ? 100 : -1};2;2026.10.29 10:00:00.000;1`).join('\n')}\n;`);
      } else if (cmd.startsWith('SINGLE_MGR:PROP_PUT ')) {
        const [, idx, mode, secKill, restartCount, resetMin, ...opt] = cmd.split(' ');
        if (state.applyProp) Object.assign(list[Number(idx)], { mode, secKill: Number(secKill), restartCount: Number(restartCount), resetMin: Number(resetMin), options: opt.join(' ') });
        sock.end('');
      } else if (cmd.startsWith('SINGLE_MGR:STOP ')) {
        const e = list[Number(cmd.split(' ')[1])];
        if (!state.ignoreStop) e.state = 0;
        if (state.restartAfterStop) setTimeout(() => (e.state = 2), state.restartAfterStop);
        sock.end('');
      } else if (cmd.startsWith('SINGLE_MGR:DEL ')) {
        const idx = Number(cmd.split(' ')[1]);
        if (list[idx].state !== 0) sock.end(`ERROR SINGLE_MGR:DEL ${idx} not possible`);
        else {
          list.splice(idx, 1);
          sock.end('');
        }
      } else sock.end('');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port })));
}

let srv;
afterEach(() => srv?.server.close());

const pmonOf = async (state) => {
  srv = await fakePmon(state);
  return new PmonClient({ host: '127.0.0.1', port: srv.port, timeout: 1000 });
};

describe('updateManager (SINGLE_MGR:PROP_PUT)', () => {
  const baseList = () => [entry('WCCILpmon', { mode: 'manual' }), entry('WCCILdata'), entry('WCCOActrl', { mode: 'once', options: '-num 1 -f pvss_scripts.lst' })];
  const change = { index: 2, startMode: 'manual', secKill: 60, restartCount: 5, resetMin: 10, options: '-num 1 -f other.lst' };

  it('sends index, start mode, secKill, restart count, reset minutes, options — in that order', async () => {
    const pmon = await pmonOf({ list: baseList(), applyProp: true });
    const r = await pmon.updateManager({ ...change, expectName: 'WCCOActrl' });
    expect(srv.received).toContain('SINGLE_MGR:PROP_PUT 2 manual 60 5 10 -num 1 -f other.lst');
    expect(r.before).toMatchObject({ name: 'WCCOActrl', startModeCfg: 'once', secKill: 30 });
    expect(r.after).toMatchObject({ name: 'WCCOActrl', startModeCfg: 'manual', secKill: 60, restartCount: 5, resetMin: 10, options: '-num 1 -f other.lst' });
  });

  it('fails when pmon ignores the command (the re-read list does not carry the new values)', async () => {
    const pmon = await pmonOf({ list: baseList(), applyProp: false });
    await expect(pmon.updateManager(change)).rejects.toThrow(/n'a pas appliqué la modification de WCCOActrl \(#2\) : mode once ≠ manual, secKill 30 ≠ 60/);
  });

  it('refuses pmon itself, an unknown index, and an entry that is no longer the expected one', async () => {
    const pmon = await pmonOf({ list: baseList(), applyProp: true });
    await expect(pmon.updateManager({ ...change, index: 0 })).rejects.toThrow(/introuvable/);
    await expect(pmon.updateManager({ ...change, index: 9 })).rejects.toThrow(/introuvable/);
    await expect(pmon.updateManager({ ...change, expectName: 'WCCOAui' })).rejects.toThrow(/la liste a changé/);
    expect(srv.received.some((c) => c.startsWith('SINGLE_MGR:PROP_PUT'))).toBe(false);
  });
});

describe('stopThenRemove', () => {
  const baseList = () => [entry('WCCILpmon', { mode: 'manual' }), entry('WCCILdata'), entry('WCCOAopcua', { options: '-num 2' })];

  it('stops a running manager, waits for "stopped", then deletes it', async () => {
    const state = { list: baseList() };
    const pmon = await pmonOf(state);
    const r = await pmon.stopThenRemove(2, { expectName: 'WCCOAopcua', pollMs: 20 });
    expect(r.stopped).toBe(true);
    const cmds = srv.received.filter((c) => c.startsWith('SINGLE_MGR'));
    expect(cmds).toEqual(['SINGLE_MGR:STOP 2', 'SINGLE_MGR:DEL 2']);
    expect(state.list.map((e) => e.name)).toEqual(['WCCILpmon', 'WCCILdata']);
  });

  it('deletes a stopped manager without stopping it', async () => {
    const list = baseList();
    list[2].state = 0;
    const pmon = await pmonOf({ list });
    expect((await pmon.stopThenRemove(2, { pollMs: 20 })).stopped).toBe(false);
    expect(srv.received.filter((c) => c.startsWith('SINGLE_MGR'))).toEqual(['SINGLE_MGR:DEL 2']);
  });

  it('reports an "always" manager that pmon started again before the delete — once, no loop', async () => {
    // pmon starts it again 1 ms after the stop: the poll may or may not see it stopped, so
    // whichever way it goes the manager is not deleted and the error says why.
    const state = { list: baseList(), restartAfterStop: 1 };
    const pmon = await pmonOf(state);
    const err = await pmon.stopThenRemove(2, { pollMs: 5, waitMs: 300 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/redémarré WCCOAopcua|ne s'est pas arrêté/);
    expect(state.list.map((e) => e.name)).toContain('WCCOAopcua');
    expect(srv.received.filter((c) => c.startsWith('SINGLE_MGR:STOP')).length).toBe(1);
    expect(srv.received.filter((c) => c.startsWith('SINGLE_MGR:DEL')).length).toBeLessThanOrEqual(1);
  });

  it('reports a restart between a seen "stopped" and the delete with an explicit message', async () => {
    const state = { list: baseList() };
    const pmon = await pmonOf(state);
    // Seen stopped by the poll, then started again by pmon before the DEL arrives.
    const remove = pmon.removeManager.bind(pmon);
    pmon.removeManager = async (index) => {
      state.list[index].state = 2;
      return remove(index);
    };
    await expect(pmon.stopThenRemove(2, { pollMs: 10 })).rejects.toThrow(/pmon a redémarré WCCOAopcua \(#2, mode always\) entre l'arrêt et la suppression : non supprimé/);
    expect(state.list.map((e) => e.name)).toContain('WCCOAopcua');
  });

  it('gives up after the timeout when the manager does not stop, without deleting', async () => {
    const state = { list: baseList(), ignoreStop: true };
    const pmon = await pmonOf(state);
    await expect(pmon.stopThenRemove(2, { pollMs: 10, waitMs: 80 })).rejects.toThrow(/ne s'est pas arrêté en 0 s : non supprimé/);
    expect(srv.received.some((c) => c.startsWith('SINGLE_MGR:DEL'))).toBe(false);
  });

  it('refuses an entry that is no longer the expected one', async () => {
    const pmon = await pmonOf({ list: baseList() });
    await expect(pmon.stopThenRemove(2, { expectName: 'WCCOAui' })).rejects.toThrow(/la liste a changé/);
    expect(srv.received.some((c) => c.startsWith('SINGLE_MGR'))).toBe(false);
  });
});

describe('checks', () => {
  const m = (over) => ({ name: 'WCCOActrl', startModeCfg: 'once', secKill: 30, restartCount: 3, resetMin: 1, options: '-num 1', ...over });

  it('checkUpdated accepts the wanted values only', () => {
    const wanted = { startModeCfg: 'manual', secKill: 60, restartCount: 3, resetMin: 1, options: '-num 1' };
    expect(checkUpdated([m(), m()], [m(), m({ startModeCfg: 'manual', secKill: 60 })], 1, wanted)).toBe('');
    expect(checkUpdated([m(), m()], [m(), m()], 1, wanted)).toMatch(/mode once ≠ manual, secKill 30 ≠ 60/);
    expect(checkUpdated([m(), m()], [m()], 1, wanted)).toMatch(/n'a pas conservé/);
  });

  it('progsMatches strict also compares the start mode and the restart settings', () => {
    const progs = [{ name: 'WCCOActrl', startMode: 'once', secKill: '30', restartCount: '3', resetMin: '1', options: '-num 1' }];
    expect(progsMatches(progs, [m()], { strict: true })).toBe(true);
    expect(progsMatches(progs, [m({ startModeCfg: 'manual' })])).toBe(true);
    expect(progsMatches(progs, [m({ startModeCfg: 'manual' })], { strict: true })).toBe(false);
    expect(progsMatches(progs, [m({ resetMin: 10 })], { strict: true })).toBe(false);
  });
});
