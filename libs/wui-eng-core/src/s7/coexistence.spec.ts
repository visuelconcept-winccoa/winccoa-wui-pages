// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **S7 and S7Plus must not contaminate each other.**
 *
 * The studio now carries two Siemens paths that look alike and are not: the
 * classic S7 one (S7-300/400 — catalogs built from STEP 7 exports, classic
 * operands, `_drv_ident` "S7", transformation codes 700–722) and the S7Plus one
 * (S7-1200/1500 — a symbolic online browse, symbolic references, codes
 * 1001–1027). `NOTES.md` records why they are kept apart: the two driver tables
 * are DISJOINT, so writing an S7Plus code onto an S7 address is accepted by the
 * API and wrong on the wire — a fault that reads as a field problem.
 *
 * Everything below is a *crossing* between the two lanes, asserted end to end:
 * one catalog of each kind, generated through the same `generateModelFromBook`,
 * must come out with its own reference AND its own transformation code — and the
 * online verifier of one lane must stay silent about the other.
 */
import { describe, expect, it } from 'vitest';
import { AWL_DB_ECHANGE, AWL_UDT_MOTEUR, S7_INVENTORY, SYMBOLS_SDF } from '../samples/s7-fixtures.js';
import { buildBookFromIngest } from '../ingest.js';
import { generateModelFromBook } from '../modelgen.js';
import { classifyEntries } from '../roles/classify.js';
import { S7Datatype, S7PlusDatatype } from '../drivers/s7.js';
import { crossCheckBookAgainstInventory, dataBlocksAddressedBy, type S7Inventory } from './inventory.js';
import type { AddressBook, BookEntry } from '../model.js';

const PROVENANCE = { generatedAt: '2026-08-02T00:00:00.000Z' };

/** A classic-S7 catalog, as the AWL generator produces it. */
const s7Book = buildBookFromIngest({
  bookId: 'awl',
  format: 's7awl',
  generatedAt: PROVENANCE.generatedAt,
  sources: [
    { fileName: 'UDT_Moteur.awl', text: AWL_UDT_MOTEUR },
    { fileName: 'DB10.awl', text: AWL_DB_ECHANGE }
  ],
  interface: { protocol: 's7', connection: 'S7_Pompage', driverNumber: 3 }
});

/**
 * An S7Plus catalog of the SAME signals, as its online browse produces them:
 * symbolic references, no classic operand. Hand-built rather than walked, so this
 * test needs no fake station — what is under test is the crossing, not the walk.
 */
const s7plusBook: AddressBook = {
  id: 's7plus',
  name: 'S7-1500',
  provenance: { kind: 's7plus-browse', generatedAt: PROVENANCE.generatedAt },
  interface: { protocol: 's7plus', connection: 'S7Plus_Ligne', driverNumber: 4 },
  entries: [
    { path: 'Echange.Consigne_Vitesse', sourceType: 'Real', leafType: 'Float', access: 'rw', addresses: { s7plus: '"Echange"."Consigne_Vitesse"' } },
    { path: 'Echange.Marche', sourceType: 'Bool', leafType: 'Bool', access: 'rw', addresses: { s7plus: '"Echange"."Marche"' } }
  ] satisfies BookEntry[],
  types: [],
  warnings: []
};

/**
 * Qualify a catalog the way the studio does before generating from it.
 *
 * `modelgen` only writes a config for a signal that carries a ROLE — an
 * unqualified signal is reported (`modelgen.unqualified`), never given a silent
 * default. So a test that generated from a raw book would measure nothing, and
 * running the real rule engine here also asserts the thing worth asserting: that
 * the classic-S7 entries are qualified by the SAME rules as every other catalog.
 */
function qualified(book: AddressBook): AddressBook {
  const roles = classifyEntries(book.entries);
  return { ...book, entries: book.entries.map((entry) => ({ ...entry, role: roles.get(entry.path)?.role })) };
}

/** Generate against a qualified catalog and collect the address config of every DPE. */
function addressesOf(book: AddressBook) {
  const proposal = generateModelFromBook(qualified(book), { typeName: 'Machine', equipments: ['M1'], deviceId: 'dev1' });
  return Object.values(proposal.configs)
    .map((configs) => configs.address)
    .filter((address) => address !== undefined);
}

describe('S7 and S7Plus catalogs generated side by side', () => {
  it('each reads ITS OWN candidate address — the interface protocol decides, not the family', () => {
    const s7 = addressesOf(s7Book);
    const s7plus = addressesOf(s7plusBook);
    // Classic: an absolute operand. Symbolic: a quoted path. Never swapped.
    expect(s7.map((address) => address.reference)).toContain('DB10.DBD0');
    expect(s7plus.map((address) => address.reference)).toContain('"Echange"."Consigne_Vitesse"');
    expect(s7.every((address) => !address.reference.includes('"'))).toBe(true);
    expect(s7plus.every((address) => !/^DB\d+\./.test(address.reference))).toBe(true);
  });

  it('each gets its OWN transformation code — the two driver tables are disjoint', () => {
    const s7 = addressesOf(s7Book);
    const s7plus = addressesOf(s7plusBook);
    // A REAL is 705 on the classic driver and 1015 on S7Plus. Crossing them is
    // accepted by the API and wrong on the wire, which is why this is asserted.
    expect(s7.map((address) => address.datatype)).toContain(S7Datatype.FLOAT as number);
    expect(s7plus.map((address) => address.datatype)).toContain(S7PlusDatatype.REAL as number);
    expect(s7.every((address) => address.datatype < 1000)).toBe(true);
    expect(s7plus.every((address) => address.datatype >= 1000)).toBe(true);
  });

  it('records the access mode each config was built for — the provenance that keeps them apart', () => {
    expect(new Set(addressesOf(s7Book).map((address) => address.mode))).toEqual(new Set(['s7']));
    expect(new Set(addressesOf(s7plusBook).map((address) => address.mode))).toEqual(new Set(['s7plus']));
  });
});

describe('the rule engine qualifies a classic-S7 catalog like any other', () => {
  it('gives every signal of both lanes a role, with no S7-specific configuration', () => {
    for (const book of [s7Book, s7plusBook]) {
      const roles = classifyEntries(book.entries);
      const unqualified = [...roles.entries()].filter(([, assignment]) => assignment.role === 'unknown').map(([path]) => path);
      expect(unqualified).toEqual([]);
    }
  });

  it('reads the SAME signal the same way on both lanes — the rules key on names and types, not on protocol', () => {
    const classic = classifyEntries(s7Book.entries).get('DB10.Marche')?.role;
    const symbolic = classifyEntries(s7plusBook.entries).get('Echange.Marche')?.role;
    expect(classic).toBe(symbolic);
    expect(classic).toBe('command');
  });
});

describe('the classic-S7 online verifier stays inside its own lane', () => {
  it('sees the data blocks of a classic catalog', () => {
    expect([...dataBlocksAddressedBy(s7Book).keys()]).toEqual([10]);
  });

  it('sees NOTHING to verify in an S7Plus catalog — a symbolic address names no DB', () => {
    expect(dataBlocksAddressedBy(s7plusBook).size).toBe(0);
    const result = crossCheckBookAgainstInventory(s7plusBook, S7_INVENTORY as S7Inventory);
    // It says so plainly instead of reporting every CPU block as "uncatalogued
    // and therefore suspect": an S7Plus catalog is not a failed S7 one.
    expect(result.warnings.map((warning) => warning.code)).toContain('s7browse.no-db-addressed');
    expect(result.warnings.map((warning) => warning.code)).not.toContain('s7browse.db-absent');
    expect(result.verdicts).toHaveLength(0);
  });
});

describe('the two lanes share the ingest switch without overlapping', () => {
  it('routes each STEP 7 format to its own generator', () => {
    const symbols = buildBookFromIngest({ bookId: 'sym', format: 's7sym', text: SYMBOLS_SDF, generatedAt: PROVENANCE.generatedAt });
    expect(symbols.provenance.kind).toBe('s7sym');
    expect(s7Book.provenance.kind).toBe('s7awl');
    // A symbol table catalogues memory areas; the AWL sources catalogue DB members.
    // Neither strays into the other's territory.
    expect(symbols.entries.every((entry) => !/^DB\d+\./.test(String(entry.addresses.s7)))).toBe(true);
    expect(s7Book.entries.every((entry) => /^DB\d+\./.test(String(entry.addresses.s7)))).toBe(true);
  });

  it('refuses a payload aimed at the wrong generator instead of producing an empty book', () => {
    expect(() => buildBookFromIngest({ bookId: 'x', format: 's7awl', text: SYMBOLS_SDF })).toThrow(/sources/);
    expect(() => buildBookFromIngest({ bookId: 'x', format: 's7sym', sources: [{ fileName: 'a.awl', text: AWL_DB_ECHANGE }] })).toThrow(/text/);
  });
});
