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
    writes.push(buildArchiveWrite(dpe, configs.archive));
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

async function applyItem(item: PlanItem, port: EngPort, previousConfigs?: DpeConfigs): Promise<ApplyItemResult> {
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
        if (await port.dpExists(dp.dpName)) return { ...base, status: 'skipped' };
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

/**
 * Apply `plan` through `port`. With `dryRun`, nothing is executed — items
 * report what WOULD happen (conflicts still report skipped).
 * `previousConfigs` supplies the live configs of config-delete items so the
 * right retire writes are emitted.
 */
export async function applyPlan(
  plan: EngPlan,
  port: EngPort,
  options?: { dryRun?: boolean; previousConfigs?: Record<string, DpeConfigs> }
): Promise<ApplyReport> {
  const dryRun = options?.dryRun === true;
  const results: ApplyItemResult[] = [];
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
    results.push(await applyItem(item, port, options?.previousConfigs?.[item.name]));
  }
  return { ok: results.every((r) => r.status !== 'failed'), dryRun, results };
}
