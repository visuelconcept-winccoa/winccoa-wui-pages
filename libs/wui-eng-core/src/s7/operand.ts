// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Classic S7 **absolute operand** — reader and classifier.
 *
 * `drivers/s7.ts` BUILDS an operand from a DB number, a datatype and an offset
 * (the SimaticML path: the export states the layout, so the address is computed).
 * This module does the opposite, which is what a STEP 7 **symbol table** needs:
 * the file already contains the address, written the way an engineer writes it,
 * and the studio has to understand it — which area, which byte, which bit, how
 * wide — before it can call it a signal.
 *
 * Three facts about symbol tables decide the shape of this parser.
 *
 * **The mnemonics come in two languages.** A STEP 7 project is configured either
 * in German (`E`ingang / `A`usgang / `M`erker / `Z`aehler) or in English
 * (`I`nput / `Q` output / `M`emory / `C`ounter), and the export carries whichever
 * the project uses. Both are accepted and normalised to ONE area, because a book
 * generated from a German export must address exactly like one generated from an
 * English export of the same PLC.
 *
 * **The address column is padded.** The exports write `E      0.0`, `DB     10`,
 * `MW     20`: the column is fixed-width, so whitespace inside an address is
 * layout, never meaning. It is stripped before matching.
 *
 * **Half of a symbol table is not a signal at all.** `DB10`, `FB1`, `OB35`,
 * `UDT2` are BLOCK names, not addressable values — a symbol table is also the
 * project's block directory. They are parsed (`isBlock` says so) rather than
 * rejected, because that directory is worth keeping: it is what lets a book name
 * a data block `Echange` instead of `DB10` when the AWL source of that block is
 * ingested beside the table (see `s7/symbols.ts`).
 *
 * What this module deliberately does NOT do: decide the WinCC OA element type.
 * A symbol table states the datatype in its own column, and that statement wins
 * over anything inferable from the operand — `s7LeafType` (`drivers/s7.ts`) maps
 * it. The operand's own width is only used to CHECK the declared type, and a
 * disagreement is reported rather than silently resolved.
 */

/** Memory area an operand addresses, normalised across the two mnemonic sets. */
export type S7Area =
  | 'input'
  | 'output'
  | 'flag'
  | 'db'
  | 'peripheral-input'
  | 'peripheral-output'
  | 'timer'
  | 'counter'
  | 'block';

/** Access width of an operand — what the notation itself says. */
export type S7Width = 'bit' | 'byte' | 'word' | 'dword' | 'none';

/** Block kinds a symbol table may name (none of them is an addressable value). */
export type S7BlockKind = 'DB' | 'FB' | 'FC' | 'OB' | 'SFB' | 'SFC' | 'SDB' | 'UDT' | 'VAT';

/** A parsed absolute operand. */
export interface S7Operand {
  /** The operand as it will be written back (whitespace removed, upper-cased). */
  raw: string;
  area: S7Area;
  width: S7Width;
  /**
   * True when the operand names a BLOCK (`DB10`, `FB1`, `OB35`, `UDT2`, `T5`,
   * `Z3`) rather than an addressable value: a directory line, not a signal.
   */
  isBlock: boolean;
  /** Block kind, for the operands that name one. */
  blockKind?: S7BlockKind;
  /** Block / timer / counter number, for `isBlock` operands. */
  blockNumber?: number;
  /** Data block number, for a `db` area operand. */
  dbNumber?: number;
  /** Byte offset inside the area. */
  byteOffset?: number;
  /** Bit offset (0..7), only for `width: 'bit'`. */
  bitOffset?: number;
}

/** Area letter (either language) to the normalised area. */
const AREA_OF_LETTER: Record<string, S7Area> = {
  E: 'input',
  I: 'input',
  A: 'output',
  Q: 'output',
  M: 'flag'
};

/** Width letter of a byte/word/dword operand (`MB` / `MW` / `MD`). */
const WIDTH_OF_LETTER: Record<string, S7Width> = { B: 'byte', W: 'word', D: 'dword' };

/** Peripheral prefix (either language): `PE`/`PI` read, `PA`/`PQ` write. */
const PERIPHERAL_AREA: Record<string, S7Area> = {
  PE: 'peripheral-input',
  PI: 'peripheral-input',
  PA: 'peripheral-output',
  PQ: 'peripheral-output'
};

/** Longest prefix first: `SFB1` must not be read as `FB` with a leading `S`. */
const BLOCK_KINDS: S7BlockKind[] = ['SFB', 'SFC', 'SDB', 'UDT', 'VAT', 'DB', 'FB', 'FC', 'OB'];

/**
 * Access width a symbol-table datatype implies, or `undefined` when the type says
 * nothing about one (a `TIMER`, a `COUNTER`, a block reference, a `STRING` whose
 * length lives in the declaration rather than in the notation).
 */
export function s7DeclaredWidth(dataType: string): S7Width | undefined {
  const name = (dataType ?? '').trim().toUpperCase();
  if (name === 'BOOL') return 'bit';
  if (name === 'BYTE' || name === 'CHAR' || name === 'SINT' || name === 'USINT') return 'byte';
  if (name === 'WORD' || name === 'INT' || name === 'UINT' || name === 'S5TIME' || name === 'DATE') return 'word';
  if (
    name === 'DWORD' ||
    name === 'DINT' ||
    name === 'UDINT' ||
    name === 'REAL' ||
    name === 'TIME' ||
    name === 'TIME_OF_DAY' ||
    name === 'TOD'
  ) {
    return 'dword';
  }
  return undefined;
}

/** Strip the fixed-width padding an export writes inside an address column. */
function compact(text: string): string {
  return (text ?? '').replaceAll(/\s+/g, '').toUpperCase();
}

/**
 * Parse one absolute operand, or `null` when the text is not one.
 *
 * `null` is a REFUSAL, never a fallback: a symbol line the parser cannot read is
 * reported by its caller with the line's own text, because a symbol silently
 * dropped is a signal missing from the book with nothing to point at.
 */
export function parseS7Operand(text: string): S7Operand | null {
  const raw = compact(text);
  if (raw === '') return null;

  // DB member — `DB10.DBX4.2`, `DB10.DBW4`. The only operand with two numbers.
  const member = /^DB(\d+)\.DB([XBWD])(\d+)(?:\.([0-7]))?$/.exec(raw);
  if (member) {
    const widthLetter = member[2] as string;
    const width: S7Width = widthLetter === 'X' ? 'bit' : (WIDTH_OF_LETTER[widthLetter] as S7Width);
    // `DBX4` addresses no bit, and `DBW4.2` is not a notation: both are refusals
    // rather than a guessed bit 0, which would bind a DPE to the wrong value.
    if (width === 'bit' && member[4] === undefined) return null;
    if (width !== 'bit' && member[4] !== undefined) return null;
    return {
      raw,
      area: 'db',
      width,
      isBlock: false,
      dbNumber: Number.parseInt(member[1] as string, 10),
      byteOffset: Number.parseInt(member[3] as string, 10),
      ...(width === 'bit' ? { bitOffset: Number.parseInt(member[4] as string, 10) } : {})
    };
  }

  // Peripheral byte/word/dword — `PEW256`, `PIW256`, `PAB4`. Matched BEFORE the
  // plain areas, which would otherwise never see a `PE`/`PA` prefix.
  const peripheral = /^(PE|PI|PA|PQ)([BWD])(\d+)$/.exec(raw);
  if (peripheral) {
    return {
      raw,
      area: PERIPHERAL_AREA[peripheral[1] as string] as S7Area,
      width: WIDTH_OF_LETTER[peripheral[2] as string] as S7Width,
      isBlock: false,
      byteOffset: Number.parseInt(peripheral[3] as string, 10)
    };
  }

  // Bit of an input / output / flag — `E0.0`, `Q1.7`, `M10.3`.
  const bit = /^([EIAQM])(\d+)\.([0-7])$/.exec(raw);
  if (bit) {
    return {
      raw,
      area: AREA_OF_LETTER[bit[1] as string] as S7Area,
      width: 'bit',
      isBlock: false,
      byteOffset: Number.parseInt(bit[2] as string, 10),
      bitOffset: Number.parseInt(bit[3] as string, 10)
    };
  }

  // Byte / word / dword of an input, output or flag — `MW20`, `EB0`, `AD8`.
  const sized = /^([EIAQM])([BWD])(\d+)$/.exec(raw);
  if (sized) {
    return {
      raw,
      area: AREA_OF_LETTER[sized[1] as string] as S7Area,
      width: WIDTH_OF_LETTER[sized[2] as string] as S7Width,
      isBlock: false,
      byteOffset: Number.parseInt(sized[3] as string, 10)
    };
  }

  // Timer / counter — addressable, but not as a memory width.
  const timer = /^T(\d+)$/.exec(raw);
  if (timer) {
    return { raw, area: 'timer', width: 'none', isBlock: true, blockNumber: Number.parseInt(timer[1] as string, 10) };
  }
  const counter = /^[ZC](\d+)$/.exec(raw);
  if (counter) {
    return { raw, area: 'counter', width: 'none', isBlock: true, blockNumber: Number.parseInt(counter[1] as string, 10) };
  }

  for (const kind of BLOCK_KINDS) {
    const match = new RegExp(String.raw`^${kind}(\d+)$`).exec(raw);
    if (match) {
      return {
        raw,
        area: 'block',
        width: 'none',
        isBlock: true,
        blockKind: kind,
        blockNumber: Number.parseInt(match[1] as string, 10)
      };
    }
  }
  return null;
}

/**
 * Does the declared datatype CONTRADICT the width the notation carries?
 *
 * `false` is a real defect: `MW20 : BOOL` addresses a word and calls it a bit, so
 * either the export is stale or the symbol is wrong, and the generated DPE would
 * read 16 bits into a boolean. `true` is also returned when nothing can be
 * compared (a `TIMER`, a block reference): this answers "is there a
 * CONTRADICTION", not "is there a match".
 */
export function s7WidthAgrees(operand: S7Operand, dataType: string): boolean {
  const declared = s7DeclaredWidth(dataType);
  if (declared === undefined || operand.width === 'none') return true;
  return declared === operand.width;
}

/**
 * Is this operand readable by the WinCC OA S7 driver as a plain value?
 *
 * Timers, counters and block names are excluded: they are directory entries, and
 * a book that catalogued `DB10` as a signal would generate a DPE bound to a whole
 * data block.
 */
export function isS7Signal(operand: S7Operand): boolean {
  return !operand.isBlock && operand.width !== 'none';
}
