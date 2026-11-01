// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The trace of every operation of the Process Monitor page, written by THIS manager — the
 * one that performs the operation and knows its real outcome (issue 53) — instead of the
 * browser after the fact:
 *   - a line of the GxP audit trail (`_AuditTrail` DP `AuditTrail_ProcessMonitor`);
 *   - an entry of the History tab (JSON list, newest first, 200 at most, in the DP
 *     `ProcessMonitor_History.json` — the same DP and format the page used to write).
 *
 * The user comes from the webserver: its session identity when it has one, else the user the
 * page declares (the WebUI authenticates on its websocket, not on HTTP) — `actor`.
 * `actor.host`: the host the page was served from, as the page used to record it.
 *
 * Pure Node: `traceOf(op, …)` builds `{ entry, audit }`; index.js writes them.
 */
'use strict';

const HISTORY_CAP = 200;
const AUDIT_DP = 'AuditTrail_ProcessMonitor';
const AUDIT_ITEM_TYPE = 'ProcessMonitor';
const HISTORY_DP = 'ProcessMonitor_History';
/** `_AuditTrail` leaves, in GxP order (wui-kit audit-trail.ts). */
const AUDIT_LEAVES = ['time', 'username', 'uinum', 'batchid', 'item', 'itemtype', 'action', 'oldval', 'newval', 'reason', 'host'];

/** The label of a node in the traces: hostname, else its system without ':', else 'local'. */
function nodeLabel(node) {
  const system = String(node?.system || '').replace(/:$/, '');
  return node?.hostname || system || 'local';
}

/**
 * The configuration fields that differ between two pmon entries (before / after) — the same
 * text as the page's `configChanges` (src/process-monitor/managers.ts).
 */
function configChanges(before, after) {
  if (!before || !after) return [];
  const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const out = [];
  if (before.startMode !== after.startMode) out.push(`startMode: ${before.startMode} → ${after.startMode}`);
  for (const key of ['secKill', 'restartCount', 'resetMin']) {
    if (before[key] !== after[key]) out.push(`${key}: ${before[key]} → ${after[key]}`);
  }
  if (norm(before.options) !== norm(after.options)) out.push(`options: "${before.options ?? ''}" → "${after.options ?? ''}"`);
  return out;
}

const json = (v) => JSON.stringify(v);

/**
 * `{ entry, audit }` of one operation. `op`:
 *   control  { cmd: {action: start|stop|restart, index}, name, node, result }
 *   add      { cmd: {manager, index}, node, result }
 *   remove   { cmd: {index, name, stopFirst}, options, node, result }
 *   update   { cmd: {index, name, manager, restart}, node, result }   result.detail: {before, after, restarted}
 *   restart-all { node, result }
 *   delete-instance { node: {dp, system, hostname}, lastSeen, state, result }
 *   deploy   { fileName, clearFolders, restart, result: {ok, results[]} }
 *   logs-export { host, files, kind, format, mergeBak }
 */
function traceOf(op, args, { actor = {}, now = () => new Date() } = {}) {
  const time = now().toISOString();
  const ok = args.result ? args.result.ok === true : true;
  const status = ok ? 'success' : 'failed';
  const unsaved = ok && args.result?.warning ? ' — config/progs not updated' : '';
  const failure = !ok && args.result?.error ? ` — ${args.result.error}` : '';
  const base = { time, status, host: actor.host || '', user: actor.username || '' };
  const label = nodeLabel(args.node);
  let entry;
  let audit;
  switch (op) {
    case 'control': {
      const { action } = args.cmd;
      entry = { action: 'manager', detail: `${args.name || `#${args.cmd.index}`} — ${action}${failure}`, system: label };
      audit = { action: action.toUpperCase(), item: args.name || `#${args.cmd.index}`, newval: action, reason: label };
      break;
    }
    case 'add': {
      const m = args.cmd.manager || {};
      const parts = [m.startMode, m.options, args.cmd.index >= 1 ? `#${args.cmd.index}` : ''].filter(Boolean);
      entry = { action: 'manager', detail: `${m.name} — add (${parts.join(', ')})${unsaved}${failure}`, system: label };
      audit = { action: 'ADD', item: m.name, newval: json({ ...m, ...(args.cmd.index >= 1 ? { index: args.cmd.index } : {}) }), reason: label };
      break;
    }
    case 'remove': {
      const { index, name, stopFirst } = args.cmd;
      const stop = stopFirst ? ' — stopped first' : '';
      entry = { action: 'manager', detail: `${name || '?'} — remove (#${index})${stop}${unsaved}${failure}`, system: label };
      audit = { action: 'REMOVE', item: name || `#${index}`, oldval: json({ index, options: args.options ?? '', stopFirst: stopFirst === true }), reason: label };
      break;
    }
    case 'update': {
      const { index, name, manager, restart } = args.cmd;
      const detail = args.result?.detail || {};
      const before = detail.before || null;
      const after = detail.after || manager;
      const changes = configChanges(before, after);
      const notes = [detail.restarted ? 'restarted' : '', ok && args.result?.warning ? 'config/progs not updated' : ''].filter(Boolean);
      entry = {
        action: 'manager-config',
        detail: `${name || '?'} (#${index}) — edit: ${changes.join(', ') || 'no change'}${notes.length > 0 ? ` — ${notes.join(', ')}` : ''}${failure}`,
        system: label
      };
      audit = { action: 'EDIT', item: name || `#${index}`, oldval: before ? json({ index, ...before }) : '', newval: json({ index, ...after, restart: restart === true }), reason: label };
      break;
    }
    case 'restart-all':
      entry = { action: 'restart-all', detail: `all managers${failure}`, system: label };
      audit = { action: 'RESTART_ALL', item: 'project', reason: label };
      break;
    case 'delete-instance': {
      const n = args.node || {};
      const host = n.hostname || n.dp || '?';
      const refused = !ok && args.result?.error ? ` — refused: ${args.result.error}` : '';
      const system = String(n.system || '').replace(/:$/, '');
      entry = { action: 'delete-instance', detail: `${host} — ${n.dp} — last seen ${args.lastSeen || '?'}${refused}`, system };
      audit = {
        action: 'DELETE_INSTANCE',
        item: host,
        oldval: json({ dp: n.dp, system: n.system, hostname: n.hostname, lastSeen: args.lastSeen || '', state: args.state || '' }),
        reason: system || host
      };
      break;
    }
    case 'deploy': {
      const results = args.result?.results || [];
      const cleared = args.clearFolders?.length > 0 ? ` [cleared: ${args.clearFolders.join(', ')}]` : '';
      const servers = results.map((r) => `${r.hostname || r.system || 'local'}${r.ok ? '' : ' (FAILED)'}`).join(', ');
      const skipped = [...new Set(results.flatMap((r) => r.skipped || []))];
      const skippedNote = skipped.length > 0 ? ` [skipped: ${skipped.join(', ')}]` : '';
      const restartNote = args.restart ? ' [restart]' : '';
      entry = { action: 'deploy', detail: `${args.fileName}${cleared}${skippedNote}${restartNote}${servers ? ` → ${servers}` : ''}`, system: servers };
      audit = { action: 'IMPORT', item: args.fileName, newval: json({ clearFolders: args.clearFolders, restart: args.restart, ok, results }) };
      break;
    }
    case 'logs-export': {
      const what = args.kind === 'raw' ? 'raw files' : `displayed entries (${args.format})`;
      const bak = args.mergeBak ? ' [.bak merged]' : '';
      entry = { action: 'logs-export', detail: `${args.files.join(', ')} — ${what}${bak}`, system: args.host || '' };
      audit = { action: 'EXPORT_LOGS', item: args.files.join(', '), newval: json({ kind: args.kind, format: args.format, mergeBak: args.mergeBak === true }), reason: args.host || '' };
      break;
    }
    default:
      throw new Error(`unknown operation ${op}`);
  }
  return { entry: { ...base, ...entry }, audit: { time, ...audit } };
}

/** The values of the audit leaves for one record (AUDIT_LEAVES order). */
function auditValues(audit, actor = {}) {
  return [
    new Date(audit.time),
    actor.username || '',
    Number.isInteger(actor.userId) && actor.userId >= 0 ? actor.userId : 0,
    0,
    audit.item || '',
    AUDIT_ITEM_TYPE,
    audit.action,
    audit.oldval || '',
    audit.newval || '',
    audit.reason || '',
    actor.host || ''
  ];
}

/** The history list with `entry` first, capped. */
function prependEntry(list, entry, cap = HISTORY_CAP) {
  return [entry, ...(Array.isArray(list) ? list : [])].slice(0, cap);
}

/**
 * Who asked, from what the webserver forwards: `{ username, userId, host }` — the session's
 * identity when it has one, else the user the page declares (`clientUser`), else ''.
 */
function actorOf(req) {
  const a = req && typeof req.actor === 'object' && req.actor ? req.actor : {};
  const declared = a.clientUser && typeof a.clientUser === 'object' ? a.clientUser : {};
  const session = typeof a.username === 'string' && a.username !== '';
  return {
    username: session ? a.username : typeof declared.name === 'string' ? declared.name : '',
    userId: session ? Number(a.userId) : Number.isInteger(declared.id) ? declared.id : 0,
    host: typeof a.host === 'string' ? a.host : ''
  };
}

module.exports = { AUDIT_DP, AUDIT_LEAVES, HISTORY_CAP, HISTORY_DP, actorOf, auditValues, configChanges, nodeLabel, prependEntry, traceOf };
