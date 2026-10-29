// Ajout / suppression d'un manager par le socket TCP de pmon (issue 35) : la commande envoyée,
// le contrôle du résultat dans MGRLIST:LIST, et la vérification de config/progs.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

// Le manager est en CommonJS (déployé hors de ce package, dont le "type" est "module") : copié en .cjs pour le test.
const src = fileURLToPath(new URL('../managers/processMonitor/pmon-client.js', import.meta.url));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pmon-client-')), 'pmon-client.cjs');
fs.copyFileSync(src, tmp);
const require = createRequire(import.meta.url);
const { PmonClient, checkInserted, checkRemoved, parseProgs, progsMatches } = require(tmp);

const m = (name, options = '') => ({ name, options });
const PMON = m('WCCILpmon');
const DATA = m('WCCILdata');
const CTRL = m('WCCOActrl', '-num 1 -f pvss_scripts.lst');

/** Faux pmon : répond à MGRLIST:LIST selon `state.list`, applique INS / DEL si `state.apply`. */
function fakePmon(state) {
  const received = [];
  const server = net.createServer((sock) => {
    sock.on('data', (buf) => {
      const line = buf.toString().trim();
      received.push(line);
      const cmd = line.replace(/^[^#]*#[^#]*#/, '');
      if (cmd === 'MGRLIST:LIST') {
        const rows = state.list.map((e) => `${e.name};always;30;3;1;${e.options}`);
        sock.end(`LIST:${rows.length}\n${rows.join('\n')}\n;`);
      } else if (cmd === 'MGRLIST:STATI') {
        sock.end(`LIST:${state.list.length}\n${state.list.map(() => '2;100;2;2026.10.29 10:00:00.000;1').join('\n')}\n;`);
      } else if (cmd.startsWith('SINGLE_MGR:INS ')) {
        const [, idx, name, , , , , ...opt] = cmd.split(' ');
        if (state.apply) state.list.splice(Number(idx), 0, m(name, opt.join(' ')));
        sock.end(state.reply ?? '');
      } else if (cmd.startsWith('SINGLE_MGR:DEL ')) {
        if (state.apply) state.list.splice(Number(cmd.split(' ')[1]), 1);
        sock.end(state.reply ?? '');
      } else sock.end('');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port })));
}

let srv;
afterEach(() => srv?.server.close());

describe('pmon : ajout et suppression contrôlés', () => {
  it('envoie SINGLE_MGR:INS dans l\'ordre attendu par pmon et vérifie la nouvelle entrée', async () => {
    srv = await fakePmon({ list: [PMON, DATA], apply: true });
    const client = new PmonClient({ host: '127.0.0.1', port: srv.port });
    await client.addManager({ index: 2, name: 'WCCOActrl', startMode: 'always', secKill: 30, restartCount: 3, resetMin: 1, options: '-num 1 -f pvss_scripts.lst' });
    expect(srv.received).toContain('##SINGLE_MGR:INS 2 WCCOActrl always 30 3 1 -num 1 -f pvss_scripts.lst');
  });

  it('refuse un ajout acquitté en silence mais ignoré par pmon', async () => {
    srv = await fakePmon({ list: [PMON, DATA], apply: false });
    const client = new PmonClient({ host: '127.0.0.1', port: srv.port });
    await expect(client.addManager({ index: 2, name: 'WCCOActrl', options: '-num 1' })).rejects.toThrow(/n'a pas ajouté WCCOActrl en position 2/);
  });

  it('refuse une suppression acquittée en silence mais ignorée', async () => {
    srv = await fakePmon({ list: [PMON, DATA, CTRL], apply: false });
    const client = new PmonClient({ host: '127.0.0.1', port: srv.port });
    await expect(client.removeManager(2)).rejects.toThrow(/n'a pas supprimé l'entrée 2 \(WCCOActrl\)/);
  });

  it('accepte une suppression appliquée', async () => {
    srv = await fakePmon({ list: [PMON, DATA, CTRL], apply: true });
    const client = new PmonClient({ host: '127.0.0.1', port: srv.port });
    await client.removeManager(2);
    expect(srv.received).toContain('##SINGLE_MGR:DEL 2');
  });

  it('checkInserted / checkRemoved', () => {
    expect(checkInserted([PMON, DATA], [PMON, DATA, CTRL], { index: 2, name: 'WCCOActrl', options: '-num 1  -f pvss_scripts.lst' })).toBe('');
    expect(checkInserted([PMON, DATA], [PMON, CTRL, DATA], { index: 2, name: 'WCCOActrl', options: '' })).not.toBe('');
    expect(checkRemoved([PMON, DATA, CTRL], [PMON, DATA], 2)).toBe('');
    expect(checkRemoved([PMON, DATA, CTRL], [PMON, DATA, CTRL], 2)).not.toBe('');
  });
});

describe('config/progs', () => {
  const PROGS = [
    'version 1',
    '',
    'auth "" ""',
    '#Manager         | Start  | SecKill | Restart# | ResetMin | Options',
    'WCCILpmon        | manual |      30 |        3 |        1 |',
    'WCCILdata        | always |      30 |        3 |        1 |',
    'WCCOActrl        | always |      30 |        3 |        1 |-num 1 -f pvss_scripts.lst',
    ''
  ].join('\r\n');

  it('lit les lignes de managers dans l\'ordre de pmon', () => {
    expect(parseProgs(PROGS).map((e) => [e.name, e.startMode, e.options])).toEqual([
      ['WCCILpmon', 'manual', ''],
      ['WCCILdata', 'always', ''],
      ['WCCOActrl', 'always', '-num 1 -f pvss_scripts.lst']
    ]);
  });

  it('dit si config/progs reflète la liste de pmon', () => {
    expect(progsMatches(parseProgs(PROGS), [PMON, DATA, CTRL])).toBe(true);
    expect(progsMatches(parseProgs(PROGS), [PMON, DATA, CTRL, m('node', '-num 5 processMonitor/index.js')])).toBe(false);
    expect(progsMatches(parseProgs(PROGS), [PMON, DATA])).toBe(false);
  });
});
