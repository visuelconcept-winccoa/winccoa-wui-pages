// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Cross-check contract: an online inventory says how far a catalog built from a
 * project export is still true — and says it in the four distinct ways that call
 * for four distinct actions (absent, overrun, unknown, uncatalogued).
 */
import { describe, expect, it } from 'vitest';
import { formatWarning } from '../warnings.js';
import { AWL_DB_ECHANGE, AWL_DB_INSTANCE, AWL_UDT_MOTEUR, S7_INVENTORY } from '../samples/s7-fixtures.js';
import { buildBookFromAwlSources } from './awl.js';
import { crossCheckBookAgainstInventory, dataBlocksAddressedBy, type S7Inventory } from './inventory.js';

const PROVENANCE = { generatedAt: '2026-08-02T00:00:00.000Z' };

const catalog = buildBookFromAwlSources({
  bookId: 'awl1',
  documents: [
    { fileName: 'UDT_Moteur.awl', text: AWL_UDT_MOTEUR },
    { fileName: 'DB10.awl', text: AWL_DB_ECHANGE },
    { fileName: 'DB12.awl', text: AWL_DB_INSTANCE }
  ],
  provenance: PROVENANCE
});

const inventory = S7_INVENTORY as S7Inventory;
const codes = (warnings: { code: string }[]) => warnings.map((warning) => warning.code);

describe('dataBlocksAddressedBy', () => {
  it('measures how far into each block the catalog actually reads', () => {
    const used = dataBlocksAddressedBy(catalog);
    // DB10 ends with the UDT's Courant at DBD24 -> 28 bytes read.
    expect(used.get(10)?.highestByte).toBe(28);
    // DB12 is the bare UDT: two packed BOOLs, then Vitesse @2 and Courant @6.
    expect(used.get(12)?.highestByte).toBe(10);
  });

  it('ignores entries with no classic address (nothing to compare)', () => {
    const used = dataBlocksAddressedBy({ ...catalog, entries: [{ path: 'x', sourceType: 'Real', leafType: 'Float', access: 'rw', addresses: {} }] });
    expect(used.size).toBe(0);
  });
});

describe('crossCheckBookAgainstInventory', () => {
  const result = crossCheckBookAgainstInventory(catalog, inventory);

  it('reports a data block the catalog addresses that the CPU does NOT hold', () => {
    expect(codes(result.warnings)).toContain('s7browse.db-absent');
    expect(result.verdicts.find((verdict) => verdict.dbNumber === 12)?.status).toBe('absent');
    expect(formatWarning(result.warnings.find((warning) => warning.code === 's7browse.db-absent')!)).toContain('DB12');
  });

  it('reports a block the catalog reads PAST THE END of', () => {
    // The CPU holds 24 B of DB10; the source describes 28.
    const overrun = result.warnings.find((warning) => warning.code === 's7browse.db-overrun');
    expect(overrun).toBeDefined();
    expect(formatWarning(overrun!)).toContain('DB10 (28 > 24 B)');
    expect(result.verdicts.find((verdict) => verdict.dbNumber === 10)).toMatchObject({ status: 'overrun', cpuSize: 24 });
  });

  it('reports the blocks the CPU holds that the catalog ignores', () => {
    expect(result.uncatalogued).toEqual([11]);
    expect(codes(result.warnings)).toContain('s7browse.db-uncatalogued');
  });

  it('never modifies the catalog — it reports a disagreement, it does not resolve it', () => {
    const before = JSON.stringify(catalog);
    crossCheckBookAgainstInventory(catalog, inventory);
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it('says “not asked” rather than “not there” when the CPU could not describe a block', () => {
    const protectedCpu: S7Inventory = {
      ...inventory,
      blocks: [{ kind: 'DB', number: 10, error: 'block protected' }, { kind: 'DB', number: 12, error: 'block protected' }]
    };
    const verdicts = crossCheckBookAgainstInventory(catalog, protectedCpu);
    expect(verdicts.verdicts.every((verdict) => verdict.status === 'unknown')).toBe(true);
    expect(codes(verdicts.warnings)).toContain('s7browse.db-unknown');
    expect(codes(verdicts.warnings)).not.toContain('s7browse.db-absent');
  });

  it('is honest about what it can verify when the catalog addresses no data block', () => {
    const memoryOnly = { ...catalog, entries: [{ path: 'Marche', sourceType: 'Bool', leafType: 'Bool' as const, access: 'w' as const, addresses: { s7: 'A4.0' } }] };
    const verdicts = crossCheckBookAgainstInventory(memoryOnly, inventory);
    const warning = verdicts.warnings.find((entry) => entry.code === 's7browse.no-db-addressed');
    expect(warning).toBeDefined();
    expect(formatWarning(warning!)).toContain('CPU 315-2 PN/DP');
  });

  it('says nothing when the catalog and the CPU agree', () => {
    const matching: S7Inventory = { ...inventory, blocks: [{ kind: 'DB', number: 10, mc7Size: 64 }, { kind: 'DB', number: 12, mc7Size: 64 }] };
    const verdicts = crossCheckBookAgainstInventory(catalog, matching);
    expect(verdicts.warnings).toHaveLength(0);
    expect(verdicts.verdicts.every((verdict) => verdict.status === 'ok')).toBe(true);
  });
});
