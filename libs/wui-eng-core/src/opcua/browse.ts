// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Online OPC UA browse → {@link AddressBook}.
 *
 * The WALK is pure: it drives an injected {@link OpcUaBrowsePort} and knows
 * nothing about WinCC OA. The backend implements the port with the *proven*
 * `_<conn>.Browse.GetBranch` request/response of the tag importer; the demo
 * implements it over an in-memory address space — so the same walker is what the
 * docs, the screenshots and the unit tests exercise.
 *
 * Design decisions, all of them consequences of what the driver actually gives us:
 *
 *  - **One level per call.** A browse response is six PARALLEL ARRAYS with no
 *    parent link, so a multi-level answer cannot be reassembled into a tree. The
 *    walker therefore asks for depth 1 and recurses itself, which is the only way
 *    to know a node's parent — and thus its symbolic path.
 *  - **Sequential.** All browses of one connection go through the same
 *    `Browse.GetBranch` datapoint: a second request overwrites the first before
 *    its response arrives, so concurrent browses on one connection lose replies.
 *    The walk is strictly sequential (the port may still batch internally).
 *  - **Bounded, and never silently.** A production address space can hold 100k
 *    nodes. Depth, node count and request count are all capped, and hitting a cap
 *    raises a book WARNING naming what was left out — a truncated catalog that
 *    looks complete is how you ship a half-configured machine.
 *  - **Access level is used when the driver gives it, assumed otherwise.** The
 *    tag importer's verified caveat is that the browse does not expose
 *    `AccessLevel`; whether a given driver version does is a property of the
 *    connection, so the PORT may fill `accessLevel` and the walker will decode it
 *    (`opcUaAccessFromLevel`). When it is absent the entry is catalogued read-only
 *    AND marked `accessSource: 'assumed'` — which tells the config generator that
 *    the access is not evidence, so a command's write intent still wins. Either
 *    way the book says which of the two happened.
 */

import { buildOpcUaReference, isUnmappedOpcUaType, opcUaAccessFromLevel, opcUaLeafType } from '../drivers/opcua.js';
import { WARNING_CODES, warn, type EngWarning } from '../warnings.js';
import type { AddressBook, BookEntry, BookInterface } from '../model.js';

/** Standard `Objects` folder — the default browse root. */
export const OPCUA_OBJECTS_FOLDER = 'ns=0;i=85';

/** Default caps (overridable per browse; see the warnings they raise). */
export const BROWSE_DEFAULTS = {
  maxDepth: 8,
  maxEntries: 5000,
  maxRequests: 2000
} as const;

/**
 * One node of a browse level, as the driver reports it.
 * Mirrors the tag importer's `BrowseNode` so the backend port is a pass-through.
 */
export interface OpcUaBrowseNode {
  displayName: string;
  nodeId: string;
  /** Driver-reported browse path (informational — the walker builds its own). */
  browsePath?: string;
  /** `Variable`, `Object`, `ObjectType`, `Method`, … (substring-matched). */
  nodeClass: string;
  /** OPC UA built-in datatype name (variables only). */
  dataType?: string;
  /** `-1` scalar, `≥ 0` array. */
  valueRank?: number;
  /**
   * OPC UA `AccessLevel` bitmask, when the driver exposes it (see the backend
   * port: the element is DISCOVERED by introspecting the connection's DP type,
   * never assumed). Absent → the walker catalogues the signal read-only and flags
   * the access as `assumed`.
   */
  accessLevel?: number;
  hasChildren?: boolean;
}

/** The ONLY runtime seam of an online browse. */
export interface OpcUaBrowsePort {
  /** Direct children of `nodeId` on `connection` (one level). */
  browseLevel(connection: string, nodeId: string): Promise<OpcUaBrowseNode[]>;
}

/** Parameters of a browse, recorded in the provenance so it can be REPLAYED. */
export interface BrowseSource {
  /** OPC UA connection (server) name, without the `_` of its `_OPCUAServer` DP. */
  connection: string;
  /** Browse root; defaults to the Objects folder. */
  rootNodeId?: string;
  maxDepth?: number;
  maxEntries?: number;
  maxRequests?: number;
}

/**
 * How far a walk has got. Reported after every browse REQUEST, which is the only
 * unit of progress a walk actually has: the size of an address space is not known
 * until it has been walked, so there is no percentage to give — only "still going,
 * here is where, and here is how much so far".
 */
export interface BrowseProgress {
  /** Browse requests issued so far (bounded by `maxRequests`). */
  requests: number;
  /** Signals catalogued so far (bounded by `maxEntries`). */
  entries: number;
  /** Dotted path of the container being browsed ('' at the root). */
  path: string;
  /** Depth of that container, in path segments. */
  depth: number;
}

export interface BrowseBookOptions extends BrowseSource {
  bookId: string;
  name?: string;
  /** Driver manager number of the connection, when known. */
  driverNumber?: number;
  /** Injected so the result is deterministic in tests. */
  generatedAt?: string;
  /**
   * Called after each browse request, so a UI can show a walk in progress rather
   * than a frozen screen for the minutes a large server takes. Throwing from it is
   * how a caller CANCELS: the walk unwinds and the partial book is not returned.
   */
  onProgress?: (progress: BrowseProgress) => void;
}

/** Outcome of a walk: the entries plus everything the caller must be told. */
interface WalkResult {
  entries: BookEntry[];
  warnings: EngWarning[];
  requests: number;
  /** Nodes whose subtree was not browsed because a cap was hit. */
  skippedBranches: string[];
}

function isVariable(node: OpcUaBrowseNode): boolean {
  return node.nodeClass.includes('Variable');
}

function isBrowsable(node: OpcUaBrowseNode): boolean {
  const cls = node.nodeClass;
  return cls.includes('Object') || cls.includes('Folder') || cls.includes('View');
}

/** An array-valued variable (`ValueRank ≥ 0` — `-1` is scalar). */
function isArrayVariable(node: OpcUaBrowseNode): boolean {
  return (node.valueRank ?? -1) >= 0;
}

/**
 * Depth-first walk of the address space, in the server's own display order — so
 * the book reads like the machine's structure rather than like a set. Sequential
 * by necessity (see the file header).
 */
async function walk(port: OpcUaBrowsePort, options: BrowseBookOptions): Promise<WalkResult> {
  const maxDepth = options.maxDepth ?? BROWSE_DEFAULTS.maxDepth;
  const maxEntries = options.maxEntries ?? BROWSE_DEFAULTS.maxEntries;
  const maxRequests = options.maxRequests ?? BROWSE_DEFAULTS.maxRequests;
  const root = options.rootNodeId ?? OPCUA_OBJECTS_FOLDER;

  const entries: BookEntry[] = [];
  const warnings: EngWarning[] = [];
  const skippedBranches: string[] = [];
  const visited = new Set<string>([root]);
  let requests = 0;
  let methods = 0;
  let unnamed = 0;
  let depthTruncated = 0;
  let assumedAccess = 0;
  const failures: string[] = [];
  const arrays: string[] = [];

  /** Browse one container and recurse; `segments` is the path from the root. */
  const visit = async (nodeId: string, segments: string[]): Promise<void> => {
    if (entries.length >= maxEntries || requests >= maxRequests) {
      skippedBranches.push(segments.join('.') || '<root>');
      return;
    }
    requests += 1;
    // Reported BEFORE the request: on a slow server the interesting information is
    // which branch the walk is waiting on, not which one it just finished.
    options.onProgress?.({ requests, entries: entries.length, path: segments.join('.'), depth: segments.length });
    let children: OpcUaBrowseNode[];
    try {
      children = await port.browseLevel(options.connection, nodeId);
    } catch (error) {
      // One unreadable branch must not lose the rest of the catalog.
      failures.push(`${segments.join('.') || '<root>'} (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    for (const child of children) {
      const name = child.displayName.trim();
      if (name === '') {
        unnamed += 1;
        continue;
      }
      const path = [...segments, name];
      if (isVariable(child)) {
        if (entries.length >= maxEntries) {
          skippedBranches.push(segments.join('.') || '<root>');
          return;
        }
        // An ARRAY variable is catalogued with its SCALAR base type and flagged:
        // the studio's OaLeafType has no `Dyn*` member, and the `_address` write
        // for a dynamic DPE is not verified here — fabricating one would put a
        // silently-truncating address in a project. Visible + flagged beats both
        // hiding it and guessing.
        const array = isArrayVariable(child);
        if (array) arrays.push(path.join('.'));
        // AccessLevel when the driver exposed it; read-only + `assumed` otherwise.
        const known = typeof child.accessLevel === 'number' && Number.isFinite(child.accessLevel);
        if (!known) assumedAccess += 1;
        entries.push({
          path: path.join('.'),
          sourceType: (child.dataType ?? '').trim() === '' ? 'Unknown' : `${child.dataType!.trim()}${array ? '[]' : ''}`,
          leafType: opcUaLeafType(child.dataType),
          access: known ? opcUaAccessFromLevel(child.accessLevel!) : 'r',
          accessSource: known ? 'declared' : 'assumed',
          addresses: { opcua: buildOpcUaReference(options.connection, child.nodeId) },
          unmapped: isUnmappedOpcUaType(child.dataType) || array || undefined
        });
        continue;
      }
      if (child.nodeClass.includes('Method')) {
        methods += 1;
        continue;
      }
      if (!isBrowsable(child)) continue;
      if (path.length > maxDepth) {
        depthTruncated += 1;
        continue;
      }
      // Cycle guard: an OPC UA address space is a graph, not a tree.
      if (visited.has(child.nodeId)) continue;
      visited.add(child.nodeId);
      await visit(child.nodeId, path);
    }
  };

  await visit(root, []);

  if (entries.length >= maxEntries) {
    warnings.push(
      warn(WARNING_CODES.browse.TRUNCATED_ENTRIES, 'Walk TRUNCATED at {max} signals (maxEntries) — the book is INCOMPLETE. Narrow the browse root or raise the limit.', {
        max: maxEntries
      })
    );
  }
  if (requests >= maxRequests) {
    warnings.push(
      warn(WARNING_CODES.browse.TRUNCATED_REQUESTS, 'Walk TRUNCATED at {max} requests (maxRequests) — the book is INCOMPLETE. Narrow the browse root or raise the limit.', {
        max: maxRequests
      })
    );
  }
  if (depthTruncated > 0) {
    warnings.push(
      warn(WARNING_CODES.browse.DEPTH_TRUNCATED, '{n} branch(es) not explored beyond depth {depth} — the book is incomplete there.', {
        n: depthTruncated,
        depth: maxDepth
      })
    );
  }
  if (skippedBranches.length > 0) {
    const shown = [...new Set(skippedBranches)].slice(0, 5);
    warnings.push(
      warn(WARNING_CODES.browse.SKIPPED_BRANCHES, 'Branches abandoned after the limit: {paths}{more}.', {
        paths: shown.join(', '),
        more: skippedBranches.length > shown.length ? '…' : ''
      })
    );
  }
  if (failures.length > 0) {
    warnings.push(
      warn(WARNING_CODES.browse.UNREADABLE_BRANCHES, '{n} unreadable branch(es): {details}{more}.', {
        n: failures.length,
        details: failures.slice(0, 3).join(' · '),
        more: failures.length > 3 ? '…' : ''
      })
    );
  }
  if (methods > 0) {
    warnings.push(warn(WARNING_CODES.browse.METHODS_SKIPPED, '{n} OPC UA method(s) skipped (not modelled as DPEs).', { n: methods }));
  }
  if (arrays.length > 0) {
    warnings.push(
      warn(
        WARNING_CODES.browse.ARRAYS_FLAGGED,
        '{n} ARRAY variable(s) catalogued with their scalar base type and flagged "unmapped" ({paths}{more}) — the address write for a dynamic DPE is not verified: do not generate an address on them without validating it first.',
        { n: arrays.length, paths: arrays.slice(0, 5).join(', '), more: arrays.length > 5 ? '…' : '' }
      )
    );
  }
  if (unnamed > 0) {
    warnings.push(warn(WARNING_CODES.browse.UNNAMED_NODES, '{n} node(s) without a DisplayName skipped.', { n: unnamed }));
  }
  if (entries.length === 0 && failures.length === 0) {
    warnings.push(
      warn(WARNING_CODES.browse.EMPTY_ROOT, 'No variable found under "{root}" — check the browse root and the connection state.', { root })
    );
  }
  if (assumedAccess > 0) {
    warnings.push(
      assumedAccess === entries.length
        ? warn(
            WARNING_CODES.browse.ACCESS_ALL_ASSUMED,
            'This walk did not expose AccessLevel: every signal is catalogued READ-ONLY with an "assumed" access. The direction then comes from the role (its profile) — qualify before generating, or fix the access by hand.'
          )
        : warn(WARNING_CODES.browse.ACCESS_PARTLY_ASSUMED, '{n}/{total} signals without an exposed AccessLevel: "assumed" access (read-only) — the direction comes from the role for those.', {
            n: assumedAccess,
            total: entries.length
          })
    );
  } else if (entries.length > 0) {
    warnings.push(
      warn(WARNING_CODES.browse.ACCESS_READ, 'AccessLevel read from the server for all {n} signals: the address direction will follow the real access.', {
        n: entries.length
      })
    );
  }
  return { entries, warnings, requests, skippedBranches };
}

/**
 * Browse a live OPC UA server into an address book.
 *
 * The book is LIVE (it carries an `interface`), because a browse can only happen
 * against a real connection — unlike a file catalog, there is nothing to bind
 * later. The browse parameters are recorded in `provenance.browse` so
 * `refreshBook` can replay exactly the same walk.
 */
export async function buildBookFromOpcUaBrowse(port: OpcUaBrowsePort, options: BrowseBookOptions): Promise<AddressBook> {
  const result = await walk(port, options);
  const bookInterface: BookInterface = {
    protocol: 'opcua',
    connection: options.connection,
    ...(options.driverNumber === undefined ? {} : { driverNumber: options.driverNumber })
  };
  const root = options.rootNodeId ?? OPCUA_OBJECTS_FOLDER;
  return {
    id: options.bookId,
    name: options.name ?? `OPC UA ${options.connection}`,
    provenance: {
      kind: 'opcua-browse',
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      detail: `walk ${root} · ${result.requests} request(s) · ${result.entries.length} signals`,
      browse: {
        connection: options.connection,
        rootNodeId: root,
        ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
        ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
        ...(options.maxRequests === undefined ? {} : { maxRequests: options.maxRequests })
      }
    },
    interface: bookInterface,
    // Kept in WALK order (the server's display order) — not sorted: an engineer
    // reads the catalog as the machine's structure.
    entries: result.entries,
    types: [],
    warnings: result.warnings
  };
}
