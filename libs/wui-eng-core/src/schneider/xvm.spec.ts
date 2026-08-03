// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * XVM/XSY reader: spelling tolerance (Unity `elementaryVariable`/`typeName`/
 * `topologicalAddress` AND capitalised `Variable`/`Type`/`Address`), Unity-style
 * `<attribute>` pairs, structured variables (members only), and the calibration
 * diagnostic when nothing is recognised — the schema is NOT vendor-verified, so
 * the reader must fail LOUD, never silently empty.
 */
import { describe, expect, it } from 'vitest';
import { formatWarning as warningText } from '../warnings.js';
import { ALT_SPELLING_XVM, M580_PESAGE_XVM } from '../samples/schneider-fixtures.js';
import { buildBookFromXvm, parseXvmVariables } from './xvm.js';

describe('parseXvmVariables — Unity spelling', () => {
  it('reads name, typeName, topologicalAddress and the comment child', () => {
    const { variables } = parseXvmVariables(M580_PESAGE_XVM);
    const byName = new Map(variables.map((v) => [v.name, v]));
    expect(byName.get('Poids_Brut')).toMatchObject({
      address: '%MF400',
      type: 'REAL',
      comment: 'Poids brut bascule',
      unit: 'kg'
    });
    expect(byName.get('Poids_Net')?.comment).toBe('Poids net après tare');
  });

  it('picks units from Unity-style <attribute name= value=/> children', () => {
    const { variables } = parseXvmVariables(M580_PESAGE_XVM);
    expect(variables.find((v) => v.name === 'Cadence_Pesee')?.unit).toBe('p/min');
    expect(variables.find((v) => v.name === 'Nb_Pesees')?.unit).toBeUndefined();
  });

  it('emits the MEMBERS of a structured variable, not the container', () => {
    const { variables } = parseXvmVariables(M580_PESAGE_XVM);
    const names = variables.map((v) => v.name);
    expect(names).not.toContain('Recette');
    expect(names).toContain('Recette.Consigne');
    expect(names).toContain('Recette.Tolerance');
    expect(variables.find((v) => v.name === 'Recette.Consigne')).toMatchObject({ address: '%MW420', type: 'INT', unit: 'kg' });
  });

  it('reports a member with no own address instead of guessing its offset', () => {
    const { variables, warnings } = parseXvmVariables(M580_PESAGE_XVM);
    expect(variables.some((v) => v.name === 'Recette.Libelle')).toBe(false);
    expect(warnings.map(warningText).join('\n')).toMatch(/Recette\.Libelle.*has no address of its own/);
  });
});

describe('parseXvmVariables — tolerance', () => {
  it('reads a capitalised alternative spelling (Variable/Type/Address/Description)', () => {
    const { variables, warnings } = parseXvmVariables(ALT_SPELLING_XVM);
    expect(warnings).toHaveLength(0);
    expect(variables).toEqual([
      { name: 'Debit_Dosage', address: '%MF500', type: 'REAL', comment: 'Débit de dosage', unit: 'm3/h' },
      { name: 'Vanne_Ouverte', address: '%M50', type: 'EBOOL', comment: 'Retour vanne ouverte', unit: undefined }
    ]);
  });

  it('fails LOUD with the encountered element names when nothing matches', () => {
    const { variables, warnings, elements } = parseXvmVariables(
      '<?xml version="1.0"?><Root><Something Foo="1"/><Other Bar="2"/><Other Bar="3"/></Root>'
    );
    expect(variables).toHaveLength(0);
    expect(warnings.map(warningText).join('\n')).toMatch(/XVM schema is unverified/);
    expect(warnings.map(warningText).join('\n')).toMatch(/Other\(2\)/);
    expect(elements['Other']).toBe(2);
  });

  it('reports unreadable XML rather than throwing', () => {
    const { variables, warnings } = parseXvmVariables('<Root><unclosed>');
    expect(variables).toHaveLength(0);
    expect(warningText(warnings[0])).toMatch(/Unreadable XML/);
  });
});

describe('buildBookFromXvm', () => {
  it('applies the SHARED engineering resolution (Modbus refs, access, checks)', () => {
    const book = buildBookFromXvm({
      bookId: 'book-xvm',
      name: 'Pesage',
      xml: M580_PESAGE_XVM,
      provenance: { file: 'M580_Pesage.xvm', generatedAt: '2026-08-02T00:00:00.000Z' },
      interface: { protocol: 'modbus', connection: 'M580_Station' }
    });
    const byPath = new Map(book.entries.map((e) => [e.path, e]));
    // %MF400 → holding 40401 (two-word overlay), %M40 → coil 00041.
    expect(byPath.get('Poids_Brut')).toMatchObject({ addresses: { modbus: '40401' }, leafType: 'Float', unit: 'kg', access: 'rw' });
    expect(byPath.get('Bascule_Stable')).toMatchObject({ addresses: { modbus: '00041' }, leafType: 'Bool' });
    expect(byPath.get('Nb_Pesees')).toMatchObject({ addresses: { modbus: '40409' }, leafType: 'UInt' });
    expect(byPath.get('Recette.Tolerance')).toMatchObject({ addresses: { modbus: '40422' }, unit: 'g' });
  });

  it('always carries the unverified-schema warning first', () => {
    const book = buildBookFromXvm({ bookId: 'b', xml: M580_PESAGE_XVM });
    expect(warningText(book.warnings[0])).toMatch(/schema not verified against a vendor export/);
  });

  it('detects a register overlap coming from an XVM export too', () => {
    const xml = `<VariableList><variables>
      <elementaryVariable name="Debit" typeName="DINT" topologicalAddress="%MW112"/>
      <elementaryVariable name="Niveau" typeName="INT" topologicalAddress="%MW113"/>
    </variables></VariableList>`;
    const book = buildBookFromXvm({ bookId: 'b', xml });
    expect(book.warnings.map(warningText).join('\n')).toMatch(/Register 113 overlaps between "Debit" and "Niveau"/);
  });
});
