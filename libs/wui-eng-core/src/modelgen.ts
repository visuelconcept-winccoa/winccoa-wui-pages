// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Model generation — an address book + its ROLES become a DP type, its datapoints
 * and their configs. This is where the studio's loop closes: qualify once
 * (`roles/classify.ts`), generate, then check-in the diff.
 *
 * What the generator derives:
 *  - the **DPType structure** from the entries' dotted paths (nested `Struct`s,
 *    leaves typed by `leafType`), with names sanitised to valid WinCC OA
 *    identifiers and de-duplicated per parent;
 *  - **N datapoints** of that type, named with the Visuel Concept convention
 *    (`{Zone}_{Equipement}`);
 *  - the **configs of every DPE**, from the role's profile (`roles/profiles.ts`):
 *    address direction, archiving, alert handling, value range — plus the
 *    peripheral-address reference resolved from the entry's candidate address for
 *    the device's access mode;
 *  - **DPE descriptions** from the source comments.
 *
 * What it refuses to invent (reported as warnings instead):
 *  - an entry whose role is `unknown` gets its DPE in the structure but NO config;
 *  - a template catalog with no bound connection yields no address config;
 *  - a driver whose `_datatype` transformation is still unverified (S7, Modbus)
 *    is flagged once, so nobody mistakes a sentinel for a verified value.
 */

import type {
  AccessMode,
  AddressBook,
  AddressConfig,
  BookEntry,
  BookInterface,
  DpTypeStructure,
  DpeConfigs,
  EngDp,
  EngType,
  OaLeafType,
  Workspace
} from './model.js';
import { makeDpeName } from './model.js';
import { dpName, sanitizeSegment, uniqueName } from './naming.js';
import { directionFor, isReadingDirection, opcUaDatatypeCode, withOpcUaConnection, withOpcUaSubscription } from './drivers/opcua.js';
import { s7DatatypeCode } from './drivers/s7.js';
import { modbusDatatypeCode } from './drivers/modbus.js';
import { configsForRole, resolveLeafPolicy, type RoleProfile, type RoleProfileContext } from './roles/profiles.js';
import { isAlarmableLeafType, structureLeaves, type ModelPolicy, type StructureBindings } from './structure.js';
import { WARNING_CODES, warn, type EngWarning } from './warnings.js';
import { SIGNAL_ROLES, type SignalRole } from './roles/roles.js';

/** Options driving one generation. */
export interface ModelGenOptions {
  /** DP type to create (or extend). */
  typeName: string;
  /** Zone segment of the datapoint names (VC convention `{Zone}_{Equipement}`). */
  zone?: string;
  /** Equipment segments — one datapoint per entry (e.g. `['FOUR001','FOUR002']`). */
  equipments: string[];
  /** Entry paths to include; omitted → every entry of the book. */
  selection?: string[];
  /** Strip the longest common leading path segments (default true). */
  stripCommonPrefix?: boolean;
  /** Access mode of the binding; default: the book's interface protocol. */
  mode?: AccessMode;
  /**
   * Connection name substituted into a TEMPLATE reference placeholder
   * (`<Machine>`, `<Conn>`…). Required to bind an interface-less catalog.
   */
  bindConnection?: string;
  /** Device recorded in the address configs. */
  deviceId: string;
  profiles?: Record<SignalRole, RoleProfile>;
  profileContext?: RoleProfileContext;
  /**
   * CUSTOM structure + mapping. Omitted → the type MIRRORS the book's paths.
   * Given → the type is exactly `mapping.structure` and each of its leaves takes
   * its config from the bound book entry (see `structure.ts`). A leaf with no
   * binding still exists in the type, it simply gets no config.
   */
  mapping?: ModelMapping;
  /**
   * ADDITIONAL catalogs the mapping may bind into — a model over SEVERAL books.
   *
   * Their entries are addressed by a QUALIFIED binding (`bindingRef`), because two
   * catalogs may hold the same signal path and a bare path could then mean either.
   * Each leaf keeps the interface of the catalog it came from, so a model that reads
   * a TIA export and an OPC UA browse of one machine still writes each address
   * through the right driver (see the per-leaf resolution in the config loop).
   */
  books?: AddressBook[];
  /**
   * DEPLOYMENT POLICY per target leaf (alarm / archive / range) — the model's own
   * decisions, defined once and replayed for every instance. Absent keys fall
   * back to `defaultLeafPolicy`; an absent policy altogether means every leaf
   * takes its default.
   */
  policy?: ModelPolicy;
}

/** An engineer-authored type structure and its bindings to the book's signals. */
export interface ModelMapping {
  /** Target structure; its root is renamed to `options.typeName`. */
  structure: DpTypeStructure;
  /** Target leaf path (dot-joined, below the root) → book entry path. */
  bindings: StructureBindings;
}

/** What a generation proposes to add to the workspace. */
export interface ModelProposal {
  type: EngType;
  dps: EngDp[];
  /** Configs keyed by full DPE path. */
  configs: Record<string, DpeConfigs>;
  warnings: EngWarning[];
  /** Generated DPEs per role (UI summary). */
  roleCounts: Record<SignalRole, number>;
}

/** One catalog a mirror reads, and which of its signals take part. */
export interface MirrorSource {
  book: AddressBook;
  /** Entry paths to mirror. Absent → the whole catalog. */
  selection?: string[];
}

/** What mirroring one or more catalogs produced. */
export interface MirrorResult {
  structure: DpTypeStructure;
  /** Leaf path → `bookId::entryPath` — always qualified (see below). */
  bindings: StructureBindings;
  warnings: EngWarning[];
}

/**
 * Build a structure BY MIRRORING one or several catalogs, with each leaf already bound
 * to the signal it came from.
 *
 * This is the "create the structure by mirroring" half of authoring a model, and it is
 * here rather than in the page because merging several catalogs into one type is where
 * the decisions are:
 *  - the common prefix is the one shared by EVERY mirrored signal of every source, not
 *    one per catalog. Two TIA DBs mirrored together therefore keep `DB_Four` and
 *    `DB_Ech` as distinct branches instead of both collapsing onto their own contents
 *    and colliding — the union is treated as one selection, which is the same rule as
 *    the single-catalog mirror, applied to what is actually being mirrored;
 *  - the catalogs are mirrored IN ORDER and **the first one to claim a leaf path keeps
 *    it** — the alternative would be a type whose branch silently reads another
 *    catalog's signal. A collision is reported, never absorbed.
 *
 * EVERY binding is qualified with {@link bindingRef} — the primary catalog's included.
 * A mapping that reads `book-s7-four::DB_Four.Mesures.Temp` says which catalog it comes
 * from without needing to know which of the model's sources happens to be first, so
 * re-ordering the sources, or promoting another one to primary, cannot change what a
 * branch reads. (A BARE path is still resolved, against the model's own book: that is
 * what models saved before this convention hold — see {@link parseBindingRef}.)
 */
export function mirrorStructureFromBooks(
  sources: MirrorSource[],
  options: { typeName: string; stripCommonPrefix?: boolean }
): MirrorResult {
  const warnings: EngWarning[] = [];
  const bindings: StructureBindings = {};
  const leaves: Leaf[] = [];
  const claimed = new Map<string, string>();
  const picked = sources.map((source) => {
    const wanted = source.selection === undefined ? undefined : new Set(source.selection);
    return { source, selected: source.book.entries.filter((entry) => wanted === undefined || wanted.has(entry.path)) };
  });
  const allPaths = picked.flatMap((item) => item.selected.map((entry) => entry.path));
  const strip = (options.stripCommonPrefix ?? true) ? commonPrefix(allPaths).length : 0;
  if (strip > 0) {
    warnings.push(
      warn(WARNING_CODES.modelgen.PREFIX_STRIPPED, 'Common prefix "{prefix}" stripped from the paths.', {
        prefix: allPaths[0].split('.').slice(0, strip).join('.')
      })
    );
  }
  for (const { source, selected } of picked) {
    if (selected.length === 0) continue;
    const mirrored = mirrorLeaves(
      selected,
      { typeName: options.typeName, equipments: [], deviceId: 'mirror' },
      warnings,
      strip
    );
    for (const leaf of mirrored.leaves) {
      const path = leaf.segments.join('.');
      const owner = claimed.get(path);
      if (owner !== undefined) {
        warnings.push(
          warn(
            WARNING_CODES.modelgen.MIRROR_COLLISION,
            'Branch "{leaf}" is already mirrored from catalog "{owner}" — "{skipped}" of "{book}" was skipped.',
            { leaf: path, owner, skipped: leaf.entry.path, book: source.book.name }
          )
        );
        continue;
      }
      claimed.set(path, source.book.name);
      leaves.push(leaf);
      bindings[path] = bindingRef(source.book.id, leaf.entry.path);
    }
  }
  return { structure: buildStructure(options.typeName, leaves), bindings, warnings };
}

/**
 * Mirror one catalog INTO an existing model: its branches are added to the structure
 * already there, and each new leaf comes bound to the signal it came from.
 *
 * This is the "update the model by mirroring the catalog" action, and merging — rather
 * than replacing — is what makes it usable on a model that reads several catalogs:
 * mirroring the second one must not wipe the first one's branches. The rule at a
 * collision is the same as everywhere else here: **what is already in the model wins**,
 * and the skipped signal is reported. A branch an engineer renamed or re-mapped by hand
 * is therefore never silently overwritten by a re-mirror.
 */
export function mirrorIntoStructure(
  base: { structure: DpTypeStructure; bindings: StructureBindings },
  source: MirrorSource,
  options: { typeName: string; stripCommonPrefix?: boolean }
): MirrorResult {
  const mirror = mirrorStructureFromBooks([source], options);
  const structure: DpTypeStructure = {
    name: options.typeName,
    type: base.structure.type,
    children: [...(base.structure.children ?? [])]
  };
  const bindings: StructureBindings = { ...base.bindings };
  const warnings = [...mirror.warnings];
  const kept: string[] = [];
  mergeNodes(structure, mirror.structure.children ?? [], [], kept);
  for (const [leaf, binding] of Object.entries(mirror.bindings)) {
    // An existing leaf keeps its own mapping; only the branches this mirror ADDED take
    // the catalog's binding.
    if (kept.includes(leaf)) continue;
    bindings[leaf] = binding;
  }
  if (kept.length > 0) {
    const shown = kept.slice(0, 5);
    warnings.push(
      warn(
        WARNING_CODES.modelgen.MIRROR_KEPT,
        '{n} branch(es) already in the model were left untouched ({leaves}{more}) — the model wins over the catalog.',
        { n: kept.length, leaves: shown.join(', '), more: kept.length > shown.length ? '…' : '' }
      )
    );
  }
  return { structure, bindings, warnings };
}

/**
 * REMOVE one catalog from a model: its branches and its mappings leave with it.
 *
 * The exact counterpart of {@link mirrorIntoStructure}, and the reason it exists: un-ticking
 * a source only stopped OFFERING its signals — the branches it had contributed stayed in the
 * structure, bound to a catalog the model no longer read, which is a model that cannot say
 * what it does. What goes is decided by the BINDINGS (`bookId::path`), not by a memory of who
 * added what: a leaf reading that catalog goes, a group left empty by its leaves goes too,
 * and a branch someone re-mapped onto another catalog STAYS — it is no longer that catalog's.
 *
 * The policy follows the leaves, so re-adding the catalog later starts from the defaults
 * rather than from decisions attached to paths that disappeared in between.
 */
export function removeSourceFromModel(
  base: { structure: DpTypeStructure; bindings: StructureBindings; policy?: ModelPolicy },
  bookId: string
): { structure: DpTypeStructure; bindings: StructureBindings; policy: ModelPolicy; removed: string[] } {
  const removed = Object.entries(base.bindings)
    .filter(([, binding]) => parseBindingRef(binding).bookId === bookId)
    .map(([leaf]) => leaf);
  const gone = new Set(removed);
  const bindings = Object.fromEntries(Object.entries(base.bindings).filter(([leaf]) => !gone.has(leaf)));
  const policy = Object.fromEntries(Object.entries(base.policy ?? {}).filter(([leaf]) => !gone.has(leaf)));
  return { structure: pruneLeaves(base.structure, [], gone), bindings, policy, removed };
}

/** The structure without those leaf paths, and without the groups they emptied. */
function pruneLeaves(node: DpTypeStructure, path: string[], gone: Set<string>): DpTypeStructure {
  const children = node.children ?? [];
  if (children.length === 0) return { ...node };
  const kept: DpTypeStructure[] = [];
  for (const child of children) {
    const here = [...path, child.name];
    const isGroup = (child.children ?? []).length > 0;
    if (!isGroup) {
      if (!gone.has(here.join('.'))) kept.push({ ...child });
      continue;
    }
    const pruned = pruneLeaves(child, here, gone);
    // A group whose every leaf left is a group that no longer describes anything.
    if ((pruned.children ?? []).length > 0) kept.push(pruned);
  }
  return { ...node, children: kept };
}

/** Graft the catalog's nodes onto the model's, recording the paths already present. */
function mergeNodes(target: DpTypeStructure, incoming: DpTypeStructure[], path: string[], kept: string[]): void {
  target.children ??= [];
  for (const node of incoming) {
    const here = [...path, node.name];
    const existing = target.children.find((child) => child.name === node.name);
    if (existing === undefined) {
      target.children.push(structuredClone(node));
      continue;
    }
    const bothGroups = (existing.children ?? []).length > 0 && (node.children ?? []).length > 0;
    if (bothGroups) {
      mergeNodes(existing, node.children ?? [], here, kept);
      continue;
    }
    kept.push(here.join('.'));
  }
}

/** Longest common leading segment sequence of the selected paths. */
function commonPrefix(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const split = paths.map((p) => p.split('.'));
  const first = split[0];
  const prefix: string[] = [];
  for (const [index, segment] of first.entries()) {
    // Never strip the last segment of any path — a leaf must remain.
    if (split.some((parts) => parts.length <= index + 1 || parts[index] !== segment)) break;
    prefix.push(segment);
  }
  return prefix;
}

/** One leaf of the future type: relative (sanitised) path + its type + source. */
interface Leaf {
  /** Sanitised relative path segments. */
  segments: string[];
  leafType: OaLeafType;
  entry: BookEntry;
  /**
   * INTERFACE of the catalog this leaf's signal came from, when the model reads
   * SEVERAL catalogs (`options.books`).
   *
   * A model may aggregate a TIA export and an OPC UA browse of the same machine, and
   * the two are addressed through different drivers: the access mode and the
   * connection to substitute are properties of the CATALOG, not of the model. Absent
   * for a single-catalog model, where the book's own interface answers for every leaf.
   */
  interface?: BookInterface;
}

/** `<bookId>::<entryPath>` — a binding that names WHICH catalog it points into. */
const BINDING_SEPARATOR = '::';

/**
 * Qualify a binding with its catalog: what makes a model over several catalogs
 * unambiguous, since two of them may hold the same signal path (two TIA DBs both
 * carrying `Mesures.Temperature`).
 */
export function bindingRef(bookId: string, entryPath: string): string {
  return `${bookId}${BINDING_SEPARATOR}${entryPath}`;
}

/**
 * Read a binding, qualified or not. A BARE path is a single-catalog binding (what
 * every model written before multi-catalog support holds), so it stays valid and is
 * resolved against the model's own book.
 */
export function parseBindingRef(value: string): { bookId?: string; path: string } {
  const at = value.indexOf(BINDING_SEPARATOR);
  if (at === -1) return { path: value };
  return { bookId: value.slice(0, at), path: value.slice(at + BINDING_SEPARATOR.length) };
}

/**
 * `_datatype` transformation for the mode, or `undefined` when that driver has no
 * transformation for this source type — the two S7 drivers do NOT share a table
 * (see `drivers/s7.ts`), so the mode, not the family, selects it.
 */
function datatypeFor(mode: AccessMode, sourceType: string): number | undefined {
  switch (mode) {
    case 'opcua': {
      return opcUaDatatypeCode(sourceType);
    }
    case 's7':
    case 's7plus': {
      return s7DatatypeCode(sourceType, mode);
    }
    case 'modbus': {
      return modbusDatatypeCode(sourceType);
    }
  }
}

/** Substitute a template placeholder (`<…>`) in a reference with the connection. */
function resolveReference(reference: string, bindConnection: string | undefined): string | null {
  if (!/<[^>]+>/.test(reference)) return reference;
  if (bindConnection === undefined || bindConnection === '') return null;
  return reference.replace(/<[^>]+>/, bindConnection);
}

/** Build the DPType structure from the leaves (nested Structs, unique names). */
function buildStructure(typeName: string, leaves: Leaf[]): DpTypeStructure {
  const root: DpTypeStructure = { name: typeName, type: 'Struct', children: [] };
  for (const leaf of leaves) {
    let node = root;
    for (const [index, segment] of leaf.segments.entries()) {
      const isLeaf = index === leaf.segments.length - 1;
      node.children ??= [];
      const existing = node.children.find((child) => child.name === segment);
      if (existing) {
        node = existing;
        continue;
      }
      const created: DpTypeStructure = isLeaf
        ? { name: segment, type: leaf.leafType }
        : { name: segment, type: 'Struct', children: [] };
      node.children.push(created);
      node = created;
    }
  }
  return root;
}

/**
 * Mirror mode: the type follows the book's own paths (the default).
 *
 * `forcedStrip` is how a MULTI-catalog mirror keeps one rule for all of its sources: the
 * prefix is then the one shared by every mirrored signal of every catalog, computed once
 * by the caller. Left out, each call strips its own selection's prefix as before.
 */
function mirrorLeaves(
  selected: BookEntry[],
  options: ModelGenOptions,
  warnings: EngWarning[],
  forcedStrip?: number
): { leaves: Leaf[]; type: EngType } {
  const strip = forcedStrip ?? ((options.stripCommonPrefix ?? true) ? commonPrefix(selected.map((e) => e.path)).length : 0);
  if (strip > 0 && forcedStrip === undefined) {
    warnings.push(
      warn(WARNING_CODES.modelgen.PREFIX_STRIPPED, 'Common prefix "{prefix}" stripped from the paths.', {
        prefix: selected[0].path.split('.').slice(0, strip).join('.')
      })
    );
  }
  const leaves: Leaf[] = [];
  const usedPerParent = new Map<string, Set<string>>();
  for (const entry of selected) {
    const raw = entry.path.split('.').slice(strip);
    const segments: string[] = [];
    for (const part of raw) {
      const parentKey = segments.join('.');
      const used = usedPerParent.get(parentKey) ?? new Set<string>();
      usedPerParent.set(parentKey, used);
      const clean = sanitizeSegment(part) || 'element';
      // Reuse an identical branch name (nesting), only de-duplicate real clashes.
      const already = [...used].includes(clean);
      const name = already && raw.at(-1) === part ? uniqueName(clean, used) : clean;
      if (!already) used.add(clean);
      segments.push(name);
    }
    if (segments.length === 0) {
      warnings.push(warn(WARNING_CODES.modelgen.UNUSABLE_NAME, 'Signal "{path}" has no usable name — skipped.', { path: entry.path }));
      continue;
    }
    leaves.push({ segments, leafType: entry.leafType, entry });
  }
  return { leaves, type: { typeName: options.typeName, structure: buildStructure(options.typeName, leaves) } };
}

/**
 * Mapping mode: the type is the AUTHORED structure, and every leaf takes its
 * config from the bound book entry.
 *
 * What it refuses to hide:
 *  - a leaf with no binding → it stays in the type (the engineer put it there) but
 *    gets no config, and is counted in a warning;
 *  - a binding pointing at a path the book (or the selection) does not have → the
 *    leaf is treated as unbound and the dangling binding is named;
 *  - a TYPE MISMATCH between the authored leaf and the bound signal → the authored
 *    type wins (it is the model's contract) and the mismatch is named, because a
 *    Bool DPE fed by a Float address is a mapping mistake far more often than an
 *    intended conversion.
 */
function mappedLeaves(
  selected: BookEntry[],
  mapping: ModelMapping,
  options: ModelGenOptions,
  warnings: EngWarning[]
): { leaves: Leaf[]; type: EngType } {
  const byPath = new Map(selected.map((entry) => [entry.path, entry]));
  // The OTHER catalogs a multi-catalog model reads: each entry keyed by its qualified
  // reference, with the interface it must be addressed through.
  const byRef = new Map<string, { entry: BookEntry; interface?: BookInterface }>();
  for (const extra of options.books ?? []) {
    for (const entry of extra.entries) {
      byRef.set(bindingRef(extra.id, entry.path), { entry, ...(extra.interface === undefined ? {} : { interface: extra.interface }) });
    }
  }
  const structure: DpTypeStructure = { ...mapping.structure, name: options.typeName };
  const leaves: Leaf[] = [];
  const unbound: string[] = [];
  const dangling: string[] = [];
  const mismatched: string[] = [];

  for (const leaf of structureLeaves(structure)) {
    const leafPath = leaf.segments.join('.');
    const boundPath = mapping.bindings[leafPath];
    if (boundPath === undefined || boundPath === '') {
      unbound.push(leafPath);
      continue;
    }
    // A QUALIFIED binding names its catalog; a bare one is this book's own.
    const qualified = byRef.get(boundPath);
    const entry = qualified?.entry ?? byPath.get(parseBindingRef(boundPath).path);
    if (entry === undefined) {
      dangling.push(`${leafPath} → ${boundPath}`);
      continue;
    }
    if (entry.leafType !== leaf.leafType) {
      mismatched.push(`${leafPath} (${leaf.leafType}) ← ${entry.path} (${entry.leafType})`);
    }
    // The AUTHORED leaf type is kept: it is the model's contract.
    leaves.push({
      segments: leaf.segments,
      leafType: leaf.leafType,
      entry,
      ...(qualified?.interface === undefined ? {} : { interface: qualified.interface })
    });
  }

  if (unbound.length > 0) {
    warnings.push(
      warn(WARNING_CODES.modelgen.UNBOUND_LEAVES, '{n} model element(s) with no mapped signal — DPEs created WITHOUT any config: {paths}{more}', {
        n: unbound.length,
        paths: unbound.slice(0, 8).join(', '),
        more: unbound.length > 8 ? ' …' : ''
      })
    );
  }
  if (dangling.length > 0) {
    warnings.push(
      warn(WARNING_CODES.modelgen.DANGLING_BINDINGS, '{n} mapping(s) point at a signal the book does not have: {details}', {
        n: dangling.length,
        details: dangling.slice(0, 5).join(' · ')
      })
    );
  }
  if (mismatched.length > 0) {
    warnings.push(
      warn(WARNING_CODES.modelgen.TYPE_MISMATCH, "{n} mapping(s) with a DIFFERENT TYPE (the model's type is kept): {details}", {
        n: mismatched.length,
        details: mismatched.slice(0, 5).join(' · ')
      })
    );
  }
  const bound = new Set(leaves.map((leaf) => leaf.entry.path));
  const unused = selected.filter((entry) => !bound.has(entry.path)).length;
  if (unused > 0) {
    warnings.push(warn(WARNING_CODES.modelgen.UNUSED_SIGNALS, '{n} book signal(s) unused by the model (partial mapping assumed).', { n: unused }));
  }
  return { leaves, type: { typeName: options.typeName, structure } };
}

/**
 * Generate a model proposal from a book. Pure: it reads the book and returns what
 * should be added — the caller merges it ({@link mergeProposal}) and check-in
 * turns it into writes.
 */
export function generateModelFromBook(book: AddressBook, options: ModelGenOptions): ModelProposal {
  const warnings: EngWarning[] = [];
  const selected = options.selection === undefined
    ? book.entries
    : book.entries.filter((entry) => options.selection?.includes(entry.path));
  if (selected.length === 0) {
    warnings.push(warn(WARNING_CODES.modelgen.NO_SELECTION, 'No signal selected — nothing to generate.'));
  }

  // --- leaves + type: MIRROR the book, or follow the AUTHORED structure -------
  const { leaves, type } = options.mapping === undefined
    ? mirrorLeaves(selected, options, warnings)
    : mappedLeaves(selected, options.mapping, options, warnings);

  // --- datapoints -----------------------------------------------------------
  const usedDpNames = new Set<string>();
  const dps: EngDp[] = [];
  for (const equipment of options.equipments) {
    const name = uniqueName(options.zone ? dpName(options.zone, equipment) : sanitizeSegment(equipment), usedDpNames);
    const descriptions: Record<string, string> = {};
    for (const leaf of leaves) {
      if (leaf.entry.comment) descriptions[leaf.segments.join('.')] = leaf.entry.comment;
    }
    dps.push({ dpName: name, dpType: options.typeName, descriptions });
  }
  if (dps.length === 0) {
    warnings.push(warn(WARNING_CODES.modelgen.NO_DEVICE, 'No device supplied — the type is generated without any datapoint.'));
  }

  // --- configs per DPE ------------------------------------------------------
  const mode: AccessMode = options.mode ?? book.interface?.protocol ?? 'opcua';
  const bindConnection = options.bindConnection ?? book.interface?.connection;
  const configs: Record<string, DpeConfigs> = {};
  const roleCounts = Object.fromEntries(SIGNAL_ROLES.map((role) => [role, 0])) as Record<SignalRole, number>;
  let unknownCount = 0;
  let missingAddress = 0;
  /** Leaves whose alarm was asked for but cannot exist (see the alarm branch below). */
  const alarmUnsupported: string[] = [];
  /** Leaves asked to be SUBSCRIBED with no subscription to subscribe on. */
  const subscriptionMissing: string[] = [];
  let unresolvedReference = 0;
  /** Source types this driver has no `_datatype` transformation for. */
  const untransformableTypes = new Set<string>();
  let assumedAccess = 0;
  /** Addresses that took the OPC UA "Historical" flag from the catalog's history column. */
  let historizedAddresses = 0;
  /** `<browsed connection> → <target connection>` for every address actually re-pointed. */
  const repointed = new Map<string, string>();
  const directionNotes = new Set<string>();

  for (const dp of dps) {
    for (const leaf of leaves) {
      const role = leaf.entry.role ?? 'unknown';
      roleCounts[role] += 1;
      const dpe = makeDpeName(dp.dpName, leaf.segments.join('.'));
      if (role === 'unknown') {
        unknownCount += 1;
        continue; // DPE exists in the type, but nothing is configured
      }
      const roleConfigs = configsForRole(leaf.entry, role, options.profiles, options.profileContext);
      if (roleConfigs.directionNote !== undefined) directionNotes.add(roleConfigs.directionNote);
      if (leaf.entry.accessSource === 'assumed') assumedAccess += 1;
      const entryConfigs: DpeConfigs = {};
      // ALARM / ARCHIVE / RANGE come from the deployment POLICY — the model's own
      // per-leaf decision, seeded by `defaultLeafPolicy` (alarm for the alarm
      // role, archive when the source historizes the signal, no range) and
      // overridden by whatever the engineer set in the model. The role profile
      // keeps deciding the address DIRECTION, which is a reconciliation with the
      // declared access and not a policy.
      const policy = resolveLeafPolicy(leaf.entry, role, options.policy?.[leaf.segments.join('.')], options.profileContext);
      if (policy.archive?.active === true) {
        entryConfigs.archive = { group: policy.archive.group ?? 'EVENT', active: true };
      }
      // A GROUP is not a leaf here (the loop walks leaves), but a String/Blob/Time leaf is —
      // and none of them can carry an alert. A policy or a catalog role asking for one is
      // reported and IGNORED: writing `_alert_hdl` there produces a config the runtime rejects.
      if (policy.alarm?.active === true && !isAlarmableLeafType(leaf.leafType)) {
        alarmUnsupported.push(`${leaf.segments.join('.')} (${leaf.leafType})`);
      } else if (policy.alarm?.active === true) {
        // BINARY or ANALOG, decided by what the model says rather than by the role: a BOOL
        // leaf can only be binary, and a numeric one becomes analog as soon as thresholds
        // are pinned (without them there is nothing to compare against, so it stays the
        // binary "non-zero" alert the role profile always produced).
        const thresholds = (policy.alarm.thresholds ?? []).filter((value) => Number.isFinite(value));
        const analog = leaf.leafType !== 'Bool' && thresholds.length > 0;
        entryConfigs.alarm = {
          kind: analog ? 'analog' : 'binary',
          alarmClass: policy.alarm.alarmClass ?? 'alert',
          // The DIRECTION of an analog alert is the alarming side (above / below the
          // thresholds); for a binary one it is kept for the older callers, while
          // `goodRange` is what actually decides `_alert_hdl.._ok_range`.
          direction: policy.alarm.direction ?? roleConfigs.alarm?.direction ?? 'ASC',
          ...(analog
            ? {
                thresholds: [...thresholds].sort((first, second) => first - second),
                // Only when the model pinned any: an empty array would claim a decision the
                // model never made, and the single class already answers for every range.
                ...((policy.alarm.alarmClasses ?? []).some((name) => name !== undefined && name !== '')
                  ? { alarmClasses: [...(policy.alarm.alarmClasses ?? [])] }
                  : {})
              }
            : {}),
          ...(policy.alarm.goodRange === undefined ? {} : { goodRange: policy.alarm.goodRange }),
          ...(policy.range === undefined ? {} : { bounds: [policy.range.min, policy.range.max] as [number, number] }),
          active: true
        };
      }
      if (policy.range !== undefined) {
        entryConfigs.range = { min: policy.range.min, max: policy.range.max, inclMin: true, inclMax: true };
      }

      // PER LEAF, not per model: with several catalogs the access mode and the
      // connection are properties of the CATALOG the signal came from (a TIA export
      // and an OPC UA browse of one machine are addressed through different drivers).
      // A single-catalog model carries no leaf interface, so this is the book's own.
      const leafMode: AccessMode = options.mode ?? leaf.interface?.protocol ?? mode;
      const leafConnection = leaf.interface?.connection ?? bindConnection;
      const candidate = leaf.entry.addresses[leafMode];
      if (candidate === undefined) {
        missingAddress += 1;
      } else {
        const resolved = resolveReference(candidate, leafConnection);
        if (resolved === null) {
          unresolvedReference += 1;
        } else {
          // The SERVER of an OPC UA reference belongs to the INSTANCE, not to the import.
          // A catalog carries the connection it was browsed on; deploying it on another
          // equipment — which is the whole point of a mutualised catalog — must re-point
          // field 1 at that equipment's own connection. A `<placeholder>` catalog is
          // already handled by `resolveReference`; this is the case where the browse left
          // a CONCRETE name behind, which used to travel unchanged into every instance.
          const target = (leafConnection ?? '').trim();
          const reference = leafMode === 'opcua' && target !== '' ? withOpcUaConnection(resolved, target) : resolved;
          if (reference !== resolved) repointed.set(resolved.split('$')[0] ?? '', target);
          const datatype = datatypeFor(leafMode, leaf.entry.sourceType);
          if (datatype === undefined) {
            // No transformation for this type on this driver: an address without a
            // `_datatype` would read garbage, so none is written at all.
            untransformableTypes.add(leaf.entry.sourceType);
          } else {
            // ACQUISITION: the model's choice, and the two things it decides — the direction, and
            // which of the poll group / subscription the address carries.
            //
            // A SUBSCRIBED address needs its subscription NAME: field 2 of the reference. Left
            // empty, the address is a polled one — the driver would do the other thing silently,
            // so a missing subscription falls back to polling AND says so.
            const wanted = policy.acquisition?.mode ?? 'poll';
            const subscription = policy.acquisition?.subscription?.trim() ?? '';
            const spont = wanted === 'spont' && leafMode === 'opcua' && subscription !== '';
            if (wanted === 'spont' && !spont) {
              subscriptionMissing.push(leaf.segments.join('.'));
            }
            const direction = directionFor(leaf.entry.access, spont ? 'spont' : 'poll');
            // HISTORICAL: the source's own statement, turned into the address attribute that
            // acts on it. A signal the OPC UA server historizes (`Historizing`, or the
            // `HistoryRead`/`HistoryWrite` bits of its `AccessLevel` — the catalog's `H`
            // column) is included in the driver's historical queries, which is
            // `_address.._offset = 1`, the "Historical" checkbox of the PARA address tab.
            //
            // Two conditions, and the second is the catalog's ACCESS: only a direction that
            // READS can take part in a historical query — `r` gives an input (IN) and `rw` an
            // input/output (IN/OUT), both of which acquire; a write-only signal produces an
            // OUTPUT and gets nothing, because there is no acquisition to look back on.
            //
            // OPC UA only: `_offset` is a bit count on Modbus, and the flag has no meaning on
            // the S7 families.
            const historical = leafMode === 'opcua' && leaf.entry.historized === true && isReadingDirection(direction);
            if (historical) historizedAddresses += 1;
            const address: AddressConfig = {
              deviceId: options.deviceId,
              mode: leafMode,
              reference: spont ? withOpcUaSubscription(reference, subscription) : reference,
              direction,
              datatype,
              // A HISTORICAL address is left INACTIVE. The signal is already historized on the
              // server: the project reads that history through a `HistoryRead` request (the
              // driver's method 3, which matches the peripheral address and fills `_archive`),
              // not by acquiring the value live as well. An active address would poll (or
              // subscribe to) the very same signal and archive it a second time.
              //
              // The address still EXISTS with all its attributes — that is what `_active` means
              // (vendor: "an inactive address exists and keeps its attributes, but the driver
              // does not use it"). Activating it is one checkbox in PARA the day the project
              // wants the live value too.
              active: !historical,
              ...(historical ? { historical: true } : {}),
              ...(spont ? { subscription } : {}),
              ...(spont || policy.acquisition?.pollGroup === undefined ? {} : { pollGroup: policy.acquisition.pollGroup })
            };
            entryConfigs.address = address;
          }
        }
      }
      if (Object.keys(entryConfigs).length > 0) configs[dpe] = entryConfigs;
    }
  }

  const perDp = dps.length === 0 ? 1 : dps.length;
  if (unknownCount > 0) {
    warnings.push(
      warn(WARNING_CODES.modelgen.UNQUALIFIED, '{n} unqualified signal(s): their DPEs are created but NO config is generated — qualify them, then regenerate.', {
        n: unknownCount / perDp
      })
    );
  }
  if (subscriptionMissing.length > 0) {
    const distinct = [...new Set(subscriptionMissing)];
    const shown = distinct.slice(0, 5);
    warnings.push(
      warn(
        WARNING_CODES.modelgen.SUBSCRIPTION_MISSING,
        '{n} element(s) asked to be SUBSCRIBED without a subscription ({leaves}{more}) — written POLLED instead, because an empty subscription in the reference IS polling. Name an _OPCUASubscription on the model, or accept polling.',
        { n: distinct.length, leaves: shown.join(', '), more: distinct.length > shown.length ? '…' : '' }
      )
    );
  }
  if (alarmUnsupported.length > 0) {
    const distinct = [...new Set(alarmUnsupported)];
    const shown = distinct.slice(0, 5);
    warnings.push(
      warn(
        WARNING_CODES.modelgen.ALARM_UNSUPPORTED,
        'Alarm IGNORED on {n} element(s) whose type cannot carry one ({leaves}{more}) — an alert compares a value, which a String, a Blob or a Time has none of.',
        { n: distinct.length, leaves: shown.join(', '), more: distinct.length > shown.length ? '…' : '' }
      )
    );
  }
  if (missingAddress > 0) {
    warnings.push(
      warn(WARNING_CODES.modelgen.MISSING_ADDRESS, '{n} signal(s) with no address for mode "{mode}" — DPE created without a peripheral address.', {
        n: missingAddress / perDp,
        mode
      })
    );
  }
  if (unresolvedReference > 0) {
    warnings.push(
      warn(
        WARNING_CODES.modelgen.UNRESOLVED_REFERENCE,
        '{n} signal(s) from an unbound catalog: supply the target connection to resolve the reference (placeholder left as-is).',
        { n: unresolvedReference / perDp }
      )
    );
  }
  if (directionNotes.size > 0) {
    warnings.push(
      warn(
        WARNING_CODES.modelgen.DIRECTION_ADJUSTED,
        'Address direction adjusted for {n} signal(s) — the role asked to write, the access declared by the source does not allow it: {details}{more}',
        { n: directionNotes.size, details: [...directionNotes].slice(0, 5).join(' · '), more: directionNotes.size > 5 ? ' …' : '' }
      )
    );
  }
  if (assumedAccess > 0) {
    warnings.push(
      warn(
        WARNING_CODES.modelgen.ACCESS_ASSUMED,
        'Access NOT DECLARED for {n} signal(s) (a walk without AccessLevel): the direction comes from the role alone — check that the commands/setpoints really are writable on the device.',
        { n: assumedAccess / perDp }
      )
    );
  }
  if (repointed.size > 0) {
    warnings.push(
      warn(
        WARNING_CODES.modelgen.CONNECTION_REPOINTED,
        'Addresses RE-POINTED at the target connection: {details}. The catalog names the server it was browsed on; an instance is addressed through its own equipment’s connection.',
        { details: [...repointed].map(([from, to]) => `${from} → ${to}`).join(' · ') }
      )
    );
  }
  if (historizedAddresses > 0) {
    warnings.push(
      warn(
        WARNING_CODES.modelgen.HISTORICAL_ADDRESSES,
        '{n} address(es) marked HISTORICAL ("_address.._offset") and left INACTIVE: the OPC UA server states it keeps a history of those signals and they are read (IN / IN-OUT), so the project reads that history through a HistoryRead request instead of acquiring the value live as well. Activate them in PARA if a signal also needs its live value.',
        { n: historizedAddresses / perDp }
      )
    );
  }
  if (untransformableTypes.size > 0) {
    warnings.push(
      warn(
        WARNING_CODES.modelgen.NO_DATATYPE,
        'The "{mode}" driver has no "_datatype" transformation for {n} source type(s) ({types}) — those DPEs are created WITHOUT a peripheral address, on purpose: a neighbouring transformation would misread the value. Change the type in the PLC, or address them through another mode.',
        { mode, n: untransformableTypes.size, types: [...untransformableTypes].sort().join(', ') }
      )
    );
  }
  return { type, dps, configs, warnings, roleCounts };
}

/**
 * Merge a proposal into a workspace: the type is added or replaced, datapoints
 * are added when absent, configs are merged per DPE (proposal wins). Pure — the
 * workspace is not mutated.
 */
export function mergeProposal(workspace: Workspace, proposal: ModelProposal): Workspace {
  const types = workspace.types.some((t) => t.typeName === proposal.type.typeName)
    ? workspace.types.map((t) => (t.typeName === proposal.type.typeName ? proposal.type : t))
    : [...workspace.types, proposal.type];
  const existingDps = new Set(workspace.dps.map((d) => d.dpName));
  const dps = [...workspace.dps, ...proposal.dps.filter((d) => !existingDps.has(d.dpName))];
  const configs: Record<string, DpeConfigs> = { ...workspace.configs };
  for (const [dpe, entry] of Object.entries(proposal.configs)) {
    configs[dpe] = { ...configs[dpe], ...entry };
  }
  return { ...workspace, types, dps, configs };
}
