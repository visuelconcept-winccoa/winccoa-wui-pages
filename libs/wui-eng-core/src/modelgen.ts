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
  DpTypeStructure,
  DpeConfigs,
  EngDp,
  EngType,
  OaLeafType,
  Workspace
} from './model.js';
import { makeDpeName } from './model.js';
import { dpName, sanitizeSegment, uniqueName } from './naming.js';
import { opcUaDatatypeCode } from './drivers/opcua.js';
import { S7_DATATYPE_UNVERIFIED, s7DatatypeCode } from './drivers/s7.js';
import { MODBUS_DATATYPE_UNVERIFIED, modbusDatatypeCode } from './drivers/modbus.js';
import { configsForRole, type RoleProfile, type RoleProfileContext } from './roles/profiles.js';
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
}

/** What a generation proposes to add to the workspace. */
export interface ModelProposal {
  type: EngType;
  dps: EngDp[];
  /** Configs keyed by full DPE path. */
  configs: Record<string, DpeConfigs>;
  warnings: string[];
  /** Generated DPEs per role (UI summary). */
  roleCounts: Record<SignalRole, number>;
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
}

/** `_datatype` transformation for the mode, and whether it is a verified value. */
function datatypeFor(mode: AccessMode, sourceType: string): { code: number; verified: boolean } {
  switch (mode) {
    case 'opcua': {
      return { code: opcUaDatatypeCode(sourceType), verified: true };
    }
    case 's7':
    case 's7plus': {
      const code = s7DatatypeCode(sourceType);
      return { code, verified: code !== S7_DATATYPE_UNVERIFIED };
    }
    case 'modbus': {
      const code = modbusDatatypeCode(sourceType as never);
      return { code, verified: code !== MODBUS_DATATYPE_UNVERIFIED };
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
 * Generate a model proposal from a book. Pure: it reads the book and returns what
 * should be added — the caller merges it ({@link mergeProposal}) and check-in
 * turns it into writes.
 */
export function generateModelFromBook(book: AddressBook, options: ModelGenOptions): ModelProposal {
  const warnings: string[] = [];
  const selected = options.selection === undefined
    ? book.entries
    : book.entries.filter((entry) => options.selection?.includes(entry.path));
  if (selected.length === 0) {
    warnings.push('Aucun signal sélectionné — rien à générer.');
  }

  const strip = (options.stripCommonPrefix ?? true) ? commonPrefix(selected.map((e) => e.path)).length : 0;
  if (strip > 0) {
    warnings.push(`Préfixe commun « ${selected[0].path.split('.').slice(0, strip).join('.')} » retiré des chemins.`);
  }

  // --- leaves (sanitised, de-duplicated per parent) --------------------------
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
      warnings.push(`Signal « ${entry.path} » sans nom exploitable — ignoré.`);
      continue;
    }
    leaves.push({ segments, leafType: entry.leafType, entry });
  }

  const type: EngType = { typeName: options.typeName, structure: buildStructure(options.typeName, leaves) };

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
    warnings.push('Aucun équipement fourni — le type est généré sans datapoint.');
  }

  // --- configs per DPE ------------------------------------------------------
  const mode: AccessMode = options.mode ?? book.interface?.protocol ?? 'opcua';
  const bindConnection = options.bindConnection ?? book.interface?.connection;
  const configs: Record<string, DpeConfigs> = {};
  const roleCounts = Object.fromEntries(SIGNAL_ROLES.map((role) => [role, 0])) as Record<SignalRole, number>;
  let unknownCount = 0;
  let missingAddress = 0;
  let unresolvedReference = 0;
  let unverifiedDatatype = 0;
  let assumedAccess = 0;
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
      if (roleConfigs.archive) entryConfigs.archive = roleConfigs.archive;
      if (roleConfigs.alarm) entryConfigs.alarm = roleConfigs.alarm;
      if (roleConfigs.range) entryConfigs.range = roleConfigs.range;

      const candidate = leaf.entry.addresses[mode];
      if (candidate === undefined) {
        missingAddress += 1;
      } else {
        const reference = resolveReference(candidate, bindConnection);
        if (reference === null) {
          unresolvedReference += 1;
        } else {
          const datatype = datatypeFor(mode, leaf.entry.sourceType);
          if (!datatype.verified) unverifiedDatatype += 1;
          const address: AddressConfig = {
            deviceId: options.deviceId,
            mode,
            reference,
            direction: roleConfigs.direction,
            datatype: datatype.code,
            active: true
          };
          entryConfigs.address = address;
        }
      }
      if (Object.keys(entryConfigs).length > 0) configs[dpe] = entryConfigs;
    }
  }

  const perDp = dps.length === 0 ? 1 : dps.length;
  if (unknownCount > 0) {
    warnings.push(
      `${unknownCount / perDp} signal(aux) non qualifié(s) : leurs DPE sont créés mais AUCUNE config n’est générée — qualifier puis régénérer.`
    );
  }
  if (missingAddress > 0) {
    warnings.push(`${missingAddress / perDp} signal(aux) sans adresse pour le mode « ${mode} » — DPE créé sans adresse périphérique.`);
  }
  if (unresolvedReference > 0) {
    warnings.push(
      `${unresolvedReference / perDp} signal(aux) issus d’un catalogue non lié : fournir la connexion cible pour résoudre la référence (placeholder non substitué).`
    );
  }
  if (directionNotes.size > 0) {
    warnings.push(
      `Direction d’adresse ajustée pour ${directionNotes.size} signal(aux) — le rôle demandait l’écriture, l’accès déclaré par la source ne la permet pas : ${[...directionNotes].slice(0, 5).join(' · ')}${directionNotes.size > 5 ? ' …' : ''}`
    );
  }
  if (assumedAccess > 0) {
    warnings.push(
      `Accès NON DÉCLARÉ pour ${assumedAccess / perDp} signal(aux) (parcours sans AccessLevel) : la direction vient du rôle seul — vérifier que les commandes/consignes sont bien accessibles en écriture sur l’équipement.`
    );
  }
  if (unverifiedDatatype > 0) {
    warnings.push(
      `Transformation « _datatype » du driver « ${mode} » NON VÉRIFIÉE (valeur sentinelle) — à confirmer sur système réel avant check-in.`
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
