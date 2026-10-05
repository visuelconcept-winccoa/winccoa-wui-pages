// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Symbol-table contract: the three export dialects produce the SAME book, the
 * column order is detected rather than configured, the area decides the access,
 * and the one thing a symbol table cannot contain is said out loud.
 */
import { describe, expect, it } from 'vitest';
import { formatWarning } from '../warnings.js';
import {
  SYMBOLS_ASC,
  SYMBOLS_CSV_ADDRESS_FIRST,
  SYMBOLS_SDF,
  SYMBOLS_WIDTH_MISMATCH
} from '../samples/s7-fixtures.js';
import { buildBookFromS7Symbols, canonicalS7Type, detectColumnOrder, parseS7SymbolTable, splitSymbolLine } from './symbols.js';

const PROVENANCE = { generatedAt: '2026-08-02T00:00:00.000Z' };

function book(text: string) {
  return buildBookFromS7Symbols({ bookId: 'sym1', name: 'Symboles', text, provenance: PROVENANCE });
}

const codes = (warnings: { code: string }[]) => warnings.map((warning) => warning.code);

describe('splitSymbolLine', () => {
  it('reads a quoted SDF record, keeping a comma inside a comment', () => {
    expect(splitSymbolLine('"Defaut","E      0.3","BOOL","Defaut pompe, toutes causes"')).toEqual([
      'Defaut',
      'E      0.3',
      'BOOL',
      'Defaut pompe, toutes causes'
    ]);
  });

  it('strips the ASC record-length prefix and re-joins the sub-columned address', () => {
    // `A      4.0` is padded INSIDE the address column, so a run-of-spaces split
    // tears the operand in two. It is put back because `A4.0` parses and `A` does not.
    expect(splitSymbolLine('126,Marche           A      4.0        BOOL      Ordre de marche')).toEqual([
      'Marche',
      'A4.0',
      'BOOL',
      'Ordre de marche'
    ]);
    expect(splitSymbolLine('126,Pression         PEW  256          INT       Pression')).toEqual(['Pression', 'PEW256', 'INT', 'Pression']);
  });

  it('keeps a multi-word comment as ONE field (single spaces are not separators)', () => {
    const fields = splitSymbolLine('126,Debit            MD      30        REAL      Consigne de debit horaire');
    expect(fields[3]).toBe('Consigne de debit horaire');
  });

  it('splits a semicolon CSV', () => {
    expect(splitSymbolLine('A 4.0;Marche;BOOL;Ordre')).toEqual(['A 4.0', 'Marche', 'BOOL', 'Ordre']);
  });
});

describe('detectColumnOrder', () => {
  it('picks the column that holds the operands, whichever it is', () => {
    expect(detectColumnOrder([['Marche', 'A 4.0'], ['Defaut', 'E 0.3']])).toBe(1);
    expect(detectColumnOrder([['A 4.0', 'Marche'], ['E 0.3', 'Defaut']])).toBe(0);
  });

  it('refuses rather than guesses when NEITHER column holds an operand', () => {
    expect(detectColumnOrder([['Nom', 'Valeur'], ['Autre', 'Chose']])).toBeNull();
  });
});

describe('canonicalS7Type', () => {
  it('normalises the shouted symbol-table spelling to the TIA one', () => {
    expect(canonicalS7Type('BOOL')).toBe('Bool');
    expect(canonicalS7Type('REAL')).toBe('Real');
    expect(canonicalS7Type('TIME_OF_DAY')).toBe('Time_Of_Day');
    expect(canonicalS7Type('STRING[16]')).toBe('String[16]');
  });

  it('passes an unknown type through untouched (so it can be REPORTED as unknown)', () => {
    expect(canonicalS7Type('UDT_Moteur')).toBe('UDT_Moteur');
  });
});

describe('parseS7SymbolTable', () => {
  it('separates the signals from the block directory', () => {
    const table = parseS7SymbolTable(SYMBOLS_SDF);
    expect(table.signals.map((signal) => signal.symbol)).toEqual([
      'Marche_Pompe_1',
      'Defaut_Pompe_1',
      'Pression_Reseau',
      'Compteur_Cycles',
      'Consigne_Debit'
    ]);
    // A timer and two DBs are directory entries, never signals.
    expect(table.blocks).toEqual([
      { kind: 'DB', number: 10, symbol: 'Echange', comment: "Bloc d'echange superviseur" },
      { kind: 'DB', number: 11, symbol: 'Recettes', comment: 'Bloc de recettes' }
    ]);
  });

  it('reports a datatype that CONTRADICTS the width of its own address', () => {
    const table = parseS7SymbolTable(SYMBOLS_WIDTH_MISMATCH);
    expect(codes(table.warnings)).toContain('s7sym.width-mismatch');
    // Reported, not dropped: the address is still the operator's best information.
    expect(table.signals).toHaveLength(2);
  });

  it('skips a header row without complaining about it', () => {
    const table = parseS7SymbolTable(SYMBOLS_CSV_ADDRESS_FIRST);
    expect(codes(table.warnings)).not.toContain('s7sym.unreadable-address');
    expect(table.addressColumn).toBe(0);
  });
});

describe('buildBookFromS7Symbols', () => {
  it('derives the ACCESS from the area — the process image is evidence, not a default', () => {
    const entries = new Map(book(SYMBOLS_SDF).entries.map((entry) => [entry.path, entry]));
    expect(entries.get('Marche_Pompe_1')?.access).toBe('w'); // A 4.0 — output image
    expect(entries.get('Defaut_Pompe_1')?.access).toBe('r'); // E 0.3 — input image
    expect(entries.get('Pression_Reseau')?.access).toBe('r'); // PEW 256 — peripheral input
    expect(entries.get('Compteur_Cycles')?.access).toBe('rw'); // MW 20 — flag
    // Every one of them is DECLARED: nothing here was assumed.
    for (const entry of book(SYMBOLS_SDF).entries) expect(entry.accessSource).toBe('declared');
  });

  it('maps the datatype and carries the operand as the s7 candidate address', () => {
    const entries = new Map(book(SYMBOLS_SDF).entries.map((entry) => [entry.path, entry]));
    expect(entries.get('Consigne_Debit')).toMatchObject({
      sourceType: 'Real',
      leafType: 'Float',
      addresses: { s7: 'MD30' },
      comment: 'Consigne de debit (m3/h)'
    });
    expect(entries.get('Marche_Pompe_1')?.addresses.s7).toBe('A4.0');
  });

  it('reads the German and the English mnemonics into the SAME book', () => {
    const german = book(SYMBOLS_ASC);
    const shared = ['Marche_Pompe_1', 'Defaut_Pompe_1', 'Compteur_Cycles', 'Consigne_Debit'];
    const sdf = new Map(book(SYMBOLS_SDF).entries.map((entry) => [entry.path, entry.addresses.s7]));
    for (const path of shared) {
      expect(german.entries.find((entry) => entry.path === path)?.addresses.s7).toBe(sdf.get(path));
    }
  });

  it('reads an address-first CSV identically to a symbol-first SDF', () => {
    const csv = new Map(book(SYMBOLS_CSV_ADDRESS_FIRST).entries.map((entry) => [entry.path, entry.addresses.s7]));
    expect(csv.get('Marche_Pompe_1')).toBe('A4.0');
    expect(csv.get('Compteur_Cycles')).toBe('MW20');
  });

  it('SAYS that the data blocks it names hold no signal here — the caveat of the format', () => {
    const warning = book(SYMBOLS_SDF).warnings.find((entry) => entry.code === 's7sym.no-db-content');
    expect(warning).toBeDefined();
    expect(formatWarning(warning!)).toContain('Echange = DB10');
    expect(formatWarning(warning!)).toContain('AWL');
  });

  it('refuses a file that is not a symbol table instead of returning an empty book', () => {
    const result = book('nom;valeur\nune;autre\n');
    expect(codes(result.warnings)).toContain('s7sym.no-address-column');
    expect(result.entries).toHaveLength(0);
  });

  it('records its generator in the provenance', () => {
    expect(book(SYMBOLS_SDF).provenance).toMatchObject({ kind: 's7sym', generatedAt: PROVENANCE.generatedAt });
  });
});
