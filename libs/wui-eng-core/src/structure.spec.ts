// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Authoring a DP-type structure by hand: the outline round trip, its error
 * reporting, and the automatic binding of the structure's leaves to a book's
 * signals (including what it refuses to decide).
 */
import { describe, expect, it } from 'vitest';
import { formatWarning as warningText } from './warnings.js';
import type { AddressBook, BookEntry, DpTypeStructure } from './model.js';
import {
  addStructureChild,
  autoBindStructure,
  formatStructureOutline,
  parseStructureOutline,
  removeStructureNode,
  renameStructureNode,
  setStructureNodeType,
  structureLeaves,
  structureNodeAt,
  templateCoverage,
  templateIdFrom,
  coverageWarnings
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
    expect(warningText(errors[0])).toContain('unknown type "Real"');
    expect(structureLeaves(structure)).toEqual([]);
  });

  it('rejects an over-indented line (no parent at that level)', () => {
    const { errors } = parseStructureOutline('Mesures\n      Temperature : Float', 'T');
    expect(errors.some((e) => warningText(e).includes('indented too deep'))).toBe(true);
  });

  it('reports an odd indentation', () => {
    const { errors } = parseStructureOutline('Mesures\n   Temperature : Float', 'T');
    expect(errors.some((e) => warningText(e).includes('indented by'))).toBe(true);
  });

  it('reports a duplicate sibling and keeps the first', () => {
    const { structure, errors } = parseStructureOutline('Mesures\n  T : Float\n  T : Int', 'T');
    expect(errors.some((e) => warningText(e).includes('duplicated under'))).toBe(true);
    expect(structureLeaves(structure)).toEqual([{ segments: ['Mesures', 'T'], leafType: 'Float' }]);
  });

  it('sanitises an invalid identifier and says so', () => {
    const { structure, errors } = parseStructureOutline('Mesures\n  Temp érature (°C) : Float', 'T');
    expect(errors.some((e) => warningText(e).includes('sanitised to'))).toBe(true);
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

describe('structure editing — the tree editor primitives', () => {
  /** Two groups, three leaves, and a binding on each leaf. */
  const tree = (): DpTypeStructure => ({
    name: 'STD_Four',
    type: 'Struct',
    children: [
      { name: 'PV', type: 'Struct', children: [{ name: 'Temperature', type: 'Float' }, { name: 'Debit', type: 'Float' }] },
      { name: 'Etat', type: 'Struct', children: [{ name: 'Marche', type: 'Bool' }] }
    ]
  });
  const bound = { 'PV.Temperature': 'Mesures.T', 'PV.Debit': 'Mesures.Q', 'Etat.Marche': 'Etat.Run' };

  it('finds a node by path, and nothing for an unknown one', () => {
    expect(structureNodeAt(tree(), ['PV', 'Debit'])?.type).toBe('Float');
    expect(structureNodeAt(tree(), ['PV', 'Absent'])).toBeNull();
  });

  it('RE-KEYS the bindings of a whole subtree when a group is renamed', () => {
    const out = renameStructureNode(tree(), ['PV'], 'Mesures', bound);
    expect(structureNodeAt(out.structure, ['Mesures', 'Temperature'])).not.toBeNull();
    // The mapping followed the rename — losing it here is the bug this guards.
    expect(out.bindings).toEqual({
      'Mesures.Temperature': 'Mesures.T',
      'Mesures.Debit': 'Mesures.Q',
      'Etat.Marche': 'Etat.Run'
    });
  });

  it('sanitises a new name and REFUSES one already taken by a sibling', () => {
    expect(structureNodeAt(renameStructureNode(tree(), ['PV', 'Debit'], 'Débit m³/h').structure, ['PV', 'Debit_m_h'])).not.toBeNull();
    // 'Temperature' is taken: two siblings with one name make a binding ambiguous.
    const refused = renameStructureNode(tree(), ['PV', 'Debit'], 'Temperature', bound);
    expect(structureNodeAt(refused.structure, ['PV', 'Debit'])).not.toBeNull();
    expect(refused.bindings).toEqual(bound);
  });

  it('drops the children AND their bindings when a group stops being a Struct', () => {
    const out = setStructureNodeType(tree(), ['PV'], 'Float', bound);
    expect(structureNodeAt(out.structure, ['PV'])?.children).toBeUndefined();
    expect(out.bindings).toEqual({ 'Etat.Marche': 'Etat.Run' });
  });

  it('drops a leaf binding when the leaf becomes a group (a group is not addressable)', () => {
    const out = setStructureNodeType(tree(), ['PV', 'Debit'], 'Struct', bound);
    expect(out.bindings).toEqual({ 'PV.Temperature': 'Mesures.T', 'Etat.Marche': 'Etat.Run' });
  });

  it('adds a child under a group, making the name unique instead of refusing it', () => {
    const once = addStructureChild(tree(), ['PV'], { name: 'Temperature', type: 'Float' });
    const twice = addStructureChild(once, ['PV'], { name: 'Temperature', type: 'Float' });
    expect((structureNodeAt(twice, ['PV'])?.children ?? []).map((c) => c.name)).toEqual([
      'Temperature',
      'Debit',
      'Temperature2',
      'Temperature3'
    ]);
  });

  it('adds at the ROOT with an empty path, and a Struct child starts with no children', () => {
    const out = addStructureChild(tree(), [], { name: 'Consignes', type: 'Struct' });
    expect(structureNodeAt(out, ['Consignes'])).toEqual({ name: 'Consignes', type: 'Struct', children: [] });
  });

  it('removes a subtree and prunes exactly its bindings', () => {
    const out = removeStructureNode(tree(), ['PV'], bound);
    expect(structureNodeAt(out.structure, ['PV'])).toBeNull();
    expect(out.bindings).toEqual({ 'Etat.Marche': 'Etat.Run' });
  });

  it('leaves the structure alone for an unknown path or an empty one', () => {
    expect(removeStructureNode(tree(), ['Absent'], bound).bindings).toEqual(bound);
    expect(structureLeaves(removeStructureNode(tree(), [], bound).structure)).toHaveLength(3);
    expect(addStructureChild(tree(), ['Absent'], { name: 'X', type: 'Float' })).toEqual(tree());
  });

  it('round-trips through the outline after an edit — the text stays the storage form', () => {
    const edited = addStructureChild(renameStructureNode(tree(), ['PV'], 'Mesures').structure, ['Etat'], {
      name: 'Defaut',
      type: 'Bool'
    });
    const reparsed = parseStructureOutline(formatStructureOutline(edited), 'STD_Four');
    expect(reparsed.errors).toHaveLength(0);
    expect(structureLeaves(reparsed.structure).map((l) => l.segments.join('.'))).toEqual([
      'Mesures.Temperature',
      'Mesures.Debit',
      'Etat.Marche',
      'Etat.Defaut'
    ]);
  });
});

describe('model templates — reuse across equipments', () => {
  const template = {
    id: 'std-four',
    name: 'STD Four',
    typeName: 'STD_Four',
    structure: {
      name: 'STD_Four',
      type: 'Struct',
      children: [
        { name: 'PV', type: 'Struct', children: [{ name: 'Temperature', type: 'Float' }] },
        { name: 'Etat', type: 'Struct', children: [{ name: 'Marche', type: 'Bool' }] },
        { name: 'Reserve', type: 'Float' }
      ]
    } as DpTypeStructure,
    bindings: { 'PV.Temperature': 'Mesures.T', 'Etat.Marche': 'Etat.Run' }
  };
  const bookWith = (paths: string[]): AddressBook => ({
    id: 'b',
    name: 'b',
    provenance: { kind: 'manual', generatedAt: '2026-01-01T00:00:00.000Z' },
    entries: paths.map((path) => ({ path, sourceType: 'Real', leafType: 'Float', access: 'r', addresses: {} })),
    types: [],
    warnings: []
  });

  it('slugifies a template name, with its own fallback', () => {
    expect(templateIdFrom('STD Four (v2)')).toBe('std-four-v2');
    expect(templateIdFrom('  ')).toBe('model');
  });

  it('counts what the catalog serves, and NAMES what it does not', () => {
    const coverage = templateCoverage(template, bookWith(['Mesures.T', 'Etat.Run']));
    expect(coverage).toEqual({ bound: 2, unbound: ['Reserve'], missing: [] });
  });

  it('reports a binding the target catalog LACKS — the reason reuse is not blind', () => {
    const coverage = templateCoverage(template, bookWith(['Mesures.T']));
    expect(coverage.bound).toBe(1);
    expect(coverage.missing).toEqual([{ leaf: 'Etat.Marche', entry: 'Etat.Run' }]);
    const texts = coverageWarnings(coverage).map((w) => warningText(w));
    expect(texts[0]).toContain('Etat.Marche → Etat.Run');
    expect(texts.join(' ')).toContain('no address and no config');
  });

  it('says nothing when the catalog covers every mapping and nothing is unbound', () => {
    const full = { ...template, structure: { ...template.structure, children: template.structure.children!.slice(0, 2) } };
    expect(coverageWarnings(templateCoverage(full, bookWith(['Mesures.T', 'Etat.Run'])))).toHaveLength(0);
  });
});
