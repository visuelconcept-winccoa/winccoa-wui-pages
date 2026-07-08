// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tag Importer — the ImportPlan: the single serializable contract between the
 * front end (which builds and previews it) and `/api/tag-importer/apply` (which
 * executes it). Everything WinCC OA-specific that the front end can compute
 * without project state lives here; anything environment-specific (the driver
 * manager number, whether a DP/type already exists) is resolved by the backend.
 *
 * The same object is BOTH the dry-run preview shown to the operator AND the
 * request body of `apply` — so what you preview is exactly what gets created.
 */

import type { SourceKind } from './model.js';

/**
 * A DPType node tree. Structurally identical to the backend's `ParaTypeStructure`
 * accepted by `createTypeFromStructure`/`dpTypeCreate`: `type` is a WinCC OA
 * element-type key (`Struct`, `Float`, `Typeref`, …); `refName` names the
 * referenced DPType when `type === 'Typeref'`.
 */
export interface DpTypeStructure {
  name: string;
  type: string;
  refName?: string;
  children?: DpTypeStructure[];
}

/** One DPType to create (or reuse), in dependency (creation) order. */
export interface PlanType {
  /** DPType name to create, or the existing type to reuse when `reuse` is set (also the root node name). */
  typeName: string;
  displayName: string;
  structure: DpTypeStructure;
  /** True when the type already exists — the backend then skips creation (dry-run diagnostic). */
  exists?: boolean;
  /** When true, `typeName` is an EXISTING datapoint type to reuse rather than create. */
  reuse?: boolean;
  /** When `reuse`: add the DPEs from `structure` that the existing type is missing (dpTypeChange). */
  extend?: boolean;
}

/** One datapoint instance to create. */
export interface PlanDp {
  dpName: string;
  displayName: string;
  dpType: string;
  /** True when the DP already exists — the backend then skips creation. */
  exists?: boolean;
}

/**
 * One peripheral-address config to write on a DPE (online only). The front end
 * fills every protocol-computable field; the backend adds the `_distrib` driver
 * number resolved from {@link ImportPlan.connection} and ensures the poll group.
 */
export interface PlanAddress {
  /** Fully-qualified DPE, e.g. `Pump1.Motor.Speed`. */
  dpe: string;
  /** OPC UA NodeId in item notation. */
  nodeId: string;
  /** `_reference` value: `<Conn>$$1$1$<NodeId>`. */
  reference: string;
  /** `_direction` (DpAddressDirection). */
  direction: number;
  /** `_datatype` (OpcUaDatatype transformation type). */
  datatype: number;
  /** `_poll_group` — the `_PollGroup` DP the backend ensures exists. */
  pollGroup: string;
}

/** The complete, serializable import plan. */
export interface ImportPlan {
  source: SourceKind;
  /** DPTypes in creation order (referenced types before their referrers). */
  types: PlanType[];
  /** DP instances to create. */
  dps: PlanDp[];
  /**
   * Address configs to write. Empty for a NodeSet2 XML import (no live server to
   * bind to); populated for an online import against {@link connection}.
   */
  addresses: PlanAddress[];
  /** OPC UA connection (server) name for address binding — online only. */
  connection?: string;
  /** Non-fatal issues carried from model building + generation. */
  warnings: string[];
}

/** Per-item outcome returned by `apply`, so the UI can show a precise report. */
export interface ApplyItemResult {
  kind: 'type' | 'dp' | 'address';
  /** typeName / dpName / dpe. */
  name: string;
  status: 'created' | 'skipped' | 'failed';
  error?: string;
}

/**
 * Response of `POST /api/tag-importer/apply`. When `dryRun` is true nothing was
 * written: each item's `status` then means `created` = "would be created",
 * `skipped` = "already exists". When false, `status` is the real outcome.
 */
export interface ApplyResult {
  ok: boolean;
  dryRun: boolean;
  results: ApplyItemResult[];
  error?: string;
}

/** Aggregate counts derived from a plan, for the dry-run summary banner. */
export interface PlanSummary {
  typesNew: number;
  typesExisting: number;
  dpsNew: number;
  dpsExisting: number;
  addresses: number;
  warnings: number;
}

/** Compute the dry-run summary counts from a plan. */
export function summarize(plan: ImportPlan): PlanSummary {
  return {
    typesNew: plan.types.filter((t) => !t.exists).length,
    typesExisting: plan.types.filter((t) => t.exists).length,
    dpsNew: plan.dps.filter((d) => !d.exists).length,
    dpsExisting: plan.dps.filter((d) => d.exists).length,
    addresses: plan.addresses.length,
    warnings: plan.warnings.length
  };
}
