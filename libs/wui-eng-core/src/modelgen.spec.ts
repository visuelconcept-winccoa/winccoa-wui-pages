// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Model generation from a qualified book: structure derivation, VC naming,
 * role-driven configs, and the things it refuses to invent (unqualified signals,
 * unbound template catalogs, unverified driver transformations).
 */
import { describe, expect, it } from 'vitest';
import { diffWorkspace } from './diff.js';
import { generateModelFromBook, mergeProposal } from './modelgen.js';
import { autoBindStructure } from './structure.js';
import type { AddressBook, BookEntry, DpTypeStructure, LiveSnapshot, OaLeafType, TagAccess, Workspace } from './model.js';
import type { SignalRole } from './roles/roles.js';

function entry(
  path: string,
  leafType: OaLeafType,
  access: TagAccess,
  role: SignalRole,
  extra: Partial<BookEntry> = {}
): BookEntry {
  return { path, sourceType: 'Double', leafType, access, addresses: {}, role, ...extra };
}

function book(entries: BookEntry[], iface?: AddressBook['interface']): AddressBook {
  return {
    id: 'b',
    name: 'Book',
    provenance: { kind: 'opcua-browse', generatedAt: '2026-08-02T00:00:00.000Z' },
    interface: iface,
    entries,
    types: [],
    warnings: []
  };
}

const OPCUA_IFACE: AddressBook['interface'] = { protocol: 'opcua', connection: 'Cellule2' };

describe('structure derivation', () => {
  it('builds nested Structs from dotted paths', () => {
    const proposal = generateModelFromBook(
      book([
        entry('Mesures.Temperature', 'Float', 'r', 'measure'),
        entry('Mesures.Pression', 'Float', 'r', 'measure'),
        entry('Etat.Defaut', 'Bool', 'r', 'alarm')
      ]),
      { typeName: 'Equip_Four', equipments: [], deviceId: 'd1' }
    );
    expect(proposal.type.structure).toEqual({
      name: 'Equip_Four',
      type: 'Struct',
      children: [
        {
          name: 'Mesures',
          type: 'Struct',
          children: [
            { name: 'Temperature', type: 'Float' },
            { name: 'Pression', type: 'Float' }
          ]
        },
        { name: 'Etat', type: 'Struct', children: [{ name: 'Defaut', type: 'Bool' }] }
      ]
    });
  });

  it('strips only the levels shared by ALL signals, keeping the real groups', () => {
    // Whole-DB selection: `DB_Four` is common, the branches are not → groups kept.
    const proposal = generateModelFromBook(
      book([
        entry('DB_Four.Mesures.Temperature', 'Float', 'r', 'measure'),
        entry('DB_Four.Mesures.Hygrometrie', 'Float', 'r', 'measure'),
        entry('DB_Four.Etat.EnChauffe', 'Bool', 'r', 'state')
      ]),
      { typeName: 'T', equipments: [], deviceId: 'd1' }
    );
    expect(proposal.type.structure.children?.map((c) => c.name)).toEqual(['Mesures', 'Etat']);
    expect(proposal.warnings.join('\n')).toMatch(/Common prefix "DB_Four" stripped/);
  });

  it('strips a fully-shared container too (it would carry no information)', () => {
    // Sub-branch selection: every signal is under `DB_Four.Mesures` → flattened.
    const proposal = generateModelFromBook(
      book([
        entry('DB_Four.Mesures.Temperature', 'Float', 'r', 'measure'),
        entry('DB_Four.Mesures.Hygrometrie', 'Float', 'r', 'measure')
      ]),
      { typeName: 'T', equipments: [], deviceId: 'd1' }
    );
    expect(proposal.type.structure.children?.map((c) => c.name)).toEqual(['Temperature', 'Hygrometrie']);
    expect(proposal.warnings.join('\n')).toMatch(/Common prefix "DB_Four\.Mesures" stripped/);
  });

  it('keeps the full paths when stripping is disabled', () => {
    const proposal = generateModelFromBook(
      book([entry('DB_Four.Mesures.Temperature', 'Float', 'r', 'measure')]),
      { typeName: 'T', equipments: [], deviceId: 'd1', stripCommonPrefix: false }
    );
    expect(proposal.type.structure.children?.[0].name).toBe('DB_Four');
  });

  it('never strips a leaf, even when all paths share it', () => {
    const proposal = generateModelFromBook(book([entry('OnlyOne', 'Float', 'r', 'measure')]), {
      typeName: 'T',
      equipments: [],
      deviceId: 'd1'
    });
    expect(proposal.type.structure.children).toEqual([{ name: 'OnlyOne', type: 'Float' }]);
  });

  it('sanitises names into valid WinCC OA identifiers (PackML brackets)', () => {
    const proposal = generateModelFromBook(
      book([entry('Admin.ProdProcessedCount[0].Count', 'UInt', 'r', 'counter')]),
      { typeName: 'T', equipments: [], deviceId: 'd1', stripCommonPrefix: false }
    );
    const admin = proposal.type.structure.children?.[0];
    expect(admin?.name).toBe('Admin');
    expect(admin?.children?.[0].name).toBe('ProdProcessedCount_0');
  });
});

describe('datapoints', () => {
  it('names datapoints with the {Zone}_{Equipement} convention', () => {
    const proposal = generateModelFromBook(book([entry('Temp', 'Float', 'r', 'measure')]), {
      typeName: 'Equip_Four',
      zone: 'Z01',
      equipments: ['FOUR001', 'FOUR002'],
      deviceId: 'd1'
    });
    expect(proposal.dps.map((d) => d.dpName)).toEqual(['Z01_FOUR001', 'Z01_FOUR002']);
    expect(proposal.dps[0].dpType).toBe('Equip_Four');
  });

  it('carries the source comments as DPE descriptions', () => {
    const proposal = generateModelFromBook(
      book([entry('Mesures.Temp', 'Float', 'r', 'measure', { comment: 'Température four' })]),
      { typeName: 'T', zone: 'Z01', equipments: ['FOUR001'], deviceId: 'd1', stripCommonPrefix: false }
    );
    expect(proposal.dps[0].descriptions).toEqual({ 'Mesures.Temp': 'Température four' });
  });

  it('generates the type alone when no equipment is given', () => {
    const proposal = generateModelFromBook(book([entry('Temp', 'Float', 'r', 'measure')]), {
      typeName: 'T',
      equipments: [],
      deviceId: 'd1'
    });
    expect(proposal.dps).toHaveLength(0);
    expect(proposal.warnings.join('\n')).toMatch(/without any datapoint/);
  });
});

describe('role-driven configs', () => {
  const entries = [
    entry('Temp', 'Float', 'r', 'measure', { addresses: { opcua: 'Cellule2$$1$1$ns=2;s=Temp' }, unit: '°C' }),
    entry('Defaut', 'Bool', 'r', 'alarm', { addresses: { opcua: 'Cellule2$$1$1$ns=2;s=Defaut' } }),
    entry('Recette', 'String', 'rw', 'parameter', { addresses: { opcua: 'Cellule2$$1$1$ns=2;s=Recette' } })
  ];

  it('derives address direction, archiving and alerts from the roles', () => {
    const proposal = generateModelFromBook(book(entries, OPCUA_IFACE), {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'opc1',
      profileContext: { archiveGroup: 'MEASURE', alarmClass: 'alert' }
    });
    // measure → IN + archived, with the resolved OPC UA reference and datatype.
    expect(proposal.configs['Z01_EQ1.Temp']).toMatchObject({
      address: { deviceId: 'opc1', mode: 'opcua', reference: 'Cellule2$$1$1$ns=2;s=Temp', direction: 4, datatype: 761, active: true },
      archive: { group: 'MEASURE', active: true }
    });
    expect(proposal.configs['Z01_EQ1.Temp'].alarm).toBeUndefined();
    // alarm → binary alert.
    expect(proposal.configs['Z01_EQ1.Defaut'].alarm).toEqual({
      kind: 'binary',
      alarmClass: 'alert',
      direction: 'ASC',
      active: true
    });
    // parameter → address only (no archive, no alarm).
    expect(proposal.configs['Z01_EQ1.Recette'].archive).toBeUndefined();
    expect(proposal.configs['Z01_EQ1.Recette'].address).toBeDefined();
  });

  it('replicates the configs on every datapoint of the type', () => {
    const proposal = generateModelFromBook(book(entries, OPCUA_IFACE), {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1', 'EQ2'],
      deviceId: 'opc1'
    });
    expect(proposal.configs['Z01_EQ1.Temp']).toBeDefined();
    expect(proposal.configs['Z01_EQ2.Temp']).toBeDefined();
    expect(proposal.roleCounts.measure).toBe(2); // one per datapoint
  });
});

describe('what it refuses to invent', () => {
  it('creates the DPE of an unqualified signal but no config, and says so', () => {
    const proposal = generateModelFromBook(
      book([entry('Mystere', 'Float', 'r', 'unknown', { addresses: { opcua: 'C$$1$1$x' } })], OPCUA_IFACE),
      { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], deviceId: 'd1' }
    );
    expect(proposal.type.structure.children).toEqual([{ name: 'Mystere', type: 'Float' }]);
    expect(proposal.configs['Z01_EQ1.Mystere']).toBeUndefined();
    expect(proposal.warnings.join('\n')).toMatch(/1 unqualified signal/);
  });

  it('does not bind a template catalog without a connection', () => {
    const template = book([entry('Status.StateCurrent', 'Int', 'r', 'state', { addresses: { opcua: '<Machine>$$1$1$ns=4;s=Status.StateCurrent' } })]);
    const proposal = generateModelFromBook(template, {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'd1',
      mode: 'opcua',
      stripCommonPrefix: false
    });
    expect(proposal.configs['Z01_EQ1.Status.StateCurrent'].address).toBeUndefined();
    // …but the role's other configs still apply.
    expect(proposal.configs['Z01_EQ1.Status.StateCurrent'].archive).toBeDefined();
    expect(proposal.warnings.join('\n')).toMatch(/from an unbound catalog/);
  });

  it('binds a template catalog once the connection is supplied', () => {
    const template = book([entry('Status.StateCurrent', 'Int', 'r', 'state', { addresses: { opcua: '<Machine>$$1$1$ns=4;s=X' } })]);
    const proposal = generateModelFromBook(template, {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'd1',
      mode: 'opcua',
      bindConnection: 'Encaisseuse',
      stripCommonPrefix: false
    });
    expect(proposal.configs['Z01_EQ1.Status.StateCurrent'].address?.reference).toBe('Encaisseuse$$1$1$ns=4;s=X');
  });

  it('flags an unverified driver transformation instead of passing a sentinel off as verified', () => {
    const modbusBook = book([entry('U_L1_N', 'Float', 'r', 'measure', { sourceType: 'REAL', addresses: { modbus: '40002' } })], {
      protocol: 'modbus',
      connection: 'PAC1'
    });
    const proposal = generateModelFromBook(modbusBook, { typeName: 'T', zone: 'Z02', equipments: ['PAC1'], deviceId: 'd1' });
    expect(proposal.configs['Z02_PAC1.U_L1_N'].address?.datatype).toBe(0);
    expect(proposal.warnings.join('\n')).toMatch(/is UNVERIFIED/);
  });

  it('reports a signal with no address for the chosen mode', () => {
    const proposal = generateModelFromBook(
      book([entry('X', 'Float', 'r', 'measure', { addresses: { s7: 'DB1.DBD0' } })], OPCUA_IFACE),
      { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], deviceId: 'd1' }
    );
    expect(proposal.configs['Z01_EQ1.X'].address).toBeUndefined();
    expect(proposal.configs['Z01_EQ1.X'].archive).toBeDefined();
    expect(proposal.warnings.join('\n')).toMatch(/no address for mode "opcua"/);
  });
});

describe('mergeProposal + diff (the closed loop)', () => {
  const emptyWorkspace: Workspace = { name: 'ws', types: [], dps: [], configs: {}, baseline: {} };
  const emptyLive: LiveSnapshot = { types: [], dps: [], configs: {} };

  it('merges into the workspace and produces a check-in plan', () => {
    const proposal = generateModelFromBook(
      book(
        [
          entry('Mesures.Temp', 'Float', 'r', 'measure', { addresses: { opcua: 'C$$1$1$t' } }),
          entry('Etat.Defaut', 'Bool', 'r', 'alarm', { addresses: { opcua: 'C$$1$1$d' } })
        ],
        OPCUA_IFACE
      ),
      { typeName: 'Equip_Four', zone: 'Z01', equipments: ['FOUR001'], deviceId: 'opc1', stripCommonPrefix: false }
    );
    const workspace = mergeProposal(emptyWorkspace, proposal);
    expect(workspace.types).toHaveLength(1);
    expect(workspace.dps.map((d) => d.dpName)).toEqual(['Z01_FOUR001']);

    const plan = diffWorkspace(workspace, emptyLive);
    expect(plan.items.map((i) => `${i.kind}:${i.op}:${i.name}`)).toEqual([
      'type:create:Equip_Four',
      'dp:create:Z01_FOUR001',
      'config:create:Z01_FOUR001.Etat.Defaut',
      'config:create:Z01_FOUR001.Mesures.Temp'
    ]);
  });

  it('replaces an existing type, keeps existing datapoints and merges configs', () => {
    const existing: Workspace = {
      name: 'ws',
      types: [{ typeName: 'T', structure: { name: 'T', type: 'Struct', children: [] } }],
      dps: [{ dpName: 'Z01_EQ1', dpType: 'T' }],
      configs: { 'Z01_EQ1.X': { range: { min: 0, max: 10, inclMin: true, inclMax: true } } },
      baseline: {}
    };
    const proposal = generateModelFromBook(
      book([entry('X', 'Float', 'r', 'measure', { addresses: { opcua: 'C$$1$1$x' } })], OPCUA_IFACE),
      { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], deviceId: 'opc1' }
    );
    const merged = mergeProposal(existing, proposal);
    expect(merged.types).toHaveLength(1);
    expect(merged.types[0].structure.children).toEqual([{ name: 'X', type: 'Float' }]);
    expect(merged.dps).toHaveLength(1); // not duplicated
    // The pre-existing range survives, the generated configs are added.
    expect(merged.configs['Z01_EQ1.X'].range).toBeDefined();
    expect(merged.configs['Z01_EQ1.X'].address).toBeDefined();
    expect(merged.configs['Z01_EQ1.X'].archive).toBeDefined();
  });
});

describe('custom structure + mapping (the alternative to mirroring)', () => {
  /** A house-standard type, deliberately named/nested unlike the source. */
  const TARGET: DpTypeStructure = {
    name: 'STD_Four',
    type: 'Struct',
    children: [
      { name: 'PV', type: 'Struct', children: [{ name: 'Temp', type: 'Float' }] },
      { name: 'SP', type: 'Struct', children: [{ name: 'Temp', type: 'Float' }] },
      { name: 'Marche', type: 'Bool' }
    ]
  };
  const SOURCE = book(
    [
      entry('PLC.Grp1.TempProcess', 'Float', 'r', 'measure', { addresses: { opcua: 'C$$1$1$ns=2;s=Temp' } }),
      entry('PLC.Grp2.ConsigneTemp', 'Float', 'rw', 'setpoint', { addresses: { opcua: 'C$$1$1$ns=2;s=Sp' } }),
      entry('PLC.Bits.CmdMarche', 'Bool', 'w', 'command', { addresses: { opcua: 'C$$1$1$ns=2;s=Cmd' } }),
      entry('PLC.Bits.Inutilise', 'Bool', 'r', 'state', { addresses: { opcua: 'C$$1$1$ns=2;s=Nc' } })
    ],
    OPCUA_IFACE
  );

  it('uses the AUTHORED structure, not the book paths', () => {
    const proposal = generateModelFromBook(SOURCE, {
      typeName: 'STD_Four',
      equipments: ['FOUR001'],
      zone: 'Z9',
      deviceId: 'd1',
      mapping: {
        structure: TARGET,
        bindings: { 'PV.Temp': 'PLC.Grp1.TempProcess', 'SP.Temp': 'PLC.Grp2.ConsigneTemp', Marche: 'PLC.Bits.CmdMarche' }
      }
    });
    expect(proposal.type.structure.children?.map((c) => c.name)).toEqual(['PV', 'SP', 'Marche']);
    expect(Object.keys(proposal.configs).sort()).toEqual(['Z9_FOUR001.Marche', 'Z9_FOUR001.PV.Temp', 'Z9_FOUR001.SP.Temp']);
  });

  it('takes each config from the BOUND signal (role, access, address)', () => {
    const proposal = generateModelFromBook(SOURCE, {
      typeName: 'STD_Four',
      equipments: ['FOUR001'],
      zone: 'Z9',
      deviceId: 'd1',
      mapping: {
        structure: TARGET,
        bindings: { 'PV.Temp': 'PLC.Grp1.TempProcess', 'SP.Temp': 'PLC.Grp2.ConsigneTemp', Marche: 'PLC.Bits.CmdMarche' }
      }
    });
    // measure → IN, setpoint on a rw signal → I/O, command on a w signal → OUT.
    expect(proposal.configs['Z9_FOUR001.PV.Temp'].address?.direction).toBe(4);
    expect(proposal.configs['Z9_FOUR001.SP.Temp'].address?.direction).toBe(7);
    expect(proposal.configs['Z9_FOUR001.Marche'].address?.direction).toBe(1);
  });

  it('keeps an UNBOUND leaf in the type but generates no config for it, and says so', () => {
    const proposal = generateModelFromBook(SOURCE, {
      typeName: 'STD_Four',
      equipments: ['FOUR001'],
      zone: 'Z9',
      deviceId: 'd1',
      mapping: { structure: TARGET, bindings: { 'PV.Temp': 'PLC.Grp1.TempProcess' } }
    });
    const sp = proposal.type.structure.children?.find((c) => c.name === 'SP');
    expect(sp?.children?.map((c) => c.name)).toEqual(['Temp']); // still in the type
    expect(proposal.configs['Z9_FOUR001.SP.Temp']).toBeUndefined();
    expect(proposal.warnings.some((w) => w.includes('with no mapped signal'))).toBe(true);
  });

  it('reports a binding that points at a signal the book does not have', () => {
    const proposal = generateModelFromBook(SOURCE, {
      typeName: 'STD_Four',
      equipments: ['FOUR001'],
      deviceId: 'd1',
      mapping: { structure: TARGET, bindings: { 'PV.Temp': 'PLC.Disparu' } }
    });
    expect(proposal.warnings.some((w) => w.includes('point at a signal the book does not have'))).toBe(true);
  });

  it('keeps the MODEL type on a mismatch and names it (a mapping mistake, usually)', () => {
    const proposal = generateModelFromBook(SOURCE, {
      typeName: 'STD_Four',
      equipments: ['FOUR001'],
      zone: 'Z9',
      deviceId: 'd1',
      mapping: { structure: TARGET, bindings: { Marche: 'PLC.Grp1.TempProcess' } }
    });
    const marche = proposal.type.structure.children?.find((c) => c.name === 'Marche');
    expect(marche?.type).toBe('Bool'); // the authored contract wins
    expect(proposal.warnings.some((w) => w.includes('DIFFERENT TYPE'))).toBe(true);
  });

  it('reports the book signals the model does not use', () => {
    const proposal = generateModelFromBook(SOURCE, {
      typeName: 'STD_Four',
      equipments: ['FOUR001'],
      deviceId: 'd1',
      mapping: {
        structure: TARGET,
        bindings: { 'PV.Temp': 'PLC.Grp1.TempProcess', 'SP.Temp': 'PLC.Grp2.ConsigneTemp', Marche: 'PLC.Bits.CmdMarche' }
      }
    });
    expect(proposal.warnings.some((w) => w.includes('unused by the model'))).toBe(true);
  });

  it('auto-binding a mirrored structure reproduces the mirror mode', () => {
    const mirrored = generateModelFromBook(SOURCE, { typeName: 'T', equipments: ['E1'], deviceId: 'd1' });
    const bound = autoBindStructure(mirrored.type.structure, SOURCE.entries);
    const mapped = generateModelFromBook(SOURCE, {
      typeName: 'T',
      equipments: ['E1'],
      deviceId: 'd1',
      mapping: { structure: mirrored.type.structure, bindings: bound.bindings }
    });
    expect(mapped.type.structure).toEqual(mirrored.type.structure);
    expect(Object.keys(mapped.configs).sort()).toEqual(Object.keys(mirrored.configs).sort());
  });
});

