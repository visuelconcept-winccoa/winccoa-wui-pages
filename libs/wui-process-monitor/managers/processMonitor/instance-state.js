// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Real state of each host instance, checked over vRPC (issue 39).
 *
 * Every agent answers `Ping()` on its own `ProcessMonitor_<hostname>` service:
 *
 *   Ping() -> { ok, hostname, system, node, version, startedAt, pmon: 'reachable' | 'unreachable' }
 *
 * The aggregator pings every node DP in parallel, with a short timeout, inside the SAME
 * `ListManagers` call (never one HTTP request per instance), and attaches
 * `status: { state, checkedAt, version, startedAt, error }` to each instance:
 *
 *   connected          the agent answers and reaches its local pmon
 *   pmon-unreachable   the agent answers but its pmon does not (MGRLIST query failed)
 *   agent-too-old      the service answers `Unimplemented` (agent older than 0.3.0, no Ping)
 *   agent-unreachable  no answer (manager stopped, host down, network) — last snapshot and
 *                      its age (`.updated`) are shown greyed
 *   not-checkable      a node of ANOTHER system of a distributed project that does not
 *                      answer: reaching a service of another system by name is not verified
 *                      (issue 32), so it is never reported as disconnected
 *
 * The local node (the aggregator's own computer) is pinged in-process, without a stub.
 *
 * Deleting an instance (`DeleteInstance`) is allowed only for `agent-unreachable`, never for
 * the local node; the aggregator pings again right before `dpDelete` and refuses when the
 * agent answers (a running agent would recreate its DP at once).
 *
 * Pure Node (no winccoa-manager): `index.js` wires it to the stubs and to the DPs; the unit
 * tests drive it with fakes.
 */
'use strict';

const STATES = Object.freeze({
  CONNECTED: 'connected',
  PMON_UNREACHABLE: 'pmon-unreachable',
  AGENT_TOO_OLD: 'agent-too-old',
  AGENT_UNREACHABLE: 'agent-unreachable',
  NOT_CHECKABLE: 'not-checkable'
});

/** Per-node ping timeout: short, the page polls the list every few seconds. */
const PING_TIMEOUT_MS = 2500;

/** An MSA answer meaning "this service has no such function" (older agent). */
const UNIMPLEMENTED_TEXT = /unimplemented|not implemented|unknown (function|method)|no such (function|method)|function\b.*\bnot (found|registered)/i;

/** Error raised by `withTimeout` (`timedOut: true`). */
function timeoutError(ms) {
  return Object.assign(new Error(`no answer within ${ms} ms`), { timedOut: true });
}

/** `promise`, or a rejection with `timedOut: true` after `ms`. The timer never keeps the process alive. */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(ms)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/** True when a vRPC failure says the called function does not exist on the service. */
function isUnimplemented(error, unimplementedCode) {
  if (!error) return false;
  const code = error.statusCode ?? error.status?.statusCode;
  if (unimplementedCode !== undefined && unimplementedCode !== null && code === unimplementedCode) return true;
  const text = `${error.message ?? ''} ${error.status?.text ?? ''}`;
  return UNIMPLEMENTED_TEXT.test(text);
}

/**
 * Map one ping outcome to a status.
 * - `reply`: what `Ping` answered (the agent is alive), or undefined;
 * - `error`: why the ping failed (`timedOut` for a timeout);
 * - `foreign`: the node belongs to another system than the aggregator.
 */
function classifyPing({ reply, error, foreign = false, unimplementedCode, now = () => new Date() } = {}) {
  const checkedAt = now().toISOString();
  if (reply && !error) {
    const state = reply.pmon === 'reachable' ? STATES.CONNECTED : STATES.PMON_UNREACHABLE;
    return {
      state,
      checkedAt,
      version: String(reply.version || ''),
      startedAt: String(reply.startedAt || ''),
      ...(state === STATES.PMON_UNREACHABLE && reply.pmonError ? { error: String(reply.pmonError) } : {})
    };
  }
  const detail = error ? String(error.message || error) : 'no answer';
  if (isUnimplemented(error, unimplementedCode)) return { state: STATES.AGENT_TOO_OLD, checkedAt, version: '', startedAt: '', error: detail };
  if (foreign) return { state: STATES.NOT_CHECKABLE, checkedAt, version: '', startedAt: '', error: detail };
  return { state: STATES.AGENT_UNREACHABLE, checkedAt, version: '', startedAt: '', error: detail };
}

/**
 * Ping one node: in-process for the local node, over its service otherwise, both under
 * `timeoutMs`. Never rejects: resolves with the status.
 */
async function pingNode(node, { isLocal, isForeign = () => false, localPing, remotePing, timeoutMs = PING_TIMEOUT_MS, unimplementedCode, now } = {}) {
  const local = isLocal(node);
  try {
    const reply = await withTimeout(local ? localPing() : remotePing(node), timeoutMs);
    return classifyPing({ reply, unimplementedCode, now });
  } catch (error) {
    return classifyPing({ error, foreign: !local && isForeign(node), unimplementedCode, now });
  }
}

/** Ping every node in parallel; resolves with the statuses in the order of `nodes`. */
function pingNodes(nodes, opts) {
  return Promise.all(nodes.map((node) => pingNode(node, opts)));
}

/**
 * May this instance be deleted? Only an instance whose agent does not answer, and never the
 * aggregator's own node. Returns `{ ok }` or `{ ok: false, code, reason }`.
 */
function canDeleteInstance(instance, { local = false } = {}) {
  if (!instance) return { ok: false, code: 'unknown', reason: 'unknown instance' };
  if (local) return { ok: false, code: 'local', reason: "the aggregator's own node cannot be deleted" };
  const state = instance.status?.state;
  if (state === STATES.AGENT_UNREACHABLE) return { ok: true };
  if (state === STATES.NOT_CHECKABLE) return { ok: false, code: 'not-checkable', reason: 'the agent cannot be checked over vRPC (other system)' };
  if (state === STATES.CONNECTED || state === STATES.PMON_UNREACHABLE || state === STATES.AGENT_TOO_OLD) {
    return { ok: false, code: 'answers', reason: 'the agent answers over vRPC: a running agent recreates its DP at once' };
  }
  return { ok: false, code: 'unchecked', reason: 'the state of the instance is not known' };
}

/**
 * The server side of a deletion: refuse the local node, ping again (never a cached answer),
 * refuse unless the agent is still unreachable, then delete the node DP.
 * `deps`: { isLocal, ping(node) -> status, readUpdated(node) -> ISO, dpDelete(dp) }.
 * Resolves `{ ok, dp, system, hostname, lastSeen, state, error? }`.
 */
async function deleteInstance(node, { isLocal, ping, readUpdated, dpDelete }) {
  if (!node) return { ok: false, code: 'unknown', error: 'unknown instance' };
  const head = { dp: node.dp, system: node.system || '', hostname: node.hostname || '' };
  let lastSeen = '';
  try {
    lastSeen = String((await readUpdated(node)) || '');
  } catch {
    lastSeen = '';
  }
  const local = isLocal(node);
  if (local) {
    const verdict = canDeleteInstance({ ...head }, { local: true });
    return { ok: false, ...head, lastSeen, code: verdict.code, error: verdict.reason };
  }
  const status = await ping(node);
  const verdict = canDeleteInstance({ ...head, status }, { local: false });
  if (!verdict.ok) return { ok: false, ...head, lastSeen, state: status?.state, code: verdict.code, error: verdict.reason };
  try {
    await dpDelete(node.dp);
  } catch (error) {
    return { ok: false, ...head, lastSeen, state: status.state, code: 'dp-delete', error: `dpDelete failed: ${error?.message || error}` };
  }
  return { ok: true, ...head, lastSeen, state: status.state };
}

module.exports = { PING_TIMEOUT_MS, STATES, canDeleteInstance, classifyPing, deleteInstance, isUnimplemented, pingNode, pingNodes, withTimeout };
