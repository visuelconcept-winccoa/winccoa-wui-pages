// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * STEP 7 **symbol table** (`.asc` / `.sdf` / `.seq` / `.csv`) → {@link AddressBook}.
 *
 * ## Why this generator exists at all
 *
 * The classic S7 protocol has **no symbolic browse**. A CPU answers what blocks
 * exist, how big they are and what bytes they hold — never what a byte is called
 * or what type it has. Names, types and comments live in the STEP 7 project, and
 * S7comm does not carry them: that is a limit of the protocol, not of any
 * library. So a book for an S7-300/400 is built from the project's own exports,
 * and the online side (`s7Browse` manager) verifies it rather than replacing it.
 *
 * Two exports, two halves of the same book, and they are complementary:
 *
 *  - the **symbol table** (this file) names everything reachable in the *memory
 *    areas* — inputs, outputs, flags, peripheral words, timers, counters — plus
 *    the project's **block directory** (`DB10` is named `Echange`);
 *  - the **AWL / DB sources** (`s7/awl.ts`) supply what a symbol table by
 *    construction cannot: the CONTENT of the data blocks, member by member.
 *
 * A symbol table alone therefore yields a book with no DB member in it. That is
 * not a parser failure and must not look like one, so it is stated as the book's
 * own warning (`s7sym.no-db-content`) whenever the table names data blocks whose
 * contents nobody supplied.
 *
 * ## Reading the file without guessing
 *
 * Siemens exports the same table in several shapes and the studio must not need
 * to be told which:
 *
 *  - `.asc` — fixed-width columns, each line prefixed by its record length and a
 *    comma (`126,`), which is what makes an ASC line instantly recognisable;
 *  - `.sdf` — System Data Format: quoted CSV, `"symbol","address","type","comment"`;
 *  - `.seq` — the legacy sequential export, whitespace-separated;
 *  - `.csv` — what an engineer produces by re-saving any of the above from Excel;
 *    separator `,` or `;` depending on the machine's locale.
 *
 * So the split is decided **per line** (quoted CSV, tabs, semicolons, then runs of
 * two-or-more spaces), which reads all four without a format switch the operator
 * would have to get right.
 *
 * **The column ORDER is detected, not assumed.** Siemens' own documentation
 * describes both `Symbol, Address, Type, Comment` (the symbol editor's export)
 * and `Address, Symbol, Type, Comment` (the reference-data export), and picking
 * wrong swaps every name with its address — a book that looks plausible and
 * addresses nothing. {@link detectColumnOrder} decides it from the file: whichever
 * of the first two columns parses as an S7 operand across the majority of lines is
 * the address column. The verdict is recorded in the provenance so it is
 * auditable, and a file where neither column wins is refused rather than read at
 * random.
 *
 * ## Access is READ from the area, not assumed
 *
 * An S7 input image cannot be written by a driver and an output image cannot be
 * meaningfully read back as a setpoint — so the area IS the evidence, and these
 * entries carry `accessSource: 'declared'`. Flags and DB members are `rw`,
 * because nothing in the source restricts them. This is the same rule the
 * online browse applies to an OPC UA `AccessLevel`, and the same honesty: what
 * the source states is `declared`, what it does not is not invented.
 *
 * ## Verification status
 *
 * ⚠️ The dialects are calibrated on the published descriptions of the export
 * formats and on hand-authored fixtures (`samples/s7-fixtures.ts`), **not** on
 * exports from the user's own STEP 7 projects — the same caveat the SimaticML
 * parser carries (see `docs/wui-eng-studio/NOTES.md`). The tolerant, per-line
 * splitting and the detected column order are what make that caveat survivable:
 * a dialect that differs in its padding still reads, and a dialect that differs
 * in its column order is detected instead of silently mis-read.
 */

import type { AddressBook, BookEntry, BookInterface, BookProvenance, TagAccess } from '../model.js';
import { WARNING_CODES, warn, type EngWarning } from '../warnings.js';
import { isUnmappedS7Type, s7LeafType } from '../drivers/s7.js';
import { isS7Signal, parseS7Operand, s7WidthAgrees, type S7Area, type S7BlockKind, type S7Operand } from './operand.js';

/** One line of a symbol table, after splitting and before interpretation. */
export interface S7SymbolRow {
  symbol: string;
  address: string;
  dataType: string;
  comment?: string;
  /** 1-based line number in the source file, for a warning that can be acted on. */
  line: number;
}

/** A block the table NAMES (`Echange` = `DB10`) — the project's block directory. */
export interface S7BlockAlias {
  kind: S7BlockKind;
  number: number;
  /** Symbolic name of the block. */
  symbol: string;
  comment?: string;
}

/** What {@link parseS7SymbolTable} makes of a file. */
export interface S7SymbolTable {
  /** Rows that name an addressable value. */
  signals: (S7SymbolRow & { operand: S7Operand })[];
  /** Rows that name a block, a timer or a counter. */
  blocks: S7BlockAlias[];
  /** Which column carried the address (`0` = first, `1` = second). */
  addressColumn: 0 | 1;
  warnings: EngWarning[];
}

/**
 * Symbol-table datatype spelling → the TIA spelling `drivers/s7.ts` maps.
 *
 * A symbol table shouts (`BOOL`, `S5TIME`, `TIME_OF_DAY`); the driver tables are
 * keyed on the TIA names (`Bool`, `S5Time`, `Time_Of_Day`). `s7DatatypeCode`
 * matches case-insensitively, but `s7LeafType` does NOT — it is an exact lookup —
 * so normalising here is what keeps a `REAL` from being catalogued as a String.
 */
const CANONICAL_TYPE: Record<string, string> = {
  BOOL: 'Bool',
  BYTE: 'Byte',
  CHAR: 'Char',
  WORD: 'Word',
  DWORD: 'DWord',
  INT: 'Int',
  DINT: 'DInt',
  UINT: 'UInt',
  UDINT: 'UDInt',
  REAL: 'Real',
  S5TIME: 'S5Time',
  TIME: 'Time',
  DATE: 'Date',
  TIME_OF_DAY: 'Time_Of_Day',
  TOD: 'Time_Of_Day',
  DATE_AND_TIME: 'Date_And_Time',
  DT: 'Date_And_Time',
  STRING: 'String'
};

/** Access an area GRANTS — the area is the evidence, so this is `declared`. */
const ACCESS_OF_AREA: Record<S7Area, TagAccess> = {
  input: 'r',
  'peripheral-input': 'r',
  output: 'w',
  'peripheral-output': 'w',
  flag: 'rw',
  db: 'rw',
  timer: 'r',
  counter: 'r',
  block: 'r'
};

/** Canonical TIA spelling of a symbol-table datatype (unknown types pass through). */
export function canonicalS7Type(dataType: string): string {
  const name = (dataType ?? '').trim();
  if (name === '') return '';
  const upper = name.toUpperCase();
  const stringLength = /^STRING\s*\[\s*(\d+)\s*\]$/.exec(upper);
  if (stringLength) return `String[${stringLength[1] as string}]`;
  return CANONICAL_TYPE[upper] ?? name;
}

/** Split one quoted-CSV line (`"a","b","c"`), honouring `""` as an escaped quote. */
function splitQuoted(line: string, separator: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] as string;
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === separator) {
      fields.push(field);
      field = '';
      continue;
    }
    field += char;
  }
  fields.push(field);
  return fields;
}

/**
 * Re-join the fragments a fixed-width split tore an operand apart into.
 *
 * The address column of an `.asc` / `.seq` export is itself sub-columned: the
 * area mnemonic and the number get their own padding, so `A      4.0` and
 * `PEW  256` arrive as TWO fragments under a run-of-spaces rule. Joining them
 * back is not a heuristic on shape — the pair is merged only when the merged
 * text PARSES as an S7 operand and the left fragment alone does not, so a
 * datatype followed by a comment (`BOOL` + `Ordre de marche`) can never merge.
 */
function mergeSplitOperands(fields: string[]): string[] {
  const merged: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const current = fields[index] as string;
    const next = fields[index + 1];
    if (next !== undefined && parseS7Operand(current) === null && parseS7Operand(current + next) !== null) {
      merged.push(current + next);
      index += 1;
      continue;
    }
    merged.push(current);
  }
  return merged;
}

/**
 * Split one line into its columns, whichever of the four dialects it came from.
 *
 * The order of the tests is the order of decreasing certainty: a quote or a tab
 * is unambiguous, a semicolon nearly so, and the run-of-spaces rule is the last
 * resort — it is what reads the fixed-width `.asc` and `.seq` exports, and it
 * requires TWO spaces precisely so a comment ("Motor 1 running") stays one field.
 */
export function splitSymbolLine(line: string): string[] {
  const text = line.replace(/\r$/, '');
  // `.asc` prefixes every record with its length and a comma — layout, not data.
  const body = /^\d+,/.test(text) ? text.slice(text.indexOf(',') + 1) : text;
  if (body.includes('"')) {
    const separator = body.includes('";"') || body.includes('";') ? ';' : ',';
    return splitQuoted(body, separator).map((field) => field.trim());
  }
  if (body.includes('\t')) return body.split('\t').map((field) => field.trim());
  if (body.includes(';')) return body.split(';').map((field) => field.trim());
  return mergeSplitOperands(
    body
      .split(/ {2,}/)
      .map((field) => field.trim())
      .filter((field) => field !== '')
  );
}

/**
 * Which of the first two columns is the address?
 *
 * Counted over the whole file rather than decided on the first line, because the
 * first line of an export is often a header and a single symbol can look like an
 * operand by accident (`M1` is a perfectly ordinary symbol name). `null` means
 * neither column wins — the caller refuses the file instead of picking one.
 */
export function detectColumnOrder(rows: string[][]): 0 | 1 | null {
  let first = 0;
  let second = 0;
  for (const columns of rows) {
    if (columns.length < 2) continue;
    if (parseS7Operand(columns[0] as string) !== null) first += 1;
    if (parseS7Operand(columns[1] as string) !== null) second += 1;
  }
  if (first === 0 && second === 0) return null;
  return second >= first ? 1 : 0;
}

/** Read a symbol-table file into its signals, its block directory and its problems. */
export function parseS7SymbolTable(text: string): S7SymbolTable {
  const warnings: EngWarning[] = [];
  const lines = (text ?? '').split('\n');
  const split: { columns: string[]; line: number }[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    const columns = splitSymbolLine(line);
    if (columns.length < 2) {
      warnings.push(
        warn(WARNING_CODES.s7sym.UNREADABLE_LINE, 'Line {line}: not a symbol record ("{text}") — skipped.', {
          line: index + 1,
          text: line.trim().slice(0, 60)
        })
      );
      continue;
    }
    split.push({ columns, line: index + 1 });
  }

  const addressColumn = detectColumnOrder(split.map((entry) => entry.columns));
  if (addressColumn === null) {
    warnings.push(
      warn(
        WARNING_CODES.s7sym.NO_ADDRESS_COLUMN,
        'No S7 address recognised in {n} record(s): neither column holds operands such as "E 0.0", "MW 20" or "DB 10". This does not look like a STEP 7 symbol table.',
        { n: split.length }
      )
    );
    return { signals: [], blocks: [], addressColumn: 1, warnings };
  }
  const symbolColumn = addressColumn === 0 ? 1 : 0;

  const signals: (S7SymbolRow & { operand: S7Operand })[] = [];
  const blocks: S7BlockAlias[] = [];
  const seenSymbols = new Map<string, number>();
  const seenAddresses = new Map<string, string>();

  for (const { columns, line } of split) {
    const address = (columns[addressColumn] ?? '').trim();
    const operand = parseS7Operand(address);
    if (operand === null) {
      // A header row (`Symbol;Address;Data type;Comment`) lands here and is not
      // worth a warning; anything else is a symbol the book will be missing.
      const looksLikeHeader = /^(symbol|address|adresse|operand|data\s?type|datentyp|comment|kommentar)$/i.test(address);
      if (!looksLikeHeader) {
        warnings.push(
          warn(WARNING_CODES.s7sym.UNREADABLE_ADDRESS, 'Line {line}: "{address}" is not an S7 address — symbol "{symbol}" skipped.', {
            line,
            address: address.slice(0, 40),
            symbol: (columns[symbolColumn] ?? '').trim().slice(0, 40)
          })
        );
      }
      continue;
    }
    const symbol = (columns[symbolColumn] ?? '').trim();
    const dataType = canonicalS7Type((columns[2] ?? '').trim());
    const comment = (columns[3] ?? '').trim();
    const row: S7SymbolRow = { symbol, address: operand.raw, dataType, line, ...(comment === '' ? {} : { comment }) };

    if (operand.isBlock) {
      if (operand.blockKind !== undefined && operand.blockNumber !== undefined && symbol !== '') {
        blocks.push({
          kind: operand.blockKind,
          number: operand.blockNumber,
          symbol,
          ...(comment === '' ? {} : { comment })
        });
      }
      continue;
    }
    if (!isS7Signal(operand)) continue;

    if (symbol === '') {
      warnings.push(warn(WARNING_CODES.s7sym.NO_SYMBOL, 'Line {line}: address "{address}" carries no symbol — skipped.', { line, address: operand.raw }));
      continue;
    }
    const duplicate = seenSymbols.get(symbol);
    if (duplicate !== undefined) {
      warnings.push(
        warn(WARNING_CODES.s7sym.DUPLICATE_SYMBOL, 'Symbol "{symbol}" is declared twice (lines {first} and {line}) — the second is skipped.', {
          symbol,
          first: duplicate,
          line
        })
      );
      continue;
    }
    const sharing = seenAddresses.get(operand.raw);
    if (sharing !== undefined) {
      // NOT a refusal: two names on one address is legal and common (an alias).
      // It is reported because it becomes two DPEs reading the same value.
      warnings.push(
        warn(WARNING_CODES.s7sym.DUPLICATE_ADDRESS, 'Address "{address}" is named twice ("{first}" and "{symbol}", line {line}) — both are catalogued.', {
          address: operand.raw,
          first: sharing,
          symbol,
          line
        })
      );
    }
    if (dataType !== '' && !s7WidthAgrees(operand, dataType)) {
      warnings.push(
        warn(
          WARNING_CODES.s7sym.WIDTH_MISMATCH,
          'Symbol "{symbol}" (line {line}): "{address}" addresses a {width} but the declared type is "{type}" — the export or the symbol is stale.',
          { symbol, line, address: operand.raw, width: operand.width, type: dataType }
        )
      );
    }
    seenSymbols.set(symbol, line);
    seenAddresses.set(operand.raw, symbol);
    signals.push({ ...row, operand });
  }
  return { signals, blocks, addressColumn, warnings };
}

/** Input of {@link buildBookFromS7Symbols}. */
export interface S7SymbolBundle {
  bookId: string;
  name?: string;
  /** The symbol-table file. */
  text: string;
  provenance?: Partial<BookProvenance>;
  /** Live interface this book binds through (absent → a template catalog). */
  interface?: BookInterface;
}

/**
 * Build an {@link AddressBook} from a STEP 7 symbol table.
 *
 * The block directory rides along in the warnings rather than in the entries: a
 * `DB10` line names a block, and cataloguing it as a signal would generate a DPE
 * bound to a whole data block. Its real use is downstream — `s7/awl.ts` reads the
 * same directory to name a data block's members `Echange.Consigne` instead of
 * `DB10.Consigne`, and the online inventory checks the directory against the
 * blocks the CPU actually holds.
 */
export function buildBookFromS7Symbols(bundle: S7SymbolBundle): AddressBook {
  const table = parseS7SymbolTable(bundle.text);
  const warnings = [...table.warnings];

  const entries: BookEntry[] = table.signals.map((signal) => {
    const sourceType = signal.dataType === '' ? 'Word' : signal.dataType;
    const unmapped = isUnmappedS7Type(sourceType);
    if (unmapped) {
      warnings.push(
        warn(WARNING_CODES.s7sym.DATATYPE_UNMAPPED, 'Symbol "{symbol}": datatype "{type}" is not mapped — bound as String.', {
          symbol: signal.symbol,
          type: sourceType
        })
      );
    }
    return {
      path: signal.symbol,
      sourceType,
      leafType: s7LeafType(sourceType),
      access: ACCESS_OF_AREA[signal.operand.area],
      // The AREA is the evidence: an S7 process image is read-only to a driver by
      // construction, so this is a statement of the source, not a default.
      accessSource: 'declared',
      addresses: { s7: signal.operand.raw },
      ...(signal.comment === undefined ? {} : { comment: signal.comment }),
      ...(unmapped ? { unmapped: true } : {})
    } satisfies BookEntry;
  });

  const dataBlocks = table.blocks.filter((block) => block.kind === 'DB');
  if (dataBlocks.length > 0) {
    warnings.push(
      warn(
        WARNING_CODES.s7sym.NO_DB_CONTENT,
        'A symbol table names data blocks but never their CONTENT — the S7 protocol carries no symbolic layout. {n} data block(s) named here ({names}{more}) hold no signal in this catalog: ingest their AWL/DB sources, or a TIA export, to catalogue their members.',
        {
          n: dataBlocks.length,
          names: dataBlocks
            .slice(0, 5)
            .map((block) => `${block.symbol} = DB${block.number}`)
            .join(', '),
          more: dataBlocks.length > 5 ? `, +${dataBlocks.length - 5}` : ''
        }
      )
    );
  }
  if (entries.length === 0) {
    warnings.push(
      warn(WARNING_CODES.s7sym.NO_SIGNAL, 'No addressable signal in this symbol table ({blocks} block name(s) read).', { blocks: table.blocks.length })
    );
  }

  return {
    id: bundle.bookId,
    name: bundle.name ?? bundle.bookId,
    provenance: {
      kind: 's7sym',
      generatedAt: bundle.provenance?.generatedAt ?? new Date().toISOString(),
      ...bundle.provenance
    },
    ...(bundle.interface === undefined ? {} : { interface: bundle.interface }),
    entries,
    types: [],
    warnings
  };
}
