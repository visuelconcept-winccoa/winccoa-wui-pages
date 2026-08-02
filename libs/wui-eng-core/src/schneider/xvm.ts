// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Schneider **XVM / XSY / XEF** variables-export reader (XML).
 *
 * ⚠️⚠️ **SCHEMA NOT VENDOR-VERIFIED.** Schneider does not publish the XVM schema
 * and no real export could be obtained (the pages that carry one — the
 * developpez.net "Lecture d'un fichier XVM" thread, se.com FAQ FA198786,
 * product-help.schneider-electric.com — are unreachable from this environment's
 * network policy, and no public sample is indexed). What IS documented:
 *   - XVM is the OFS-compatible **variables export**; it carries the link between
 *     variables and controller addresses, and the memory-organisation info;
 *   - XSY/XEF are **XML** exports preserving name, address, type, description and
 *     initial values, and the attribute **`topologicalAddress`** holds the memory
 *     position (e.g. `%MW3215`), alongside `typeName` and `comment`.
 *
 * The reader is therefore deliberately **SPELLING-TOLERANT** rather than tied to
 * one schema: any element that carries a recognisable *name* is treated as a
 * variable, and name/type/address/comment/unit are looked up across attribute
 * aliases, child elements, and Unity-style `<attribute name= value=/>` children
 * (all case-insensitive, namespace prefixes ignored).
 *
 * If nothing is recognised, the result does not fail silently: it reports the
 * **element names actually encountered**, so calibrating on a real file is a
 * one-line change (add the alias). Feed a real export to
 * `docs/wui-eng-studio/INTEGRATION.md` "inputs needed" to close this out.
 *
 * The engineering resolution (addresses → Modbus, unlocated/topological
 * exclusion, overlap detection) is SHARED with the CSV generator through
 * {@link entriesFromSchneiderVariables} — only the file reading differs.
 */

import type { AddressBook, BookInterface, BookProvenance } from '../model.js';
import { localName, parseXml, type XmlNode } from '../simaticml/xml.js';
import { entriesFromSchneiderVariables, type SchneiderVariable } from './variables.js';
import { WARNING_CODES, warn, type EngWarning } from '../warnings.js';

/** Element local names understood as a variable declaration (lower-case). */
const VARIABLE_ELEMENTS = new Set([
  'elementaryvariable',
  'derivedvariable',
  'locatedvariable',
  'iovariable',
  'variable',
  'var',
  'tag',
  'item',
  'symbol'
]);

/** Element local names understood as a member of a structured variable. */
const MEMBER_ELEMENTS = new Set(['structmember', 'arraymember', 'member', 'element', 'field']);

/** Field aliases, looked up in attributes, child elements and `<attribute>` pairs. */
const FIELD_ALIASES: Record<'name' | 'type' | 'address' | 'comment' | 'unit', string[]> = {
  name: ['name', 'varname', 'variablename', 'symbol', 'symbole', 'nom', 'id'],
  type: ['typename', 'type', 'datatype', 'basetype', 'dataty', 'typededonnees'],
  address: ['topologicaladdress', 'address', 'adresse', 'addr', 'location', 'iecaddress', 'reference', '@'],
  comment: ['comment', 'commentaire', 'description', 'desc', 'descriptivecomment'],
  unit: ['unit', 'unite', 'unité', 'eu', 'engineeringunit']
};

/** Result of reading an XVM/XSY document. */
export interface XvmParseResult {
  variables: SchneiderVariable[];
  warnings: EngWarning[];
  /** Local-name → count of every element seen (diagnostic for calibration). */
  elements: Record<string, number>;
}

/** Lower-cased, prefix-stripped attribute pool of a node (+ `<attribute>` children). */
function fieldPool(node: XmlNode): Map<string, string> {
  const pool = new Map<string, string>();
  for (const [key, value] of Object.entries(node.attrs)) {
    pool.set(localName(key).toLowerCase(), value);
  }
  // Unity-style custom attributes: <attribute name="unit" value="bar"/>
  for (const child of node.children) {
    if (localName(child.tag).toLowerCase() !== 'attribute') continue;
    const childPool = new Map<string, string>();
    for (const [key, value] of Object.entries(child.attrs)) {
      childPool.set(localName(key).toLowerCase(), value);
    }
    const key = childPool.get('name');
    const value = childPool.get('value') ?? child.text;
    if (key !== undefined && value !== undefined && value !== '') {
      const slot = key.toLowerCase();
      if (!pool.has(slot)) pool.set(slot, value);
    }
  }
  // Child elements carrying the value as text: <comment>…</comment>
  for (const child of node.children) {
    const key = localName(child.tag).toLowerCase();
    if (child.children.length === 0 && child.text !== '' && !pool.has(key)) {
      pool.set(key, child.text);
    }
  }
  return pool;
}

function pick(pool: Map<string, string>, field: keyof typeof FIELD_ALIASES): string | undefined {
  for (const alias of FIELD_ALIASES[field]) {
    const value = pool.get(alias);
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return undefined;
}

/** Variable-like children of a node (structured variable members). */
function memberChildren(node: XmlNode): XmlNode[] {
  return node.children.filter((child) => {
    const tag = localName(child.tag).toLowerCase();
    return MEMBER_ELEMENTS.has(tag) || VARIABLE_ELEMENTS.has(tag);
  });
}

/**
 * Read an XVM/XSY/XEF document into flat variables.
 * Structured variables contribute their MEMBERS (dot-joined paths), not the
 * container itself — you bind leaves, not a struct root.
 */
export function parseXvmVariables(xml: string): XvmParseResult {
  const warnings: EngWarning[] = [];
  const elements: Record<string, number> = {};
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (error) {
    return {
      variables: [],
      warnings: [warn(WARNING_CODES.schneider.XVM_UNREADABLE, 'Unreadable XML: {error}', { error: (error as Error).message })],
      elements
    };
  }

  const variables: SchneiderVariable[] = [];

  const emit = (node: XmlNode, prefix: string): void => {
    const pool = fieldPool(node);
    const name = pick(pool, 'name');
    if (name === undefined) {
      return; // not a variable declaration (no recognisable name)
    }
    const path = prefix === '' ? name : `${prefix}.${name}`;
    const members = memberChildren(node);
    if (members.length > 0) {
      // Container: emit its members only.
      for (const member of members) emit(member, path);
      return;
    }
    const address = pick(pool, 'address') ?? '';
    if (address === '' && prefix !== '') {
      warnings.push(
        warn(
          WARNING_CODES.schneider.MEMBER_NO_ADDRESS,
          'Member "{path}" has no address of its own — derived layout not computed (declare a located address, or export the member).',
          { path }
        )
      );
      return;
    }
    variables.push({
      name: path,
      address,
      type: pick(pool, 'type') ?? '',
      comment: pick(pool, 'comment'),
      unit: pick(pool, 'unit')
    });
  };

  const walk = (node: XmlNode): void => {
    const tag = localName(node.tag).toLowerCase();
    elements[localName(node.tag)] = (elements[localName(node.tag)] ?? 0) + 1;
    if (VARIABLE_ELEMENTS.has(tag)) {
      emit(node, '');
      return; // members handled by emit()
    }
    for (const child of node.children) walk(child);
  };
  walk(root);

  if (variables.length === 0) {
    const seen = Object.entries(elements)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => `${tag}(${count})`)
      .join(', ');
    warnings.push(
      warn(
        WARNING_CODES.schneider.XVM_NOTHING_RECOGNISED,
        'No variable recognised in the XML export — the XVM schema is unverified. Elements seen: {elements}. Add the missing element/attribute to the aliases in schneider/xvm.ts.',
        { elements: seen || '(none)' }
      )
    );
  }
  return { variables, warnings, elements };
}

/** Input of {@link buildBookFromXvm}. */
export interface XvmBundle {
  bookId: string;
  name?: string;
  /** The XVM / XSY / XEF document. */
  xml: string;
  provenance?: Partial<BookProvenance>;
  /** The PLC's Modbus interface. */
  interface?: BookInterface;
}

/** Build an {@link AddressBook} from an XVM/XSY variables export. */
export function buildBookFromXvm(bundle: XvmBundle): AddressBook {
  const parsed = parseXvmVariables(bundle.xml);
  const resolved = entriesFromSchneiderVariables(parsed.variables);
  return {
    id: bundle.bookId,
    name: bundle.name ?? bundle.bookId,
    provenance: {
      kind: 'xvm',
      generatedAt: bundle.provenance?.generatedAt ?? new Date().toISOString(),
      ...bundle.provenance
    },
    interface: bundle.interface,
    entries: resolved.entries,
    types: [],
    warnings: [
      warn(
        WARNING_CODES.schneider.XVM_UNVERIFIED_SCHEMA,
        'XVM/XSY reader: schema not verified against a vendor export (none available) — check the entries before any check-in.'
      ),
      ...parsed.warnings,
      ...resolved.warnings
    ]
  };
}
