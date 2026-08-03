// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Byte/bit offset computation for members of a NON-optimized (standard) S7
 * data block — SimaticML exports carry the interface, not the offsets, so the
 * classic absolute operands (`DB12.DBX0.3`, `DB12.DBD4`, …) are derived here.
 *
 * Layout rules implemented (classic S7-300/400-compatible layout used by
 * `MemoryLayout="Standard"` blocks):
 *   - BOOLs are bit-packed: consecutive BOOLs fill bits 0..7 of one byte;
 *   - 1-byte types (Byte/Char/SInt/USInt) take the next free byte;
 *   - every type ≥ 2 bytes is WORD-aligned (offset rounded up to even);
 *   - STRING[n] occupies n + 2 bytes (max length + actual length header) and
 *     is WORD-aligned; default STRING = STRING[254];
 *   - a nested STRUCT starts WORD-aligned and its total size is padded to a
 *     WORD boundary.
 *
 * ⚠️ Cross-check against a real standard DB before production use (same
 * verification culture as `docs/wui-para/NOTES.md`); arrays and UDT-in-
 * standard-DB are not computed in v1 (reported by the parser as warnings).
 */

import { S7_TYPE_SIZE } from '../drivers/s7.js';

/** One member to lay out (leaf or struct with children, in declared order). */
export interface LayoutMember {
  name: string;
  /** S7 elementary type name, `String[<n>]`, or 'Struct'. */
  dataType: string;
  children?: LayoutMember[];
}

/** Computed placement of one LEAF member (dot-joined path). */
export interface MemberOffset {
  path: string;
  byteOffset: number;
  /** Bit within the byte — BOOL members only. */
  bitOffset?: number;
}

interface Cursor {
  byte: number;
  bit: number;
}

function alignToByte(cursor: Cursor): void {
  if (cursor.bit > 0) {
    cursor.byte += 1;
    cursor.bit = 0;
  }
}

function alignToWord(cursor: Cursor): void {
  alignToByte(cursor);
  if (cursor.byte % 2 === 1) cursor.byte += 1;
}

/** Size in bytes of a non-BOOL leaf type (String[n] → n + 2). */
function leafSize(dataType: string): number {
  const str = /^String(?:\[(\d+)\])?$/i.exec(dataType.trim());
  if (str) {
    const max = str[1] === undefined ? 254 : Number.parseInt(str[1], 10);
    return max + 2;
  }
  return S7_TYPE_SIZE[dataType.trim()] ?? 0;
}

/**
 * Compute the offsets of every LEAF member of a standard block interface.
 * Unknown leaf types get size 0 (flagged upstream) but still consume their
 * alignment so the following members stay plausible.
 */
export function computeStandardOffsets(members: LayoutMember[]): MemberOffset[] {
  const out: MemberOffset[] = [];
  const cursor: Cursor = { byte: 0, bit: 0 };
  layout(members, '', cursor, out);
  return out;
}

function layout(members: LayoutMember[], prefix: string, cursor: Cursor, out: MemberOffset[]): void {
  for (const member of members) {
    const path = prefix === '' ? member.name : `${prefix}.${member.name}`;
    if (member.dataType === 'Struct') {
      alignToWord(cursor);
      layout(member.children ?? [], path, cursor, out);
      alignToWord(cursor); // struct total size padded to a word boundary
      continue;
    }
    if (member.dataType === 'Bool') {
      if (cursor.bit > 7) {
        cursor.byte += 1;
        cursor.bit = 0;
      }
      out.push({ path, byteOffset: cursor.byte, bitOffset: cursor.bit });
      cursor.bit += 1;
      if (cursor.bit === 8) {
        cursor.byte += 1;
        cursor.bit = 0;
      }
      continue;
    }
    const size = leafSize(member.dataType);
    if (size >= 2) {
      alignToWord(cursor);
    } else {
      alignToByte(cursor);
    }
    out.push({ path, byteOffset: cursor.byte });
    cursor.byte += size;
    cursor.bit = 0;
  }
}
