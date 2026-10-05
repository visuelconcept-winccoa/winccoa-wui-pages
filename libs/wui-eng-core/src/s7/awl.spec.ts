// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AWL/STL source contract: a DATA_BLOCK declaration becomes addressable entries
 * whose offsets follow the classic standard layout, UDTs expand and are carried
 * as types, an instance DB takes its members from the type it names, and the
 * symbol table's block directory decides how the entries are pathed.
 */
import { describe, expect, it } from 'vitest';
import { formatWarning } from '../warnings.js';
import { AWL_DB_ECHANGE, AWL_DB_INSTANCE, AWL_MULTI_BLOCK, AWL_PARTLY_BROKEN, AWL_UDT_MOTEUR, SYMBOLS_SDF } from '../samples/s7-fixtures.js';
import { buildBookFromAwlSources, parseAwlSource } from './awl.js';
import { parseS7SymbolTable } from './symbols.js';

const PROVENANCE = { generatedAt: '2026-08-02T00:00:00.000Z' };

function book(documents: { fileName: string; text: string }[], blockNames?: ReturnType<typeof parseS7SymbolTable>['blocks']) {
  return buildBookFromAwlSources({
    bookId: 'awl1',
    name: 'Sources',
    documents,
    provenance: PROVENANCE,
    ...(blockNames === undefined ? {} : { blockNames })
  });
}

const addressOf = (result: ReturnType<typeof book>, path: string) => result.entries.find((entry) => entry.path === path)?.addresses.s7;
const codes = (warnings: { code: string }[]) => warnings.map((warning) => warning.code);

describe('parseAwlSource', () => {
  it('reads the block number, the members and their trailing comments', () => {
    const { blocks } = parseAwlSource(AWL_DB_ECHANGE);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'db', number: 10 });
    expect(blocks[0]?.members.map((member) => member.name)).toEqual([
      'Consigne_Vitesse',
      'Marche',
      'Arret',
      'Compteur_Pieces',
      'Mesures',
      'Moteur'
    ]);
    expect(blocks[0]?.members[0]?.comment).toBe('Consigne de vitesse (tr/min)');
  });

  it('drops the initial value, keeping the declared type', () => {
    const { blocks } = parseAwlSource(AWL_DB_ECHANGE);
    // `REAL := 0.000000e+000` declares a REAL, canonicalised to the TIA spelling.
    expect(blocks[0]?.members[0]?.dataType).toBe('Real');
  });

  it('never reads the BEGIN section — those are initial values, not a layout', () => {
    const { blocks } = parseAwlSource(AWL_DB_ECHANGE);
    expect(blocks[0]?.members.some((member) => member.name === 'FALSE')).toBe(false);
  });

  it('reads a UDT declaration as a type, and a UDT reference as a struct', () => {
    const { blocks } = parseAwlSource(AWL_UDT_MOTEUR);
    expect(blocks[0]).toMatchObject({ kind: 'udt', name: 'UDT_Moteur' });
    const echange = parseAwlSource(AWL_DB_ECHANGE).blocks[0];
    expect(echange?.members.at(-1)).toMatchObject({ name: 'Moteur', dataType: 'Struct', udtRef: 'UDT_Moteur' });
  });

  it('reports a declaration it cannot read, WITH its line, instead of dropping it silently', () => {
    const { blocks, warnings } = parseAwlSource(AWL_PARTLY_BROKEN);
    expect(codes(warnings)).toContain('s7awl.unreadable-declaration');
    expect(formatWarning(warnings[0]!)).toContain('Line 4');
    // The readable members survive: one bad line does not cost the block.
    expect(blocks[0]?.members.map((member) => member.name)).toEqual(['Bonne_Mesure', 'Autre_Mesure']);
  });

  it('reads EVERY declaration of one file — a source commonly holds several blocks', () => {
    const { blocks } = parseAwlSource(AWL_MULTI_BLOCK);
    expect(blocks.map((block) => [block.kind, block.number])).toEqual([
      ['udt', undefined],
      ['db', 20],
      ['db', 21]
    ]);
    expect(blocks[0]?.name).toBe('UDT_Vanne');
  });

  it('refuses a file that declares no block', () => {
    expect(codes(parseAwlSource('L MW 20\nT MW 22\n').warnings)).toContain('s7awl.no-block');
  });
});

describe('buildBookFromAwlSources', () => {
  const documents = [
    { fileName: 'UDT_Moteur.awl', text: AWL_UDT_MOTEUR },
    { fileName: 'DB10.awl', text: AWL_DB_ECHANGE }
  ];

  it('computes CLASSIC operands following the standard layout', () => {
    const result = book(documents);
    expect(addressOf(result, 'DB10.Consigne_Vitesse')).toBe('DB10.DBD0');
    // Two BOOLs pack into one byte, and the DINT that follows realigns to a word.
    expect(addressOf(result, 'DB10.Marche')).toBe('DB10.DBX4.0');
    expect(addressOf(result, 'DB10.Arret')).toBe('DB10.DBX4.1');
    expect(addressOf(result, 'DB10.Compteur_Pieces')).toBe('DB10.DBD6');
  });

  it('flattens a nested STRUCT into dotted paths', () => {
    const result = book(documents);
    expect(addressOf(result, 'DB10.Mesures.Debit')).toBe('DB10.DBD10');
    expect(addressOf(result, 'DB10.Mesures.Pression')).toBe('DB10.DBD14');
  });

  it('expands a UDT reference and records the member origin as a type id', () => {
    const result = book(documents);
    expect(addressOf(result, 'DB10.Moteur.Vitesse')).toBe('DB10.DBD20');
    expect(result.entries.find((entry) => entry.path === 'DB10.Moteur.Vitesse')?.typeId).toBe('UDT_Moteur');
    expect(result.types.map((type) => type.id)).toEqual(['UDT_Moteur']);
  });

  it('names the block from the SYMBOL TABLE when one was ingested beside the sources', () => {
    const { blocks } = parseS7SymbolTable(SYMBOLS_SDF);
    const result = book(documents, blocks);
    // Same address, readable path: this is the only thing the directory changes.
    expect(addressOf(result, 'Echange.Consigne_Vitesse')).toBe('DB10.DBD0');
    expect(result.entries.every((entry) => !entry.path.startsWith('DB10.'))).toBe(true);
  });

  it('takes an INSTANCE block’s members from the type it names', () => {
    const result = book([
      { fileName: 'UDT_Moteur.awl', text: AWL_UDT_MOTEUR },
      { fileName: 'DB12.awl', text: AWL_DB_INSTANCE }
    ]);
    expect(addressOf(result, 'DB12.Vitesse')).toBe('DB12.DBD2');
    expect(addressOf(result, 'DB12.Retour_Marche')).toBe('DB12.DBX0.0');
  });

  it('refuses an instance block whose type was not ingested, naming what is missing', () => {
    const result = book([{ fileName: 'DB12.awl', text: AWL_DB_INSTANCE }]);
    expect(codes(result.warnings)).toContain('s7awl.instance-type-missing');
    expect(result.entries).toHaveLength(0);
  });

  it('builds a whole catalog from ONE multi-block file, UDT included', () => {
    const result = book([{ fileName: 'Pompage.awl', text: AWL_MULTI_BLOCK }]);
    // Two data blocks out of a single document, each addressed independently.
    expect(addressOf(result, 'DB20.Debit')).toBe('DB20.DBD0');
    expect(addressOf(result, 'DB20.Temperature')).toBe('DB20.DBD8');
    expect(addressOf(result, 'DB21.Marche_Generale')).toBe('DB21.DBX0.0');
    // …and a UDT declared in the SAME file resolves for the block below it.
    expect(addressOf(result, 'DB21.Vanne_Amont.Position')).toBe('DB21.DBD4');
    expect(addressOf(result, 'DB21.Vanne_Aval.Ouverte')).toBe('DB21.DBX8.0');
    expect(result.types.map((type) => type.id)).toEqual(['UDT_Vanne']);
  });

  it('mixes single-block and multi-block files in one ingestion', () => {
    const result = book([
      { fileName: 'UDT_Moteur.awl', text: AWL_UDT_MOTEUR },
      { fileName: 'DB10.awl', text: AWL_DB_ECHANGE },
      { fileName: 'Pompage.awl', text: AWL_MULTI_BLOCK }
    ]);
    const blocks = new Set(result.entries.map((entry) => entry.path.split('.')[0]));
    expect([...blocks].sort()).toEqual(['DB10', 'DB20', 'DB21']);
    // A UDT from one file, a UDT from another: both carried, neither shadowed.
    expect(result.types.map((type) => type.id).sort()).toEqual(['UDT_Moteur', 'UDT_Vanne']);
  });

  it('states the layout assumption every address of the book rests on', () => {
    const warning = book(documents).warnings.find((entry) => entry.code === 's7awl.standard-layout');
    expect(warning).toBeDefined();
    expect(formatWarning(warning!)).toContain('optimized');
  });

  it('maps the datatypes and records its generator', () => {
    const result = book(documents);
    expect(result.entries.find((entry) => entry.path === 'DB10.Marche')).toMatchObject({ sourceType: 'Bool', leafType: 'Bool', access: 'rw' });
    expect(result.provenance).toMatchObject({ kind: 's7awl' });
  });
});
