// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DpTypeGenerator — turns a protocol-neutral {@link TagModel} into a concrete,
 * serializable {@link ImportPlan}. This is where the confirmed HYBRID policy is
 * applied:
 *
 *  - one DPType per source type that is directly instantiated;
 *  - a nested type used by ≥2 distinct parents becomes its own DPType referenced
 *    by `DPT_TYPEREF` (shared); a nested type used by a single parent (and not
 *    instantiated) is flattened into that parent as a `Struct` group;
 *  - the operator can override per type (forceKeep / forceInline) from the review
 *    screen, and can turn hybrid off entirely (always flatten).
 *
 * The DPE path of a leaf is identical whether its containing nested type is a
 * typeref or flattened, so instance address bindings survive the decision. Types
 * are emitted in dependency order (referenced types before their referrers);
 * inline cycles are broken by promoting a type to a typeref, and any residual
 * typeref cycle (unsupported by `dpTypeCreate`) is reported as a warning.
 */

import type { InstanceDef, Member, RefMember, TagModel, TypeDef } from './model.js';
import type { DpTypeStructure, ImportPlan, PlanAddress, PlanDp, PlanType } from './plan.js';
import { buildOpcUaReference, isUnmappedOpcUaType, opcUaDatatypeCode, DEFAULT_POLL_GROUP, DpAddressDirection } from './opcua-mapping.js';
import { proposeDpName, proposeTypeName, uniqueName } from './naming.js';

/** How a source type maps to a WinCC OA DPType: create a new one, or reuse an existing one. */
export interface TypeMapping {
  /** Existing DPType to reuse; when omitted a new type is created. */
  target?: string;
  /** When reusing: extend the existing type with the model's missing DPEs. */
  extend: boolean;
}

/** Options driving generation (from the review UI). */
export interface GenerateOptions {
  /** Prepended to every generated (created) DPType name. */
  typePrefix: string;
  /** Apply the hybrid typeref policy; when false every nested type is flattened. */
  hybrid: boolean;
  /** Type ids the operator forces to be their own DPType (typeref). */
  forceKeep?: ReadonlySet<string>;
  /** Type ids the operator forces to be flattened (ignored if the type is instantiated). */
  forceInline?: ReadonlySet<string>;
  /** Per source-type mapping (keyed by TypeDef.id): create new (default) or reuse an existing DPType. */
  typeMapping?: Record<string, TypeMapping>;
  /** OPC UA connection (server) name — presence enables online address binding. */
  connection?: string;
  /** Poll-group DP name for the address configs. */
  pollGroup?: string;
  /** Per-DPE direction override (INPUT_POLL / IO_POLL); default is IO_POLL (IN/OUT). */
  directionOverrides?: Record<string, number>;
}

/** Map a scalar WinCC OA element-type key to its one-dimensional `Dyn*` variant. */
function dynVariant(leaf: string): string {
  return `Dyn${leaf}`;
}

/** Yield every RefMember in a member subtree (recurses into groups). */
function* iterRefs(members: Member[]): Generator<RefMember> {
  for (const m of members) {
    if (m.kind === 'ref') yield m;
    else if (m.kind === 'group') yield* iterRefs(m.children);
  }
}

/** Distinct parent-type ids that reference each type id. */
function parentIndex(types: TypeDef[]): Map<string, Set<string>> {
  const parents = new Map<string, Set<string>>();
  for (const t of types) {
    for (const ref of iterRefs(t.members)) {
      let set = parents.get(ref.typeId);
      if (!set) {
        set = new Set();
        parents.set(ref.typeId, set);
      }
      set.add(t.id);
    }
  }
  return parents;
}

/** Compute the initial "keep" set (types emitted as their own DPType). */
function computeKeep(model: TagModel, opts: GenerateOptions, parents: Map<string, Set<string>>): Set<string> {
  const instantiated = new Set(model.instances.map((i) => i.typeId));
  const keep = new Set<string>();
  for (const t of model.types) {
    const isInstantiated = instantiated.has(t.id);
    const sharedCount = parents.get(t.id)?.size ?? 0;
    let kept = isInstantiated;
    if (opts.hybrid && sharedCount > 1) kept = true;
    if (opts.forceKeep?.has(t.id)) kept = true;
    if (opts.forceInline?.has(t.id) && !isInstantiated) kept = false;
    if (kept) keep.add(t.id);
  }
  return keep;
}

/**
 * Break inline cycles: if flattening would recurse through a type already on the
 * inline path, promote that type to "kept" (emit it as a typeref instead) and
 * record a warning. Iterates the keep set until stable.
 */
function breakInlineCycles(model: TagModel, keep: Set<string>, typeById: Map<string, TypeDef>, warnings: string[]): void {
  const visitInline = (typeId: string, stack: Set<string>): void => {
    const t = typeById.get(typeId);
    if (!t) return;
    for (const ref of iterRefs(t.members)) {
      if (keep.has(ref.typeId)) continue; // typeref edge — not an inline edge
      if (stack.has(ref.typeId)) {
        keep.add(ref.typeId);
        warnings.push(
          `Type "${typeById.get(ref.typeId)?.displayName ?? ref.typeId}" is part of a nesting cycle — kept as a reference to break it.`
        );
        continue;
      }
      visitInline(ref.typeId, new Set(stack).add(ref.typeId));
    }
  };
  // Re-run until a full pass adds nothing new (each promotion only removes inline edges).
  let before = -1;
  while (before !== keep.size) {
    before = keep.size;
    for (const t of model.types) if (keep.has(t.id)) visitInline(t.id, new Set([t.id]));
    // Also walk from roots that are kept; non-kept roots are unreachable anyway.
  }
}

/** Build the DpTypeStructure children for a member list, inlining non-kept refs. */
function membersToStructure(
  members: Member[],
  keep: Set<string>,
  typeById: Map<string, TypeDef>,
  nameById: Map<string, string>,
  inlineStack: Set<string>,
  warnings: string[]
): DpTypeStructure[] {
  const out: DpTypeStructure[] = [];
  for (const m of members) {
    if (m.kind === 'leaf') {
      out.push({ name: m.name, type: m.arrayRank >= 1 ? dynVariant(m.dataType) : m.dataType });
    } else if (m.kind === 'group') {
      out.push({
        name: m.name,
        type: 'Struct',
        children: membersToStructure(m.children, keep, typeById, nameById, inlineStack, warnings)
      });
    } else {
      // ref
      if (keep.has(m.typeId)) {
        out.push({ name: m.name, type: 'Typeref', refName: nameById.get(m.typeId) ?? m.typeId });
        continue;
      }
      const rt = typeById.get(m.typeId);
      if (!rt) {
        warnings.push(`Referenced type "${m.typeId}" is missing — member "${m.name}" skipped.`);
        continue;
      }
      if (inlineStack.has(m.typeId)) {
        // Safety net (cycles are pre-broken); emit as a typeref.
        out.push({ name: m.name, type: 'Typeref', refName: nameById.get(m.typeId) ?? m.typeId });
        continue;
      }
      out.push({
        name: m.name,
        type: 'Struct',
        children: membersToStructure(rt.members, keep, typeById, nameById, new Set(inlineStack).add(m.typeId), warnings)
      });
    }
  }
  return out;
}

/** Collect every DPType name referenced by a `Typeref` node in a structure tree. */
function collectTyperefNames(node: DpTypeStructure, out: Set<string>): void {
  if (node.type === 'Typeref' && node.refName) out.add(node.refName);
  for (const child of node.children ?? []) collectTyperefNames(child, out);
}

/**
 * Topological order (referenced type before its referrer) over the ACTUAL
 * emitted typeref edges. A kept type's typerefs can be produced TRANSITIVELY by
 * inlining a non-kept type that itself references a kept type, so the edges are
 * read from the built structures (their `Typeref` refNames), not from the raw
 * model refs. Any cycle — including a self-typeref formed through a flattened
 * intermediate — is reported and the types are emitted best-effort.
 */
function creationOrder(deps: Map<string, Set<string>>, warnings: string[]): string[] {
  const state = new Map<string, 'visiting' | 'done'>();
  const order: string[] = [];
  let cyclic = false;
  const visit = (id: string): void => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') {
      cyclic = true;
      return;
    }
    state.set(id, 'visiting');
    for (const dep of deps.get(id) ?? []) visit(dep);
    state.set(id, 'done');
    order.push(id);
  };
  for (const id of deps.keys()) visit(id);
  if (cyclic) {
    warnings.push('Datapoint types have a reference cycle — creation order may fail (unsupported by dpTypeCreate).');
  }
  return order;
}

/** Address configs for an instance's leaf bindings (online only). Direction defaults to IN/OUT. */
function addressesForInstance(
  inst: InstanceDef,
  dpName: string,
  conn: string,
  pollGroup: string,
  directionOverrides: Record<string, number>,
  warnings: string[]
): PlanAddress[] {
  const out: PlanAddress[] = [];
  for (const [path, addr] of Object.entries(inst.bindings)) {
    if (addr.protocol !== 'opcua') continue;
    if (isUnmappedOpcUaType(addr.sourceDataType)) {
      warnings.push(`Leaf "${dpName}.${path}" has unsupported OPC UA type "${addr.sourceDataType ?? '?'}" — bound as default transformation.`);
    }
    const dpe = `${dpName}.${path}`;
    out.push({
      dpe,
      nodeId: addr.nodeId,
      reference: buildOpcUaReference(conn, addr.nodeId),
      direction: directionOverrides[dpe] ?? DpAddressDirection.IO_POLL,
      datatype: opcUaDatatypeCode(addr.sourceDataType),
      pollGroup
    });
  }
  return out;
}

/** Per-type decision for the review screen (candidacy + current keep/flatten choice). */
export interface TypeDecision {
  id: string;
  displayName: string;
  /** Proposed DPType name (before collision de-duplication). */
  proposedName: string;
  /** Emitted as its own DPType (kept) vs flattened into its parent(s). */
  kept: boolean;
  /** Directly instantiated (always kept, override disabled). */
  instantiated: boolean;
  /** Used as a nested member by at least one parent type (a flatten/keep candidate). */
  referenced: boolean;
  /** Number of distinct parent types that reference it. */
  sharedCount: number;
}

/**
 * Analyse each source type for the review UI: whether it will be its own DPType
 * or flattened, and whether the operator may override that (only referenced,
 * non-instantiated types are candidates). Mirrors {@link buildPlan}'s keep rule
 * (before cycle-breaking, which can only add to the kept set).
 */
export function analyzeTypes(model: TagModel, opts: GenerateOptions): TypeDecision[] {
  const parents = parentIndex(model.types);
  const keep = computeKeep(model, opts, parents);
  const instantiated = new Set(model.instances.map((i) => i.typeId));
  return model.types.map((t) => ({
    id: t.id,
    displayName: t.displayName,
    proposedName: proposeTypeName(opts.typePrefix, t.name || t.displayName),
    kept: keep.has(t.id),
    instantiated: instantiated.has(t.id),
    referenced: (parents.get(t.id)?.size ?? 0) > 0,
    sharedCount: parents.get(t.id)?.size ?? 0
  }));
}

/** Build the complete import plan from a model + generation options. */
export function buildPlan(model: TagModel, opts: GenerateOptions): ImportPlan {
  const warnings = [...model.warnings];
  const typeById = new Map(model.types.map((t) => [t.id, t]));

  const parents = parentIndex(model.types);
  const keep = computeKeep(model, opts, parents);
  breakInlineCycles(model, keep, typeById, warnings);

  // Resolve DPType names for every kept type: a mapped type reuses its existing
  // target name; otherwise a unique prefixed name is generated. Reuse targets are
  // reserved FIRST so a generated (created) name can never collide with one.
  const usedTypeNames = new Set<string>();
  for (const id of keep) {
    const target = opts.typeMapping?.[id]?.target;
    if (target) usedTypeNames.add(target);
  }
  const nameById = new Map<string, string>();
  for (const id of keep) {
    const t = typeById.get(id);
    if (!t) continue;
    const target = opts.typeMapping?.[id]?.target;
    nameById.set(id, target ?? uniqueName(proposeTypeName(opts.typePrefix, t.name || t.displayName), usedTypeNames));
  }

  // Build each kept type's structure first, then order by the typeref edges the
  // structures ACTUALLY contain (typerefs can arise transitively via inlining a
  // non-kept type that references a kept one), so a referrer never precedes a
  // type it typerefs.
  const structById = new Map<string, DpTypeStructure>();
  for (const id of keep) {
    const t = typeById.get(id);
    const typeName = nameById.get(id);
    if (!t || !typeName) continue;
    structById.set(id, {
      name: typeName,
      type: 'Struct',
      children: membersToStructure(t.members, keep, typeById, nameById, new Set([id]), warnings)
    });
  }
  const idByName = new Map<string, string>();
  for (const [id, name] of nameById) if (!idByName.has(name)) idByName.set(name, id);
  const deps = new Map<string, Set<string>>();
  for (const [id, struct] of structById) {
    const refNames = new Set<string>();
    collectTyperefNames(struct, refNames);
    const set = new Set<string>();
    for (const refName of refNames) {
      const depId = idByName.get(refName);
      if (depId) set.add(depId); // depId === id (self-typeref) is kept so the cycle is detected
    }
    deps.set(id, set);
  }
  const order = creationOrder(deps, warnings);
  const types: PlanType[] = [];
  for (const id of order) {
    const t = typeById.get(id);
    const struct = structById.get(id);
    if (!t || !struct) continue;
    const mapping = opts.typeMapping?.[id];
    types.push(
      mapping?.target
        ? { typeName: struct.name, displayName: t.displayName, structure: struct, reuse: true, extend: mapping.extend }
        : { typeName: struct.name, displayName: t.displayName, structure: struct }
    );
  }

  // Instances → DPs (only for kept types; every instantiated type is kept).
  const usedDpNames = new Set<string>();
  const dps: PlanDp[] = [];
  const addresses: PlanAddress[] = [];
  const conn = opts.connection;
  const pollGroup = opts.pollGroup ?? DEFAULT_POLL_GROUP;
  const directionOverrides = opts.directionOverrides ?? {};
  for (const inst of model.instances) {
    const typeName = nameById.get(inst.typeId);
    if (!typeName) {
      warnings.push(`Instance "${inst.displayName}" has no generated type — skipped.`);
      continue;
    }
    const dpName = uniqueName(proposeDpName(inst.name || inst.displayName), usedDpNames);
    dps.push({ dpName, displayName: inst.displayName, dpType: typeName });
    if (conn) addresses.push(...addressesForInstance(inst, dpName, conn, pollGroup, directionOverrides, warnings));
  }

  if (model.source === 'opcua-nodeset' && conn && addresses.length > 0) {
    warnings.push(
      'NodeSet namespace indices are file-local and may differ from the live server — verify the NodeIds of the written address configs.'
    );
  }

  return { source: model.source, types, dps, addresses, connection: conn, warnings };
}
