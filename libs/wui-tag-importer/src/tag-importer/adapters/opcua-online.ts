// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OPC UA online adapter — builds a {@link TagModel} from a live server by
 * browsing the subtree of each SELECTED instance (via the backend `/browse`).
 * Every selected instance's subtree becomes a datapoint type (nested objects
 * flattened into `Struct` groups — the confirmed online behaviour, since a live
 * browse does not reliably expose shared type definitions) and the instance
 * itself becomes a datapoint; each leaf's live NodeId is captured as its OPC UA
 * address binding. Selected instances with an identical structure share a single
 * datapoint type (mutualisation) — N pumps → 1 type + N datapoints.
 */

import type { InstanceDef, LeafMember, Member, ProtocolAddress, TagAccess, TagModel, TypeDef } from '../core/model.js';
import { opcUaLeafType, isUnmappedOpcUaType } from '../core/opcua-mapping.js';
import { sanitizeIdentifier, stripBrowseNs } from '../core/naming.js';
import { browse, type BrowseNode } from '../data/api.js';

/** A node picked in the browse tree to model as (and instantiate) a type. */
export interface OnlineNodeRef {
  nodeId: string;
  displayName: string;
}

/**
 * How the selected nodes are assembled:
 *  - `perNode` (default, "flat"): one datapoint type per distinct structure and
 *    one datapoint per selected node;
 *  - `grouped` ("sub-levels"): all selected nodes become named child sub-groups
 *    of ONE type, and a SINGLE datapoint is created.
 */
export type AssemblyMode = 'perNode' | 'grouped';

export interface OnlineOptions {
  connection: string;
  /** The selected instances. */
  nodes: OnlineNodeRef[];
  /** perNode (default) or grouped. */
  assembly?: AssemblyMode;
  /** grouped: sub-element name per node (default = sanitised display name). */
  childNames?: Record<string, string>;
  /** grouped: the single type/DP display name (default = the connection name). */
  groupName?: string;
  /** Max subtree depth to browse (guards huge address spaces). */
  maxDepth?: number;
  /** Default access for browsed variables (online browse omits AccessLevel). */
  defaultAccess?: TagAccess;
}

const DEFAULT_MAX_DEPTH = 5;

const isVariable = (nodeClass: string): boolean => nodeClass.includes('Variable');
const isObjectLike = (nodeClass: string): boolean => nodeClass.includes('Object') || nodeClass.includes('Folder');
const arrayRankOf = (valueRank: number): number => (valueRank >= 1 || valueRank === 0 ? 1 : 0);

/**
 * Walk an instance subtree, appending its members (type structure) and, in
 * parallel, its leaf address bindings keyed by dot-path. `members` is per-level;
 * `bindings` is the flat instance-wide map.
 */
async function walk(
  connection: string,
  nodeId: string,
  prefix: string,
  depthLeft: number,
  access: TagAccess,
  members: Member[],
  bindings: Record<string, ProtocolAddress>,
  warnings: string[]
): Promise<void> {
  let children: BrowseNode[];
  try {
    children = await browse(connection, nodeId, 1);
  } catch (error) {
    warnings.push(`Browse of "${nodeId}" failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const used = new Set<string>();
  for (const child of children) {
    // Element names must be valid WinCC OA identifiers and unique within a level;
    // the SAME sanitised name is used for the DPE and the binding path segment.
    let name = sanitizeIdentifier(stripBrowseNs(child.displayName));
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name}_${n}`)) n += 1;
      name = `${name}_${n}`;
    }
    used.add(name);
    const path = prefix ? `${prefix}.${name}` : name;
    if (isVariable(child.nodeClass)) {
      if (isUnmappedOpcUaType(child.dataType)) {
        warnings.push(`Variable "${path}" has unsupported/complex type "${child.dataType || '?'}" — mapped to String.`);
      }
      const leaf: LeafMember = {
        kind: 'leaf',
        name,
        dataType: opcUaLeafType(child.dataType),
        access,
        arrayRank: arrayRankOf(child.valueRank),
        sourceDataType: child.dataType || undefined,
        sourceRef: child.nodeId
      };
      members.push(leaf);
      bindings[path] = { protocol: 'opcua', nodeId: child.nodeId, access, sourceDataType: child.dataType || undefined };
    } else if (isObjectLike(child.nodeClass)) {
      if (depthLeft <= 0) {
        warnings.push(`Subtree of "${path}" truncated at max depth.`);
        continue;
      }
      const sub: Member[] = [];
      await walk(connection, child.nodeId, path, depthLeft - 1, access, sub, bindings, warnings);
      members.push({ kind: 'group', name, children: sub });
    }
    // Methods / views are ignored.
  }
}

/** Structural signature of a member tree (names + leaf datatype/rank + nesting) — access excluded. */
function memberSignature(members: Member[]): string {
  const sig = (m: Member): unknown => {
    if (m.kind === 'leaf') return ['l', m.name, m.dataType, m.arrayRank];
    if (m.kind === 'group') return ['g', m.name, m.children.map((c) => sig(c))];
    return ['r', m.name, m.typeId];
  };
  return JSON.stringify(members.map((m) => sig(m)));
}

/** Build a {@link TagModel} from the selected live instances (one type per distinct structure). */
export async function buildOnlineModel(opts: OnlineOptions): Promise<TagModel> {
  const warnings: string[] = [];
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const access = opts.defaultAccess ?? 'r';
  if (opts.assembly === 'grouped') return buildGrouped(opts, maxDepth, access, warnings);

  const types: TypeDef[] = [];
  const instances: InstanceDef[] = [];
  const typeIdBySignature = new Map<string, string>();

  for (const node of opts.nodes) {
    const displayName = stripBrowseNs(node.displayName);
    const members: Member[] = [];
    const bindings: Record<string, ProtocolAddress> = {};
    await walk(opts.connection, node.nodeId, '', maxDepth, access, members, bindings, warnings);
    if (members.length === 0) warnings.push(`No variables found under "${displayName}".`);

    // Reuse a datapoint type when a previously-selected instance had the same structure.
    const signature = memberSignature(members);
    let typeId = typeIdBySignature.get(signature);
    if (typeId === undefined) {
      typeId = `online:${node.nodeId}`;
      typeIdBySignature.set(signature, typeId);
      types.push({ id: typeId, name: displayName, displayName, members, sourceNodeId: node.nodeId });
    }
    instances.push({ name: displayName, displayName, typeId, bindings, sourceNodeId: node.nodeId });
  }

  if (opts.nodes.length === 0) warnings.push('No instance selected.');

  return { source: 'opcua-online', namespaces: [], types, instances, warnings };
}

/**
 * Grouped assembly: every selected node becomes a named child sub-group of ONE
 * type, and a SINGLE datapoint is created (its bindings prefixed by the child
 * name). Combined with a reuse+extend mapping, this adds the nodes as sub-levels
 * of an existing datapoint type.
 */
async function buildGrouped(opts: OnlineOptions, maxDepth: number, access: TagAccess, warnings: string[]): Promise<TagModel> {
  const groupName = opts.groupName?.trim() || stripBrowseNs(opts.connection);
  const members: Member[] = [];
  const bindings: Record<string, ProtocolAddress> = {};
  const usedChild = new Set<string>();
  for (const node of opts.nodes) {
    let childName = sanitizeIdentifier(opts.childNames?.[node.nodeId] ?? stripBrowseNs(node.displayName));
    // Keep child sub-element names unique within the single datapoint.
    if (usedChild.has(childName)) {
      let n = 2;
      while (usedChild.has(`${childName}_${n}`)) n += 1;
      childName = `${childName}_${n}`;
    }
    usedChild.add(childName);
    const sub: Member[] = [];
    const subBindings: Record<string, ProtocolAddress> = {};
    await walk(opts.connection, node.nodeId, '', maxDepth, access, sub, subBindings, warnings);
    members.push({ kind: 'group', name: childName, children: sub });
    for (const [path, addr] of Object.entries(subBindings)) bindings[`${childName}.${path}`] = addr;
  }
  if (members.length === 0) warnings.push('No instance selected.');
  const typeId = 'online:grouped';
  return {
    source: 'opcua-online',
    namespaces: [],
    types: [{ id: typeId, name: groupName, displayName: groupName, members }],
    instances: [{ name: groupName, displayName: groupName, typeId, bindings }],
    warnings
  };
}
