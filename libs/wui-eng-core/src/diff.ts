// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Check-in diff engine — computes the {@link EngPlan} between a check-out
 * {@link Workspace} and a fresh {@link LiveSnapshot} of the project.
 *
 * Semantics (see docs/wui-eng-studio/NOTES.md):
 *  - a workspace object absent from the live snapshot          → create;
 *  - present in both but different                             → update;
 *  - present live, absent from the workspace AND part of the
 *    check-out baseline (the user deleted it deliberately)     → delete —
 *    live objects that were never checked out are NEVER deleted implicitly;
 *  - the live object differs from its check-out baseline       → conflict
 *    (the plan item is emitted flagged; the applier refuses conflicting
 *    items unless the caller re-bases them explicitly).
 */

import { comparableConfigs } from './configs/read.js';
import { orphanStagedDps } from './workspace.js';
import { WARNING_CODES, warn, type EngWarning } from './warnings.js';
import {
  fingerprint,
  type DpeConfigs,
  type EngPlan,
  type LiveSnapshot,
  type PlanItem,
  type Workspace
} from './model.js';

function typeKey(name: string): string {
  return `type:${name}`;
}
function dpKey(name: string): string {
  return `dp:${name}`;
}
function cfgKey(dpe: string): string {
  return `cfg:${dpe}`;
}

/** Attribute-level summary of a config change (for the diff UI). */
function describeConfigChange(before: DpeConfigs | undefined, after: DpeConfigs | undefined): string {
  const parts: string[] = [];
  const families: (keyof DpeConfigs)[] = ['address', 'alarm', 'archive', 'range'];
  for (const family of families) {
    const a = before?.[family];
    const b = after?.[family];
    if (a === undefined && b === undefined) continue;
    if (a === undefined) {
      parts.push(`+${family}`);
    } else if (b === undefined) {
      parts.push(`-${family}`);
    } else if (fingerprint(comparableConfigs({ [family]: a } as DpeConfigs)) !== fingerprint(comparableConfigs({ [family]: b } as DpeConfigs))) {
      parts.push(`~${family}`);
    }
  }
  return parts.join(' ');
}

/** Compute the check-in plan for `workspace` against the live `snapshot`. */
export function diffWorkspace(workspace: Workspace, snapshot: LiveSnapshot): EngPlan {
  const items: PlanItem[] = [];
  const warnings: EngWarning[] = [];

  const liveTypes = new Map(snapshot.types.map((t) => [t.typeName, t]));
  const liveDps = new Map(snapshot.dps.map((d) => [d.dpName, d]));
  const liveCfgs = new Map(Object.entries(snapshot.configs));

  const conflictOf = (key: string, liveValue: unknown): boolean => {
    const base = workspace.baseline[key];
    if (base === undefined) return false; // object was not checked out → no baseline to violate
    return fingerprint(liveValue) !== base;
  };

  // --- types -----------------------------------------------------------------
  for (const type of workspace.types) {
    const live = liveTypes.get(type.typeName);
    if (!live) {
      items.push({ kind: 'type', op: 'create', name: type.typeName, payload: type });
      continue;
    }
    if (fingerprint(live.structure) !== fingerprint(type.structure)) {
      items.push({
        kind: 'type',
        op: 'update',
        name: type.typeName,
        payload: type,
        conflict: conflictOf(typeKey(type.typeName), live.structure) || undefined
      });
    }
  }
  for (const [name, live] of liveTypes) {
    if (workspace.types.some((t) => t.typeName === name)) continue;
    if (workspace.baseline[typeKey(name)] === undefined) continue; // never checked out → keep
    items.push({
      kind: 'type',
      op: 'delete',
      name,
      conflict: conflictOf(typeKey(name), live.structure) || undefined
    });
  }

  // --- datapoints --------------------------------------------------------------
  for (const dp of workspace.dps) {
    const live = liveDps.get(dp.dpName);
    if (!live) {
      items.push({ kind: 'dp', op: 'create', name: dp.dpName, detail: dp.dpType, payload: dp });
      continue;
    }
    if (live.dpType !== dp.dpType) {
      warnings.push(
        warn(
          WARNING_CODES.diff.RETYPE_UNSUPPORTED,
          'Datapoint "{dp}" exists with type "{live}" (workspace: "{wanted}") — retype is not supported; item skipped.',
          { dp: dp.dpName, live: live.dpType, wanted: dp.dpType }
        )
      );
    }
  }
  for (const [name, live] of liveDps) {
    if (workspace.dps.some((d) => d.dpName === name)) continue;
    if (workspace.baseline[dpKey(name)] === undefined) continue;
    items.push({
      kind: 'dp',
      op: 'delete',
      name,
      detail: live.dpType,
      conflict: conflictOf(dpKey(name), live) || undefined
    });
  }

  // --- configs -----------------------------------------------------------------
  for (const [dpe, configs] of Object.entries(workspace.configs)) {
    const live = liveCfgs.get(dpe);
    // Compare only what is WRITTEN to the project: an address' deviceId/mode are
    // studio provenance and are absent from a read-back (see configs/read.ts).
    const same = live !== undefined && fingerprint(comparableConfigs(live)) === fingerprint(comparableConfigs(configs));
    if (same) continue;
    items.push({
      kind: 'config',
      op: live === undefined ? 'create' : 'update',
      name: dpe,
      detail: describeConfigChange(live, configs),
      payload: configs,
      conflict: live !== undefined ? conflictOf(cfgKey(dpe), live) || undefined : undefined
    });
  }
  for (const [dpe, live] of liveCfgs) {
    if (workspace.configs[dpe] !== undefined) continue;
    if (workspace.baseline[cfgKey(dpe)] === undefined) continue;
    items.push({
      kind: 'config',
      op: 'delete',
      name: dpe,
      detail: describeConfigChange(live, undefined),
      conflict: conflictOf(cfgKey(dpe), live) || undefined
    });
  }

  // Deterministic order: types → dps → configs, creates before updates/deletes.
  const kindRank: Record<PlanItem['kind'], number> = { type: 0, dp: 1, config: 2 };
  const opRank: Record<PlanItem['op'], number> = { create: 0, update: 1, delete: 2 };
  items.sort(
    (a, b) => kindRank[a.kind] - kindRank[b.kind] || opRank[a.op] - opRank[b.op] || a.name.localeCompare(b.name)
  );
  // A staged datapoint whose TYPE exists nowhere is what a DELETED model leaves behind:
  // the plan would offer to create it and `dpCreate` would refuse it, one by one, at
  // check-in. Said here, with the names, next to the button that can clean it up.
  const orphans = orphanStagedDps(workspace, snapshot);
  if (orphans.length > 0) {
    const shown = orphans.slice(0, 8);
    warnings.push(
      warn(
        WARNING_CODES.diff.DP_TYPE_MISSING,
        '{n} datapoint(s) staged for creation with a DP type that exists NEITHER in the workspace NOR in the project ({dps}{more}) — most likely a model that was deleted. They would fail at check-in: select them below and remove them from the workspace.',
        { n: orphans.length, dps: shown.join(', '), more: orphans.length > shown.length ? '…' : '' }
      )
    );
  }

  return { workspace: workspace.name, items, warnings };
}

/**
 * What a live read must cover for {@link diffWorkspace} to be complete.
 *
 * Reading the configs of the workspace's DPEs is NOT enough: a config the user
 * DELETED from the workspace is no longer a workspace key, so without its
 * baseline `cfg:` key the read would miss it and the diff would silently drop the
 * removal. Both the studio UI and the backend `/plan` handler derive their read
 * scope here so they cannot drift apart.
 */
export function liveScopeOf(workspace: Workspace): { types: string[]; dpes: string[] } {
  const dpes = new Set<string>(Object.keys(workspace.configs));
  for (const key of Object.keys(workspace.baseline)) {
    if (key.startsWith('cfg:')) dpes.add(key.slice('cfg:'.length));
  }
  const types = new Set<string>(workspace.types.map((type) => type.typeName));
  for (const key of Object.keys(workspace.baseline)) {
    if (key.startsWith('type:')) types.add(key.slice('type:'.length));
  }
  return { types: [...types], dpes: [...dpes] };
}

/** Baseline map for a fresh check-out of `snapshot` (fingerprint per object). */
export function baselineOf(snapshot: LiveSnapshot): Record<string, string> {
  const baseline: Record<string, string> = {};
  for (const type of snapshot.types) baseline[typeKey(type.typeName)] = fingerprint(type.structure);
  for (const dp of snapshot.dps) baseline[dpKey(dp.dpName)] = fingerprint(dp);
  for (const [dpe, cfg] of Object.entries(snapshot.configs)) baseline[cfgKey(dpe)] = fingerprint(cfg);
  return baseline;
}
