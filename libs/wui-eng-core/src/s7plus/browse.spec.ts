// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * S7Plus online browse — the walker, over a FAKE port (no WinCC OA, no PLC).
 *
 * What these tests exist for: the `item` grammar is the part of an S7Plus browse
 * that cannot be checked by reading the result. A wrong path does not error — the
 * driver answers an empty level — so a book silently comes out short. The fake
 * port therefore REFUSES an item it was not asked for, which turns a grammar
 * mistake into a failing test instead of a missing signal.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  S7PLUS_ONLINE_STATION,
  buildBookFromS7PlusBrowse,
  isS7PlusOnline,
  s7plusChildItem,
  s7plusEntryLength,
  s7plusSymbolicPath,
  type S7PlusBrowseNode,
  type S7PlusBrowsePort
} from './browse.js';
import { S7PlusDatatype, buildS7PlusReference, s7DatatypeCode } from '../drivers/s7.js';

const STATION = 'Four_Plasma|PLC_1';

/** A node as the driver reports it, with the fields a test does not care about defaulted. */
function node(nodePath: string, systemType: string, valueType = '', itemLength = -1, comment?: string): S7PlusBrowseNode {
  return { nodePath, systemType, valueType, itemLength, ...(comment === undefined ? {} : { comment }) };
}

/**
 * A fake station: a map from the EXACT item the driver would be asked, to the
 * level it answers. An unknown item throws — see the file header.
 */
function fakePort(levels: Record<string, S7PlusBrowseNode[]>): S7PlusBrowsePort & { items: string[] } {
  const items: string[] = [];
  return {
    items,
    async browseLevel(_connection, item) {
      items.push(item);
      const level = levels[item];
      if (level === undefined) throw new Error(`unexpected browse item '${item}'`);
      return level;
    }
  };
}

const SIMPLE_STATION: Record<string, S7PlusBrowseNode[]> = {
  [STATION]: [node('DB_Echange', 'Block'), node('Tags_IHM', 'ComplexTag')],
  [`${STATION}|Blocks|DB_Echange`]: [
    node('Consigne', 'Struct'),
    node('Marche', 'Variable', 'Bool', -1, 'Ordre de marche'),
    node('Texte', 'Variable', 'String[80]', 82)
  ],
  [`${STATION}|Blocks|DB_Echange|Consigne`]: [
    node('Valeur', 'Variable', 'Real'),
    node('Unite', 'Variable', 'Int')
  ],
  [`${STATION}|Tags|Tags_IHM`]: [node('Bp_Marche', 'Tag', 'Bool')]
};

describe('s7plusChildItem — the panel’s own id composition', () => {
  it('addresses a data block under the synthetic "Blocks" segment', () => {
    expect(s7plusChildItem(STATION, node('DB_Echange', 'Block'))).toBe(`${STATION}|Blocks|DB_Echange`);
  });

  it('addresses a tag table under the synthetic "Tags" segment', () => {
    expect(s7plusChildItem(STATION, node('Tags_IHM', 'ComplexTag'))).toBe(`${STATION}|Tags|Tags_IHM`);
  });

  it('appends any other node as-is (no synthetic segment inside a block)', () => {
    expect(s7plusChildItem(`${STATION}|Blocks|DB_Echange`, node('Consigne', 'Struct'))).toBe(
      `${STATION}|Blocks|DB_Echange|Consigne`
    );
  });

  it('reduces a Station answer to its first "|" part', () => {
    expect(s7plusChildItem('Four_Plasma', node('PLC_1|S71500', 'Station'))).toBe('PLC_1');
  });
});

describe('s7plusSymbolicPath — what the driver resolves at runtime', () => {
  it('drops the station and the Blocks segment, and dots the rest', () => {
    expect(s7plusSymbolicPath(STATION, `${STATION}|Blocks|DB_Echange|Consigne|Valeur`)).toBe('DB_Echange.Consigne.Valeur');
  });

  it('drops the Tags segment the same way', () => {
    expect(s7plusSymbolicPath(STATION, `${STATION}|Tags|Tags_IHM|Bp_Marche`)).toBe('Tags_IHM.Bp_Marche');
  });

  it('is empty at the station itself (the walk root)', () => {
    expect(s7plusSymbolicPath(STATION, STATION)).toBe(STATION.split('|').join('.'));
  });
});

describe('s7plusEntryLength — only a string carries a length into the address', () => {
  it('subtracts the 2 header bytes of a String, like the standard panel', () => {
    expect(s7plusEntryLength(node('Texte', 'Variable', 'String[80]', 82))).toBe(80);
  });

  it('does the same for a WString', () => {
    expect(s7plusEntryLength(node('Texte', 'Variable', 'WString', 34))).toBe(32);
  });

  it('ignores the length of a scalar (an Int is not length-addressed)', () => {
    expect(s7plusEntryLength(node('Valeur', 'Variable', 'Int', 2))).toBeUndefined();
  });

  it('ignores an ARRAY length (structural, not part of one element’s address)', () => {
    expect(s7plusEntryLength(node('Mesures', 'Array', 'Real', 10))).toBeUndefined();
  });
});

describe('buildS7PlusReference', () => {
  it('is the bare symbolic path', () => {
    expect(buildS7PlusReference('DB_Echange.Marche')).toBe('DB_Echange.Marche');
  });

  it('appends the item length of a string', () => {
    expect(buildS7PlusReference('DB_Echange.Texte', 80)).toBe('DB_Echange.Texte:80');
  });

  it('appends a TRAILING colon when the symbol itself contains one', () => {
    expect(buildS7PlusReference('DB:Echange.Marche')).toBe('DB:Echange.Marche:');
  });
});

describe('buildBookFromS7PlusBrowse — the walk', () => {
  it('catalogues every leaf of a station, with its symbolic address and comment', async () => {
    const port = fakePort(SIMPLE_STATION);
    const book = await buildBookFromS7PlusBrowse(port, {
      bookId: 'book-1',
      connection: 'Four2',
      station: STATION,
      generatedAt: '2026-08-18T10:00:00.000Z'
    });
    expect(book.entries.map((entry) => entry.path)).toEqual([
      'DB_Echange.Consigne.Valeur',
      'DB_Echange.Consigne.Unite',
      'DB_Echange.Marche',
      'DB_Echange.Texte',
      'Tags_IHM.Bp_Marche'
    ]);
    const marche = book.entries.find((entry) => entry.path === 'DB_Echange.Marche');
    expect(marche).toMatchObject({
      sourceType: 'Bool',
      leafType: 'Bool',
      comment: 'Ordre de marche',
      addresses: { s7plus: 'DB_Echange.Marche' }
    });
    // A string's address carries its length, the struct's members do not.
    expect(book.entries.find((entry) => entry.path === 'DB_Echange.Texte')?.addresses.s7plus).toBe('DB_Echange.Texte:80');
    expect(book.entries.find((entry) => entry.path === 'DB_Echange.Consigne.Valeur')?.leafType).toBe('Float');
  });

  it('asks for exactly the items the driver understands (grammar regression)', async () => {
    const port = fakePort(SIMPLE_STATION);
    await buildBookFromS7PlusBrowse(port, { bookId: 'b', connection: 'Four2', station: STATION });
    expect(port.items).toEqual([
      STATION,
      `${STATION}|Blocks|DB_Echange`,
      `${STATION}|Blocks|DB_Echange|Consigne`,
      `${STATION}|Tags|Tags_IHM`
    ]);
  });

  it('flags every signal as read-only with an ASSUMED access (the browse states none)', async () => {
    const port = fakePort(SIMPLE_STATION);
    const book = await buildBookFromS7PlusBrowse(port, { bookId: 'b', connection: 'Four2', station: STATION });
    expect(book.entries.every((entry) => entry.access === 'r' && entry.accessSource === 'assumed')).toBe(true);
    // `historized` is UNKNOWN, never `false`.
    expect(book.entries.every((entry) => entry.historized === undefined)).toBe(true);
    expect(book.warnings.map((w) => w.code)).toContain('s7plus.access-assumed');
  });

  it('walks a sub-tree when given a root, and keeps the station-relative paths', async () => {
    const port = fakePort(SIMPLE_STATION);
    const book = await buildBookFromS7PlusBrowse(port, {
      bookId: 'b',
      connection: 'Four2',
      station: STATION,
      root: `${STATION}|Blocks|DB_Echange|Consigne`
    });
    expect(book.entries.map((entry) => entry.path)).toEqual(['DB_Echange.Consigne.Valeur', 'DB_Echange.Consigne.Unite']);
  });

  it('expands an ARRAY element by element', async () => {
    const port = fakePort({
      [STATION]: [node('DB_Mes', 'Block')],
      [`${STATION}|Blocks|DB_Mes`]: [node('Mesures', 'Array', 'Real', 3)],
      [`${STATION}|Blocks|DB_Mes|Mesures`]: [
        node('Mesures[0]', 'Variable', 'Real'),
        node('Mesures[1]', 'Variable', 'Real'),
        node('Mesures[2]', 'Variable', 'Real')
      ]
    });
    const book = await buildBookFromS7PlusBrowse(port, { bookId: 'b', connection: 'Four2', station: STATION });
    expect(book.entries.map((entry) => entry.path)).toEqual([
      'DB_Mes.Mesures.Mesures[0]',
      'DB_Mes.Mesures.Mesures[1]',
      'DB_Mes.Mesures.Mesures[2]'
    ]);
    expect(book.warnings.map((w) => w.code)).toContain('s7plus.arrays-expanded');
  });

  it('completes an array the driver answered with its FIRST element only', async () => {
    // What the standard panel does (its `g_optBrowse` block): the driver answers
    // `Mesures[0]` for a 4-element array, and the client synthesises the rest.
    const port = fakePort({
      [STATION]: [node('DB_Mes', 'Block')],
      [`${STATION}|Blocks|DB_Mes`]: [node('Mesures', 'Array', 'Real', 4)],
      [`${STATION}|Blocks|DB_Mes|Mesures`]: [node('Mesures[0]', 'Variable', 'Real')]
    });
    const book = await buildBookFromS7PlusBrowse(port, { bookId: 'b', connection: 'Four2', station: STATION });
    expect(book.entries.map((entry) => entry.path)).toEqual([
      'DB_Mes.Mesures.Mesures[0]',
      'DB_Mes.Mesures.Mesures[1]',
      'DB_Mes.Mesures.Mesures[2]',
      'DB_Mes.Mesures.Mesures[3]'
    ]);
    expect(book.entries.every((entry) => entry.leafType === 'Float')).toBe(true);
  });

  it('bounds a huge array and SAYS the rest is missing', async () => {
    const elements = Array.from({ length: 300 }, (_unused, index) => node(`Mesures[${index}]`, 'Variable', 'Real'));
    const port = fakePort({
      [STATION]: [node('DB_Mes', 'Block')],
      [`${STATION}|Blocks|DB_Mes`]: [node('Mesures', 'Array', 'Real', 300)],
      [`${STATION}|Blocks|DB_Mes|Mesures`]: elements
    });
    const book = await buildBookFromS7PlusBrowse(port, {
      bookId: 'b',
      connection: 'Four2',
      station: STATION,
      maxArrayElements: 10
    });
    expect(book.entries).toHaveLength(10);
    expect(book.warnings.map((w) => w.code)).toContain('s7plus.array-truncated');
  });

  it('keeps the rest of the catalog when one block is unreadable', async () => {
    const port: S7PlusBrowsePort = {
      async browseLevel(_connection, item) {
        if (item === STATION) return [node('DB_Ok', 'Block'), node('DB_Ko', 'Block')];
        if (item === `${STATION}|Blocks|DB_Ok`) return [node('Marche', 'Variable', 'Bool')];
        throw new Error('block locked');
      }
    };
    const book = await buildBookFromS7PlusBrowse(port, { bookId: 'b', connection: 'Four2', station: STATION });
    expect(book.entries.map((entry) => entry.path)).toEqual(['DB_Ok.Marche']);
    expect(book.warnings.map((w) => w.code)).toContain('browse.unreadable-branches');
  });

  it('flags a datatype the S7 mapping does not cover instead of guessing one', async () => {
    const port = fakePort({
      [STATION]: [node('DB_X', 'Block')],
      [`${STATION}|Blocks|DB_X`]: [node('Bizarre', 'Variable', 'Variant')]
    });
    const book = await buildBookFromS7PlusBrowse(port, { bookId: 'b', connection: 'Four2', station: STATION });
    expect(book.entries[0]).toMatchObject({ sourceType: 'Variant', unmapped: true });
    expect(book.warnings.map((w) => w.code)).toContain('s7plus.type-unmapped');
  });

  it('reports progress per request and CANCELS when the callback throws', async () => {
    const port = fakePort(SIMPLE_STATION);
    const seen: string[] = [];
    await expect(
      buildBookFromS7PlusBrowse(port, {
        bookId: 'b',
        connection: 'Four2',
        station: STATION,
        onProgress: (progress) => {
          seen.push(progress.path);
          if (progress.requests === 2) throw new Error('cancelled');
        }
      })
    ).rejects.toThrow('cancelled');
    expect(seen).toHaveLength(2);
  });

  it('an ONLINE walk is a live book (it carries its interface)', async () => {
    const online = S7PLUS_ONLINE_STATION;
    const port = fakePort({
      [online]: [node('DB_Echange', 'Block')],
      [`${online}|Blocks|DB_Echange`]: [node('Marche', 'Variable', 'Bool')]
    });
    const book = await buildBookFromS7PlusBrowse(port, { bookId: 'b', connection: 'Four2', station: online });
    expect(isS7PlusOnline(online)).toBe(true);
    expect(book.interface).toMatchObject({ protocol: 's7plus', connection: 'Four2', params: { station: online } });
    expect(book.provenance.kind).toBe('s7plus-browse');
    expect(book.warnings.map((w) => w.code)).toContain('s7plus.source-online');
  });

  it('a TIA-PROJECT walk is a template catalog (no interface) and says so', async () => {
    const port = fakePort(SIMPLE_STATION);
    const book = await buildBookFromS7PlusBrowse(port, { bookId: 'b', connection: 'Four2', station: STATION });
    expect(book.interface).toBeUndefined();
    expect(book.warnings.map((w) => w.code)).toContain('s7plus.source-project');
  });

  it('records the parameters needed to REPLAY the walk', async () => {
    const port = fakePort(SIMPLE_STATION);
    const book = await buildBookFromS7PlusBrowse(port, {
      bookId: 'b',
      connection: 'Four2',
      station: STATION,
      maxEntries: 100,
      hmiVisibleOnly: false
    });
    expect(book.provenance.browse).toMatchObject({
      connection: 'Four2',
      station: STATION,
      hmiVisibleOnly: false,
      maxEntries: 100
    });
    expect(book.warnings.map((w) => w.code)).not.toContain('s7plus.hmi-filtered');
  });

  it('passes the HMI filter to the driver (its third GetBranch parameter)', async () => {
    const browseLevel = vi.fn(async () => []);
    await buildBookFromS7PlusBrowse({ browseLevel }, { bookId: 'b', connection: 'Four2', station: STATION });
    expect(browseLevel).toHaveBeenCalledWith('Four2', STATION, true);
  });

  it('says a station is empty rather than answering an empty book silently', async () => {
    const book = await buildBookFromS7PlusBrowse({ browseLevel: async () => [] }, {
      bookId: 'b',
      connection: 'Four2',
      station: STATION
    });
    expect(book.entries).toHaveLength(0);
    expect(book.warnings.map((w) => w.code)).toContain('browse.empty-root');
  });

  it('the catalogued datatypes have an S7Plus transformation (the check-in half)', async () => {
    const port = fakePort(SIMPLE_STATION);
    const book = await buildBookFromS7PlusBrowse(port, { bookId: 'b', connection: 'Four2', station: STATION });
    const codes = book.entries.map((entry) => s7DatatypeCode(entry.sourceType, 's7plus'));
    expect(codes).not.toContain(undefined);
    expect(s7DatatypeCode('Bool', 's7plus')).toBe(S7PlusDatatype.BOOL);
  });
});
