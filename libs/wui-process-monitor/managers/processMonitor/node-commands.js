// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Control commands and managers lists of the hosts, over vRPC (issue 53).
 *
 * Every agent answers on its own `ProcessMonitor_<hostname>` service:
 *
 *   Control({ cmd })  -> { ok, warning?, detail?, selfRestart?, error? }
 *                        cmd: { action: start|stop|restart|restart-all|add|remove|update, index, … }
 *                        executed against the agent's LOCAL pmon, answered when done
 *   ListLocal()       -> { ok, managers, at }   the agent's LOCAL pmon list, read now
 *
 * The aggregator calls them on the target host's service — the same way as Ping, the logs
 * and the deploy — instead of writing the node DP's `.cmd` and polling `.cmdResult`, and
 * instead of reading the `.pmon` snapshot an agent used to publish every 3 s.
 *
 * Agents older than 0.4.0 answer `Unimplemented`: for them, and for this version only, the
 * former DP path is kept (`legacyCommand`: `.cmd` / `.cmdResult`; `legacySnapshot`: `.pmon`).
 *
 * A manager that restarts or stops ITSELF (the processMonitor agent) cannot wait for pmon's
 * answer: it is killed first. `selfCommand` answers before acting, and refuses unless pmon
 * restarts it on its own (start mode `always`).
 *
 * Pure Node (no winccoa-manager): `index.js` wires it; the unit tests drive it with fakes.
 */
'use strict';

const { isUnimplemented, withTimeout } = require('./instance-state.js');

/** A command that stops or restarts THE manager running this code (`pid`), or null. */
function selfTarget(cmd, managers, pid) {
  if (!cmd || !['stop', 'restart'].includes(cmd.action)) return null;
  const m = (managers || []).find((x) => x && x.index === cmd.index);
  return m && Number(m.pid) === Number(pid) ? m : null;
}

/**
 * The plan for a command aimed at this manager itself: `{ allowed, reason? }`. Only a restart,
 * and only in start mode `always` (pmon starts it again; any other mode would leave the host
 * without its agent).
 */
function selfCommandPlan(cmd, manager) {
  if (cmd.action !== 'restart') {
    return { allowed: false, reason: 'the processMonitor agent cannot stop itself from here: stop it in the WinCC OA console of its host' };
  }
  if (manager.startModeCfg !== 'always') {
    return {
      allowed: false,
      reason: `the processMonitor agent restarts itself only in start mode "always" (here "${manager.startModeCfg || '?'}"): pmon would not start it again`
    };
  }
  return { allowed: true };
}

/**
 * Route one command to its host:
 *   - the aggregator's own node → `execLocal(cmd)`;
 *   - another node → `call(node, 'Control', { cmd })` on its service;
 *     `Unimplemented` (agent < 0.4.0) → `legacyCommand(node, cmd)` (the former `.cmd` DP).
 * Resolves `{ ok, error?, warning?, detail?, selfRestart?, legacy? }`, never rejects.
 */
async function routeCommand(node, cmd, { isLocal, execLocal, call, legacyCommand, timeoutMs, unimplementedCode, log = () => undefined }) {
  if (!node || isLocal(node)) return settle(execLocal(cmd));
  try {
    const res = await withTimeout(call(node, 'Control', { cmd }), timeoutMs);
    return { ok: res?.ok === true, error: res?.error || '', warning: res?.warning || '', ...pick(res, ['detail', 'selfRestart']) };
  } catch (error) {
    if (!isUnimplemented(error, unimplementedCode)) return { ok: false, error: String(error?.message || error) };
    log(`${node.dp}: agent older than 0.4.0 (no Control) — command sent through its .cmd DP`);
    const res = await settle(legacyCommand(node, cmd));
    return { ...res, legacy: true };
  }
}

/** `{ ok: true, … }` from what the local execution resolved, `{ ok: false, error }` when it threw. */
async function settle(promise) {
  try {
    const r = await promise;
    return { ok: r?.ok !== false, error: r?.error || '', warning: r?.warning || '', ...pick(r, ['detail', 'selfRestart']) };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (obj && obj[key] !== undefined) out[key] = obj[key];
  return out;
}

/**
 * The managers of every instance, read NOW (issue 52): the local pmon for the aggregator's
 * own node, `ListLocal` on the service of the others. The instances carry their ping
 * `status` already (instance-state.js). Per state:
 *   connected / pmon-unreachable → ListLocal (a failure keeps the last list, with its age);
 *   agent-too-old                → `legacySnapshot(node)` (the `.pmon` DP it still publishes);
 *   agent-unreachable / other    → the last list read from it by this aggregator (`memory`),
 *                                  empty after a restart of the aggregator.
 * Sets `managers` and `updated` (ISO time the list was read) on each instance.
 */
async function collectManagers(instances, { isLocal, listLocal, call, legacySnapshot, memory, timeoutMs, now = () => new Date() }) {
  await Promise.all(
    instances.map(async (inst) => {
      const state = inst.status?.state;
      let fresh = null;
      try {
        if (isLocal(inst)) fresh = { managers: await listLocal(), at: now().toISOString() };
        else if (state === 'connected' || state === 'pmon-unreachable') {
          const res = await withTimeout(call(inst, 'ListLocal', {}), timeoutMs);
          if (res?.ok) fresh = { managers: res.managers || [], at: res.at || now().toISOString() };
        } else if (state === 'agent-too-old') {
          fresh = await legacySnapshot(inst);
        }
      } catch {
        fresh = null;
      }
      if (fresh) memory.set(inst.dp, fresh);
      const known = fresh || memory.get(inst.dp) || { managers: [], at: inst.updated || '' };
      inst.managers = known.managers;
      inst.updated = known.at;
    })
  );
  return instances;
}

module.exports = { collectManagers, routeCommand, selfCommandPlan, selfTarget };
