// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATALOG_ID,
  DEFAULT_CATALOG_NAME,
  catalogDp,
  catalogFor,
  catalogIdOfDp,
  catalogsFromDps,
  causesFor,
  defaultCatalog,
  newCatalogId,
  normaliseCatalogs,
  parseCatalogs
} from './stop-catalogs.js';

const OLD = JSON.stringify([
  { code: 'AP01', description: 'Repas', classification: 'planned' },
  { code: 'ANP01', description: 'Panne', classification: 'unplanned', isDefault: true }
]);

describe('stop-cause catalogues (#74)', () => {
  it('maps a catalogue to its datapoint and back', () => {
    expect(catalogDp(DEFAULT_CATALOG_ID)).toBe('MachineFleet3D_StopCauses');
    expect(catalogDp('inox')).toBe('MachineFleet3D_StopCauses_inox');
    expect(catalogIdOfDp('System1:MachineFleet3D_StopCauses.')).toBe(DEFAULT_CATALOG_ID);
    expect(catalogIdOfDp('System1:MachineFleet3D_StopCauses_inox')).toBe('inox');
    expect(catalogIdOfDp('MachineFleet3D_StopCauses_')).toBeNull();
    expect(catalogIdOfDp('MachineFleet3D_Closures')).toBeNull();
  });

  it('reads one catalogue per datapoint, the single one of before as the default', () => {
    const cats = catalogsFromDps([
      { dp: 'System1:MachineFleet3D_StopCauses_inox', json: JSON.stringify([{ code: 'X1', classification: 'planned' }]), name: 'Inox' },
      { dp: 'System1:MachineFleet3D_StopCauses', json: OLD }
    ]);
    expect(cats.map((c) => [c.id, c.name, c.isDefault === true])).toEqual([
      [DEFAULT_CATALOG_ID, DEFAULT_CATALOG_NAME, true],
      ['inox', 'Inox', false]
    ]);
    expect(cats[0].causes.map((c) => c.code)).toEqual(['AP01', 'ANP01']);
    // No datapoint yet: the default catalogue, empty.
    expect(catalogsFromDps([])).toEqual([{ id: DEFAULT_CATALOG_ID, name: DEFAULT_CATALOG_NAME, causes: [], isDefault: true }]);
  });

  it('keeps the default one first and always there, the others by name', () => {
    const cats = normaliseCatalogs([{ id: 'b', name: 'Usinage' }, { id: 'a', name: 'Inox' }]);
    expect(cats.map((c) => c.id)).toEqual([DEFAULT_CATALOG_ID, 'a', 'b']);
    expect(cats.filter((c) => c.isDefault).map((c) => c.id)).toEqual([DEFAULT_CATALOG_ID]);
  });

  it('gives each catalogue a unique id fit for a datapoint name', () => {
    expect(newCatalogId('Fours inox', [])).toBe('fours-inox');
    expect(newCatalogId('Fours inox', ['fours-inox'])).toBe('fours-inox-2');
    expect(newCatalogId('Default', [])).toBe('default-2');
    expect(normaliseCatalogs([{ id: 'a', name: 'A' }, { id: 'a', name: 'A' }, { id: 'Bad id', name: 'B c' }]).map((c) => c.id)).toEqual([
      DEFAULT_CATALOG_ID,
      'a',
      'a-2',
      'b-c'
    ]);
  });

  it('takes catalogues handed over as values, else the default one from its causes', () => {
    expect(parseCatalogs([{ id: 'inox', name: 'Inox', causes: [] }]).map((c) => c.id)).toEqual([DEFAULT_CATALOG_ID, 'inox']);
    expect(parseCatalogs(null, OLD)[0].causes.map((c) => c.code)).toEqual(['AP01', 'ANP01']);
  });

  it('picks a machine its catalogue, else the default', () => {
    const cats = normaliseCatalogs([
      { id: DEFAULT_CATALOG_ID, name: 'Base', causes: [{ code: 'B', description: 'b', classification: 'unplanned' }] },
      { id: 'inox', name: 'Inox', causes: [{ code: 'I', description: 'i', classification: 'planned' }] }
    ]);
    expect(catalogFor(cats, 'inox').id).toBe('inox');
    expect(catalogFor(cats, 'inconnu').id).toBe(DEFAULT_CATALOG_ID);
    expect(catalogFor(cats).id).toBe(DEFAULT_CATALOG_ID);
    expect(causesFor(cats, 'inox').map((c) => c.code)).toEqual(['I']);
    expect(defaultCatalog([]).causes).toEqual([]);
  });
});
