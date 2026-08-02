// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SimaticML → AddressBook generator.
 *
 * Parses TIA Openness `Export()` XML of global DBs (`SW.Blocks.GlobalDB`) and
 * UDTs (`SW.Types.PlcStruct`) into {@link AddressBook} entries:
 *
 *  - every elementary member becomes a {@link BookEntry} with its symbolic
 *    path (`<DB>.<member…>`), the mapped WinCC OA leaf type, the comment,
 *    and its candidate addresses:
 *      · `s7plus` / `opcua`  → symbolic (`"DB"."member"…` / plain path) —
 *        always present;
 *      · `s7` (classic operand `DB<n>.DBX…`) → ONLY for `MemoryLayout=
 *        "Standard"` blocks, computed by {@link computeStandardOffsets};
 *  - a member whose datatype is a quoted UDT name (`"UDT_Moteur"`) is
 *    expanded from the UDT's members (the UDT must be part of the same
 *    bundle); the UDT itself is carried as a {@link BookType} (a DPT
 *    candidate for mutualisation);
 *  - arrays and unknown datatypes are skipped with a warning (v1 scope).
 *
 * The exact SimaticML dialect is calibrated on Openness exports; sample
 * fixtures live in `src/samples/simaticml/`. Real exports from the user's
 * TIA projects should be added there as they become available (pending
 * input — see docs/wui-eng-studio/README.md).
 */

import type { AddressBook, BookEntry, BookInterface, BookProvenance, BookType, OaLeafType } from '../model.js';
import { isUnmappedS7Type, s7LeafType, s7Operand } from '../drivers/s7.js';
import { computeStandardOffsets, type LayoutMember, type MemberOffset } from './offsets.js';
import { childrenOf, findAll, findFirst, localName, parseXml, type XmlNode } from './xml.js';

/** One parsed member (leaf, struct or UDT reference). */
interface ParsedMember {
  name: string;
  dataType: string;
  comment?: string;
  children: ParsedMember[];
  /** Bare UDT name when dataType is a quoted type reference. */
  udtRef?: string;
}

/** One parsed block (global DB) with its interface. */
export interface ParsedBlock {
  kind: 'db' | 'udt';
  name: string;
  number?: number;
  /** `Standard` (non-optimized) or `Optimized`; UDTs have no layout. */
  memoryLayout?: string;
  members: ParsedMember[];
}

/** Bare UDT name of a quoted datatype (`"UDT_Moteur"` → `UDT_Moteur`). */
function udtRefOf(dataType: string): string | undefined {
  const match = /^"(.+)"$/.exec(dataType.trim());
  return match ? match[1] : undefined;
}

/** True for `Array[…] of …` datatypes (v1: skipped with a warning). */
function isArrayType(dataType: string): boolean {
  return /^Array\b/i.test(dataType.trim());
}

/** Multi-language member comment: first non-empty text of the subtree. */
function commentOf(member: XmlNode): string | undefined {
  const comment = findFirst(member, 'Comment');
  if (!comment) return undefined;
  const texts = findAll(comment, 'MultiLanguageText');
  for (const t of texts) {
    if (t.text !== '') return t.text;
  }
  return comment.text === '' ? undefined : comment.text;
}

function parseMembers(container: XmlNode): ParsedMember[] {
  return childrenOf(container, 'Member').map((m) => {
    const dataType = m.attrs['Datatype'] ?? '';
    return {
      name: m.attrs['Name'] ?? '',
      dataType,
      comment: commentOf(m),
      udtRef: udtRefOf(dataType),
      children: parseMembers(m)
    } satisfies ParsedMember;
  });
}

/** Parse one SimaticML export document into its block/UDT description. */
export function parseSimaticMlDocument(xml: string): ParsedBlock {
  const root = parseXml(xml);
  const db = findFirst(root, 'SW.Blocks.GlobalDB');
  const udt = findFirst(root, 'SW.Types.PlcStruct');
  const node = db ?? udt;
  if (!node) {
    throw new Error('SimaticML: no SW.Blocks.GlobalDB or SW.Types.PlcStruct element found');
  }
  const attributeList = childrenOf(node, 'AttributeList')[0];
  const attr = (name: string): string | undefined => {
    if (!attributeList) return undefined;
    const hit = attributeList.children.find((c) => localName(c.tag) === name);
    return hit?.text;
  };
  // The interface section: AttributeList > Interface > Sections > Section[@Name="Static"|"None"]
  const iface = findFirst(node, 'Interface');
  const sections = iface ? findAll(iface, 'Section') : [];
  const section =
    sections.find((s) => s.attrs['Name'] === 'Static') ?? sections.find((s) => s.attrs['Name'] === 'None') ?? sections[0];
  const members = section ? parseMembers(section) : [];
  const numberText = attr('Number');
  return {
    kind: db ? 'db' : 'udt',
    name: attr('Name') ?? node.attrs['Name'] ?? '',
    number: numberText === undefined ? undefined : Number.parseInt(numberText, 10),
    memoryLayout: attr('MemoryLayout'),
    members
  };
}

/** Input of {@link buildBookFromSimaticMl}: the exported documents + context. */
export interface SimaticMlBundle {
  /** Stable book identity. */
  bookId: string;
  /** Human name for the produced book. */
  name?: string;
  /** XML documents (any mix of DB and UDT exports). */
  documents: { fileName: string; xml: string }[];
  provenance?: Partial<BookProvenance>;
  /** Live interface this book binds through (absent → a pure file catalog). */
  interface?: BookInterface;
}

/** Expand UDT references into concrete members (one level of indirection at a time). */
function expandUdtRefs(members: ParsedMember[], udts: Map<string, ParsedBlock>, warnings: string[], stack: string[]): ParsedMember[] {
  const out: ParsedMember[] = [];
  for (const member of members) {
    if (member.udtRef !== undefined) {
      const udt = udts.get(member.udtRef);
      if (!udt) {
        warnings.push(`Member "${member.name}": UDT "${member.udtRef}" is not part of the bundle — skipped.`);
        continue;
      }
      if (stack.includes(member.udtRef)) {
        warnings.push(`Member "${member.name}": recursive UDT "${member.udtRef}" — skipped.`);
        continue;
      }
      out.push({
        ...member,
        dataType: 'Struct',
        children: expandUdtRefs(udt.members, udts, warnings, [...stack, member.udtRef])
      });
      continue;
    }
    out.push({ ...member, children: expandUdtRefs(member.children, udts, warnings, stack) });
  }
  return out;
}

/** Flatten expanded members to leaf entries (path, type, comment, udt origin). */
function collectLeaves(
  members: ParsedMember[],
  prefix: string,
  udtOrigin: string | undefined,
  warnings: string[],
  out: { path: string; dataType: string; comment?: string; udtOrigin?: string }[]
): void {
  for (const member of members) {
    const path = prefix === '' ? member.name : `${prefix}.${member.name}`;
    if (isArrayType(member.dataType)) {
      warnings.push(`Member "${path}": array datatypes are not imported in v1 — skipped.`);
      continue;
    }
    if (member.dataType === 'Struct') {
      collectLeaves(member.children, path, udtOrigin ?? member.udtRef, warnings, out);
      continue;
    }
    out.push({ path, dataType: member.dataType, comment: member.comment, udtOrigin });
  }
}

/** Layout-member view of parsed members (for the standard-offset computer). */
function toLayoutMembers(members: ParsedMember[]): LayoutMember[] {
  return members.map((m) => ({
    name: m.name,
    dataType: m.dataType === 'Struct' || m.udtRef !== undefined ? 'Struct' : m.dataType,
    children: toLayoutMembers(m.children)
  }));
}

/**
 * Build an {@link AddressBook} from a bundle of SimaticML exports.
 * UDT documents feed the type catalog; DB documents produce the entries.
 */
export function buildBookFromSimaticMl(bundle: SimaticMlBundle): AddressBook {
  const warnings: string[] = [];
  const blocks: { block: ParsedBlock; fileName: string }[] = [];
  for (const document of bundle.documents) {
    try {
      blocks.push({ block: parseSimaticMlDocument(document.xml), fileName: document.fileName });
    } catch (error) {
      warnings.push(`${document.fileName}: ${(error as Error).message}`);
    }
  }

  const udts = new Map<string, ParsedBlock>();
  for (const { block } of blocks) {
    if (block.kind === 'udt') udts.set(block.name, block);
  }

  const types: BookType[] = [...udts.values()].map((udt) => {
    const leaves: { path: string; dataType: string; comment?: string }[] = [];
    collectLeaves(expandUdtRefs(udt.members, udts, warnings, [udt.name]), '', undefined, warnings, leaves);
    return {
      id: udt.name,
      name: udt.name,
      members: leaves.map((leaf) => ({
        path: leaf.path,
        sourceType: leaf.dataType,
        leafType: s7LeafType(leaf.dataType),
        comment: leaf.comment
      }))
    } satisfies BookType;
  });

  const entries: BookEntry[] = [];
  for (const { block } of blocks) {
    if (block.kind !== 'db') continue;
    const expanded = expandUdtRefs(block.members, udts, warnings, []);
    const leaves: { path: string; dataType: string; comment?: string; udtOrigin?: string }[] = [];
    collectLeaves(expanded, '', undefined, warnings, leaves);

    // Classic operands only exist for standard (non-optimized) blocks.
    const standard = (block.memoryLayout ?? '').toLowerCase() === 'standard';
    let offsets = new Map<string, MemberOffset>();
    if (standard) {
      if (block.number === undefined) {
        warnings.push(`DB "${block.name}": standard layout but no block number — classic operands skipped.`);
      } else {
        offsets = new Map(computeStandardOffsets(toLayoutMembers(expanded)).map((o) => [o.path, o]));
      }
    }

    for (const leaf of leaves) {
      const leafType: OaLeafType = s7LeafType(leaf.dataType);
      const unmapped = isUnmappedS7Type(leaf.dataType);
      if (unmapped) {
        warnings.push(`Member "${block.name}.${leaf.path}": datatype "${leaf.dataType}" is not mapped — bound as String.`);
      }
      const addresses: BookEntry['addresses'] = {
        s7plus: `"${block.name}".${leaf.path.split('.').map((s) => `"${s}"`).join('.')}`,
        opcua: `ns=3;s="${block.name}".${leaf.path.split('.').map((s) => `"${s}"`).join('.')}`
      };
      const offset = offsets.get(leaf.path);
      if (standard && block.number !== undefined && offset) {
        addresses.s7 = s7Operand(block.number, leaf.dataType, offset.byteOffset, offset.bitOffset ?? 0);
      }
      entries.push({
        path: `${block.name}.${leaf.path}`,
        sourceType: leaf.dataType,
        leafType,
        access: 'rw',
        addresses,
        comment: leaf.comment,
        typeId: leaf.udtOrigin,
        unmapped: unmapped || undefined
      });
    }
  }

  return {
    id: bundle.bookId,
    name: bundle.name ?? bundle.bookId,
    provenance: {
      kind: 'simaticml',
      generatedAt: bundle.provenance?.generatedAt ?? new Date().toISOString(),
      ...bundle.provenance
    },
    interface: bundle.interface,
    entries,
    types,
    warnings
  };
}
