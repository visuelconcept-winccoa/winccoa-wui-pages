// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Authoring a DP-type structure by hand: the outline round trip, its error
 * reporting, and the automatic binding of the structure's leaves to a book's
 * signals (including what it refuses to decide).
 */
import { describe, expect, it } from 'vitest';
import type { BookEntry, DpTypeStructure } from './model.js';
import {
  autoBindStructure,
  formatStructureOutline,
  parseStructureOutline,
  structureLeaves
} from './structure.js';

const STRUCTURE: DpTypeStructure = {
  name: 'Equip_Four',
  type: 'Struct',
  children: [
    { name: 'Etat', type: 'Struct', children: [{ name: 'EnChauffe', type: 'Bool' }] },
    {
      name: 'Mesures',
      type: 'Struct',
      children: [
        { name: 'Temperature', type: 'Float' },
        { name: 'Hygrometrie', type: 'Float' }
      ]
    }
  ]
};

const entry = (path: string, leafType: BookEntry['leafType'] = 'Float'): BookEntry => ({
  path,
  sourceType: leafType,
  leafType,
  access: 'r',
  addresses: {}
});

describe('structureLeaves', () => {
  it('lists the leaves with their path below the root', () => {
    expect(structureLeaves(STRUCTURE)).toEqual([
      { segments: ['Etat', 'EnChauffe'], leafType: 'Bool' },
      { segments: ['Mesures', 'Temperature'], leafType: 'Float' },
      { segments: ['Mesures', 'Hygrometrie'], leafType: 'Float' }
    ]);
  });

  it('ignores an empty group (a placeholder nobody filled is not a leaf)', () => {
    const withEmpty: DpTypeStructure = { name: 'T', type: 'Struct', children: [{ name: 'Vide', type: 'Struct', children: [] }] };
    expect(structureLeaves(withEmpty)).toEqual([]);
  });
});

describe('outline round trip', () => {
  it('formats a structure as an indented outline', () => {
    expect(formatStructureOutline(STRUCTURE)).toBe(
      ['Equip_Four', '  Etat', '    EnChauffe : Bool', '  Mesures', '    Temperature : Float', '    Hygrometrie : Float'].join('\n')
    );
  });

  it('parses its own output back to the same structure', () => {
    const { structure, errors } = parseStructureOutline(formatStructureOutline(STRUCTURE), 'Equip_Four');
    expect(errors).toEqual([]);
    expect(structure).toEqual(STRUCTURE);
  });

  it('drops the root line only when it NAMES the type (no silent level loss)', () => {
    // Matching name → recognised as the root and dropped.
    const matching = parseStructureOutline(formatStructureOutline(STRUCTURE), 'Equip_Four');
    expect(matching.structure.children?.map((c) => c.name)).toEqual(['Etat', 'Mesures']);
    // A different name → the line is a MEMBER, not the root: nothing is eaten.
    const renamed = parseStructureOutline(formatStructureOutline(STRUCTURE), 'Autre_Type');
    expect(renamed.structure.name).toBe('Autre_Type');
    expect(renamed.structure.children?.map((c) => c.name)).toEqual(['Equip_Four']);
  });

  it('accepts an outline with no root line (top-level members)', () => {
    const { structure, errors } = parseStructureOutline(['Mesures', '  Temperature : Float', 'Etat', '  Marche : Bool'].join('\n'), 'T');
    expect(errors).toEqual([]);
    expect(structure.children?.map((c) => c.name)).toEqual(['Mesures', 'Etat']);
  });

  it('accepts tabs, blank lines and # comments, and keeps a lone top-level group', () => {
    const { structure, errors } = parseStructureOutline('# le modèle\nMesures\n\n\tTemperature : float\n', 'T');
    expect(errors).toEqual([]);
    expect(structureLeaves(structure)).toEqual([{ segments: ['Mesures', 'Temperature'], leafType: 'Float' }]);
  });
});

describe('outline errors (reported, never thrown)', () => {
  it('names an unknown leaf type and skips the line', () => {
    const { structure, errors } = parseStructureOutline('Temperature : Real', 'T');
    expect(errors[0]).toContain('unknown type "Real"');
    expect(structureLeaves(structure)).toEqual([]);
  });

  it('rejects an over-indented line (no parent at that level)', () => {
    const { errors } = parseStructureOutline('Mesures\n      Temperature : Float', 'T');
    expect(errors.some((e) => e.includes('indented too deep'))).toBe(true);
  });

  it('reports an odd indentation', () => {
    const { errors } = parseStructureOutline('Mesures\n   Temperature : Float', 'T');
    expect(errors.some((e) => e.includes('indented by'))).toBe(true);
  });

  it('reports a duplicate sibling and keeps the first', () => {
    const { structure, errors } = parseStructureOutline('Mesures\n  T : Float\n  T : Int', 'T');
    expect(errors.some((e) => e.includes('duplicated under'))).toBe(true);
    expect(structureLeaves(structure)).toEqual([{ segments: ['Mesures', 'T'], leafType: 'Float' }]);
  });

  it('sanitises an invalid identifier and says so', () => {
    const { structure, errors } = parseStructureOutline('Mesures\n  Temp érature (°C) : Float', 'T');
    expect(errors.some((e) => e.includes('sanitised to'))).toBe(true);
    expect(structureLeaves(structure)[0].segments[1]).not.toContain(' ');
  });
});

describe('autoBindStructure', () => {
  it('binds on an identical full path', () => {
    const entries = [entry('Mesures.Temperature'), entry('Mesures.Hygrometrie'), entry('Etat.EnChauffe', 'Bool')];
    const result = autoBindStructure(STRUCTURE, entries);
    expect(result.bindings).toEqual({
      'Etat.EnChauffe': 'Etat.EnChauffe',
      'Mesures.Temperature': 'Mesures.Temperature',
      'Mesures.Hygrometrie': 'Mesures.Hygrometrie'
    });
    expect(result.unbound).toEqual([]);
  });

  it('binds a book rooted at a block or an instance (suffix match)', () => {
    const entries = [
      entry('DB_Four.Mesures.Temperature'),
      entry('DB_Four.Mesures.Hygrometrie'),
      entry('DB_Four.Etat.EnChauffe', 'Bool')
    ];
    expect(autoBindStructure(STRUCTURE, entries).bindings['Mesures.Temperature']).toBe('DB_Four.Mesures.Temperature');
  });

  it('falls back to the leaf NAME when the branches differ', () => {
    const entries = [entry('PLC.Group7.Temperature'), entry('PLC.Group7.Hygrometrie'), entry('PLC.Bits.EnChauffe', 'Bool')];
    const result = autoBindStructure(STRUCTURE, entries);
    expect(result.bindings['Mesures.Temperature']).toBe('PLC.Group7.Temperature');
    expect(result.bindings['Etat.EnChauffe']).toBe('PLC.Bits.EnChauffe');
  });

  it('matches through separators and case (Temp_Produit ↔ TempProduit)', () => {
    const target: DpTypeStructure = { name: 'T', type: 'Struct', children: [{ name: 'Temp_Produit', type: 'Float' }] };
    expect(autoBindStructure(target, [entry('Mes.TempProduit')]).bindings['Temp_Produit']).toBe('Mes.TempProduit');
  });

  it('REFUSES to pick between two equal candidates and reports them', () => {
    const entries = [entry('Ligne1.Temperature'), entry('Ligne2.Temperature')];
    const target: DpTypeStructure = { name: 'T', type: 'Struct', children: [{ name: 'Temperature', type: 'Float' }] };
    const result = autoBindStructure(target, entries);
    expect(result.bindings['Temperature']).toBeUndefined();
    expect(result.ambiguous).toEqual([{ leaf: 'Temperature', candidates: ['Ligne1.Temperature', 'Ligne2.Temperature'] }]);
  });

  it('lists the leaves it could not bind and the entries nobody used', () => {
    const result = autoBindStructure(STRUCTURE, [entry('Mesures.Temperature'), entry('Autre.Inutilise')]);
    expect(result.unbound).toEqual(['Etat.EnChauffe', 'Mesures.Hygrometrie']);
    expect(result.unusedEntries).toEqual(['Autre.Inutilise']);
  });

  it('prefers an unused entry but allows a legitimate reuse', () => {
    // Two leaves, one candidate each by name, plus one shared fallback.
    const target: DpTypeStructure = {
      name: 'T',
      type: 'Struct',
      children: [
        { name: 'Vitesse', type: 'Float' },
        { name: 'Vitesse_Copie', type: 'Float' }
      ]
    };
    const result = autoBindStructure(target, [entry('M.Vitesse')]);
    expect(result.bindings['Vitesse']).toBe('M.Vitesse');
    // The second leaf finds no name match of its own → unbound, not silently reused.
    expect(result.unbound).toEqual(['Vitesse_Copie']);
  });
});
