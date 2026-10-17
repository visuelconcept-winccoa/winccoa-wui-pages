// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Model INSTANCES — one datapoint built from a model, and the equipment it reads.
 *
 * An instance is **derived, never stored**. It is a workspace datapoint whose DP
 * type is the model's, plus the device its address configs point at
 * (`AddressConfig.deviceId`, the provenance every generated address records). That
 * is deliberate, and it is the same decision as the connection state on a device:
 *
 *  - a stored list would be a second truth to keep in step with the workspace, and
 *    the first time someone edited the workspace directly the two would disagree;
 *  - what an operator asks is "what did this model actually produce, and where",
 *    and the workspace already answers it exactly.
 *
 * The STATUS comes from the check-in plan the page already computes: an instance is
 * in sync when no plan item mentions it, and otherwise carries the strongest thing
 * the plan says about it (a conflict outranks a create, which outranks an update).
 * So "is everything checked in?" is answered by the same engine that answers "what
 * would a check-in write?" — there is no second opinion to drift.
 */

import type { EngPlan, LiveSnapshot, PlanItem, Workspace } from './model.js';

/**
 * Where an instance stands versus the live project, worst-first.
 *
 * `unmanaged` is the one that is not about a pending write: the datapoint EXISTS in the
 * project and the working copy says nothing about it — an instance the model could describe
 * but has not been applied to yet. It is listed because hiding it was the bug: a model built
 * on an existing DP type showed "no instance" while the project was full of them.
 */
export type InstanceStatus = 'conflict' | 'create' | 'update' | 'delete' | 'synced' | 'unmanaged';

/** One datapoint produced by a model, and what a check-in would do about it. */
export interface ModelInstance {
  /** Datapoint name — the equipment segment the generation was given. */
  dpName: string;
  /** DP type, i.e. the model this is an instance of. */
  typeName: string;
  /**
   * Device the instance READS: the `deviceId` recorded in its address configs.
   * Absent when no DPE of it carries an address yet (a model generated with no
   * target, or a type whose leaves are all unbound) — "unknown", not "none".
   */
  deviceId?: string;
  status: InstanceStatus;
  /** Plan items that concern this datapoint (its own, and its DPEs' configs). */
  items: PlanItem[];
  /** Does the PROJECT have this datapoint? (read from the live snapshot) */
  exists: boolean;
  /** Does the WORKING COPY describe it? (false = the project has it, the model does not) */
  managed: boolean;
}

/** Aggregate of a set of instances — the panel's global status line. */
export interface InstanceTally {
  total: number;
  synced: number;
  create: number;
  update: number;
  delete: number;
  conflict: number;
  unmanaged: number;
}

/** `Z01_FOUR001` for `Z01_FOUR001.Mesures.Temp` — the DP a DPE belongs to. */
function dpOf(dpe: string): string {
  const dot = dpe.indexOf('.');
  return dot === -1 ? dpe : dpe.slice(0, dot);
}

/** Worst status wins: a conflict must never be hidden behind an "update". */
const SEVERITY: InstanceStatus[] = ['conflict', 'create', 'delete', 'update', 'synced'];

function worst(a: InstanceStatus, b: InstanceStatus): InstanceStatus {
  return SEVERITY.indexOf(a) <= SEVERITY.indexOf(b) ? a : b;
}

/**
 * The status a set of plan items gives one datapoint.
 *
 * A `type` item is deliberately NOT considered here: the type belongs to the MODEL,
 * not to one of its instances, and letting it mark every instance "update" would
 * report N problems for one change (see {@link modelStatus} for the model's own).
 *
 * And only the DATAPOINT's own item may say "to create" or "to delete": an instance
 * that exists live, gaining three new config families, is being UPDATED — reading
 * "to create" there would say the machine's datapoint does not exist yet, which is
 * a different (and alarming) statement. Config items therefore fold into `update`,
 * whatever their own op.
 */
function statusOf(items: PlanItem[]): InstanceStatus {
  let status: InstanceStatus = 'synced';
  for (const item of items) {
    if (item.conflict === true) return 'conflict';
    // A CONFIG item folds to `update`: creating a config on an existing datapoint is an update
    // OF THAT DATAPOINT, and calling it "to create" would read as "the datapoint is missing".
    // A `dp` and a `type` item keep their own operation — folding the type's `create` into
    // `update` is what made a model announce "to update" beside "not created" for a DP type
    // nobody has created yet.
    status = worst(status, item.kind === 'config' ? 'update' : item.op);
  }
  return status;
}

/**
 * Instances of one model, from the workspace, with the plan's verdict on each.
 *
 * @param workspace the working copy (its `dps` are the instances)
 * @param typeName  the model's DP type
 * @param plan      the current check-in plan, or `null` when none is computed yet
 *                  (every instance then reads `synced`: with nothing to compare,
 *                  claiming a pending change would be an invention)
 */
export function modelInstances(
  workspace: Workspace,
  typeName: string,
  plan: EngPlan | null,
  live?: LiveSnapshot | null
): ModelInstance[] {
  const itemsByDp = new Map<string, PlanItem[]>();
  for (const item of plan?.items ?? []) {
    if (item.kind === 'type') continue;
    const dp = item.kind === 'dp' ? item.name : dpOf(item.name);
    const list = itemsByDp.get(dp);
    if (list === undefined) itemsByDp.set(dp, [item]);
    else list.push(item);
  }

  // BOTH SIDES. The project's datapoints of this type are what exists; the working copy's are
  // what the model describes. Deriving only from the working copy was the bug this fixes: a
  // model built on an existing DP type described nothing yet, so the panel said "no instance"
  // while the project held a dozen — and the answer to "is my model applied?" was invisible.
  const liveNames = new Set((live?.dps ?? []).filter((dp) => dp.dpType === typeName).map((dp) => dp.dpName));
  const stagedNames = workspace.dps.filter((dp) => dp.dpType === typeName).map((dp) => dp.dpName);
  const names = [...new Set([...stagedNames, ...liveNames])].sort((first, second) => first.localeCompare(second));
  const staged = new Set(stagedNames);

  return names.map((dpName) => {
    const items = itemsByDp.get(dpName) ?? [];
    const deviceId = deviceOf(workspace, dpName);
    const managed = staged.has(dpName);
    return {
      dpName,
      typeName,
      ...(deviceId === undefined ? {} : { deviceId }),
      // A datapoint the project has but the model does not describe has nothing pending — and
      // saying "in sync" about it would claim the model was applied to it. It is `unmanaged`.
      status: managed ? statusOf(items) : 'unmanaged',
      items,
      exists: liveNames.has(dpName),
      managed
    };
  });
}

/**
 * The device an instance reads — the `deviceId` its address configs record.
 *
 * The FIRST one found: every address of one instance is generated for the same
 * target, so a second value would mean the workspace was hand-edited. Reporting
 * one rather than guessing between them keeps this honest and cheap.
 */
function deviceOf(workspace: Workspace, dpName: string): string | undefined {
  const prefix = `${dpName}.`;
  for (const [dpe, configs] of Object.entries(workspace.configs)) {
    if (!dpe.startsWith(prefix)) continue;
    const deviceId = configs.address?.deviceId;
    if (deviceId !== undefined && deviceId !== '') return deviceId;
  }
  return undefined;
}

/** What the plan says about the MODEL itself (its DP type), not its instances. */
export function modelStatus(typeName: string, plan: EngPlan | null): InstanceStatus {
  const items = (plan?.items ?? []).filter((item) => item.kind === 'type' && item.name === typeName);
  return statusOf(items);
}

/** Count instances per status — the global "is everything checked in?" line. */
export function tallyInstances(instances: ModelInstance[]): InstanceTally {
  const tally: InstanceTally = { total: instances.length, synced: 0, create: 0, update: 0, delete: 0, conflict: 0, unmanaged: 0 };
  for (const instance of instances) tally[instance.status] += 1;
  return tally;
}

/**
 * Everything a model needs to be RE-APPLIED to one of its instances.
 *
 * Changing a model's policy (an alarm class, an archive group) must reach the
 * datapoints it already produced — otherwise the model says one thing and the
 * project holds another, and nobody can tell which is current. The regeneration
 * itself is `generateModelFromBook`, so this only states WHAT to regenerate: the
 * equipment segment (the datapoint name) and the device to bind it to.
 */
export interface InstanceTarget {
  equipment: string;
  deviceId?: string;
}

/** The re-apply targets of a model: one per existing instance, in workspace order. */
export function instanceTargets(workspace: Workspace, typeName: string): InstanceTarget[] {
  return modelInstances(workspace, typeName, null).map((instance) => ({
    equipment: instance.dpName,
    ...(instance.deviceId === undefined ? {} : { deviceId: instance.deviceId })
  }));
}
