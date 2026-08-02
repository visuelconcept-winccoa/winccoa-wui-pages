// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Schneider address-book generator — from a **Control Expert / Unity Pro
 * variables export** (data editor → Export, or a copy-paste to a spreadsheet).
 *
 * Why a FILE generator rather than an online browse: standard Modbus has no
 * discovery, and Schneider's symbolic browse rides on **UMAS**, the proprietary
 * extension of Modbus on reserved function code **90 (0x5A)** used by Control
 * Expert. UMAS is undocumented by the vendor (publicly described only through
 * reverse engineering, with published vulnerabilities), so it is NOT the default
 * path here — see docs/wui-eng-studio/NOTES.md. The variables export gives the
 * same symbols, offline, with no proprietary traffic on the OT network.
 *
 * The parser is intentionally FORMAT-TOLERANT (delimiter and column order are
 * detected) because the export column set varies with the Control Expert version
 * and locale: it recognises name / address / type / comment / unit headers in
 * English and French, and falls back to positional columns with a warning.
 *
 * Engineering rules applied (verified — see `address.ts`):
 *  - a variable with NO address is **unlocated** → not reachable over Modbus:
 *    it is reported as a warning and kept out of the entries;
 *  - overlapping registers (e.g. a DINT at `%MW100` and an INT at `%MW101`) are
 *    reported — a classic cause of "the value moves on its own".
 */

import type { AddressBook, BookEntry, BookInterface, BookProvenance, OaLeafType } from '../model.js';
import { occupiedRegisters, parseSchneiderAddress } from './address.js';

/** Schneider/IEC-61131 elementary type → WinCC OA element type + register span. */
const TYPE_MAP: Record<string, { leaf: OaLeafType; span: number }> = {
  BOOL: { leaf: 'Bool', span: 1 },
  EBOOL: { leaf: 'Bool', span: 1 },
  BYTE: { leaf: 'UInt', span: 1 },
  INT: { leaf: 'Int', span: 1 },
  UINT: { leaf: 'UInt', span: 1 },
  WORD: { leaf: 'UInt', span: 1 },
  DINT: { leaf: 'Int', span: 2 },
  UDINT: { leaf: 'UInt', span: 2 },
  DWORD: { leaf: 'Bit32', span: 2 },
  REAL: { leaf: 'Float', span: 2 },
  STRING: { leaf: 'String', span: 1 },
  DATE: { leaf: 'Time', span: 2 },
  TOD: { leaf: 'Time', span: 2 },
  DT: { leaf: 'Time', span: 4 },
  // Schneider TIME is a DURATION in ms (not a timestamp) → unsigned, 2 words.
  TIME: { leaf: 'UInt', span: 2 }
};

/** Map a Control Expert type name to the WinCC OA element type. */
export function schneiderLeafType(type: string): OaLeafType {
  return TYPE_MAP[normalizeType(type)]?.leaf ?? 'String';
}

/** Register span of a Control Expert type (words). */
export function schneiderTypeSpan(type: string): number {
  return TYPE_MAP[normalizeType(type)]?.span ?? 1;
}

/** True when the type has no verified mapping (derived/FB/unknown type). */
export function isUnmappedSchneiderType(type: string): boolean {
  return !(normalizeType(type) in TYPE_MAP);
}

/** `STRING[16]` → `STRING`, `ARRAY[0..9] OF INT` → `ARRAY`, trimmed upper-case. */
function normalizeType(type: string): string {
  const text = type.trim().toUpperCase();
  const head = /^([A-Z_]+)/.exec(text)?.[1] ?? text;
  return head;
}

/** One parsed row of the export. */
interface VariableRow {
  name: string;
  address: string;
  type: string;
  comment?: string;
  unit?: string;
}

/** Recognised header aliases (EN + FR), lower-case. */
const HEADERS: Record<keyof VariableRow, string[]> = {
  name: ['name', 'nom', 'variable', 'symbol', 'symbole'],
  address: ['address', 'adresse', 'addr', 'topological address', '@'],
  type: ['type', 'datatype', 'data type', 'type de données'],
  comment: ['comment', 'commentaire', 'description'],
  unit: ['unit', 'unité', 'unite', 'eu']
};

/** Detect the delimiter of a text export (tab, semicolon or comma). */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const counts: [string, number][] = [
    ['\t', (line.match(/\t/g) ?? []).length],
    [';', (line.match(/;/g) ?? []).length],
    [',', (line.match(/,/g) ?? []).length]
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : '\t';
}

/** Map header cells to row fields; null when no header is recognised. */
function mapHeader(cells: string[]): Partial<Record<keyof VariableRow, number>> | null {
  const found: Partial<Record<keyof VariableRow, number>> = {};
  for (const [index, cell] of cells.entries()) {
    const needle = cell.trim().toLowerCase().replaceAll(/^"|"$/g, '');
    for (const [field, aliases] of Object.entries(HEADERS) as [keyof VariableRow, string[]][]) {
      if (found[field] === undefined && aliases.includes(needle)) {
        found[field] = index;
      }
    }
  }
  return found.name !== undefined && found.address !== undefined ? found : null;
}

function cellsOf(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((c) => c.trim().replaceAll(/^"|"$/g, ''));
}

/** Input of {@link buildBookFromSchneiderExport}. */
export interface SchneiderExportBundle {
  bookId: string;
  name?: string;
  /** The exported variables text (CSV/TSV from the Control Expert data editor). */
  text: string;
  provenance?: Partial<BookProvenance>;
  /** The PLC's Modbus interface (a project book normally has one). */
  interface?: BookInterface;
}

/**
 * Build an {@link AddressBook} from a Control Expert variables export.
 * Unlocated variables and register overlaps are reported as warnings.
 */
export function buildBookFromSchneiderExport(bundle: SchneiderExportBundle): AddressBook {
  const warnings: string[] = [];
  const delimiter = detectDelimiter(bundle.text);
  const lines = bundle.text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const rows: VariableRow[] = [];

  const header = lines.length > 0 ? mapHeader(cellsOf(lines[0], delimiter)) : null;
  if (!header) {
    warnings.push('Aucun en-tête reconnu — colonnes supposées dans l’ordre : nom, adresse, type, commentaire.');
  }
  for (const line of lines.slice(header ? 1 : 0)) {
    const cells = cellsOf(line, delimiter);
    const row: VariableRow = header
      ? {
          name: cells[header.name as number] ?? '',
          address: cells[header.address as number] ?? '',
          type: header.type === undefined ? '' : cells[header.type] ?? '',
          comment: header.comment === undefined ? undefined : cells[header.comment] || undefined,
          unit: header.unit === undefined ? undefined : cells[header.unit] || undefined
        }
      : { name: cells[0] ?? '', address: cells[1] ?? '', type: cells[2] ?? '', comment: cells[3] || undefined };
    if (row.name !== '') {
      rows.push(row);
    }
  }

  const entries: BookEntry[] = [];
  /** register index → first variable name occupying it (overlap detection). */
  const owner = new Map<number, string>();

  for (const row of rows) {
    const address = parseSchneiderAddress(row.address);
    if (!address) {
      warnings.push(`Variable « ${row.name} » non localisée (aucune adresse) — invisible pour un client Modbus.`);
      continue;
    }
    if (address.reference == null) {
      warnings.push(`Variable « ${row.name} » (${address.raw}) : ${address.note ?? 'non adressable en Modbus'}.`);
      continue;
    }
    const unmapped = isUnmappedSchneiderType(row.type);
    if (unmapped && row.type.trim() !== '') {
      warnings.push(`Variable « ${row.name} » : type « ${row.type} » sans correspondance vérifiée — lue comme String.`);
    }
    for (const register of occupiedRegisters(address, schneiderTypeSpan(row.type))) {
      const previous = owner.get(register);
      if (previous !== undefined && previous !== row.name) {
        warnings.push(`Chevauchement de registre ${register} entre « ${previous} » et « ${row.name} » — vérifier l’implantation mémoire.`);
      } else {
        owner.set(register, row.name);
      }
    }
    entries.push({
      path: row.name,
      sourceType: row.type.trim() === '' ? '?' : row.type.trim(),
      leafType: schneiderLeafType(row.type),
      // Control Expert exports carry no read/write intent — %MW/%M are writable,
      // %I/%IW are read-only by nature.
      access: address.object === 'discrete-input' || address.object === 'input-register' ? 'r' : 'rw',
      addresses: { modbus: address.reference },
      comment: row.comment ?? address.note,
      unit: row.unit,
      unmapped: unmapped || undefined
    });
  }

  return {
    id: bundle.bookId,
    name: bundle.name ?? bundle.bookId,
    provenance: {
      kind: 'csv',
      generatedAt: bundle.provenance?.generatedAt ?? new Date().toISOString(),
      ...bundle.provenance
    },
    interface: bundle.interface,
    entries,
    types: [],
    warnings
  };
}
