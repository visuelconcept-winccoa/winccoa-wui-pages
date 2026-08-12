// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Workspace HOUSEKEEPING — taking objects back out of the check-out working copy.
 *
 * The studio could put things into a workspace (generate a model, extend it, re-apply a
 * template) and never take them out. That is not a missing convenience, it is a trap: a
 * model deleted from the library leaves its generated DP type and its datapoints staged
 * in the workspace, so the Control tab keeps offering to CREATE datapoints of a type
 * nobody wants any more — and, when the type went with it, datapoints of a type that
 * does not exist at all, which fails at check-in with a driver-level error.
 *
 * The operation is deliberately named FORGET rather than delete: it is about what the
 * workspace CLAIMS, never about the live project.
 *
 *  - a staged creation disappears — nothing will be created;
 *  - a staged update disappears — the live object is left exactly as it is;
 *  - a staged DELETION disappears too, and that is the subtle one: a plan says "delete"
 *    because the object is in the check-out baseline and absent from the workspace, so
 *    forgetting it means dropping the BASELINE entry. Removing an object from
 *    `types`/`dps`/`configs` without its baseline key would turn a pending creation into
 *    a pending deletion — the exact opposite of what "clean this up" means.
 *
 * Cascades, because the alternative is orphans: forgetting a type forgets the workspace
 * datapoints declared with it, and forgetting a datapoint forgets its configs. What was
 * cascaded is REPORTED, so a UI can say "1 type, 24 datapoints and 312 configs removed"
 * instead of silently deciding more than the operator asked for.
 */

import type { DpeConfigs, LiveSnapshot, Workspace } from './model.js';

/** What the operator picked, by name (a DPE path for a config). */
export interface ForgetSelection {
  types?: string[];
  dps?: string[];
  configs?: string[];
}

/** What actually left the workspace, cascades included. */
export interface ForgetResult {
  workspace: Workspace;
  removed: { types: string[]; dps: string[]; configs: string[] };
}

/** `MyDp.Element` → `MyDp`; `MyDp.` → `MyDp` (a scalar DP root, see the DPE notation). */
export function dpOfDpe(dpe: string): string {
  const dot = dpe.indexOf('.');
  return dot === -1 ? dpe : dpe.slice(0, dot);
}

/**
 * Take the selected objects out of the workspace — see the file header for the
 * semantics of each plan operation and for the cascade.
 *
 * Returns a NEW workspace (the caller persists it and re-runs the diff); the original is
 * untouched, so a failed save cannot leave the page holding a half-cleaned copy.
 */
export function forgetInWorkspace(workspace: Workspace, selection: ForgetSelection): ForgetResult {
  const types = new Set(selection.types ?? []);
  const dps = new Set(selection.dps ?? []);
  const configs = new Set(selection.configs ?? []);

  // Cascade: a datapoint of a forgotten type would be staged against a type nobody
  // creates any more — which is the very failure this function exists to clean up.
  for (const dp of workspace.dps) {
    if (types.has(dp.dpType)) dps.add(dp.dpName);
  }
  // …and a config of a forgotten datapoint would be written on a DPE that never exists.
  for (const dpe of Object.keys(workspace.configs)) {
    if (dps.has(dpOfDpe(dpe))) configs.add(dpe);
  }

  const keptConfigs: Record<string, DpeConfigs> = {};
  for (const [dpe, value] of Object.entries(workspace.configs)) {
    if (!configs.has(dpe)) keptConfigs[dpe] = value;
  }

  // The baseline goes with them: an object absent from the workspace but PRESENT in the
  // baseline reads as "delete it from the project" (see diffWorkspace).
  const baseline: Record<string, string> = {};
  for (const [key, value] of Object.entries(workspace.baseline)) {
    if (types.has(stripKey(key, 'type:')) || dps.has(stripKey(key, 'dp:')) || configs.has(stripKey(key, 'cfg:'))) continue;
    baseline[key] = value;
  }

  return {
    workspace: {
      ...workspace,
      types: workspace.types.filter((type) => !types.has(type.typeName)),
      dps: workspace.dps.filter((dp) => !dps.has(dp.dpName)),
      configs: keptConfigs,
      baseline
    },
    removed: { types: [...types], dps: [...dps], configs: [...configs] }
  };
}

/** `'dp:Z01_Pompe1'` with prefix `'dp:'` → `'Z01_Pompe1'`; a foreign prefix → `''`. */
function stripKey(key: string, prefix: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length) : '';
}

/**
 * Staged datapoints whose DP TYPE exists NOWHERE — neither in the workspace nor in the
 * live project.
 *
 * This is what a deleted model leaves behind, and it is silent until check-in: the plan
 * happily offers to create the datapoints, then `dpCreate` refuses them one by one
 * because their type is unknown. Reported as a warning by `diffWorkspace` so the
 * Control tab can say what to clean up, with the names.
 */
export function orphanStagedDps(workspace: Workspace, snapshot: LiveSnapshot): string[] {
  const known = new Set([...workspace.types.map((type) => type.typeName), ...snapshot.types.map((type) => type.typeName)]);
  const liveDps = new Set(snapshot.dps.map((dp) => dp.dpName));
  return workspace.dps
    .filter((dp) => !liveDps.has(dp.dpName) && !known.has(dp.dpType))
    .map((dp) => dp.dpName);
}
