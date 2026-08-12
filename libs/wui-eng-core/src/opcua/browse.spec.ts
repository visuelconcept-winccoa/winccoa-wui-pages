// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The online browse walker, driven by a FAKE port (no WinCC OA, no server):
 * path building, variable/method/container handling, the caps and their
 * warnings, cycle protection, and the replayable provenance.
 */
import { describe, expect, it } from 'vitest';
import { formatWarning as warningText } from '../warnings.js';
import { BROWSE_DEFAULTS, OPCUA_OBJECTS_FOLDER, buildBookFromOpcUaBrowse, type OpcUaBrowseNode, type OpcUaBrowsePort } from './browse.js';

/** An in-memory address space: nodeId → children. */
function fakePort(space: Record<string, OpcUaBrowseNode[]>, calls: string[] = []): OpcUaBrowsePort & { calls: string[] } {
  return {
    calls,
    async browseLevel(_connection: string, nodeId: string): Promise<OpcUaBrowseNode[]> {
      calls.push(nodeId);
      return space[nodeId] ?? [];
    }
  };
}

const object = (name: string, id: string): OpcUaBrowseNode => ({ displayName: name, nodeId: id, nodeClass: 'Object' });
const withAccessLevel = (node: OpcUaBrowseNode, accessLevel: number): OpcUaBrowseNode => ({ ...node, accessLevel });
const variable = (name: string, id: string, dataType: string, valueRank = -1): OpcUaBrowseNode => ({
  displayName: name,
  nodeId: id,
  nodeClass: 'Variable',
  dataType,
  valueRank
});

/** A small filler machine: two groups, one method, one nested level. */
const MACHINE: Record<string, OpcUaBrowseNode[]> = {
  [OPCUA_OBJECTS_FOLDER]: [object('Remplisseuse', 'ns=2;i=100')],
  'ns=2;i=100': [
    object('Mesures', 'ns=2;i=110'),
    object('Consignes', 'ns=2;i=120'),
    { displayName: 'Reset', nodeId: 'ns=2;i=130', nodeClass: 'Method' }
  ],
  'ns=2;i=110': [variable('Temperature', 'ns=2;s=Temp', 'Double'), variable('Debit', 'ns=2;s=Debit', 'Float')],
  'ns=2;i=120': [variable('Temperature', 'ns=2;s=SpTemp', 'Double')]
};

describe('buildBookFromOpcUaBrowse', () => {
  it('walks the address space into dot-joined paths, in server order', async () => {
    const book = await buildBookFromOpcUaBrowse(fakePort(MACHINE), {
      bookId: 'b1',
      connection: 'Remplisseuse1',
      generatedAt: '2026-08-02T10:00:00.000Z'
    });
    expect(book.entries.map((e) => e.path)).toEqual([
      'Remplisseuse.Mesures.Temperature',
      'Remplisseuse.Mesures.Debit',
      'Remplisseuse.Consignes.Temperature'
    ]);
  });

  it('maps datatypes through the verified OPC UA mapping and builds the reference', async () => {
    const book = await buildBookFromOpcUaBrowse(fakePort(MACHINE), { bookId: 'b1', connection: 'Remplisseuse1' });
    const temp = book.entries[0];
    expect(temp.leafType).toBe('Float'); // Double → Float
    expect(temp.sourceType).toBe('Double');
    expect(temp.addresses.opcua).toBe('Remplisseuse1$$1$1$ns=2;s=Temp');
  });

  it('is a LIVE book: it carries the interface it was browsed through', async () => {
    const book = await buildBookFromOpcUaBrowse(fakePort(MACHINE), { bookId: 'b1', connection: 'Remplisseuse1', driverNumber: 3 });
    expect(book.interface).toEqual({ protocol: 'opcua', connection: 'Remplisseuse1', driverNumber: 3 });
  });

  it('records REPLAYABLE browse parameters in the provenance', async () => {
    const book = await buildBookFromOpcUaBrowse(fakePort(MACHINE), {
      bookId: 'b1',
      connection: 'Remplisseuse1',
      rootNodeId: 'ns=2;i=100',
      maxDepth: 4
    });
    expect(book.provenance.kind).toBe('opcua-browse');
    expect(book.provenance.browse).toEqual({ connection: 'Remplisseuse1', rootNodeId: 'ns=2;i=100', maxDepth: 4 });
  });

  it('catalogues everything read-only and says so (AccessLevel is not browsed)', async () => {
    const book = await buildBookFromOpcUaBrowse(fakePort(MACHINE), { bookId: 'b1', connection: 'C' });
    expect(book.entries.every((e) => e.access === 'r')).toBe(true);
    expect(book.entries.every((e) => e.accessSource === 'assumed')).toBe(true);
    expect(book.warnings.some((w) => warningText(w).includes('AccessLevel'))).toBe(true);
  });

  it('DECODES AccessLevel when the port provides it', async () => {
    const space = {
      [OPCUA_OBJECTS_FOLDER]: [
        withAccessLevel(variable('Mesure', 'ns=2;s=m', 'Double'), 1),
        withAccessLevel(variable('Commande', 'ns=2;s=c', 'Boolean'), 2),
        withAccessLevel(variable('Consigne', 'ns=2;s=s', 'Double'), 3)
      ]
    };
    const book = await buildBookFromOpcUaBrowse(fakePort(space), { bookId: 'b1', connection: 'C' });
    expect(book.entries.map((e) => [e.access, e.accessSource])).toEqual([
      ['r', 'declared'],
      ['w', 'declared'],
      ['rw', 'declared']
    ]);
    expect(book.warnings.some((w) => warningText(w).includes('AccessLevel read from the server'))).toBe(true);
  });

  it('reports the MIX when only some nodes carry an AccessLevel', async () => {
    const space = {
      [OPCUA_OBJECTS_FOLDER]: [withAccessLevel(variable('A', 'ns=2;s=a', 'Double'), 3), variable('B', 'ns=2;s=b', 'Double')]
    };
    const book = await buildBookFromOpcUaBrowse(fakePort(space), { bookId: 'b1', connection: 'C' });
    expect(book.entries.map((e) => e.accessSource)).toEqual(['declared', 'assumed']);
    expect(book.warnings.some((w) => warningText(w).includes('1/2 signals without an exposed AccessLevel'))).toBe(true);
  });

  it('treats an AccessLevel of 0 as evidence (no read, no write) — not as absent', async () => {
    const space = { [OPCUA_OBJECTS_FOLDER]: [withAccessLevel(variable('X', 'ns=2;s=x', 'Double'), 0)] };
    const book = await buildBookFromOpcUaBrowse(fakePort(space), { bookId: 'b1', connection: 'C' });
    expect(book.entries[0]).toMatchObject({ access: 'r', accessSource: 'declared' });
  });

  it('skips methods, and reports how many', async () => {
    const book = await buildBookFromOpcUaBrowse(fakePort(MACHINE), { bookId: 'b1', connection: 'C' });
    expect(book.entries.some((e) => e.path.endsWith('Reset'))).toBe(false);
    expect(book.warnings.some((w) => warningText(w).includes('1 OPC UA method'))).toBe(true);
  });

  it('flags an array variable instead of inventing a Dyn element type', async () => {
    const space = {
      [OPCUA_OBJECTS_FOLDER]: [variable('Profil', 'ns=2;s=Profil', 'Float', 1)]
    };
    const book = await buildBookFromOpcUaBrowse(fakePort(space), { bookId: 'b1', connection: 'C' });
    expect(book.entries[0]).toMatchObject({ leafType: 'Float', sourceType: 'Float[]', unmapped: true });
    expect(book.warnings.some((w) => warningText(w).includes('ARRAY'))).toBe(true);
  });

  it('marks an unmappable datatype as unmapped', async () => {
    const space = { [OPCUA_OBJECTS_FOLDER]: [variable('Custom', 'ns=2;s=C', 'MyStructType')] };
    const book = await buildBookFromOpcUaBrowse(fakePort(space), { bookId: 'b1', connection: 'C' });
    expect(book.entries[0]).toMatchObject({ leafType: 'String', unmapped: true });
  });

  it('survives a cycle in the address space (a graph, not a tree)', async () => {
    const space: Record<string, OpcUaBrowseNode[]> = {
      [OPCUA_OBJECTS_FOLDER]: [object('A', 'ns=2;i=1')],
      'ns=2;i=1': [object('B', 'ns=2;i=2'), variable('V1', 'ns=2;s=v1', 'Int32')],
      'ns=2;i=2': [object('A', 'ns=2;i=1'), variable('V2', 'ns=2;s=v2', 'Int32')]
    };
    const book = await buildBookFromOpcUaBrowse(fakePort(space), { bookId: 'b1', connection: 'C' });
    // Declaration order is preserved verbatim: B is declared before V1, so its
    // subtree comes first — the catalog reads like the server's own tree.
    expect(book.entries.map((e) => e.path)).toEqual(['A.B.V2', 'A.V1']);
  });

  it('stops at maxDepth and WARNS instead of truncating silently', async () => {
    const space: Record<string, OpcUaBrowseNode[]> = {
      [OPCUA_OBJECTS_FOLDER]: [object('L1', 'ns=2;i=1')],
      'ns=2;i=1': [object('L2', 'ns=2;i=2')],
      'ns=2;i=2': [variable('Deep', 'ns=2;s=deep', 'Int32')]
    };
    const book = await buildBookFromOpcUaBrowse(fakePort(space), { bookId: 'b1', connection: 'C', maxDepth: 1 });
    expect(book.entries).toHaveLength(0);
    expect(book.warnings.some((w) => warningText(w).includes('depth 1'))).toBe(true);
  });

  it('stops at maxEntries and WARNS that the catalog is incomplete', async () => {
    const many = Array.from({ length: 20 }, (_, i) => variable(`V${i}`, `ns=2;s=v${i}`, 'Int32'));
    const book = await buildBookFromOpcUaBrowse(fakePort({ [OPCUA_OBJECTS_FOLDER]: many }), {
      bookId: 'b1',
      connection: 'C',
      maxEntries: 5
    });
    expect(book.entries).toHaveLength(5);
    // Assert on the CODE and its params, not on the prose: that is what the
    // EngWarning refactor buys — the message may be re-worded or translated.
    expect(book.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'browse.truncated-entries', params: { max: 5 } })])
    );
  });

  it('keeps the rest of the catalog when one branch is unreadable', async () => {
    const port: OpcUaBrowsePort = {
      async browseLevel(_c, nodeId) {
        if (nodeId === 'ns=2;i=bad') throw new Error('BadNodeIdUnknown');
        if (nodeId === OPCUA_OBJECTS_FOLDER) return [object('Bad', 'ns=2;i=bad'), object('Good', 'ns=2;i=ok')];
        return [variable('V', 'ns=2;s=v', 'Int32')];
      }
    };
    const book = await buildBookFromOpcUaBrowse(port, { bookId: 'b1', connection: 'C' });
    expect(book.entries.map((e) => e.path)).toEqual(['Good.V']);
    const unreadable = book.warnings.find((w) => w.code === 'browse.unreadable-branches');
    expect(unreadable?.params).toMatchObject({ n: 1 });
    expect(warningText(unreadable!)).toContain('BadNodeIdUnknown');
  });

  it('warns when the root holds nothing (wrong root or dead connection)', async () => {
    const book = await buildBookFromOpcUaBrowse(fakePort({}), { bookId: 'b1', connection: 'C' });
    expect(book.entries).toHaveLength(0);
    expect(book.warnings.some((w) => warningText(w).includes('No variable found'))).toBe(true);
  });

  it('browses one level at a time — one request per container, never more', async () => {
    const calls: string[] = [];
    await buildBookFromOpcUaBrowse(fakePort(MACHINE, calls), { bookId: 'b1', connection: 'C' });
    expect(calls).toEqual([OPCUA_OBJECTS_FOLDER, 'ns=2;i=100', 'ns=2;i=110', 'ns=2;i=120']);
  });

  it('exposes usable default caps', () => {
    expect(BROWSE_DEFAULTS.maxDepth).toBeGreaterThan(2);
    expect(BROWSE_DEFAULTS.maxEntries).toBeGreaterThan(100);
  });
});

describe('buildBookFromOpcUaBrowse — progress', () => {
  it('reports one progress event per browse request, monotonically', async () => {
    const seen: { requests: number; entries: number; path: string; depth: number }[] = [];
    const book = await buildBookFromOpcUaBrowse(fakePort(MACHINE), {
      bookId: 'b1',
      connection: 'Remplisseuse1',
      onProgress: (progress) => seen.push({ ...progress })
    });
    // One per container visited, and the first is the root: '' at depth 0.
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0]).toMatchObject({ requests: 1, entries: 0, path: '', depth: 0 });
    expect(seen.map((p) => p.requests)).toEqual(seen.map((_, index) => index + 1));
    // The counts never go backwards, and the last one matches the finished book.
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index].entries).toBeGreaterThanOrEqual(seen[index - 1].entries);
    }
    expect(book.entries.length).toBeGreaterThanOrEqual(seen.at(-1)!.entries);
    // The path names the container being waited on, so a slow branch is visible.
    expect(seen.some((p) => p.path !== '' && p.depth > 0)).toBe(true);
  });

  it('lets the caller CANCEL by throwing from the callback', async () => {
    const attempt = buildBookFromOpcUaBrowse(fakePort(MACHINE), {
      bookId: 'b1',
      connection: 'Remplisseuse1',
      onProgress: () => {
        throw new Error('cancelled by the operator');
      }
    });
    await expect(attempt).rejects.toThrow('cancelled by the operator');
  });
});
