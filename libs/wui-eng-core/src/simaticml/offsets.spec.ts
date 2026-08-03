// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Standard-block layout rules: BOOL bit-packing, byte types, word alignment
 * of ≥2-byte types, String[n] = n+2 bytes, word-aligned structs padded to a
 * word boundary. (Cross-check against a real standard DB is tracked in
 * docs/wui-eng-studio/NOTES.md.)
 */
import { describe, expect, it } from 'vitest';
import { computeStandardOffsets } from './offsets.js';

describe('computeStandardOffsets', () => {
  it('packs consecutive BOOLs into bits of one byte', () => {
    const offsets = computeStandardOffsets([
      { name: 'A', dataType: 'Bool' },
      { name: 'B', dataType: 'Bool' },
      { name: 'C', dataType: 'Bool' }
    ]);
    expect(offsets).toEqual([
      { path: 'A', byteOffset: 0, bitOffset: 0 },
      { path: 'B', byteOffset: 0, bitOffset: 1 },
      { path: 'C', byteOffset: 0, bitOffset: 2 }
    ]);
  });

  it('starts a new byte after 8 BOOLs', () => {
    const members = Array.from({ length: 9 }, (_v, i) => ({ name: `B${i}`, dataType: 'Bool' }));
    const offsets = computeStandardOffsets(members);
    expect(offsets[7]).toEqual({ path: 'B7', byteOffset: 0, bitOffset: 7 });
    expect(offsets[8]).toEqual({ path: 'B8', byteOffset: 1, bitOffset: 0 });
  });

  it('word-aligns 2- and 4-byte types after bools and bytes', () => {
    const offsets = computeStandardOffsets([
      { name: 'Flag', dataType: 'Bool' },
      { name: 'Small', dataType: 'Byte' },
      { name: 'Counter', dataType: 'Int' },
      { name: 'Value', dataType: 'Real' }
    ]);
    // Flag 0.0 ; Small byte 1 ; Counter word-aligned -> 2 ; Value -> 4.
    expect(offsets).toEqual([
      { path: 'Flag', byteOffset: 0, bitOffset: 0 },
      { path: 'Small', byteOffset: 1 },
      { path: 'Counter', byteOffset: 2 },
      { path: 'Value', byteOffset: 4 }
    ]);
  });

  it('sizes String[n] as n+2 bytes and keeps following members aligned', () => {
    const offsets = computeStandardOffsets([
      { name: 'Name', dataType: 'String[9]' }, // 11 bytes: 0..10
      { name: 'After', dataType: 'Int' } // word-aligned -> 12
    ]);
    expect(offsets).toEqual([
      { path: 'Name', byteOffset: 0 },
      { path: 'After', byteOffset: 12 }
    ]);
  });

  it('aligns structs to words and pads their size', () => {
    const offsets = computeStandardOffsets([
      { name: 'Lead', dataType: 'Byte' },
      {
        name: 'S',
        dataType: 'Struct',
        children: [
          { name: 'X', dataType: 'Bool' },
          { name: 'Y', dataType: 'Byte' }
        ]
      },
      { name: 'Tail', dataType: 'Byte' }
    ]);
    // Lead 0 ; struct starts word-aligned at 2: X 2.0, Y byte 3 ; struct end
    // padded to word -> Tail at 4.
    expect(offsets).toEqual([
      { path: 'Lead', byteOffset: 0 },
      { path: 'S.X', byteOffset: 2, bitOffset: 0 },
      { path: 'S.Y', byteOffset: 3 },
      { path: 'Tail', byteOffset: 4 }
    ]);
  });
});
