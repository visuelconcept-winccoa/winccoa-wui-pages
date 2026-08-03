// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Control Expert variables-export → AddressBook: format tolerance, type
 * mapping, and the engineering checks (unlocated variables, register overlaps,
 * topological/unmapped cases) that make the book trustworthy.
 */
import { describe, expect, it } from 'vitest';
import { formatWarning as warningText } from '../warnings.js';
import { M580_STATION_CSV } from '../samples/schneider-fixtures.js';
import {
  buildBookFromSchneiderExport,
  detectDelimiter,
  isUnmappedSchneiderType,
  schneiderLeafType,
  schneiderTypeSpan
} from './variables.js';

function book(text = M580_STATION_CSV) {
  return buildBookFromSchneiderExport({
    bookId: 'book-m580',
    name: 'M580 station',
    text,
    provenance: { generatedAt: '2026-08-02T00:00:00.000Z' },
    interface: { protocol: 'modbus', connection: 'M580_Station' }
  });
}

describe('type mapping', () => {
  it('maps IEC/Schneider elementary types', () => {
    expect(schneiderLeafType('EBOOL')).toBe('Bool');
    expect(schneiderLeafType('INT')).toBe('Int');
    expect(schneiderLeafType('UINT')).toBe('UInt');
    expect(schneiderLeafType('DINT')).toBe('Int');
    expect(schneiderLeafType('UDINT')).toBe('UInt');
    expect(schneiderLeafType('REAL')).toBe('Float');
    expect(schneiderLeafType('DWORD')).toBe('Bit32');
    expect(schneiderLeafType('STRING[16]')).toBe('String');
  });

  it('reports the word span of 32-bit types', () => {
    expect(schneiderTypeSpan('INT')).toBe(1);
    expect(schneiderTypeSpan('DINT')).toBe(2);
    expect(schneiderTypeSpan('REAL')).toBe(2);
  });

  it('flags derived/unknown types instead of inventing a mapping', () => {
    expect(isUnmappedSchneiderType('PID_Params')).toBe(true);
    expect(isUnmappedSchneiderType('REAL')).toBe(false);
  });
});

describe('delimiter detection', () => {
  it('detects semicolon, tab and comma exports', () => {
    expect(detectDelimiter('Nom;Adresse;Type')).toBe(';');
    expect(detectDelimiter('Name\tAddress\tType')).toBe('\t');
    expect(detectDelimiter('Name,Address,Type')).toBe(',');
  });
});

describe('buildBookFromSchneiderExport', () => {
  it('resolves located variables to Modbus references', () => {
    const result = book();
    const byPath = new Map(result.entries.map((e) => [e.path, e]));
    expect(byPath.get('Consigne_Debit')?.addresses.modbus).toBe('40101');
    expect(byPath.get('Consigne_Debit')?.leafType).toBe('Int');
    expect(byPath.get('Consigne_Debit')?.unit).toBe('m3/h');
    expect(byPath.get('Pression_Reseau')?.addresses.modbus).toBe('40105');
    expect(byPath.get('Marche_Pompe1')?.addresses.modbus).toBe('00011');
    expect(byPath.get('Etat_Vanne')?.addresses.modbus).toBe('30201');
  });

  it('derives access from the Modbus object (%IW read-only, %MW/%M writable)', () => {
    const byPath = new Map(book().entries.map((e) => [e.path, e]));
    expect(byPath.get('Etat_Vanne')?.access).toBe('r');
    expect(byPath.get('Consigne_Debit')?.access).toBe('rw');
    expect(byPath.get('Marche_Pompe1')?.access).toBe('rw');
  });

  it('excludes an unlocated variable and says why', () => {
    const result = book();
    expect(result.entries.some((e) => e.path === 'Recette_Courante')).toBe(false);
    expect(result.warnings.map(warningText).join('\n')).toMatch(/Recette_Courante.*is not located/);
  });

  it('excludes a topological address and says why', () => {
    const result = book();
    expect(result.entries.some((e) => e.path === 'Securite_Niveau_Bas')).toBe(false);
    expect(result.warnings.map(warningText).join('\n')).toMatch(/Securite_Niveau_Bas.*topological address/);
  });

  it('detects the register overlap between a DINT and the next word', () => {
    const result = book();
    expect(result.warnings.map(warningText).join('\n')).toMatch(/Register 113 overlaps between "Debit_Brut" and "Niveau_Cuve"/);
  });

  it('keeps a derived-type variable but marks it unmapped', () => {
    const entry = book().entries.find((e) => e.path === 'Bloc_Regulation');
    expect(entry?.unmapped).toBe(true);
    expect(entry?.leafType).toBe('String');
    expect(book().warnings.map(warningText).join('\n')).toMatch(/PID_Params.*has no verified mapping/);
  });

  it('carries the PLC interface and the provenance', () => {
    const result = book();
    expect(result.interface).toMatchObject({ protocol: 'modbus', connection: 'M580_Station' });
    expect(result.provenance.kind).toBe('csv');
  });

  it('falls back to positional columns when no header is recognised', () => {
    const result = book('Pompe_Marche\t%MW10\tINT\tsans en-tête\n');
    expect(result.entries[0]).toMatchObject({ path: 'Pompe_Marche', addresses: { modbus: '40011' } });
    expect(result.warnings.map(warningText).join('\n')).toMatch(/No recognised header/);
  });
});
