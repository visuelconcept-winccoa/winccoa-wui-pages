// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OPC UA **NodeSet2 XML** → {@link AddressBook}.
 *
 * A NodeSet2 (`UANodeSet`, OPC UA Part 6) is how a companion specification or a
 * vendor ships an information model as a file: PackML (OPC 30050), Euromap,
 * a machine builder's own model, or an export from a live server. Ingesting it
 * gives a catalog **without touching the machine** — the offline sibling of the
 * online browse (`browse.ts`).
 *
 * Ported from the tag importer's proven `adapters/opcua-nodeset.ts` (standard
 * reference/datatype NodeIds, alias resolution, AccessLevel decoding), but
 * rewritten on the core's dependency-free XML reader: the tag-importer version
 * runs on the browser's `DOMParser`, which does not exist in the core or in the
 * backend. The datatype/direction mapping is the shared, verified `drivers/opcua`.
 *
 * Two shapes come out of it, and the difference matters:
 *
 *  - the file declares real **instances** (`UAObject` with a `HasTypeDefinition`
 *    and NO `HasModellingRule`) → each instance's subtree becomes book entries
 *    under the instance name. This is an export of a concrete machine.
 *  - the file declares only **types** (the usual case for a companion spec) →
 *    each `UAObjectType` is catalogued as a TEMPLATE, its members rooted at the
 *    type name. That is exactly the studio's *template catalog*: mutualisable
 *    across every machine implementing the spec.
 *
 * ⚠️ **NodeIds are file-local.** A NodeSet's namespace INDICES are assigned by
 * the file, and a live server almost always assigns different ones — so an
 * address built from a NodeSet is a *candidate*, not a binding. Every address is
 * therefore emitted with the `<Connexion>` placeholder (never a real connection)
 * and the book carries a loud warning: verify against the server, or re-browse it
 * online, before check-in. This is the same caveat the tag importer documents.
 */

import { buildOpcUaReference, isUnmappedOpcUaType, opcUaAccessFromLevel, opcUaLeafType } from '../drivers/opcua.js';
import { childrenOf, localName, parseXml, type XmlNode } from '../simaticml/xml.js';
import { WARNING_CODES, warn, type EngWarning } from '../warnings.js';
import type { AddressBook, BookEntry, BookType } from '../model.js';

// Standard reference-type NodeIds (namespace 0, OPC UA Part 6).
const REF_HAS_SUBTYPE = 'i=45';
const REF_HAS_PROPERTY = 'i=46';
const REF_HAS_COMPONENT = 'i=47';
const REF_HAS_TYPE_DEFINITION = 'i=40';
const REF_HAS_MODELLING_RULE = 'i=37';
/** `BaseObjectType` — carries no useful custom member. */
const BASE_OBJECT_TYPE = 'i=58';

/** Standard built-in DataType NodeIds (namespace 0) → OPC UA type name. */
const BUILTIN_DATATYPE: Record<string, string> = {
  'i=1': 'Boolean', 'i=2': 'SByte', 'i=3': 'Byte', 'i=4': 'Int16', 'i=5': 'UInt16',
  'i=6': 'Int32', 'i=7': 'UInt32', 'i=8': 'Int64', 'i=9': 'UInt64', 'i=10': 'Float',
  'i=11': 'Double', 'i=12': 'String', 'i=13': 'DateTime', 'i=14': 'Guid',
  'i=15': 'ByteString', 'i=16': 'XmlElement', 'i=17': 'NodeId', 'i=18': 'ExpandedNodeId',
  'i=20': 'QualifiedName', 'i=21': 'LocalizedText', 'i=26': 'Number', 'i=27': 'Integer',
  'i=28': 'UInteger'
};
const KNOWN_TYPE_NAMES = new Set(Object.values(BUILTIN_DATATYPE));

/** Connection placeholder of a template address (substituted at generation). */
const CONNECTION_PLACEHOLDER = '<Connection>';

/** Recursion guard: a NodeSet's HasComponent graph can be deep and cyclic. */
const MAX_MEMBER_DEPTH = 12;

interface RawRef {
  type: string;
  target: string;
  forward: boolean;
}

interface RawNode {
  nodeId: string;
  /** `UAObjectType`, `UAVariable`, `UAObject`, `UAMethod`, … */
  kind: string;
  browseName: string;
  description?: string;
  dataType?: string;
  valueRank: number;
  accessLevel: number;
  refs: RawRef[];
}

/** `ns=0;i=N` → `i=N` (a NodeId of namespace 0 has a canonical short form). */
function canonicalNodeId(id: string): string {
  const match = /^ns=0;(.+)$/.exec(id.trim());
  return match ? match[1] : id.trim();
}

function resolveRef(attr: string, aliases: Map<string, string>): string {
  return canonicalNodeId(aliases.get(attr) ?? attr);
}

/** A `DataType` attribute (alias or NodeId) → OPC UA built-in type name. */
function resolveDataTypeName(attr: string | undefined, aliases: Map<string, string>): string {
  if (!attr) return 'BaseDataType';
  if (KNOWN_TYPE_NAMES.has(attr)) return attr; // the alias IS a type name (e.g. "Double")
  const id = resolveRef(attr, aliases);
  return BUILTIN_DATATYPE[id] ?? attr;
}

/** `2:Temperature` → `Temperature` (a BrowseName is `<nsIndex>:<name>`). */
function stripBrowseNs(browseName: string): string {
  const colon = browseName.indexOf(':');
  return colon === -1 ? browseName : browseName.slice(colon + 1);
}

function directText(node: XmlNode, tag: string): string | undefined {
  const child = childrenOf(node, tag)[0];
  const text = child?.text.trim();
  return text === undefined || text === '' ? undefined : text;
}

function parseRefs(node: XmlNode, aliases: Map<string, string>): RawRef[] {
  const container = childrenOf(node, 'References')[0];
  if (!container) return [];
  const out: RawRef[] = [];
  for (const ref of childrenOf(container, 'Reference')) {
    const type = ref.attrs['ReferenceType'] ?? '';
    const target = ref.text.trim();
    if (type === '' || target === '') continue;
    out.push({ type: resolveRef(type, aliases), target, forward: (ref.attrs['IsForward'] ?? 'true') !== 'false' });
  }
  return out;
}

interface ParsedDocument {
  nodes: Map<string, RawNode>;
  namespaces: string[];
}

/** Parse a `UANodeSet` document into a node map + its namespace table. */
function parseDocument(xml: string): ParsedDocument {
  const root = parseXml(xml);
  if (localName(root.tag) !== 'UANodeSet') {
    throw new Error(`not a NodeSet2 document: root element is <${root.tag}>, expected <UANodeSet>`);
  }
  const namespaces = ['http://opcfoundation.org/UA/'];
  const nsUris = childrenOf(root, 'NamespaceUris')[0];
  if (nsUris) {
    for (const uri of childrenOf(nsUris, 'Uri')) namespaces.push(uri.text.trim());
  }
  const aliases = new Map<string, string>();
  const aliasContainer = childrenOf(root, 'Aliases')[0];
  if (aliasContainer) {
    for (const alias of childrenOf(aliasContainer, 'Alias')) {
      const name = alias.attrs['Alias'];
      const id = alias.text.trim();
      if (name && id !== '') aliases.set(name, canonicalNodeId(id));
    }
  }
  const nodes = new Map<string, RawNode>();
  for (const element of root.children) {
    const kind = localName(element.tag);
    if (!kind.startsWith('UA')) continue;
    const nodeId = element.attrs['NodeId'];
    if (!nodeId) continue;
    const id = canonicalNodeId(nodeId);
    nodes.set(id, {
      nodeId: id,
      kind,
      browseName: element.attrs['BrowseName'] ?? directText(element, 'DisplayName') ?? id,
      description: directText(element, 'Description'),
      dataType: kind === 'UAVariable' ? resolveDataTypeName(element.attrs['DataType'], aliases) : undefined,
      valueRank: Number(element.attrs['ValueRank'] ?? '-1'),
      accessLevel: Number(element.attrs['AccessLevel'] ?? '1'),
      refs: parseRefs(element, aliases)
    });
  }
  return { nodes, namespaces };
}

const forwardTargets = (node: RawNode, refType: string): string[] =>
  node.refs.filter((r) => r.forward && r.type === refType).map((r) => canonicalNodeId(r.target));

const hasRef = (node: RawNode, refType: string): boolean => node.refs.some((r) => r.type === refType);

/** The custom supertype of a type node (inverse `HasSubtype`), when modelled here. */
function superTypeOf(node: RawNode, nodes: Map<string, RawNode>): RawNode | undefined {
  const parent = node.refs.find((r) => r.type === REF_HAS_SUBTYPE && !r.forward)?.target;
  if (!parent) return undefined;
  const canon = canonicalNodeId(parent);
  return canon === BASE_OBJECT_TYPE ? undefined : nodes.get(canon);
}

export interface NodeSetBookOptions {
  bookId: string;
  name?: string;
  /** Source file name, recorded in the provenance. */
  file?: string;
  /** Injected so the result is deterministic in tests. */
  generatedAt?: string;
}

interface Collector {
  entries: BookEntry[];
  types: BookType[];
  warnings: EngWarning[];
  methods: number;
  arrays: string[];
  cycles: number;
  depthHits: number;
}

/**
 * Collect the leaf variables of `owner` into `entries`, recursing through nested
 * objects and folding in the members inherited from a custom supertype (WinCC OA
 * has no DPType inheritance, so a subtype must carry everything).
 */
function collectMembers(
  owner: RawNode,
  nodes: Map<string, RawNode>,
  segments: string[],
  visited: Set<string>,
  out: Collector,
  members?: BookType['members']
): void {
  if (segments.length > MAX_MEMBER_DEPTH) {
    out.depthHits += 1;
    return;
  }
  // Inherited members first, so an override by the subtype wins on name.
  const inherited = superTypeOf(owner, nodes);
  if (inherited && !visited.has(inherited.nodeId)) {
    visited.add(inherited.nodeId);
    collectMembers(inherited, nodes, segments, visited, out, members);
  }
  const componentIds = [...forwardTargets(owner, REF_HAS_COMPONENT), ...forwardTargets(owner, REF_HAS_PROPERTY)];
  for (const childId of componentIds) {
    const child = nodes.get(childId);
    if (!child) continue; // reference into a namespace this file does not carry
    const name = stripBrowseNs(child.browseName).trim();
    if (name === '') continue;
    const path = [...segments, name];
    if (child.kind === 'UAMethod') {
      out.methods += 1;
      continue;
    }
    if (child.kind === 'UAVariable') {
      const array = child.valueRank >= 0;
      if (array) out.arrays.push(path.join('.'));
      const sourceType = `${child.dataType ?? 'BaseDataType'}${array ? '[]' : ''}`;
      const leafType = opcUaLeafType(child.dataType);
      const entry: BookEntry = {
        path: path.join('.'),
        sourceType,
        leafType,
        // A NodeSet DOES carry AccessLevel — unlike an online browse.
        access: opcUaAccessFromLevel(child.accessLevel),
        accessSource: 'declared',
        // File-local NodeId ⇒ a TEMPLATE address, bound at generation time.
        addresses: { opcua: buildOpcUaReference(CONNECTION_PLACEHOLDER, child.nodeId) },
        ...(child.description === undefined ? {} : { comment: child.description }),
        ...(isUnmappedOpcUaType(child.dataType) || array ? { unmapped: true } : {})
      };
      out.entries.push(entry);
      members?.push({
        path: path.slice(segments.length > 0 ? 1 : 0).join('.') || name,
        sourceType,
        leafType,
        ...(child.description === undefined ? {} : { comment: child.description })
      });
      continue;
    }
    // A nested object: recurse into its own declaration, and into its TYPE when
    // the declaration is empty (an instance-declaration often only points at it).
    if (visited.has(child.nodeId)) {
      out.cycles += 1;
      continue;
    }
    visited.add(child.nodeId);
    const before = out.entries.length;
    collectMembers(child, nodes, path, visited, out, members);
    if (out.entries.length === before) {
      const typeId = forwardTargets(child, REF_HAS_TYPE_DEFINITION)[0];
      const typeNode = typeId === undefined ? undefined : nodes.get(typeId);
      if (typeNode && !visited.has(typeNode.nodeId)) {
        visited.add(typeNode.nodeId);
        collectMembers(typeNode, nodes, path, visited, out, members);
      }
    }
  }
}

/**
 * Build an address book from a NodeSet2 XML document.
 *
 * The book is a TEMPLATE catalog: it carries no `interface`, because a NodeSet
 * describes a model, not a reachable server (and its namespace indices are
 * file-local). Bind it per equipment at generation time.
 */
export function buildBookFromNodeSet(options: NodeSetBookOptions & { xml: string }): AddressBook {
  const { nodes, namespaces } = parseDocument(options.xml);
  const out: Collector = { entries: [], types: [], warnings: [], methods: 0, arrays: [], cycles: 0, depthHits: 0 };

  // Real instances: an object with a type definition and NO modelling rule (a
  // modelling rule marks an instance DECLARATION, i.e. part of a type).
  const instances = [...nodes.values()].filter(
    (node) => node.kind === 'UAObject' && forwardTargets(node, REF_HAS_TYPE_DEFINITION).length > 0 && !hasRef(node, REF_HAS_MODELLING_RULE)
  );
  const objectTypes = [...nodes.values()].filter((node) => node.kind === 'UAObjectType');

  if (instances.length > 0) {
    for (const instance of instances) {
      const name = stripBrowseNs(instance.browseName).trim() || instance.nodeId;
      const visited = new Set<string>([instance.nodeId]);
      const before = out.entries.length;
      collectMembers(instance, nodes, [name], visited, out);
      if (out.entries.length === before) {
        // An empty instance declaration: its members live on its type.
        const typeId = forwardTargets(instance, REF_HAS_TYPE_DEFINITION)[0];
        const typeNode = typeId === undefined ? undefined : nodes.get(typeId);
        if (typeNode) collectMembers(typeNode, nodes, [name], new Set([typeNode.nodeId]), out);
      }
    }
  }

  // Types are always catalogued as BookTypes (they are the DPT candidates), and
  // when the file declares no instance they also provide the ENTRIES.
  for (const type of objectTypes) {
    const typeName = stripBrowseNs(type.browseName).trim() || type.nodeId;
    const members: BookType['members'] = [];
    if (instances.length === 0) {
      const visited = new Set<string>([type.nodeId]);
      collectMembers(type, nodes, [typeName], visited, out, members);
    } else {
      // Instances already produced the entries: collect the members separately so
      // the type catalog stays available without duplicating entries.
      const scratch: Collector = { ...out, entries: [] };
      collectMembers(type, nodes, [], new Set([type.nodeId]), scratch, members);
    }
    if (members.length > 0) out.types.push({ id: type.nodeId, name: typeName, members });
  }

  const warnings: EngWarning[] = [
    warn(
      WARNING_CODES.nodeset.FILE_LOCAL_NODEIDS,
      '⚠️ NodeSet2 NodeIds are FILE-LOCAL: a real server almost always assigns different namespace indices. The addresses below are CANDIDATES (placeholder "{placeholder}") — verify them against the server, or regenerate the book with an online browse, before any check-in.',
      { placeholder: CONNECTION_PLACEHOLDER }
    )
  ];
  if (instances.length === 0 && objectTypes.length > 0) {
    warnings.push(
      warn(
        WARNING_CODES.nodeset.TEMPLATES_ONLY,
        'No instance declared in the file: {n} type(s) catalogued as TEMPLATES (rooted at the type name) — a shareable book, bound to each device at generation time.',
        { n: objectTypes.length }
      )
    );
  }
  if (out.entries.length === 0) {
    warnings.push(
      warn(WARNING_CODES.nodeset.NO_VARIABLE, 'No usable variable found: check that the file really contains UAVariable nodes under UAObject/UAObjectType.')
    );
  }
  if (out.methods > 0) {
    warnings.push(warn(WARNING_CODES.nodeset.METHODS_SKIPPED, '{n} OPC UA method(s) skipped (not modelled as DPEs).', { n: out.methods }));
  }
  if (out.arrays.length > 0) {
    warnings.push(
      warn(
        WARNING_CODES.nodeset.ARRAYS_FLAGGED,
        '{n} ARRAY variable(s) catalogued with their scalar base type and flagged "unmapped" ({paths}{more}) — the address write for a dynamic DPE is not verified.',
        { n: out.arrays.length, paths: out.arrays.slice(0, 5).join(', '), more: out.arrays.length > 5 ? '…' : '' }
      )
    );
  }
  if (out.cycles > 0) {
    warnings.push(warn(WARNING_CODES.nodeset.CYCLES_CUT, '{n} circular reference(s) cut while reading the model.', { n: out.cycles }));
  }
  if (out.depthHits > 0) {
    warnings.push(
      warn(WARNING_CODES.nodeset.DEPTH_TRUNCATED, '{n} branch(es) truncated beyond {depth} nesting levels.', {
        n: out.depthHits,
        depth: MAX_MEMBER_DEPTH
      })
    );
  }
  warnings.push(...out.warnings);

  return {
    id: options.bookId,
    name: options.name ?? `NodeSet ${options.file ?? options.bookId}`,
    provenance: {
      kind: 'nodeset',
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      ...(options.file === undefined ? {} : { file: options.file }),
      detail: `${namespaces.length - 1} namespace(s) · ${objectTypes.length} type(s) · ${instances.length} instance(s) · ${out.entries.length} signals`
    },
    // No `interface`: a NodeSet is a MODEL, not a reachable server (see header).
    entries: out.entries,
    types: out.types,
    warnings
  };
}
