// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DP-type STRUCTURE authoring — the "or build your own" half of model generation.
 *
 * The studio offers two ways to get a DP type out of an address book:
 *
 *  - **mirror** — the type follows the book's own paths (`modelgen.ts`). Fast, and
 *    right when the source is already organised the way you want your model
 *    (a TIA DB, a PackML interface).
 *  - **custom + mapping** — you author the target structure and BIND each of its
 *    leaves to a book signal. That is what a house standard needs: the same DP type
 *    across machines whose PLCs name and nest things differently.
 *
 * This module holds everything the second mode needs, all of it pure:
 *  - an **outline** text format (indent = nesting, `Name : Type` = leaf) that is
 *    readable, diffable and editable in a plain textarea — no tree widget to fight;
 *  - `formatStructureOutline` / `parseStructureOutline` to round-trip it, so a
 *    custom structure can be BOOTSTRAPPED from the mirrored one and then edited;
 *  - `autoBindStructure`, which does the tedious part of the mapping by matching
 *    leaf names against the book, and — importantly — reports what it could NOT
 *    decide instead of picking for you.
 */

import type { AddressBook, BookEntry, DpTypeStructure, OaLeafType } from './model.js';
import { sanitizeSegment } from './naming.js';
import { WARNING_CODES, warn, type EngWarning } from './warnings.js';

/** Element types a leaf may take in an outline (the studio's scalar set). */
export const OUTLINE_LEAF_TYPES: OaLeafType[] = [
  'Bool',
  'Char',
  'UInt',
  'Int',
  'Long',
  'ULong',
  'Float',
  'String',
  'Time',
  'Blob',
  'Bit32',
  'LangString'
];

const LEAF_TYPE_BY_LOWER = new Map(OUTLINE_LEAF_TYPES.map((type) => [type.toLowerCase(), type]));

/** One leaf of an authored structure: its path inside the type, and its type. */
export interface StructureLeaf {
  /** Segments below the type root (`['Mesures','Temperature']`). */
  segments: string[];
  leafType: OaLeafType;
}

/** Depth-first leaves of a structure (the root's own name is not part of a path). */
export function structureLeaves(structure: DpTypeStructure): StructureLeaf[] {
  const out: StructureLeaf[] = [];
  const walk = (node: DpTypeStructure, segments: string[]): void => {
    const children = node.children ?? [];
    if (children.length === 0) {
      // A childless Struct is a group nobody filled — not a leaf, and not an error.
      if (node.type !== 'Struct' && segments.length > 0) {
        out.push({ segments, leafType: node.type as OaLeafType });
      }
      return;
    }
    for (const child of children) walk(child, [...segments, child.name]);
  };
  walk(structure, []);
  return out;
}

// --- outline text format -----------------------------------------------------

const INDENT = '  ';

/**
 * Render a structure as an outline (the root line included, so the text is
 * self-describing when pasted around).
 */
export function formatStructureOutline(structure: DpTypeStructure): string {
  const lines: string[] = [];
  const walk = (node: DpTypeStructure, depth: number): void => {
    const children = node.children ?? [];
    const isGroup = children.length > 0 || node.type === 'Struct';
    lines.push(`${INDENT.repeat(depth)}${node.name}${isGroup ? '' : ` : ${node.type}`}`);
    for (const child of children) walk(child, depth + 1);
  };
  walk(structure, 0);
  return lines.join('\n');
}

export interface OutlineParseResult {
  /** The parsed structure (root named `rootName`), even when errors were found. */
  structure: DpTypeStructure;
  /** Problems, one per offending line. Empty = clean parse. */
  errors: EngWarning[];
}

/**
 * Parse an outline into a structure.
 *
 * Format, deliberately minimal:
 *   - indentation (2 spaces, or a tab) is nesting;
 *   - `Name : Type` is a leaf, `Name` alone is a group;
 *   - blank lines and `#` comments are ignored;
 *   - the first line is treated as the ROOT (and dropped, since the type name comes
 *     from the generation form) ONLY when it names the type. Any other top-level
 *     line is a member: `Mesures` + indented children is ambiguous, and eating it
 *     would silently lose a level.
 *
 * It never throws: a malformed line is reported and skipped, so the UI can show
 * the errors next to a partially valid preview instead of a stack trace.
 */
export function parseStructureOutline(text: string, rootName: string): OutlineParseResult {
  const errors: EngWarning[] = [];
  const root: DpTypeStructure = { name: rootName, type: 'Struct', children: [] };

  interface Row {
    depth: number;
    name: string;
    type?: OaLeafType;
    line: number;
  }
  const rows: Row[] = [];
  const rawLines = text.split(/\r?\n/);
  for (const [index, raw] of rawLines.entries()) {
    const lineNumber = index + 1;
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const expanded = raw.replaceAll('\t', INDENT);
    const spaces = expanded.length - expanded.trimStart().length;
    if (spaces % INDENT.length !== 0) {
      errors.push(
        warn(WARNING_CODES.outline.ODD_INDENT, 'line {line}: indented by {spaces} space(s) — use multiples of {step}', {
          line: lineNumber,
          spaces,
          step: INDENT.length
        })
      );
    }
    const depth = Math.floor(spaces / INDENT.length);
    const body = expanded.trim();
    const colon = body.indexOf(':');
    const name = (colon === -1 ? body : body.slice(0, colon)).trim();
    const typeText = colon === -1 ? '' : body.slice(colon + 1).trim();
    if (name === '') {
      errors.push(warn(WARNING_CODES.outline.EMPTY_NAME, 'line {line}: empty element name', { line: lineNumber }));
      continue;
    }
    const clean = sanitizeSegment(name);
    if (clean === '') {
      errors.push(
        warn(WARNING_CODES.outline.INVALID_IDENTIFIER, 'line {line}: "{name}" yields no valid WinCC OA identifier', { line: lineNumber, name })
      );
      continue;
    }
    if (clean !== name) {
      errors.push(warn(WARNING_CODES.outline.SANITISED, 'line {line}: "{name}" sanitised to "{clean}"', { line: lineNumber, name, clean }));
    }
    if (typeText === '') {
      rows.push({ depth, name: clean, line: lineNumber });
      continue;
    }
    const leafType = LEAF_TYPE_BY_LOWER.get(typeText.toLowerCase());
    if (leafType === undefined) {
      errors.push(
        warn(WARNING_CODES.outline.UNKNOWN_TYPE, 'line {line}: unknown type "{type}" — expected one of: {expected}', {
          line: lineNumber,
          type: typeText,
          expected: OUTLINE_LEAF_TYPES.join(', ')
        })
      );
      continue;
    }
    rows.push({ depth, name: clean, type: leafType, line: lineNumber });
  }

  // The first line is the ROOT only when it NAMES the type: `Mesures` followed by
  // indented members is otherwise genuinely ambiguous (root, or a group inside the
  // type?), and dropping it would silently lose a level. Nothing is eaten unless
  // the text says so — the UI pre-fills the outline from `formatStructureOutline`,
  // which always emits that line.
  const first = rows[0];
  const skipRoot =
    first !== undefined &&
    first.depth === 0 &&
    first.type === undefined &&
    rows.length > 1 &&
    normalizeName(first.name) === normalizeName(rootName);
  const body = skipRoot ? rows.slice(1).map((row) => ({ ...row, depth: row.depth - 1 })) : rows;

  /** Node stack per depth; `stack[d]` is the parent of a depth-`d + 1` row. */
  const stack: DpTypeStructure[] = [root];
  for (const row of body) {
    if (row.depth > stack.length - 1) {
      errors.push(
        warn(WARNING_CODES.outline.TOO_DEEP, 'line {line}: "{name}" is indented too deep (no parent at that level)', {
          line: row.line,
          name: row.name
        })
      );
      continue;
    }
    const parent = stack[row.depth];
    parent.children ??= [];
    if (parent.children.some((child) => child.name === row.name)) {
      errors.push(
        warn(WARNING_CODES.outline.DUPLICATE, 'line {line}: "{name}" duplicated under "{parent}"', {
          line: row.line,
          name: row.name,
          parent: parent.name
        })
      );
      continue;
    }
    const node: DpTypeStructure =
      row.type === undefined ? { name: row.name, type: 'Struct', children: [] } : { name: row.name, type: row.type };
    parent.children.push(node);
    stack.length = row.depth + 1;
    stack.push(node);
  }
  return { structure: root, errors };
}

// --- automatic binding -------------------------------------------------------

/** target leaf path (dot-joined) → book entry path. */
export type StructureBindings = Record<string, string>;

export interface AutoBindResult {
  bindings: StructureBindings;
  /** Leaves no entry matched — the DPE will exist without a config. */
  unbound: string[];
  /**
   * Leaves several entries matched equally well. NOT bound: the studio does not
   * pick for you, it asks (the UI offers the candidates).
   */
  ambiguous: { leaf: string; candidates: string[] }[];
  /** Book entries no leaf uses — informational (a partial model is legitimate). */
  unusedEntries: string[];
}

/** Case/separator-insensitive name comparison (root line vs requested type name). */
function normalizeName(value: string): string {
  return sanitizeSegment(value).toLowerCase();
}

/** Comparable form of a name/segment: sanitised, lowercased, separators dropped. */
function normalize(value: string): string {
  return sanitizeSegment(value).toLowerCase().replaceAll('_', '');
}

/**
 * Bind an authored structure to a book by NAME, from the most specific match to
 * the least — and stop rather than guess when two entries tie.
 *
 * Passes, in order (a leaf is bound by the first pass that yields exactly one hit):
 *   1. identical full path (`Mesures.Temperature` ↔ `…Mesures.Temperature`);
 *   2. the entry path ENDS WITH the leaf path (the usual case: the book is rooted
 *      at a block or an instance, the structure is not);
 *   3. the leaf NAME alone matches the entry's last segment.
 * Comparison is on normalized names, so `Temp_Produit` matches `TempProduit`.
 */
export function autoBindStructure(structure: DpTypeStructure, entries: BookEntry[]): AutoBindResult {
  const leaves = structureLeaves(structure);
  const bindings: StructureBindings = {};
  const unbound: string[] = [];
  const ambiguous: { leaf: string; candidates: string[] }[] = [];
  const used = new Set<string>();

  const normalizedPath = (path: string): string => path.split('.').map(normalize).join('.');
  const indexed = entries.map((entry) => ({
    entry,
    path: normalizedPath(entry.path),
    last: normalize(entry.path.split('.').at(-1) ?? '')
  }));

  for (const leaf of leaves) {
    const leafPath = leaf.segments.join('.');
    const target = normalizedPath(leafPath);
    const targetLast = normalize(leaf.segments.at(-1) ?? '');
    const passes: ((item: (typeof indexed)[number]) => boolean)[] = [
      (item) => item.path === target,
      (item) => item.path.endsWith(`.${target}`),
      (item) => item.last === targetLast
    ];
    let bound = false;
    for (const predicate of passes) {
      // Prefer a still-unused entry, but allow reuse rather than reporting a false
      // ambiguity: one source signal MAY legitimately feed two DPEs.
      const hits = indexed.filter((item) => predicate(item));
      const fresh = hits.filter((item) => !used.has(item.entry.path));
      const pool = fresh.length > 0 ? fresh : hits;
      if (pool.length === 0) continue;
      if (pool.length > 1) {
        ambiguous.push({ leaf: leafPath, candidates: pool.slice(0, 8).map((item) => item.entry.path) });
        bound = true; // reported, deliberately not bound
        break;
      }
      bindings[leafPath] = pool[0].entry.path;
      used.add(pool[0].entry.path);
      bound = true;
      break;
    }
    if (!bound) unbound.push(leafPath);
  }

  return {
    bindings,
    unbound,
    ambiguous,
    unusedEntries: entries.filter((entry) => !used.has(entry.path)).map((entry) => entry.path)
  };
}

/** Convenience: bind against a whole book (optionally a selection of its paths). */
export function autoBindBook(structure: DpTypeStructure, book: AddressBook, selection?: string[]): AutoBindResult {
  const entries = selection === undefined ? book.entries : book.entries.filter((entry) => selection.includes(entry.path));
  return autoBindStructure(structure, entries);
}
