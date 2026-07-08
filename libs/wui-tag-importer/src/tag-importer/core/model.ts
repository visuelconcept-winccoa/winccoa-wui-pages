// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tag Importer — protocol-neutral intermediate model (IR).
 *
 * Every source adapter (OPC UA NodeSet2 XML, live OPC UA browse, and future
 * protocols) produces a {@link TagModel}. The protocol-agnostic
 * `DpTypeGenerator` turns that model into an {@link import('./plan.js').ImportPlan}
 * of concrete WinCC OA objects to create. Only the {@link ProtocolAddress}
 * carries protocol-specific data, and it is opaque to the core: the
 * matching `AddressBinder` (same `protocol` discriminator) is the sole reader.
 *
 * Design decisions (confirmed with the product owner):
 *  - one DPType per source ObjectType; repeated instances of a type become many
 *    DPs of that one DPType (the "mutualisation" of repeated nodes);
 *  - nested typed objects are expressed FAITHFULLY as {@link RefMember}s here;
 *    the generator later applies the HYBRID policy (keep as `DPT_TYPEREF` when a
 *    type is shared by ≥2 parents, otherwise flatten into a struct).
 */

/**
 * Scalar leaf types the importer maps source datatypes onto. The names match
 * the WinCC OA element-type keys used by the backend DPType builder
 * (`Bool`, `Int`, `Float`, …) so a leaf's `dataType` is written verbatim into
 * the generated {@link import('./plan.js').DpTypeStructure}.
 */
export type OaLeafType =
  | 'Bool'
  | 'Char'
  | 'UInt'
  | 'Int'
  | 'Long'
  | 'ULong'
  | 'Float'
  | 'String'
  | 'Time'
  | 'Blob'
  | 'Bit32'
  | 'LangString';

/** Access mode of a leaf — drives the peripheral-address direction. */
export type TagAccess = 'r' | 'rw' | 'w';

/**
 * A protocol-specific address for one leaf of one instance. Opaque to the core;
 * produced by an adapter and consumed only by the matching AddressBinder.
 */
export interface ProtocolAddress {
  /** Discriminator selecting the binding rule. */
  protocol: 'opcua';
  /** OPC UA NodeId in item notation, e.g. `ns=2;s=Pump1.Flow`. */
  nodeId: string;
  /** Access mode (read-only → INPUT, writable → I/O). */
  access: TagAccess;
  /** OPC UA built-in datatype name (e.g. `Double`), for the `_datatype` mapping. */
  sourceDataType?: string;
}

/** A leaf DPE of a type. */
export interface LeafMember {
  kind: 'leaf';
  /** DPE name (sanitised BrowseName). */
  name: string;
  dataType: OaLeafType;
  access: TagAccess;
  /** 0 = scalar; 1 = one-dimensional array (mapped to a `Dyn*` element type). */
  arrayRank: number;
  /** Original source datatype name (diagnostics + `_datatype` mapping). */
  sourceDataType?: string;
  /** Original browse path/NodeId of this leaf (tooltips + diagnostics). */
  sourceRef?: string;
}

/** An inline sub-structure (a nested object with no reusable type, or a flattened one). */
export interface GroupMember {
  kind: 'group';
  name: string;
  children: Member[];
}

/** A reference to another {@link TypeDef} — becomes a `DPT_TYPEREF` when kept, or is inlined. */
export interface RefMember {
  kind: 'ref';
  name: string;
  /** {@link TypeDef.id} of the referenced type. */
  typeId: string;
}

/** One member of a type: a leaf value, a nested group, or a reference to another type. */
export type Member = LeafMember | GroupMember | RefMember;

/** A source ObjectType → one candidate WinCC OA DPType. */
export interface TypeDef {
  /** Stable id for references + dependency ordering (the source type NodeId). */
  id: string;
  /** Proposed WinCC OA DPType name (sanitised + prefixed; editable in review). */
  name: string;
  /** Display name (source BrowseName). */
  displayName: string;
  /** Members (leaves, nested groups, and refs to other TypeDefs). */
  members: Member[];
  /** Source type NodeId (diagnostics). */
  sourceNodeId?: string;
}

/** A source object instance → one WinCC OA datapoint of its type. */
export interface InstanceDef {
  /** Proposed WinCC OA DP name (sanitised; editable in review). */
  name: string;
  /** Display name (source BrowseName). */
  displayName: string;
  /** {@link TypeDef.id} this instance is created from. */
  typeId: string;
  /**
   * Address of each leaf, keyed by the DPE path within the type — the member
   * names dot-joined (e.g. `Motor.Speed`). The DPE path is identical whether the
   * nested type is flattened or kept as a typeref, so bindings survive the
   * hybrid decision unchanged.
   */
  bindings: Record<string, ProtocolAddress>;
  /** Source instance NodeId (diagnostics). */
  sourceNodeId?: string;
}

/** The complete protocol-neutral import model produced by a source adapter. */
export interface TagModel {
  /** Which adapter produced this model. */
  source: SourceKind;
  /** OPC UA namespace URIs (array index = namespace index), for naming + diagnostics. */
  namespaces: string[];
  types: TypeDef[];
  instances: InstanceDef[];
  /** Non-fatal issues surfaced while building the model (unsupported nodes, …). */
  warnings: string[];
}

/** Source adapter identifiers. */
export type SourceKind = 'opcua-nodeset' | 'opcua-online';

/** Walk every leaf of a member subtree, yielding its dot-path and the leaf. */
export function* walkLeaves(members: Member[], prefix = ''): Generator<{ path: string; leaf: LeafMember }> {
  for (const m of members) {
    const path = prefix ? `${prefix}.${m.name}` : m.name;
    if (m.kind === 'leaf') {
      yield { path, leaf: m };
    } else if (m.kind === 'group') {
      yield* walkLeaves(m.children, path);
    }
    // RefMember leaves live in the referenced type; their bindings are resolved
    // against that type when the plan is generated (see DpTypeGenerator).
  }
}
