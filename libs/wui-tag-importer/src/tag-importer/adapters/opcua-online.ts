// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OPC UA online adapter — builds a {@link TagModel} from a live server by
 * browsing a selected instance's subtree (via the backend `/browse`). The
 * selected instance's subtree becomes ONE datapoint type (nested objects are
 * flattened into `Struct` groups — the confirmed online behaviour, since a live
 * browse does not reliably expose shared type definitions); the instance itself
 * (and, optionally, its same-type siblings) become datapoints. Each leaf's live
 * NodeId is captured as its OPC UA address binding.
 */

import type { InstanceDef, LeafMember, Member, ProtocolAddress, TagAccess, TagModel } from '../core/model.js';
import { opcUaLeafType, isUnmappedOpcUaType } from '../core/opcua-mapping.js';
import { stripBrowseNs } from '../core/naming.js';
import { browse, type BrowseNode } from '../data/api.js';

/** A node picked in the browse tree to model as (or instantiate) a type. */
export interface OnlineNodeRef {
  nodeId: string;
  displayName: string;
}

export interface OnlineOptions {
  connection: string;
  /** The instance whose subtree defines the type. */
  primary: OnlineNodeRef;
  /** Optional same-type sibling instances to also create as datapoints. */
  siblings?: OnlineNodeRef[];
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
  for (const child of children) {
    const name = stripBrowseNs(child.displayName);
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

/** Collect only the leaf bindings of an instance subtree (for sibling instances). */
async function collectBindings(
  connection: string,
  nodeId: string,
  prefix: string,
  depthLeft: number,
  access: TagAccess,
  bindings: Record<string, ProtocolAddress>,
  warnings: string[]
): Promise<void> {
  const discard: Member[] = [];
  await walk(connection, nodeId, prefix, depthLeft, access, discard, bindings, warnings);
}

/** Build a {@link TagModel} from a live-browsed instance (+ optional siblings). */
export async function buildOnlineModel(opts: OnlineOptions): Promise<TagModel> {
  const warnings: string[] = [];
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const access = opts.defaultAccess ?? 'r';
  const typeId = `online:${opts.primary.nodeId}`;
  const displayName = stripBrowseNs(opts.primary.displayName);

  // Primary instance → type members + its own bindings.
  const members: Member[] = [];
  const primaryBindings: Record<string, ProtocolAddress> = {};
  await walk(opts.connection, opts.primary.nodeId, '', maxDepth, access, members, primaryBindings, warnings);

  if (members.length === 0) warnings.push(`No variables found under "${displayName}".`);

  const instances: InstanceDef[] = [
    { name: displayName, displayName, typeId, bindings: primaryBindings, sourceNodeId: opts.primary.nodeId }
  ];

  const primaryPaths = Object.keys(primaryBindings);
  for (const sib of opts.siblings ?? []) {
    const sibName = stripBrowseNs(sib.displayName);
    const sibBindings: Record<string, ProtocolAddress> = {};
    await collectBindings(opts.connection, sib.nodeId, '', maxDepth, access, sibBindings, warnings);
    // Only accept a sibling that is structurally compatible with the selected
    // type (covers every leaf of the primary). A divergent sibling is a different
    // type and would otherwise yield a wrong-type datapoint + address configs for
    // elements that do not exist on it.
    const missing = primaryPaths.filter((p) => !(p in sibBindings));
    if (missing.length > 0) {
      warnings.push(`Sibling "${sibName}" skipped — its structure differs from the selected type (missing ${missing.length} element(s)).`);
      continue;
    }
    const restricted: Record<string, ProtocolAddress> = {};
    for (const p of primaryPaths) {
      const addr = sibBindings[p];
      if (addr) restricted[p] = addr;
    }
    instances.push({ name: sibName, displayName: sibName, typeId, bindings: restricted, sourceNodeId: sib.nodeId });
  }

  return {
    source: 'opcua-online',
    namespaces: [],
    types: [{ id: typeId, name: displayName, displayName, members, sourceNodeId: opts.primary.nodeId }],
    instances,
    warnings
  };
}
