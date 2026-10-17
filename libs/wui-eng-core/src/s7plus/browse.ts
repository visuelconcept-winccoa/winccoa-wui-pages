// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Online **S7Plus** browse (S7-1200/1500 symbolic) → {@link AddressBook}.
 *
 * Sibling of `opcua/browse.ts`, and deliberately the same shape: the WALK is pure
 * and drives an injected {@link S7PlusBrowsePort}; the runtime side (the WinCC OA
 * `Browse.*` dialogue) lives in the dedicated `s7plusBrowse` JavaScript manager.
 *
 * ## The protocol this models (read from the installed 3.21, not guessed)
 *
 * The S7Plus driver answers browse requests on the **connection** datapoint
 * (`_S7PlusConnection`), through a request/response slot shaped exactly like the
 * OPC UA one:
 *
 * | element | role |
 * |---|---|
 * | `Browse.GetBranch` (dyn_string, written) | `[requestId, item, hmiVisible]` |
 * | `Browse.RequestId` (string) | echoed by the driver when the answer is ready |
 * | `Browse.NodePaths` / `SystemTypes` / `ValueTypes` / `ItemLengths` / `NodeComments` | the five parallel answer arrays |
 *
 * Sources, verbatim: `panels/para/s7plus_symbolic.pnl` (`treeConnect`, the tree's
 * `expanded` callback), `panels/para/address_s7plus_symbolic.pnl`
 * (`closeAndReturn` — the symbolic reference), `scripts/libs/s7PlusDrvPara.ctl`
 * (`paS7PlusBrowseParams`), `dbdfiles/version_3.21/dptypes.txt`
 * (`_S7PlusConnection.Browse`), `msg/en_US.utf8/s7plus.cat` (error 00025:
 * "GetBranch element requires 2 item for a valid browse query (Request ID, Start
 * node [, HMI relevance filters])"). See `docs/wui-eng-studio/S7PLUS-BROWSE.md`.
 *
 * ## The `item` grammar — the one thing that is NOT like OPC UA
 *
 * There is no node id: a node is addressed by its **path from the TIA project**,
 * `|`-separated, and the driver browses whatever that path names:
 *
 * ```
 * ''                                  -> the TIA projects (SystemTypes 'Project')
 * '<project>'                         -> its stations   (SystemTypes 'Station')
 * '<project>|<station>'               -> the station's blocks and tag tables
 * '<project>|<station>|Blocks|<DB>'   -> the members of a data block
 * '<project>|<station>|Tags|<table>'  -> the tags of a tag table
 * ```
 *
 * `Blocks` and `Tags` are **synthetic segments the client inserts** (the driver
 * reports a block as a plain child with `SystemType = 'Block'`) — see
 * {@link s7plusChildItem}, which reproduces the panel's own rule. Getting this
 * wrong does not error: the driver answers an empty level, and a book comes out
 * silently short.
 *
 * **Online vs a TIA export.** The same walk serves both, and the *project* says
 * which: a real project name reads an export under `<proj>/data/TIA_Projects` —
 * the PLC is never contacted — while the reserved {@link S7PLUS_ONLINE_STATION}
 * (`S7Plus$Online|Online`) reads the **live PLC**. The book records which one it
 * was, because a catalog read from a file and one read from the running machine
 * are different claims about reality.
 *
 * ## What the driver does NOT tell us
 *
 * No access level, and no history flag: the answer carries a datatype, a length
 * and a comment, nothing more. So every signal is catalogued **read-only with an
 * `assumed` access** (the direction then comes from the signal's role, exactly as
 * for an OPC UA browse whose driver exposes no `AccessLevel`), and `historized`
 * stays absent — unknown, never `false`.
 */

import { buildS7PlusReference, isUnmappedS7Type, s7LeafType } from '../drivers/s7.js';
import { WARNING_CODES, warn, type EngWarning } from '../warnings.js';
import type { AddressBook, BookEntry, BookInterface } from '../model.js';

/** Reserved TIA "project" that makes the driver browse the **live PLC**. */
export const S7PLUS_ONLINE_PROJECT = 'S7Plus$Online';

/**
 * Reserved `project|station` pair for an ONLINE browse — the value the standard
 * panel writes into `Config.StationName` when the engineer switches the source
 * from a TIA export to the device (`s7plus_engineering.pnl`: `sStationOnline`).
 */
export const S7PLUS_ONLINE_STATION = `${S7PLUS_ONLINE_PROJECT}|Online`;

/** Synthetic path segment the client inserts before a data block's name. */
export const S7PLUS_BLOCKS_SEGMENT = 'Blocks';
/** Synthetic path segment the client inserts before a tag table's name. */
export const S7PLUS_TAGS_SEGMENT = 'Tags';

/** Default caps (overridable per browse; each raises its own warning). */
export const S7PLUS_BROWSE_DEFAULTS = {
  maxDepth: 8,
  maxEntries: 5000,
  maxRequests: 2000,
  /**
   * Elements catalogued per ARRAY node. The standard panel stops at 50 and asks
   * the engineer whether to go on; a walk has nobody to ask, so it takes a
   * bounded prefix and says so. An `Array[0..9999] of Real` is a legitimate TIA
   * declaration and would otherwise eat the whole entry budget.
   */
  maxArrayElements: 64
} as const;

/** `SystemTypes` values that are LEAVES — everything else is browsed into. */
const LEAF_SYSTEM_TYPES = new Set(['Variable', 'Tag']);

/**
 * One node of a browse level, as the driver reports it (one slice across the five
 * parallel answer arrays).
 */
export interface S7PlusBrowseNode {
  /**
   * `NodePaths[i]` — the node's own name (one segment). At the *station* level the
   * driver answers `"<station>|<something>"`; the walker only ever needs the first
   * `|`-part there, which is what the standard panel takes too.
   */
  nodePath: string;
  /** `SystemTypes[i]`: `Project` | `Station` | `Block` | `ComplexTag` | `Array` | `Variable` | `Tag` | … */
  systemType: string;
  /** `ValueTypes[i]`: the TIA datatype (`Bool`, `Real`, `String[254]`, …). */
  valueType?: string;
  /**
   * `ItemLengths[i]`: array length, or a string's declared length.
   *
   * The driver reports a `String` length INCLUDING its 2 header bytes; the
   * standard panel subtracts them before using the value as the address' item
   * length, and so does {@link s7plusEntryLength}. `-1` means "not applicable".
   */
  itemLength?: number;
  /** `NodeComments[i]`: the TIA member comment (→ the DPE description). */
  comment?: string;
}

/** The ONLY runtime seam of an S7Plus browse (one level per call). */
export interface S7PlusBrowsePort {
  /**
   * Children of `item` on `connection` (the grammar in the file header).
   * `hmiVisibleOnly` is the driver's third `GetBranch` parameter.
   */
  browseLevel(connection: string, item: string, hmiVisibleOnly: boolean): Promise<S7PlusBrowseNode[]>;
}

/** Parameters of an S7Plus browse, recorded in the provenance so it can be REPLAYED. */
export interface S7PlusBrowseSource {
  /** `_S7PlusConnection` name, without its leading `_`. */
  connection: string;
  /**
   * `<project>|<station>` — a TIA export's project and station, or
   * {@link S7PLUS_ONLINE_STATION} to read the live PLC.
   */
  station: string;
  /**
   * Sub-tree to walk, as a full item (e.g. `<project>|<station>|Blocks|DB_Echange`).
   * Defaults to the station itself.
   */
  root?: string;
  /**
   * Only elements flagged "Visible in HMI Engineering" in TIA (the driver's third
   * `GetBranch` parameter). Defaults to `true` — the standard panel's own default.
   */
  hmiVisibleOnly?: boolean;
  maxDepth?: number;
  maxEntries?: number;
  maxRequests?: number;
  maxArrayElements?: number;
}

/** How far a walk has got — reported after every browse REQUEST. */
export interface S7PlusBrowseProgress {
  requests: number;
  entries: number;
  /** Dotted symbolic path of the container being browsed ('' at the station). */
  path: string;
  depth: number;
}

export interface S7PlusBrowseBookOptions extends S7PlusBrowseSource {
  bookId: string;
  name?: string;
  /** Driver manager number of the connection, when known. */
  driverNumber?: number;
  /** Injected so the result is deterministic in tests. */
  generatedAt?: string;
  /** Throwing from it CANCELS the walk (the partial book is not returned). */
  onProgress?: (progress: S7PlusBrowseProgress) => void;
}

/** True for the reserved online project/station pair. */
export function isS7PlusOnline(station: string): boolean {
  return station.split('|')[0] === S7PLUS_ONLINE_PROJECT;
}

/**
 * The child `item` of `parent` for one reported node — the standard panel's own
 * rule (`s7plus_symbolic.pnl`, `refreshTree`):
 *
 *  - a `Block` is addressed under the synthetic `Blocks` segment,
 *  - a `ComplexTag` (tag table) under `Tags`,
 *  - anything else is appended as-is,
 *  - a `Station` answers `"<station>|…"` and is reduced to its first part.
 */
export function s7plusChildItem(parent: string, node: S7PlusBrowseNode): string {
  const name = node.nodePath.trim();
  if (node.systemType === 'Station') return name.split('|')[0];
  if (node.systemType === 'Block') return `${parent}|${S7PLUS_BLOCKS_SEGMENT}|${name}`;
  if (node.systemType === 'ComplexTag') return `${parent}|${S7PLUS_TAGS_SEGMENT}|${name}`;
  return `${parent}|${name}`;
}

/**
 * The SYMBOLIC address of an item, relative to its station — what the driver
 * resolves at runtime, and what `address_s7plus_symbolic.pnl` returns to the
 * address panel: drop the station and the synthetic `Blocks`/`Tags` segment, then
 * join the rest with `.`.
 *
 * `DB_Echange.Consigne.Valeur` for `Proj|Station|Blocks|DB_Echange|Consigne|Valeur`.
 */
export function s7plusSymbolicPath(station: string, item: string): string {
  const prefixes = [`${station}|${S7PLUS_BLOCKS_SEGMENT}|`, `${station}|${S7PLUS_TAGS_SEGMENT}|`, `${station}|`];
  const matched = prefixes.find((prefix) => item.startsWith(prefix));
  const stripped = matched === undefined ? item : item.slice(matched.length);
  return stripped.split('|').join('.');
}

/**
 * The item length to carry into the ADDRESS, or `undefined` when the datatype
 * needs none.
 *
 * Only a string does: the reference then reads `MyDB.Text:80`, and the driver's
 * reported length includes the 2 header bytes the panel subtracts. An array's
 * length is structural (it decides how many elements exist), never part of one
 * element's address.
 */
export function s7plusEntryLength(node: S7PlusBrowseNode): number | undefined {
  const raw = node.itemLength ?? -1;
  if (raw <= 0 || node.systemType === 'Array') return undefined;
  const base = (node.valueType ?? '').split('[')[0].trim().toLowerCase();
  if (base !== 'string' && base !== 'wstring') return undefined;
  const length = raw - 2;
  return length > 0 ? length : undefined;
}

/** An `Array` node — expandable, its children are `Name[i]`. */
function isArray(node: S7PlusBrowseNode): boolean {
  return node.systemType === 'Array';
}

/** `Mesures[12]` -> 12, or `undefined` when the name carries no index. */
function elementIndex(nodePath: string): number | undefined {
  const match = /\[(\d+)\]\s*$/.exec(nodePath);
  return match === null ? undefined : Number(match[1]);
}

/**
 * The elements of an array, as the driver answers them.
 *
 * A browse of an `Array` node does not always return every element: the driver
 * answers the FIRST one (`Mesures[0]`) and the standard panel synthesises the rest
 * up to the array's declared length (`s7plus_symbolic.pnl`, the `g_optBrowse`
 * block). A walk has to do the same, or a 200-element array is catalogued as one
 * signal — and the missing 199 are invisible, not reported.
 *
 * Only ever applied to an array whose length the driver declared, and only when
 * the single answer really is an indexed element; anything else is passed through.
 */
function expandArrayElements(children: S7PlusBrowseNode[], declaredLength: number): S7PlusBrowseNode[] {
  if (children.length !== 1 || declaredLength <= 1) return children;
  const template = children[0];
  const first = elementIndex(template.nodePath);
  if (first === undefined) return children;
  const base = template.nodePath.slice(0, template.nodePath.lastIndexOf('['));
  return Array.from({ length: declaredLength }, (_unused, offset) => ({
    ...template,
    nodePath: `${base}[${first + offset}]`
  }));
}

/** Outcome of a walk: the entries plus everything the caller must be told. */
interface WalkResult {
  entries: BookEntry[];
  warnings: EngWarning[];
  requests: number;
}

/**
 * Depth-first walk of the station, in the driver's own order — so the book reads
 * like the PLC program rather than like a set.
 *
 * Sequential by necessity: every browse of a connection goes through the same
 * `Browse.GetBranch` element, so a second request would overwrite the first before
 * its answer arrives (the manager serialises per connection too, but the walk does
 * not rely on that to stay correct).
 */
async function walk(port: S7PlusBrowsePort, options: S7PlusBrowseBookOptions): Promise<WalkResult> {
  const maxDepth = options.maxDepth ?? S7PLUS_BROWSE_DEFAULTS.maxDepth;
  const maxEntries = options.maxEntries ?? S7PLUS_BROWSE_DEFAULTS.maxEntries;
  const maxRequests = options.maxRequests ?? S7PLUS_BROWSE_DEFAULTS.maxRequests;
  const maxArrayElements = options.maxArrayElements ?? S7PLUS_BROWSE_DEFAULTS.maxArrayElements;
  const hmiVisibleOnly = options.hmiVisibleOnly ?? true;
  const station = options.station;
  const root = options.root ?? station;

  const entries: BookEntry[] = [];
  const warnings: EngWarning[] = [];
  const seen = new Set<string>();
  const skippedBranches: string[] = [];
  const failures: string[] = [];
  const arrays: string[] = [];
  const truncatedArrays: string[] = [];
  const unmapped: string[] = [];
  const duplicates: string[] = [];
  let requests = 0;
  let unnamed = 0;
  let depthTruncated = 0;

  /**
   * Browse one container and recurse. `item` is absolute, `depth` counts from the
   * root, and `arrayLength` is the declared element count when `item` is an ARRAY
   * (which decides whether a single answered element must be expanded).
   */
  const visit = async (item: string, depth: number, arrayLength?: number): Promise<void> => {
    if (entries.length >= maxEntries || requests >= maxRequests) {
      skippedBranches.push(s7plusSymbolicPath(station, item) || '<station>');
      return;
    }
    requests += 1;
    // Reported BEFORE the request: on a slow PLC what matters is which branch the
    // walk is waiting on, not which one it just finished.
    options.onProgress?.({ requests, entries: entries.length, path: s7plusSymbolicPath(station, item), depth });
    let children: S7PlusBrowseNode[];
    try {
      children = await port.browseLevel(options.connection, item, hmiVisibleOnly);
    } catch (error) {
      // One unreadable block must not lose the rest of the catalog.
      failures.push(
        `${s7plusSymbolicPath(station, item) || '<station>'} (${error instanceof Error ? error.message : String(error)})`
      );
      return;
    }
    // An array's elements: completed from its declared length when the driver only
    // answered the first, then bounded — a truncation is always named.
    const elements = arrayLength === undefined ? children : expandArrayElements(children, arrayLength);
    const considered =
      arrayLength !== undefined && elements.length > maxArrayElements ? elements.slice(0, maxArrayElements) : elements;
    if (considered.length < elements.length) {
      truncatedArrays.push(`${s7plusSymbolicPath(station, item)} (${elements.length})`);
    }
    for (const child of considered) {
      const name = child.nodePath.trim();
      if (name === '') {
        unnamed += 1;
        continue;
      }
      const childItem = s7plusChildItem(item, child);
      if (LEAF_SYSTEM_TYPES.has(child.systemType)) {
        if (entries.length >= maxEntries) {
          skippedBranches.push(s7plusSymbolicPath(station, item) || '<station>');
          return;
        }
        const path = s7plusSymbolicPath(station, childItem);
        // A book is keyed by path everywhere (diff, bindings, generated DPE names),
        // so two signals sharing one would become a single DPE.
        if (seen.has(path)) {
          duplicates.push(path);
          continue;
        }
        seen.add(path);
        const sourceType = (child.valueType ?? '').trim();
        const unmappedType = isUnmappedS7Type(sourceType);
        if (unmappedType) unmapped.push(`${path}: ${sourceType === '' ? '?' : sourceType}`);
        entries.push({
          path,
          sourceType: sourceType === '' ? 'Unknown' : sourceType,
          leafType: s7LeafType(sourceType),
          // The browse answer carries NO access information at all (see the file
          // header): read-only, and flagged as not-evidence so a role's write
          // intent still wins. `historized` stays absent — unknown, not "no".
          access: 'r',
          accessSource: 'assumed',
          addresses: { s7plus: buildS7PlusReference(path, s7plusEntryLength(child)) },
          ...(child.comment === undefined || child.comment.trim() === '' ? {} : { comment: child.comment.trim() }),
          ...(unmappedType ? { unmapped: true } : {})
        });
        continue;
      }
      if (depth + 1 > maxDepth) {
        depthTruncated += 1;
        continue;
      }
      if (isArray(child)) arrays.push(s7plusSymbolicPath(station, childItem));
      await visit(childItem, depth + 1, isArray(child) ? Math.max(child.itemLength ?? 0, 0) : undefined);
    }
  };

  await visit(root, 0);

  if (entries.length >= maxEntries) {
    warnings.push(
      warn(
        WARNING_CODES.browse.TRUNCATED_ENTRIES,
        'Walk TRUNCATED at {max} signals (maxEntries) — the book is INCOMPLETE. Narrow the browse root or raise the limit.',
        { max: maxEntries }
      )
    );
  }
  if (requests >= maxRequests) {
    warnings.push(
      warn(
        WARNING_CODES.browse.TRUNCATED_REQUESTS,
        'Walk TRUNCATED at {max} requests (maxRequests) — the book is INCOMPLETE. Narrow the browse root or raise the limit.',
        { max: maxRequests }
      )
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
  if (unnamed > 0) {
    warnings.push(warn(WARNING_CODES.browse.UNNAMED_NODES, '{n} node(s) without a name skipped.', { n: unnamed }));
  }
  if (duplicates.length > 0) {
    warnings.push(
      warn(WARNING_CODES.book.DUPLICATE_PATHS, '{n} duplicate path(s) dropped: {paths}{more}.', {
        n: duplicates.length,
        paths: duplicates.slice(0, 5).join(', '),
        more: duplicates.length > 5 ? '…' : ''
      })
    );
  }
  if (arrays.length > 0) {
    warnings.push(
      warn(
        WARNING_CODES.s7plus.ARRAYS_EXPANDED,
        '{n} ARRAY(s) catalogued ELEMENT BY ELEMENT ({paths}{more}) — one signal per index, since WinCC OA addresses an S7Plus array member individually.',
        { n: arrays.length, paths: arrays.slice(0, 5).join(', '), more: arrays.length > 5 ? '…' : '' }
      )
    );
  }
  if (truncatedArrays.length > 0) {
    warnings.push(
      warn(
        WARNING_CODES.s7plus.ARRAY_TRUNCATED,
        '{n} array(s) catalogued up to {max} elements only ({paths}{more}) — the rest is MISSING from the book. Raise maxArrayElements, or browse into the array itself.',
        {
          n: truncatedArrays.length,
          max: maxArrayElements,
          paths: truncatedArrays.slice(0, 5).join(', '),
          more: truncatedArrays.length > 5 ? '…' : ''
        }
      )
    );
  }
  if (unmapped.length > 0) {
    warnings.push(
      warn(
        WARNING_CODES.s7plus.TYPE_UNMAPPED,
        '{n} signal(s) whose TIA datatype has no verified WinCC OA element type ({paths}{more}) — catalogued and flagged "unmapped": no address is generated on them.',
        { n: unmapped.length, paths: unmapped.slice(0, 5).join(', '), more: unmapped.length > 5 ? '…' : '' }
      )
    );
  }
  if (entries.length === 0 && failures.length === 0) {
    warnings.push(
      warn(WARNING_CODES.browse.EMPTY_ROOT, 'No signal found under "{root}" — check the station, the browse root and the connection state.', {
        root
      })
    );
  }
  // Said on EVERY S7Plus book, not only when something went wrong: the driver
  // exposes no access, so "read-only" here is a default and not a reading.
  if (entries.length > 0) {
    warnings.push(
      warn(
        WARNING_CODES.s7plus.ACCESS_ASSUMED,
        'The S7Plus browse exposes no access rights: all {n} signals are catalogued READ-ONLY with an "assumed" access — the direction comes from the role (its profile). Qualify before generating, or fix the access by hand.',
        { n: entries.length }
      )
    );
  }
  if (hmiVisibleOnly) {
    warnings.push(
      warn(
        WARNING_CODES.s7plus.HMI_FILTERED,
        'Only the elements flagged "Visible in HMI Engineering" in TIA were browsed — an element the program does not expose is ABSENT from this catalog. Re-browse with the filter off to see everything.'
      )
    );
  }
  warnings.push(
    isS7PlusOnline(station)
      ? warn(
          WARNING_CODES.s7plus.SOURCE_ONLINE,
          'Read ONLINE from the PLC through connection "{connection}" — the catalog is the program currently loaded, and the driver must stay able to resolve each symbol at runtime.',
          { connection: options.connection }
        )
      : warn(
          WARNING_CODES.s7plus.SOURCE_PROJECT,
          'Read from the TIA project "{project}" (an export under <proj>/data/TIA_Projects) — the PLC was NOT contacted, so a program downloaded since may differ. Re-browse online to confirm.',
          { project: station.split('|')[0] }
        )
  );
  return { entries, warnings, requests };
}

/**
 * Browse an S7-1200/1500 station into an address book.
 *
 * The book is LIVE (it carries an `interface`) whenever the walk went to the PLC;
 * a walk of a TIA **export** describes a program, not a running interface, so it
 * comes out as a **template catalog** with no interface — bound to each equipment
 * at generation, exactly like a NodeSet. The parameters are recorded in
 * `provenance.browse` so a refresh replays the same walk.
 */
export async function buildBookFromS7PlusBrowse(
  port: S7PlusBrowsePort,
  options: S7PlusBrowseBookOptions
): Promise<AddressBook> {
  const result = await walk(port, options);
  const online = isS7PlusOnline(options.station);
  const bookInterface: BookInterface = {
    protocol: 's7plus',
    connection: options.connection,
    params: { station: options.station },
    ...(options.driverNumber === undefined ? {} : { driverNumber: options.driverNumber })
  };
  const root = options.root ?? options.station;
  return {
    id: options.bookId,
    name: options.name ?? `S7+ ${options.connection}`,
    provenance: {
      kind: 's7plus-browse',
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      detail: `${online ? 'online' : 'TIA project'} walk ${root} · ${result.requests} request(s) · ${result.entries.length} signals`,
      browse: {
        connection: options.connection,
        station: options.station,
        ...(options.root === undefined ? {} : { root: options.root }),
        hmiVisibleOnly: options.hmiVisibleOnly ?? true,
        ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
        ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
        ...(options.maxRequests === undefined ? {} : { maxRequests: options.maxRequests }),
        ...(options.maxArrayElements === undefined ? {} : { maxArrayElements: options.maxArrayElements })
      }
    },
    // A TIA-export walk binds nothing: same honesty as a NodeSet catalog.
    ...(online ? { interface: bookInterface } : {}),
    entries: result.entries,
    types: [],
    warnings: result.warnings
  };
}
