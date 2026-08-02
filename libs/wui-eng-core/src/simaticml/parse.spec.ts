// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SimaticML parsing contract: DB + UDT exports become an AddressBook whose
 * entries carry the right leaf types, comments, UDT expansion, and the
 * per-access-mode candidate addresses (classic operands ONLY for standard
 * blocks, computed offsets).
 */
import { describe, expect, it } from 'vitest';
import { formatWarning as warningText } from '../warnings.js';
import {
  DB_ECHANGE_STANDARD_XML,
  DB_FOUR_OPTIMIZED_XML,
  UDT_MOTEUR_XML
} from '../samples/simaticml-fixtures.js';
import { buildBookFromSimaticMl, parseSimaticMlDocument } from './parse.js';

const PROVENANCE = { generatedAt: '2026-08-02T00:00:00.000Z' };

function book(documents: { fileName: string; xml: string }[]) {
  return buildBookFromSimaticMl({ bookId: 'book1', name: 'Book 1', documents, provenance: PROVENANCE });
}

describe('parseSimaticMlDocument', () => {
  it('reads name, number, layout and nested members of a global DB', () => {
    const block = parseSimaticMlDocument(DB_ECHANGE_STANDARD_XML);
    expect(block.kind).toBe('db');
    expect(block.name).toBe('DB_Echange');
    expect(block.number).toBe(12);
    expect(block.memoryLayout).toBe('Standard');
    expect(block.members.map((m) => m.name)).toEqual([
      'Vie',
      'Acquit',
      'ModeAuto',
      'Reserve',
      'ConsigneTemp',
      'MesureTemp',
      'NbPieces',
      'Recette',
      'Statut'
    ]);
    const statut = block.members.at(-1);
    expect(statut?.dataType).toBe('Struct');
    expect(statut?.children.map((m) => m.name)).toEqual(['Code', 'Message']);
  });

  it('reads a UDT export and decodes quoted type references', () => {
    const udt = parseSimaticMlDocument(UDT_MOTEUR_XML);
    expect(udt.kind).toBe('udt');
    expect(udt.name).toBe('UDT_Moteur');
    const db = parseSimaticMlDocument(DB_FOUR_OPTIMIZED_XML);
    const moteur = db.members.find((m) => m.name === 'Moteur');
    expect(moteur?.udtRef).toBe('UDT_Moteur');
  });

  it('keeps entity-decoded comments', () => {
    const block = parseSimaticMlDocument(DB_ECHANGE_STANDARD_XML);
    expect(block.members[0].comment).toBe('Bit de vie');
    expect(block.members.find((m) => m.name === 'ConsigneTemp')?.comment).toBe('Consigne température (°C)');
  });
});

describe('buildBookFromSimaticMl', () => {
  it('expands UDT members and carries the UDT as a book type', () => {
    const result = book([
      { fileName: 'UDT_Moteur.xml', xml: UDT_MOTEUR_XML },
      { fileName: 'DB_Four.xml', xml: DB_FOUR_OPTIMIZED_XML }
    ]);
    expect(result.types.map((t) => t.id)).toEqual(['UDT_Moteur']);
    const vitesse = result.entries.find((e) => e.path === 'DB_Four.Moteur.Vitesse');
    expect(vitesse).toBeDefined();
    expect(vitesse?.leafType).toBe('Float');
    expect(vitesse?.typeId).toBe('UDT_Moteur');
    expect(vitesse?.comment).toBe('Vitesse (tr/min)');
  });

  it('gives optimized blocks symbolic candidates only (no classic operand)', () => {
    const result = book([
      { fileName: 'UDT_Moteur.xml', xml: UDT_MOTEUR_XML },
      { fileName: 'DB_Four.xml', xml: DB_FOUR_OPTIMIZED_XML }
    ]);
    const temp = result.entries.find((e) => e.path === 'DB_Four.Mesures.Temperature');
    expect(temp?.addresses.s7plus).toBe('"DB_Four"."Mesures"."Temperature"');
    expect(temp?.addresses.opcua).toBe('ns=3;s="DB_Four"."Mesures"."Temperature"');
    expect(temp?.addresses.s7).toBeUndefined();
  });

  it('computes classic operands for a standard block', () => {
    const result = book([{ fileName: 'DB_Echange.xml', xml: DB_ECHANGE_STANDARD_XML }]);
    const byPath = new Map(result.entries.map((e) => [e.path, e]));
    expect(byPath.get('DB_Echange.Vie')?.addresses.s7).toBe('DB12.DBX0.0');
    expect(byPath.get('DB_Echange.ModeAuto')?.addresses.s7).toBe('DB12.DBX0.2');
    expect(byPath.get('DB_Echange.Reserve')?.addresses.s7).toBe('DB12.DBB1');
    expect(byPath.get('DB_Echange.ConsigneTemp')?.addresses.s7).toBe('DB12.DBD2');
    expect(byPath.get('DB_Echange.NbPieces')?.addresses.s7).toBe('DB12.DBW10');
    expect(byPath.get('DB_Echange.Recette')?.addresses.s7).toBe('DB12.DBB12');
    expect(byPath.get('DB_Echange.Statut.Code')?.addresses.s7).toBe('DB12.DBW34');
  });

  it('skips arrays and missing UDTs with warnings instead of failing', () => {
    const result = book([{ fileName: 'DB_Four.xml', xml: DB_FOUR_OPTIMIZED_XML }]);
    expect(result.entries.some((e) => e.path.startsWith('DB_Four.Alarmes'))).toBe(false);
    expect(result.entries.some((e) => e.path.startsWith('DB_Four.Moteur'))).toBe(false);
    expect(result.warnings.map(warningText).join('\n')).toContain('array datatypes are not imported');
    expect(result.warnings.map(warningText).join('\n')).toContain('UDT "UDT_Moteur" is not part of the bundle');
  });
});
