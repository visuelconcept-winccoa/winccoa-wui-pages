// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plan applier — executes an {@link EngPlan} against an {@link EngPort}.
 *
 * The port is the ONLY seam to WinCC OA: the backend provides a real
 * implementation over `WsjServerGlobal.winccoa`, tests and the demo gateway
 * provide in-memory fakes. This keeps the whole check-in engine unit-testable
 * without any runtime.
 *
 * Guarantees:
 *  - conflicting items are NEVER applied (reported `skipped` with an error);
 *  - order: types → datapoints → configs (referenced objects first, matching
 *    the plan's deterministic sort);
 *  - each config family is written with the atomic builders of
 *    `configs/builders.ts` (one dpSetWait per write);
 *  - idempotent: a create whose object already exists is `skipped`, never an
 *    error — re-running a plan converges.
 */

import type {
  AddressConfig,
  ApplyItemResult,
  ApplyReport,
  DpeConfigs,
  DpTypeStructure,
  EngDp,
  EngPlan,
  EngType,
  PlanItem
} from './model.js';
import {
  buildAddressDeactivate,
  buildAddressWrite,
  buildAlarmDeactivate,
  buildAlarmWrites,
  buildArchiveWrite,
  buildRangeRemove,
  buildRangeWrite,
  type ConfigWrite
} from './configs/builders.js';

/** The single seam to the runtime (real: WsjServerGlobal; tests/demo: fake). */
export interface EngPort {
  typeExists(typeName: string): Promise<boolean>;
  dpTypeCreate(structure: DpTypeStructure): Promise<void>;
  dpTypeChange(structure: DpTypeStructure): Promise<void>;
  dpTypeDelete(typeName: string): Promise<void>;
  dpExists(dpName: string): Promise<boolean>;
  dpCreate(dpName: string, dpType: string): Promise<void>;
  dpDelete(dpName: string): Promise<void>;
  /** One atomic dpSetWait over parallel arrays. */
  dpSetWait(dpes: string[], values: unknown[]): Promise<void>;
  /**
   * Resolve the device context of an address config: the driver manager
   * number and the ensured poll-group DP. Backend: driver detection + poll
   * group creation; demo: static values.
   */
  resolveAddressContext(config: AddressConfig): Promise<{ driverNumber: number; pollGroupDp: string }>;
  /**
   * The ARCHIVE GROUP datapoint to write, resolved from the name the model carries.
   *
   * `_archive.1._class` must name an existing `_NGA_Group` datapoint. A model says `EVENT` (a
   * token an engineer types, and the studio's own default) while a project holds
   * `_NGA_G_EVENT` — writing the token verbatim fails the whole config write with
   * `dpSetWait … rc=-1`, which is what this seam exists to prevent. Same shape as
   * `resolveAddressContext`: the port knows the project, the core does not.
   */
  resolveArchiveGroup(group: string): Promise<string>;
}

/** Writes needed to (re)apply the configs of one DPE. */
async function configWrites(dpe: string, configs: DpeConfigs, port: EngPort): Promise<ConfigWrite[]> {
  const writes: ConfigWrite[] = [];
  if (configs.address) {
    const ctx = await port.resolveAddressContext(configs.address);
    writes.push(buildAddressWrite(dpe, configs.address, ctx.driverNumber, ctx.pollGroupDp));
  }
  if (configs.alarm) {
    writes.push(...buildAlarmWrites(dpe, configs.alarm));
  }
  if (configs.archive) {
    // Resolved, never verbatim: see `EngPort.resolveArchiveGroup`.
    const group = configs.archive.active ? await port.resolveArchiveGroup(configs.archive.group) : configs.archive.group;
    writes.push(buildArchiveWrite(dpe, { ...configs.archive, group }));
  }
  if (configs.range) {
    writes.push(buildRangeWrite(dpe, configs.range));
  }
  return writes;
}

/** Writes that retire the configs of one DPE (config delete). */
function configRetireWrites(dpe: string, previous: DpeConfigs | undefined): ConfigWrite[] {
  const writes: ConfigWrite[] = [];
  if (previous?.address) writes.push(buildAddressDeactivate(dpe));
  if (previous?.alarm) writes.push(buildAlarmDeactivate(dpe));
  if (previous?.archive) writes.push(buildArchiveWrite(dpe, { group: previous.archive.group, active: false }));
  if (previous?.range) writes.push(buildRangeRemove(dpe));
  return writes;
}

async function applyItem(
  item: PlanItem,
  port: EngPort,
  previousConfigs?: DpeConfigs,
  recreate = false
): Promise<ApplyItemResult> {
  const base = { kind: item.kind, op: item.op, name: item.name } as const;
  if (item.conflict) {
    return { ...base, status: 'skipped', error: 'conflict with live project (changed since check-out) — re-base required' };
  }
  try {
    switch (item.kind) {
      case 'type': {
        if (item.op === 'delete') {
          if (!(await port.typeExists(item.name))) return { ...base, status: 'skipped' };
          await port.dpTypeDelete(item.name);
          return { ...base, status: 'applied' };
        }
        const type = item.payload as EngType;
        const exists = await port.typeExists(item.name);
        if (item.op === 'create' && exists) return { ...base, status: 'skipped' };
        // An EXISTING type is CHANGED, never re-created: `dpTypeChange` adds and updates
        // elements while every datapoint of the type keeps its identity, its configs and its
        // history. Deleting and re-creating it would take the datapoints with it — which is
        // why `recreate` exists as an explicit, separately-asked-for operation and not as a
        // fallback (see `ApplyOptions.recreate`).
        if (exists && recreate) {
          await port.dpTypeDelete(item.name);
          await port.dpTypeCreate({ ...type.structure, name: item.name });
          return { ...base, status: 'applied' };
        }
        await (exists ? port.dpTypeChange({ ...type.structure, name: item.name }) : port.dpTypeCreate({ ...type.structure, name: item.name }));
        return { ...base, status: 'applied' };
      }
      case 'dp': {
        if (item.op === 'delete') {
          if (!(await port.dpExists(item.name))) return { ...base, status: 'skipped' };
          await port.dpDelete(item.name);
          return { ...base, status: 'applied' };
        }
        const dp = item.payload as EngDp;
        if (await port.dpExists(dp.dpName)) {
          // Same rule one level down: an existing datapoint is LEFT IN PLACE and only its
          // configs are (re)written by the config items. Re-creating it would drop its
          // archived values — hence, again, only on the explicit `recreate`.
          if (!recreate) return { ...base, status: 'skipped' };
          await port.dpDelete(dp.dpName);
        }
        await port.dpCreate(dp.dpName, dp.dpType);
        return { ...base, status: 'applied' };
      }
      case 'config': {
        const writes =
          item.op === 'delete'
            ? configRetireWrites(item.name, previousConfigs)
            : await configWrites(item.name, item.payload as DpeConfigs, port);
        for (const write of writes) {
          await port.dpSetWait(write.dpes, write.values);
        }
        return { ...base, status: 'applied' };
      }
    }
  } catch (error) {
    return { ...base, status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

/** Default pairs per `dpSetWait` when writing configs in bulk (see {@link ApplyOptions.batch}). */
const DEFAULT_BATCH_PAIRS = 400;

/** How one apply run behaves. */
export interface ApplyOptions {
  /** Report what WOULD happen, write nothing. */
  dryRun?: boolean;
  /** Live configs of config-delete items, so the right retire writes are emitted. */
  previousConfigs?: Record<string, DpeConfigs>;
  /**
   * DESTRUCTIVE, and never a default: delete and re-create the types and datapoints of the
   * plan instead of changing them in place.
   *
   * The normal path amends — `dpTypeChange` on an existing type, configs re-written on an
   * existing datapoint — because that is what keeps a running project's datapoints, their
   * configs and their history. Re-creating a datapoint drops its archived values, so this
   * exists for the one case the normal path cannot serve (a type whose element had to change
   * kind, say) and only when someone asked for it in those terms.
   */
  recreate?: boolean;
  /**
   * MASS WRITING: how many `(dpe, value)` pairs one `dpSetWait` may carry.
   *
   * A model check-in is thousands of config attributes, and one round-trip per DPE made the
   * button feel broken on a real project. Consecutive CONFIG items are therefore merged into
   * as few calls as this allows — never splitting one of the builders' atomic writes, and
   * always flushing before a type/datapoint item, since a config can only be written after
   * its datapoint exists.
   *
   * `1` disables it (one call per write, the old behaviour). When a batch FAILS, its items
   * are replayed one by one so the report still names the offending DPE rather than blaming
   * the four hundred that travelled with it.
   */
  batch?: number;
}

/**
 * Apply `plan` through `port`. With `dryRun`, nothing is executed — items
 * report what WOULD happen (conflicts still report skipped).
 */
export async function applyPlan(plan: EngPlan, port: EngPort, options?: ApplyOptions): Promise<ApplyReport> {
  const dryRun = options?.dryRun === true;
  const batchPairs = Math.max(1, options?.batch ?? DEFAULT_BATCH_PAIRS);
  const results: ApplyItemResult[] = [];
  /** Config items whose writes are staged but not yet sent, with those writes. */
  let pending: { item: PlanItem; writes: ConfigWrite[] }[] = [];
  let pendingPairs = 0;

  /** Send what is staged as ONE dpSetWait; on failure, replay item by item to attribute it. */
  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const staged = pending;
    pending = [];
    pendingPairs = 0;
    const dpes = staged.flatMap((entry) => entry.writes.flatMap((write) => write.dpes));
    const values = staged.flatMap((entry) => entry.writes.flatMap((write) => write.values));
    if (dpes.length === 0) {
      results.push(...staged.map((entry) => itemResult(entry.item, 'applied')));
      return;
    }
    try {
      await port.dpSetWait(dpes, values);
      results.push(...staged.map((entry) => itemResult(entry.item, 'applied')));
    } catch {
      // One bad attribute must not hide which one it was: replay the batch individually.
      for (const entry of staged) {
        results.push(await applyItem(entry.item, port, options?.previousConfigs?.[entry.item.name], options?.recreate === true));
      }
    }
  };

  for (const item of plan.items) {
    if (dryRun) {
      results.push({
        kind: item.kind,
        op: item.op,
        name: item.name,
        status: item.conflict ? 'skipped' : 'applied',
        error: item.conflict ? 'conflict with live project (changed since check-out) — re-base required' : undefined
      });
      continue;
    }
    // Only plain config WRITES batch: a conflict is refused, a delete needs the live
    // configs, and a type/datapoint item must be ordered against them.
    const batchable = item.kind === 'config' && item.op !== 'delete' && item.conflict !== true && batchPairs > 1;
    if (!batchable) {
      await flush();
      results.push(await applyItem(item, port, options?.previousConfigs?.[item.name], options?.recreate === true));
      continue;
    }
    let writes: ConfigWrite[];
    try {
      writes = await configWrites(item.name, item.payload as DpeConfigs, port);
    } catch (error) {
      // Resolving the address context is what can fail here (no driver, no poll group):
      // that is this item's own error, and the batch it would have joined is unaffected.
      results.push({ kind: item.kind, op: item.op, name: item.name, status: 'failed', error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    // A MULTI-STEP write is never merged: the analog alert handling is a proven SEQUENCE
    // (type + orig_hdl, then the ranges, then active) and folding it into one transaction
    // would write ranges before the type that gives them meaning. Everything else — an
    // address, an archive, a range, a binary alert — is a single write and batches freely.
    if (writes.length > 1) {
      await flush();
      results.push(await applyItem(item, port, options?.previousConfigs?.[item.name], options?.recreate === true));
      continue;
    }
    pending.push({ item, writes });
    pendingPairs += writes.reduce((total, write) => total + write.dpes.length, 0);
    if (pendingPairs >= batchPairs) await flush();
  }
  await flush();
  return { ok: results.every((r) => r.status !== 'failed'), dryRun, results };
}

/** A plain outcome for one item (the batch path knows no per-item error). */
function itemResult(item: PlanItem, status: ApplyItemResult['status']): ApplyItemResult {
  return { kind: item.kind, op: item.op, name: item.name, status };
}

