// The trace of each operation, written by the manager (issue 53): the History entry and the
// audit line, the user forwarded by the webserver, the 200-entry bound.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('../managers/processMonitor/history.js', import.meta.url));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'history-')), 'history.cjs');
fs.copyFileSync(src, tmp);
const require = createRequire(import.meta.url);
const { AUDIT_LEAVES, actorOf, auditValues, configChanges, prependEntry, traceOf } = require(tmp);

const NOW = () => new Date('2026-11-01T10:00:00.000Z');
const actor = { username: 'amichon', userId: 12, host: 'scada.local' };
const PC2 = { dp: 'System1:ProcessMonitor_Node_PC2', system: 'System1:', hostname: 'PC2' };

describe('traceOf', () => {
  it('traces a control with the manager name, the host and the outcome', () => {
    const { entry, audit } = traceOf('control', { cmd: { action: 'restart', index: 7 }, name: 'WCCOActrl', node: PC2, result: { ok: true } }, { actor, now: NOW });
    expect(entry).toEqual({ time: '2026-11-01T10:00:00.000Z', status: 'success', host: 'scada.local', user: 'amichon', action: 'manager', detail: 'WCCOActrl — restart', system: 'PC2' });
    expect(audit).toMatchObject({ action: 'RESTART', item: 'WCCOActrl', newval: 'restart', reason: 'PC2' });
  });

  it('traces a refused add with its reason, and an add not written to config/progs', () => {
    const cmd = { manager: { name: 'WCCOAjavascript', startMode: 'always', options: 'usersService/index.js' }, index: -1 };
    expect(traceOf('add', { cmd, node: PC2, result: { ok: false, error: 'nom invalide' } }, { now: NOW }).entry).toMatchObject({
      status: 'failed',
      detail: 'WCCOAjavascript — add (always, usersService/index.js) — nom invalide'
    });
    expect(traceOf('add', { cmd, node: PC2, result: { ok: true, warning: 'x' } }, { now: NOW }).entry.detail).toBe(
      'WCCOAjavascript — add (always, usersService/index.js) — config/progs not updated'
    );
  });

  it('traces an edit with the changes pmon reports, as the page did', () => {
    const before = { startMode: 'manual', secKill: 30, restartCount: 3, resetMin: 1, options: '-num 2' };
    const after = { ...before, startMode: 'always' };
    const { entry, audit } = traceOf(
      'update',
      { cmd: { index: 4, name: 'WCCOActrl', manager: after, restart: true }, node: PC2, result: { ok: true, detail: { before, after, restarted: true } } },
      { now: NOW }
    );
    expect(entry.detail).toBe('WCCOActrl (#4) — edit: startMode: manual → always — restarted');
    expect(JSON.parse(audit.oldval)).toMatchObject({ index: 4, startMode: 'manual' });
    expect(JSON.parse(audit.newval)).toMatchObject({ index: 4, startMode: 'always', restart: true });
  });

  it('traces a deploy with the servers and the protected folders skipped', () => {
    const result = { ok: false, results: [{ hostname: 'PC1', ok: true, skipped: ['config'] }, { hostname: 'PC2', ok: false, skipped: [] }] };
    const { entry } = traceOf('deploy', { fileName: 'proj.zip', clearFolders: ['panels'], restart: true, result }, { now: NOW });
    expect(entry).toMatchObject({ status: 'failed', detail: 'proj.zip [cleared: panels] [skipped: config] [restart] → PC1, PC2 (FAILED)' });
  });

  it('traces a refused instance deletion and a logs export', () => {
    expect(traceOf('delete-instance', { node: PC2, lastSeen: 'T0', state: 'connected', result: { ok: false, error: 'the agent answers' } }, { now: NOW }).entry.detail).toBe(
      'PC2 — System1:ProcessMonitor_Node_PC2 — last seen T0 — refused: the agent answers'
    );
    expect(traceOf('logs-export', { host: 'PC2', files: ['a.log', 'b.log'], kind: 'raw', mergeBak: true }, { now: NOW }).entry.detail).toBe('a.log, b.log — raw files [.bak merged]');
  });
});

describe('audit line and user', () => {
  it('writes the eleven _AuditTrail leaves in order', () => {
    const { audit } = traceOf('restart-all', { node: PC2, result: { ok: true } }, { actor, now: NOW });
    const values = auditValues(audit, actor);
    expect(values).toHaveLength(AUDIT_LEAVES.length);
    expect(values.slice(1)).toEqual(['amichon', 12, 0, 'project', 'ProcessMonitor', 'RESTART_ALL', '', '', 'PC2', 'scada.local']);
  });

  it('takes the session user first, else the user the page declares', () => {
    expect(actorOf({ actor: { username: 'srv', userId: 3, host: 'h', clientUser: { name: 'page', id: 9 } } })).toEqual({ username: 'srv', userId: 3, host: 'h' });
    expect(actorOf({ actor: { username: '', host: 'h', clientUser: { name: 'page', id: 9 } } })).toEqual({ username: 'page', userId: 9, host: 'h' });
    expect(actorOf({})).toEqual({ username: '', userId: 0, host: '' });
  });
});

describe('history list', () => {
  it('puts the newest first and keeps 200 entries', () => {
    const list = Array.from({ length: 200 }, (_, i) => ({ n: i }));
    const next = prependEntry(list, { n: 'new' });
    expect(next).toHaveLength(200);
    expect(next[0]).toEqual({ n: 'new' });
    expect(next[199]).toEqual({ n: 198 });
    expect(prependEntry(undefined, { n: 1 })).toEqual([{ n: 1 }]);
  });

  it('lists the changed configuration fields as the page did', () => {
    expect(configChanges({ startMode: 'always', secKill: 30, options: '-num  2' }, { startMode: 'always', secKill: 45, options: '-num 2' })).toEqual(['secKill: 30 → 45']);
  });
});
