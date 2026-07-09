// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OPC UA NodeSet2 XML adapter — parses a standard `UANodeSet` document (OPC
 * Foundation Part 6 schema) into the protocol-neutral {@link TagModel}, in the
 * browser via `DOMParser`.
 *
 * Mapping:
 *  - every `UAObjectType` becomes a {@link TypeDef}; its `HasComponent` /
 *    `HasProperty` instance-declarations become members (variables → leaves,
 *    nested objects → a {@link RefMember} to their `HasTypeDefinition` type when
 *    that type is modelled here, else an inlined group). Members inherited from
 *    a custom supertype (`HasSubtype`) are folded in (WinCC OA has no type
 *    inheritance), subtype members overriding by name;
 *  - every `UAObject` instance (has a `HasTypeDefinition` to a modelled type and
 *    NO `HasModellingRule` — i.e. a real instance, not an instance-declaration)
 *    becomes an {@link InstanceDef}; this is the "mutualisation" — N objects of
 *    one type → 1 DPType, N datapoints.
 *
 * NOTE: NodeSet namespace indices are file-local and generally differ from a
 * live server's, so instance NodeIds parsed here are informational — a NodeSet
 * (offline) import creates types + datapoints but does NOT write address configs
 * (there is no live server to bind to).
 */

import type { InstanceDef, LeafMember, Member, ProtocolAddress, TagModel, TagAccess, TypeDef } from '../core/model.js';
import { opcUaLeafType, isUnmappedOpcUaType } from '../core/opcua-mapping.js';
import { sanitizeIdentifier, stripBrowseNs } from '../core/naming.js';

/** DPE element name from an OPC UA BrowseName: strip the ns prefix, then sanitise to a valid identifier. */
function elementName(browseName: string): string {
  return sanitizeIdentifier(stripBrowseNs(browseName));
}

// Standard reference-type NodeIds (namespace 0). See OPC UA Part 6.
const REF_HAS_SUBTYPE = 'i=45';
const REF_HAS_PROPERTY = 'i=46';
const REF_HAS_COMPONENT = 'i=47';
const REF_HAS_TYPE_DEFINITION = 'i=40';
const REF_HAS_MODELLING_RULE = 'i=37';

// Standard base type NodeIds that carry no useful custom members.
const BASE_OBJECT_TYPE = 'i=58';

/** Standard built-in DataType NodeIds (namespace 0) → OPC UA type name. */
const BUILTIN_DATATYPE: Record<string, string> = {
  'i=1': 'Boolean',
  'i=2': 'SByte',
  'i=3': 'Byte',
  'i=4': 'Int16',
  'i=5': 'UInt16',
  'i=6': 'Int32',
  'i=7': 'UInt32',
  'i=8': 'Int64',
  'i=9': 'UInt64',
  'i=10': 'Float',
  'i=11': 'Double',
  'i=12': 'String',
  'i=13': 'DateTime',
  'i=14': 'Guid',
  'i=15': 'ByteString',
  'i=16': 'XmlElement',
  'i=17': 'NodeId',
  'i=18': 'ExpandedNodeId',
  'i=20': 'QualifiedName',
  'i=21': 'LocalizedText',
  'i=26': 'Number',
  'i=27': 'Integer',
  'i=28': 'UInteger'
};

const KNOWN_TYPE_NAMES = new Set(Object.values(BUILTIN_DATATYPE));

/** One parsed reference of a node. */
interface RawRef {
  /** Reference type resolved to a namespace-0 NodeId (e.g. `i=47`). */
  type: string;
  /** Target NodeId. */
  target: string;
  /** Forward (true) or inverse (false). */
  forward: boolean;
}

/** One parsed node of the address space. */
interface RawNode {
  nodeId: string;
  /** Element local name: `UAObjectType`, `UAVariable`, `UAObject`, … */
  kind: string;
  browseName: string;
  /** DataType attribute (UAVariable), resolved to an OPC UA type name. */
  dataType?: string;
  /** ValueRank attribute (UAVariable). */
  valueRank: number;
  /** AccessLevel attribute (UAVariable). */
  accessLevel: number;
  refs: RawRef[];
}

/** Normalise a NodeId to its canonical string (a bare `i=N` stays `i=N`; `ns=0;i=N` → `i=N`). */
function canonicalNodeId(id: string): string {
  const m = /^ns=0;(.+)$/.exec(id.trim());
  return m ? m[1] : id.trim();
}

/** Resolve a reference-type or datatype attribute (alias or NodeId) to a NodeId. */
function resolveRef(attr: string, aliases: Map<string, string>): string {
  const viaAlias = aliases.get(attr);
  return canonicalNodeId(viaAlias ?? attr);
}

/** Resolve a UAVariable DataType attribute to an OPC UA built-in type name (or the raw custom id). */
function resolveDataTypeName(attr: string | null, aliases: Map<string, string>): string {
  if (!attr) return 'BaseDataType';
  if (KNOWN_TYPE_NAMES.has(attr)) return attr; // alias already a type name, e.g. "Double"
  const id = resolveRef(attr, aliases);
  return BUILTIN_DATATYPE[id] ?? attr;
}

function elementText(parent: Element, localName: string): string {
  const el = [...parent.children].find((c) => c.localName === localName);
  return el?.textContent?.trim() ?? '';
}

function parseRefs(node: Element, aliases: Map<string, string>): RawRef[] {
  const refsEl = [...node.children].find((c) => c.localName === 'References');
  if (!refsEl) return [];
  const out: RawRef[] = [];
  for (const r of refsEl.children) {
    if (r.localName !== 'Reference') continue;
    const typeAttr = r.getAttribute('ReferenceType') ?? '';
    const forward = (r.getAttribute('IsForward') ?? 'true') !== 'false';
    const target = (r.textContent ?? '').trim();
    if (!typeAttr || !target) continue;
    out.push({ type: resolveRef(typeAttr, aliases), target: target, forward });
  }
  return out;
}

/** OPC UA AccessLevel bit masks. */
const ACCESS_CURRENT_READ = 1;
const ACCESS_CURRENT_WRITE = 2;

/** Access mode from an OPC UA AccessLevel bitmask (CurrentRead=1, CurrentWrite=2). */
function accessFromLevel(level: number): TagAccess {
  const read = (level & ACCESS_CURRENT_READ) !== 0;
  const write = (level & ACCESS_CURRENT_WRITE) !== 0;
  if (read && write) return 'rw';
  if (write) return 'w';
  return 'r';
}

/** Parse the document into a node map + alias/namespace tables. */
function parseDocument(xml: string): { nodes: Map<string, RawNode>; namespaces: string[]; error?: string } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parseError = doc.querySelectorAll('parsererror')[0];
  if (parseError) return { nodes: new Map(), namespaces: [], error: parseError.textContent ?? 'XML parse error' };
  const root = doc.documentElement;
  if (!root || root.localName !== 'UANodeSet') {
    return { nodes: new Map(), namespaces: [], error: 'Root element is not <UANodeSet>' };
  }

  // Namespaces (index 0 is always the OPC UA base namespace).
  const namespaces = ['http://opcfoundation.org/UA/'];
  const nsUris = [...root.children].find((c) => c.localName === 'NamespaceUris');
  if (nsUris) {
    for (const u of nsUris.children) {
      if (u.localName === 'Uri') namespaces.push(u.textContent?.trim() ?? '');
    }
  }

  // Aliases (alias name → NodeId).
  const aliases = new Map<string, string>();
  const aliasesEl = [...root.children].find((c) => c.localName === 'Aliases');
  if (aliasesEl) {
    for (const a of aliasesEl.children) {
      if (a.localName !== 'Alias') continue;
      const name = a.getAttribute('Alias');
      const id = (a.textContent ?? '').trim();
      if (name && id) aliases.set(name, canonicalNodeId(id));
    }
  }

  const nodes = new Map<string, RawNode>();
  for (const el of root.children) {
    if (!el.localName.startsWith('UA')) continue;
    const nodeId = el.getAttribute('NodeId');
    if (!nodeId) continue;
    const id = canonicalNodeId(nodeId);
    nodes.set(id, {
      nodeId: id,
      kind: el.localName,
      browseName: el.getAttribute('BrowseName') ?? elementText(el, 'DisplayName') ?? id,
      dataType: el.localName === 'UAVariable' ? resolveDataTypeName(el.getAttribute('DataType'), aliases) : undefined,
      valueRank: Number(el.getAttribute('ValueRank') ?? '-1'),
      accessLevel: Number(el.getAttribute('AccessLevel') ?? '1'),
      refs: parseRefs(el, aliases)
    });
  }
  return { nodes, namespaces };
}

const forwardTargets = (node: RawNode, refType: string): string[] =>
  node.refs.filter((r) => r.forward && r.type === refType).map((r) => canonicalNodeId(r.target));

const hasRef = (node: RawNode, refType: string): boolean => node.refs.some((r) => r.type === refType);

/** The HasTypeDefinition target of an instance/instance-declaration (canonical), if any. */
function typeDefinitionOf(node: RawNode): string | undefined {
  return forwardTargets(node, REF_HAS_TYPE_DEFINITION)[0];
}

/** The custom supertype of a type node (via inverse HasSubtype), if it is modelled here. */
function superTypeOf(node: RawNode, nodes: Map<string, RawNode>): RawNode | undefined {
  const parentId = node.refs.find((r) => r.type === REF_HAS_SUBTYPE && !r.forward)?.target;
  if (!parentId) return undefined;
  const canon = canonicalNodeId(parentId);
  if (canon === BASE_OBJECT_TYPE) return undefined;
  return nodes.get(canon);
}

export interface NodeSetParseResult {
  model?: TagModel;
  error?: string;
}

/** Parse an OPC UA NodeSet2 XML string into a {@link TagModel}. */
export function parseNodeSet(xml: string): NodeSetParseResult {
  const { nodes, namespaces, error } = parseDocument(xml);
  if (error) return { error };

  const warnings: string[] = [];
  const objectTypes = [...nodes.values()].filter((n) => n.kind === 'UAObjectType');

  // --- component members of a type/object node (variables, nested objects) ----
  const membersOf = (owner: RawNode, seenTypes: Set<string>): Member[] => {
    const members: Member[] = [];
    const componentIds = [...forwardTargets(owner, REF_HAS_COMPONENT), ...forwardTargets(owner, REF_HAS_PROPERTY)];
    for (const childId of componentIds) {
      const child = nodes.get(childId);
      if (!child) continue;
      switch (child.kind) {
      case 'UAVariable': {
        const dataType = child.dataType ?? 'BaseDataType';
        if (isUnmappedOpcUaType(dataType)) {
          warnings.push(`Variable "${stripBrowseNs(child.browseName)}" has unsupported type "${dataType}" — mapped to String.`);
        }
        const leaf: LeafMember = {
          kind: 'leaf',
          name: elementName(child.browseName),
          dataType: opcUaLeafType(dataType),
          access: accessFromLevel(child.accessLevel),
          arrayRank: child.valueRank >= 1 || child.valueRank === 0 ? 1 : 0,
          sourceDataType: dataType,
          sourceRef: child.nodeId
        };
        members.push(leaf);
      
      break;
      }
      case 'UAObject': {
        const typeDef = typeDefinitionOf(child);
        if (typeDef && nodes.get(typeDef)?.kind === 'UAObjectType') {
          members.push({ kind: 'ref', name: elementName(child.browseName), typeId: typeDef });
        } else if (seenTypes.has(child.nodeId)) {
          warnings.push(`Component cycle at "${stripBrowseNs(child.browseName)}" — nested object skipped.`);
        } else {
          // Untyped / non-modelled nested object → inline its own components.
          members.push({
            kind: 'group',
            name: elementName(child.browseName),
            children: membersOf(child, new Set(seenTypes).add(child.nodeId))
          });
        }

      break;
      }
      case 'UAMethod': {
        warnings.push(`Method "${stripBrowseNs(child.browseName)}" on "${stripBrowseNs(owner.browseName)}" skipped (methods not imported).`);
      
      break;
      }
      // No default
      }
    }
    return members;
  };

  // --- type definitions (with inherited members folded in) --------------------
  const typeMembersCache = new Map<string, Member[]>();
  const resolveTypeMembers = (typeNode: RawNode, stack: Set<string>): Member[] => {
    const cached = typeMembersCache.get(typeNode.nodeId);
    if (cached) return cached;
    if (stack.has(typeNode.nodeId)) return []; // supertype cycle guard
    const own = membersOf(typeNode, new Set([typeNode.nodeId]));
    const parent = superTypeOf(typeNode, nodes);
    let merged = own;
    if (parent) {
      const inherited = resolveTypeMembers(parent, new Set(stack).add(typeNode.nodeId));
      const ownNames = new Set(own.map((m) => m.name));
      merged = [...inherited.filter((m) => !ownNames.has(m.name)), ...own];
    }
    typeMembersCache.set(typeNode.nodeId, merged);
    return merged;
  };

  const types: TypeDef[] = objectTypes.map((t) => ({
    id: t.nodeId,
    name: stripBrowseNs(t.browseName),
    displayName: stripBrowseNs(t.browseName),
    members: resolveTypeMembers(t, new Set()),
    sourceNodeId: t.nodeId
  }));
  const modelledTypeIds = new Set(types.map((t) => t.id));

  // --- instances (real objects, not instance-declarations) --------------------
  const instanceBindings = (owner: RawNode, prefix: string, out: Record<string, ProtocolAddress>, seen: Set<string>): void => {
    const componentIds = [...forwardTargets(owner, REF_HAS_COMPONENT), ...forwardTargets(owner, REF_HAS_PROPERTY)];
    for (const childId of componentIds) {
      const child = nodes.get(childId);
      if (!child) continue;
      const seg = elementName(child.browseName);
      const path = prefix ? `${prefix}.${seg}` : seg;
      if (child.kind === 'UAVariable') {
        out[path] = {
          protocol: 'opcua',
          nodeId: child.nodeId,
          access: accessFromLevel(child.accessLevel),
          sourceDataType: child.dataType ?? 'BaseDataType'
        };
      } else if (child.kind === 'UAObject' && !seen.has(child.nodeId)) {
        instanceBindings(child, path, out, new Set(seen).add(child.nodeId));
      }
    }
  };

  // Candidate instances: real objects (no modelling rule) of a modelled type.
  const candidates = [...nodes.values()].filter((n) => {
    if (n.kind !== 'UAObject' || hasRef(n, REF_HAS_MODELLING_RULE)) return false;
    const typeDef = typeDefinitionOf(n);
    return Boolean(typeDef && modelledTypeIds.has(typeDef));
  });

  // A candidate that is a component/property (recursively) of ANOTHER object is a
  // nested part — it is already flattened into its parent's datapoint, so it must
  // NOT also be created standalone (else duplicate/orphan DPs + double bindings).
  const owned = new Set<string>();
  const markOwned = (id: string, path: Set<string>): void => {
    const n = nodes.get(id);
    if (!n) return;
    for (const childId of [...forwardTargets(n, REF_HAS_COMPONENT), ...forwardTargets(n, REF_HAS_PROPERTY)]) {
      if (path.has(childId)) continue; // component cycle guard
      owned.add(childId);
      markOwned(childId, new Set(path).add(childId));
    }
  };
  for (const c of candidates) markOwned(c.nodeId, new Set([c.nodeId]));

  const instances: InstanceDef[] = [];
  for (const n of candidates) {
    if (owned.has(n.nodeId)) continue; // nested part of another instance
    const typeDef = typeDefinitionOf(n);
    if (!typeDef) continue;
    const bindings: Record<string, ProtocolAddress> = {};
    instanceBindings(n, '', bindings, new Set([n.nodeId]));
    instances.push({
      name: stripBrowseNs(n.browseName),
      displayName: stripBrowseNs(n.browseName),
      typeId: typeDef,
      bindings,
      sourceNodeId: n.nodeId
    });
  }

  if (types.length === 0) warnings.push('No object types found in the NodeSet.');

  return { model: { source: 'opcua-nodeset', namespaces, types, instances, warnings } };
}
