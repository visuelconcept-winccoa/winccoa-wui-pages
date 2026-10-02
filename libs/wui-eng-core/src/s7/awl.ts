// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * STEP 7 **AWL / STL sources** (`DATA_BLOCK` / `TYPE`) → {@link AddressBook}.
 *
 * The other half of the classic-S7 story. A symbol table (`s7/symbols.ts`) names
 * the memory areas and the blocks; it cannot describe what is INSIDE a data
 * block, and neither can the protocol — the CPU hands out bytes, never a layout.
 * The layout is in the STEP 7 project, and the way to get it out is
 * *Sources → Generate source* on the blocks, which writes the AWL text this
 * module reads:
 *
 * ```
 * DATA_BLOCK DB 10
 * TITLE = Echange
 * VERSION : 0.1
 *   STRUCT
 *    Consigne_Vitesse : REAL ;   //Consigne de vitesse
 *    Marche : BOOL ;             //Ordre de marche
 *    Moteur : "UDT_Moteur";
 *   END_STRUCT ;
 * BEGIN
 *    Consigne_Vitesse := 0.000000e+000;
 * END_DATA_BLOCK
 * ```
 *
 * ## What is read, and what is deliberately ignored
 *
 * Only the **declaration** part matters: the `STRUCT … END_STRUCT` interface of a
 * `DATA_BLOCK`, and the same for a `TYPE` (a UDT). Everything from `BEGIN` to
 * `END_DATA_BLOCK` is the block's *initial values* — engineering data, not a
 * layout — and is skipped. A DB declared **from** a UDT or an FB
 * (`DATA_BLOCK DB 12 "UDT_Moteur"` / `DB 13 FB 1`) has no `STRUCT` of its own;
 * its members come from the referenced type, which must be part of the same
 * ingestion, exactly like the SimaticML generator's UDT rule.
 *
 * ## The offsets are computed, not read
 *
 * An AWL source states the ORDER of the members and nothing about their address.
 * The classic S7 layout turns that order into byte offsets — BOOL bit-packing,
 * word alignment, `STRING[n]` = n + 2 bytes, struct padding — and that computation
 * already exists, unit-tested, in `simaticml/offsets.ts`. It is reused verbatim
 * rather than reimplemented: two implementations of the same layout rule would
 * drift, and a drift here moves every address of a data block by a byte.
 *
 * That reuse is also why this generator only ever produces **classic operands**
 * (`DB10.DBD4`): the layout it computes is the standard, non-optimized one. An
 * S7-300/400 has no other, so nothing is lost; an S7-1200/1500 block declared
 * "optimized" has no byte offsets at all and is addressed symbolically through
 * the S7Plus driver instead (`s7plus/browse.ts`).
 *
 * ## Names come from the symbol table when it is there
 *
 * A DB is `DB10` on the wire and `Echange` in the project. Given the block
 * directory of a symbol table ({@link S7BlockAlias}), the entries are pathed
 * `Echange.Consigne_Vitesse`; without it, `DB10.Consigne_Vitesse`. The address is
 * identical either way — only the DPE names the model generates change, and the
 * readable one is worth having.
 *
 * ## Verification status
 *
 * ⚠️ Calibrated on the published AWL source syntax and on hand-authored fixtures
 * (`samples/s7-fixtures.ts`), **not** on sources exported from the user's own
 * STEP 7 projects — the same caveat the SimaticML parser carries. The parser is
 * deliberately tolerant (case-insensitive keywords, optional spaces around
 * `DB 10` / `DB10`, `//` and `(* *)` comments) and reports every declaration it
 * cannot read with its line, rather than skipping it quietly.
 */

import type { AddressBook, BookEntry, BookInterface, BookProvenance, BookType } from '../model.js';
import { WARNING_CODES, warn, type EngWarning } from '../warnings.js';
import { isUnmappedS7Type, s7LeafType, s7Operand } from '../drivers/s7.js';
import { computeStandardOffsets, type LayoutMember, type MemberOffset } from '../simaticml/offsets.js';
import { canonicalS7Type } from './symbols.js';
import type { S7BlockAlias } from './symbols.js';

/** One declared member of a block interface (a leaf, a nested struct or a UDT ref). */
export interface AwlMember {
  name: string;
  /** Datatype as declared, canonicalised to the TIA spelling (`REAL` → `Real`). */
  dataType: string;
  comment?: string;
  children: AwlMember[];
  /** Bare UDT name when the datatype is a quoted type reference (`"UDT_Moteur"`). */
  udtRef?: string;
}

/** One block parsed out of an AWL source file. */
export interface AwlBlock {
  kind: 'db' | 'udt';
  /** Symbolic name when the source declares one (`DATA_BLOCK "Echange"`). */
  name?: string;
  /** Block number (`DATA_BLOCK DB 10`); absent for a UDT declared by name only. */
  number?: number;
  /** UDT/FB the DB is an instance of, when it declares no `STRUCT` of its own. */
  ofType?: string;
  members: AwlMember[];
  /** 1-based line the declaration starts on, for actionable warnings. */
  line: number;
}

/** Strip AWL comments, keeping the trailing `//` one (it is the member comment). */
function stripBlockComments(text: string): string {
  return text.replaceAll(/\(\*[\S\s]*?\*\)/g, ' ');
}

/** Bare name of a quoted identifier (`"UDT_Moteur"` → `UDT_Moteur`). */
function unquote(text: string): string | undefined {
  const match = /^"(.+)"$/.exec(text.trim());
  return match ? (match[1] as string) : undefined;
}

/** True for `ARRAY [1..10] OF …` declarations (skipped, like the SimaticML v1 rule). */
function isArrayType(dataType: string): boolean {
  return /^array\b/i.test(dataType.trim());
}

/**
 * Parse the member declarations between `STRUCT` and its matching `END_STRUCT`.
 *
 * Written as an explicit cursor rather than a regex sweep because STRUCTs nest,
 * and the nesting is what carries the padding rules the offset computer applies.
 */
function parseMembers(lines: { text: string; line: number }[], start: number, warnings: EngWarning[]): { members: AwlMember[]; next: number } {
  const members: AwlMember[] = [];
  let index = start;
  while (index < lines.length) {
    const entry = lines[index] as { text: string; line: number };
    const text = entry.text.trim();
    index += 1;
    if (text === '') continue;
    if (/^end_struct\s*;?$/i.test(text)) return { members, next: index };
    if (/^(begin|end_data_block|end_type)\b/i.test(text)) return { members, next: index - 1 };

    // `Name : Type ;   //comment`, `Name : Type := init ;`, `Name : STRUCT`
    const declaration = /^([A-Za-z_][\w$]*)\s*:\s*([^;]*?)\s*(?:;|$)\s*(?:\/\/(.*))?$/.exec(text);
    if (!declaration) {
      warnings.push(
        warn(WARNING_CODES.s7awl.UNREADABLE_DECLARATION, 'Line {line}: declaration not understood ("{text}") — skipped.', {
          line: entry.line,
          text: text.slice(0, 60)
        })
      );
      continue;
    }
    const name = declaration[1] as string;
    const comment = (declaration[3] ?? '').trim();
    // Drop the initial value: `REAL := 0.000000e+000` declares a REAL.
    const declaredType = (declaration[2] as string).split(':=')[0]?.trim() ?? '';

    if (/^struct$/i.test(declaredType)) {
      const nested = parseMembers(lines, index, warnings);
      index = nested.next;
      members.push({ name, dataType: 'Struct', children: nested.members, ...(comment === '' ? {} : { comment }) });
      continue;
    }
    const udtRef = unquote(declaredType);
    members.push({
      name,
      dataType: udtRef === undefined ? canonicalS7Type(declaredType) : 'Struct',
      children: [],
      ...(udtRef === undefined ? {} : { udtRef }),
      ...(comment === '' ? {} : { comment })
    });
  }
  return { members, next: index };
}

/**
 * Parse an AWL source file into the blocks it declares.
 *
 * One file may hold several blocks — *Generate source* on a whole program writes
 * every UDT and DB into one `.awl`, which is precisely the convenient case, so a
 * single file is enough to build a complete book.
 */
export function parseAwlSource(text: string): { blocks: AwlBlock[]; warnings: EngWarning[] } {
  const warnings: EngWarning[] = [];
  const blocks: AwlBlock[] = [];
  const lines = stripBlockComments(text ?? '')
    .split('\n')
    .map((line, index) => ({ text: line.replace(/\r$/, ''), line: index + 1 }));

  let index = 0;
  while (index < lines.length) {
    const entry = lines[index] as { text: string; line: number };
    const text_ = entry.text.trim();
    index += 1;
    if (text_ === '') continue;

    // `DATA_BLOCK DB 10`, `DATA_BLOCK "Echange"`, `DATA_BLOCK DB10 "UDT_Moteur"`
    const dataBlock = /^data_block\s+(.*)$/i.exec(text_);
    const typeBlock = /^type\s+(.*)$/i.exec(text_);
    if (!dataBlock && !typeBlock) continue;

    const head = ((dataBlock ?? typeBlock) as RegExpExecArray)[1] as string;
    const numberMatch = /\bDB\s*(\d+)\b/i.exec(head);
    const udtNumberMatch = /\bUDT\s*(\d+)\b/i.exec(head);
    const quoted = [...head.matchAll(/"([^"]+)"/g)].map((match) => match[1] as string);

    // Which quoted name is WHOSE. The header is ambiguous unless the numeric
    // token is taken into account, and reading it wrong is not cosmetic: it
    // pathed an instance block's entries under the UDT it instantiates.
    //   DATA_BLOCK "Echange"                 -> the block's own name
    //   DATA_BLOCK DB 10                     -> no name, number only
    //   DATA_BLOCK DB 12 "UDT_Moteur"        -> a TYPE, not a name
    //   DATA_BLOCK "Moteur_1" "UDT_Moteur"   -> name, then type
    const declaredType = quoted.length > 1 ? quoted[1] : (numberMatch && dataBlock ? quoted[0] : undefined);
    // The first quoted name is the block's own UNLESS it was consumed as the type.
    const blockName = quoted.length > 1 || declaredType === undefined ? quoted[0] : undefined;

    const block: AwlBlock = {
      kind: dataBlock ? 'db' : 'udt',
      line: entry.line,
      members: [],
      ...(blockName === undefined ? {} : { name: blockName }),
      ...(numberMatch && dataBlock ? { number: Number.parseInt(numberMatch[1] as string, 10) } : {}),
      ...(udtNumberMatch && !dataBlock ? { number: Number.parseInt(udtNumberMatch[1] as string, 10) } : {})
    };

    // Walk to the interface: `STRUCT` opens one, `BEGIN` means there is none —
    // an instance DB, whose members come from the type it was declared from.
    while (index < lines.length) {
      const inner = (lines[index] as { text: string; line: number }).text.trim();
      if (/^struct\b/i.test(inner)) {
        index += 1;
        const parsed = parseMembers(lines, index, warnings);
        block.members = parsed.members;
        index = parsed.next;
        break;
      }
      if (/^(begin|end_data_block|end_type)\b/i.test(inner)) {
        if (declaredType !== undefined) block.ofType = declaredType;
        break;
      }
      if (/^(data_block|type)\b/i.test(inner)) break;
      index += 1;
    }
    blocks.push(block);
  }
  if (blocks.length === 0) {
    warnings.push(
      warn(WARNING_CODES.s7awl.NO_BLOCK, 'No DATA_BLOCK or TYPE declaration found — this does not look like a STEP 7 AWL/STL source.')
    );
  }
  return { blocks, warnings };
}

/** Expand UDT references into concrete members (one indirection at a time). */
function expandUdtRefs(members: AwlMember[], udts: Map<string, AwlBlock>, warnings: EngWarning[], stack: string[]): AwlMember[] {
  const out: AwlMember[] = [];
  for (const member of members) {
    if (member.udtRef !== undefined) {
      const udt = udts.get(member.udtRef);
      if (!udt) {
        warnings.push(
          warn(WARNING_CODES.s7awl.UDT_MISSING, 'Member "{member}": UDT "{udt}" is not part of the ingested sources — skipped.', {
            member: member.name,
            udt: member.udtRef
          })
        );
        continue;
      }
      if (stack.includes(member.udtRef)) {
        warnings.push(warn(WARNING_CODES.s7awl.UDT_RECURSIVE, 'Member "{member}": recursive UDT "{udt}" — skipped.', { member: member.name, udt: member.udtRef }));
        continue;
      }
      out.push({ ...member, dataType: 'Struct', children: expandUdtRefs(udt.members, udts, warnings, [...stack, member.udtRef]) });
      continue;
    }
    out.push({ ...member, children: expandUdtRefs(member.children, udts, warnings, stack) });
  }
  return out;
}

/** Flatten expanded members to leaves (path, type, comment, UDT origin). */
function collectLeaves(
  members: AwlMember[],
  prefix: string,
  udtOrigin: string | undefined,
  warnings: EngWarning[],
  out: { path: string; dataType: string; comment?: string; udtOrigin?: string }[]
): void {
  for (const member of members) {
    const path = prefix === '' ? member.name : `${prefix}.${member.name}`;
    if (isArrayType(member.dataType)) {
      warnings.push(warn(WARNING_CODES.s7awl.ARRAY_SKIPPED, 'Member "{path}": array datatypes are not imported — skipped.', { path }));
      continue;
    }
    if (member.dataType === 'Struct') {
      collectLeaves(member.children, path, udtOrigin ?? member.udtRef, warnings, out);
      continue;
    }
    out.push({ path, dataType: member.dataType, ...(member.comment === undefined ? {} : { comment: member.comment }), ...(udtOrigin === undefined ? {} : { udtOrigin }) });
  }
}

/** Layout-member view of the parsed members, for the standard-offset computer. */
function toLayoutMembers(members: AwlMember[]): LayoutMember[] {
  return members.map((member) => ({
    name: member.name,
    dataType: member.dataType === 'Struct' || member.udtRef !== undefined ? 'Struct' : member.dataType,
    children: toLayoutMembers(member.children)
  }));
}

/** Input of {@link buildBookFromAwlSources}. */
export interface AwlBundle {
  bookId: string;
  name?: string;
  /** The AWL/STL source documents (any mix of DB and UDT declarations). */
  documents: { fileName: string; text: string }[];
  /**
   * Block directory of a symbol table ingested beside these sources, so a data
   * block is pathed by its project name rather than by its number.
   */
  blockNames?: S7BlockAlias[];
  provenance?: Partial<BookProvenance>;
  interface?: BookInterface;
}

/** Build an {@link AddressBook} from STEP 7 AWL/STL sources. */
export function buildBookFromAwlSources(bundle: AwlBundle): AddressBook {
  const warnings: EngWarning[] = [];
  const blocks: AwlBlock[] = [];
  for (const document of bundle.documents) {
    const parsed = parseAwlSource(document.text);
    warnings.push(
      ...parsed.warnings.map((warning) =>
        warning.code === WARNING_CODES.s7awl.NO_BLOCK
          ? warn(WARNING_CODES.s7awl.NO_BLOCK_IN_FILE, '{file}: no DATA_BLOCK or TYPE declaration found.', { file: document.fileName })
          : warning
      )
    );
    blocks.push(...parsed.blocks);
  }

  // UDTs are keyed by every name they can be referenced under: a member says
  // `"UDT_Moteur"` when the source declares `TYPE "UDT_Moteur"`, but a source
  // generated by number says `TYPE UDT 5` and members reference `UDT5`.
  const udts = new Map<string, AwlBlock>();
  for (const block of blocks) {
    if (block.kind !== 'udt') continue;
    if (block.name !== undefined) udts.set(block.name, block);
    if (block.number !== undefined) udts.set(`UDT${block.number}`, block);
  }

  const types: BookType[] = [...new Set(udts.values())].map((udt) => {
    const leaves: { path: string; dataType: string; comment?: string }[] = [];
    collectLeaves(expandUdtRefs(udt.members, udts, warnings, [udt.name ?? `UDT${udt.number ?? 0}`]), '', undefined, warnings, leaves);
    const id = udt.name ?? `UDT${udt.number ?? 0}`;
    return {
      id,
      name: id,
      members: leaves.map((leaf) => ({
        path: leaf.path,
        sourceType: leaf.dataType,
        leafType: s7LeafType(leaf.dataType),
        ...(leaf.comment === undefined ? {} : { comment: leaf.comment })
      }))
    } satisfies BookType;
  });

  const nameOfDb = new Map<number, string>();
  for (const alias of bundle.blockNames ?? []) {
    if (alias.kind === 'DB') nameOfDb.set(alias.number, alias.symbol);
  }

  const entries: BookEntry[] = [];
  for (const block of blocks) {
    if (block.kind !== 'db') continue;
    // An instance DB carries no interface of its own: take the referenced type's.
    let members = block.members;
    if (members.length === 0 && block.ofType !== undefined) {
      const source = udts.get(block.ofType);
      if (!source) {
        warnings.push(
          warn(WARNING_CODES.s7awl.INSTANCE_TYPE_MISSING, 'DB{number}: declared from "{type}", which is not part of the ingested sources — no signal catalogued.', {
            number: block.number ?? 0,
            type: block.ofType
          })
        );
        continue;
      }
      members = source.members;
    }
    if (members.length === 0) {
      warnings.push(warn(WARNING_CODES.s7awl.EMPTY_BLOCK, 'DB{number} (line {line}) declares no member — skipped.', { number: block.number ?? 0, line: block.line }));
      continue;
    }
    if (block.number === undefined) {
      warnings.push(
        warn(WARNING_CODES.s7awl.NO_BLOCK_NUMBER, 'Data block "{name}" (line {line}) carries no block number — its members cannot be addressed, so it is skipped.', {
          name: block.name ?? '?',
          line: block.line
        })
      );
      continue;
    }

    const expanded = expandUdtRefs(members, udts, warnings, []);
    const leaves: { path: string; dataType: string; comment?: string; udtOrigin?: string }[] = [];
    collectLeaves(expanded, '', undefined, warnings, leaves);
    const offsets = new Map<string, MemberOffset>(computeStandardOffsets(toLayoutMembers(expanded)).map((offset) => [offset.path, offset]));
    // The project name wins over the source's own, and both over the number.
    const blockLabel = nameOfDb.get(block.number) ?? block.name ?? `DB${block.number}`;

    for (const leaf of leaves) {
      const unmapped = isUnmappedS7Type(leaf.dataType);
      if (unmapped) {
        warnings.push(
          warn(WARNING_CODES.s7awl.DATATYPE_UNMAPPED, 'Member "{path}": datatype "{type}" is not mapped — bound as String.', {
            path: `${blockLabel}.${leaf.path}`,
            type: leaf.dataType
          })
        );
      }
      const offset = offsets.get(leaf.path);
      if (offset === undefined) {
        warnings.push(
          warn(WARNING_CODES.s7awl.NO_OFFSET, 'Member "{path}": no byte offset could be computed — catalogued without an address.', {
            path: `${blockLabel}.${leaf.path}`
          })
        );
      }
      entries.push({
        path: `${blockLabel}.${leaf.path}`,
        sourceType: leaf.dataType,
        leafType: s7LeafType(leaf.dataType),
        // Nothing in an AWL source restricts a data block's members, and the S7
        // driver reads and writes them alike: `rw` is what the source states.
        access: 'rw',
        accessSource: 'declared',
        addresses: offset === undefined ? {} : { s7: s7Operand(block.number, leaf.dataType, offset.byteOffset, offset.bitOffset ?? 0) },
        ...(leaf.comment === undefined ? {} : { comment: leaf.comment }),
        ...(leaf.udtOrigin === undefined ? {} : { typeId: leaf.udtOrigin }),
        ...(unmapped ? { unmapped: true } : {})
      });
    }
  }

  warnings.push(
    warn(
      WARNING_CODES.s7awl.STANDARD_LAYOUT,
      'Addresses are computed for the STANDARD (non-optimized) block layout — the only one an S7-300/400 has. If a block was compiled "optimized" (S7-1200/1500), it has no byte offsets and these addresses do not apply: browse it through the S7Plus driver instead.'
    )
  );

  return {
    id: bundle.bookId,
    name: bundle.name ?? bundle.bookId,
    provenance: {
      kind: 's7awl',
      generatedAt: bundle.provenance?.generatedAt ?? new Date().toISOString(),
      ...bundle.provenance
    },
    ...(bundle.interface === undefined ? {} : { interface: bundle.interface }),
    entries,
    types,
    warnings
  };
}
