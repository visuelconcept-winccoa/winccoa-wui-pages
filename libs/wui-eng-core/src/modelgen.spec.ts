// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Model generation from a qualified book: structure derivation, VC naming,
 * role-driven configs, and the things it refuses to invent (unqualified signals,
 * unbound template catalogs, unverified driver transformations).
 */
import { describe, expect, it } from 'vitest';
import { formatWarning as warningText } from './warnings.js';
import { diffWorkspace } from './diff.js';
import { bindingRef, generateModelFromBook, mergeProposal, mirrorIntoStructure, mirrorStructureFromBooks, removeSourceFromModel, parseBindingRef } from './modelgen.js';
import { autoBindStructure } from './structure.js';
import { buildAddressWrite } from './configs/builders.js';
import { CONFIG_READ_ATTRS, comparableConfigs, configsFromRaw } from './configs/read.js';
import { fingerprint } from './model.js';
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
    expect(proposal.warnings.map(warningText).join('\n')).toMatch(/Common prefix "DB_Four" stripped/);
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
    expect(proposal.warnings.map(warningText).join('\n')).toMatch(/Common prefix "DB_Four\.Mesures" stripped/);
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
    expect(proposal.warnings.map(warningText).join('\n')).toMatch(/without any datapoint/);
  });
});

describe('role-driven configs', () => {
  const entries = [
    // Historized on the source → archived by default (see defaultLeafPolicy).
    entry('Temp', 'Float', 'r', 'measure', { addresses: { opcua: 'Cellule2$$1$1$ns=2;s=Temp' }, unit: '°C', historized: true }),
    entry('Defaut', 'Bool', 'r', 'alarm', { addresses: { opcua: 'Cellule2$$1$1$ns=2;s=Defaut' } }),
    entry('Recette', 'String', 'rw', 'parameter', { addresses: { opcua: 'Cellule2$$1$1$ns=2;s=Recette' } })
  ];

  it('derives the direction from the role, and the alarm/archive from the DEFAULT POLICY', () => {
    const proposal = generateModelFromBook(book(entries, OPCUA_IFACE), {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'opc1',
      profileContext: { archiveGroup: 'MEASURE', alarmClass: 'alert' }
    });
    // measure → IN, with the resolved OPC UA reference and datatype; archived
    // because the SOURCE historizes it, in the project's group. That same history
    // makes the address HISTORICAL, and a historical address is left INACTIVE.
    expect(proposal.configs['Z01_EQ1.Temp']).toMatchObject({
      address: {
        deviceId: 'opc1',
        mode: 'opcua',
        reference: 'Cellule2$$1$1$ns=2;s=Temp',
        direction: 4,
        datatype: 761,
        historical: true,
        active: false
      },
      archive: { group: 'MEASURE', active: true }
    });
    expect(proposal.configs['Z01_EQ1.Temp'].alarm).toBeUndefined();
    // alarm role → binary alert, and NO archive (the source says nothing).
    expect(proposal.configs['Z01_EQ1.Defaut'].alarm).toEqual({
      kind: 'binary',
      alarmClass: 'alert',
      // A fault bit is healthy at FALSE — stated by the default policy, so `_ok_range`
      // is written from a decision instead of from the direction.
      goodRange: false,
      direction: 'ASC',
      active: true
    });
    expect(proposal.configs['Z01_EQ1.Defaut'].archive).toBeUndefined();
    // parameter → address only (no archive, no alarm).
    expect(proposal.configs['Z01_EQ1.Recette'].archive).toBeUndefined();
    expect(proposal.configs['Z01_EQ1.Recette'].address).toBeDefined();
    // Nothing ever gets an invented range.
    expect(Object.values(proposal.configs).every((c) => c.range === undefined)).toBe(true);
  });

  /**
   * The OPC UA "Historical" checkbox of the WinCC OA address (`_address.._offset`).
   *
   * TWO facts decide it, and both come from the catalog: the source says it keeps a
   * HISTORY of the signal (`Historizing` / the `HistoryRead` bits — the catalog's `H`
   * column), and its ACCESS makes the address one that reads — `r` gives IN and `rw`
   * gives IN/OUT. A write-only signal produces an OUTPUT, which acquires nothing and
   * therefore has no history to query.
   *
   * And a historical address is left INACTIVE: the history is read through a
   * HistoryRead request, so acquiring the same signal live would archive it twice.
   */
  it('checks HISTORICAL on a historized signal the catalog declares readable', () => {
    const proposal = generateModelFromBook(
      book(
        [
          entry('Temp', 'Float', 'r', 'measure', { addresses: { opcua: 'C$$1$1$ns=2;s=T' }, historized: true }),
          entry('Consigne', 'Float', 'rw', 'setpoint', { addresses: { opcua: 'C$$1$1$ns=2;s=C' }, historized: true }),
          // Historized but WRITE-ONLY: the address is an OUTPUT, so no historical query.
          entry('Marche', 'Bool', 'w', 'command', { addresses: { opcua: 'C$$1$1$ns=2;s=M' }, historized: true }),
          // The source says nothing about history — absence is unknown, not "yes".
          entry('Debit', 'Float', 'r', 'measure', { addresses: { opcua: 'C$$1$1$ns=2;s=D' } }),
          // The source says NO.
          entry('Etat', 'Int', 'r', 'state', { addresses: { opcua: 'C$$1$1$ns=2;s=E' }, historized: false })
        ],
        OPCUA_IFACE
      ),
      { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], deviceId: 'opc1' }
    );
    // r → IN (4) + historical; rw → I/O (7) + historical. Both INACTIVE.
    expect(proposal.configs['Z01_EQ1.Temp'].address).toMatchObject({ direction: 4, historical: true, active: false });
    expect(proposal.configs['Z01_EQ1.Consigne'].address).toMatchObject({ direction: 7, historical: true, active: false });
    // OUT, and NOT historical — so ACTIVE, like every ordinary address.
    expect(proposal.configs['Z01_EQ1.Marche'].address).toMatchObject({ direction: 1, active: true });
    // Not historized → active, whatever the direction.
    expect(proposal.configs['Z01_EQ1.Debit'].address).toMatchObject({ active: true });
    expect(proposal.configs['Z01_EQ1.Etat'].address).toMatchObject({ active: true });
    expect(proposal.configs['Z01_EQ1.Marche'].address).not.toHaveProperty('historical');
    // Absent stays absent — never `false`, so a model that never decided fingerprints
    // like the read-back of an unchecked box.
    expect(proposal.configs['Z01_EQ1.Debit'].address).not.toHaveProperty('historical');
    expect(proposal.configs['Z01_EQ1.Etat'].address).not.toHaveProperty('historical');
    expect(proposal.warnings.map(warningText).join(' | ')).toMatch(/2 address\(es\) marked HISTORICAL/);
  });

  /**
   * MUTUALISATION is the whole point of a catalog: browse one machine, deploy the five
   * identical ones beside it. The reference the browse produced names the server it ran
   * on — a property of the IMPORT. Carried into every instance, the plant would read one
   * PLC five times and report the other four as healthy.
   */
  it('re-points the OPC UA reference at the TARGET connection, not the browsed one', () => {
    const proposal = generateModelFromBook(
      book([entry('Temp', 'Float', 'r', 'measure', { addresses: { opcua: 'Cellule2$$1$1$ns=2;s=Temp' } })], OPCUA_IFACE),
      { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], deviceId: 'opc4', bindConnection: 'Cellule4' }
    );
    expect(proposal.configs['Z01_EQ1.Temp'].address?.reference).toBe('Cellule4$$1$1$ns=2;s=Temp');
    // …and it says so, rather than silently changing the server a catalog names.
    expect(proposal.warnings.map(warningText).join(' | ')).toMatch(/Cellule2 . Cellule4/);
  });

  it('keeps the SUBSCRIPTION and the NodeId when re-pointing (field 1 alone)', () => {
    const proposal = generateModelFromBook(
      book([entry('Defaut', 'Bool', 'r', 'alarm', { addresses: { opcua: 'Cellule2$$1$1$ns=2;s=Defaut' } })], OPCUA_IFACE),
      {
        typeName: 'T',
        zone: 'Z01',
        equipments: ['EQ1'],
        deviceId: 'opc4',
        bindConnection: 'Cellule4',
        profileContext: { subscription: 'Sub_Fast' }
      }
    );
    expect(proposal.configs['Z01_EQ1.Defaut'].address?.reference).toBe('Cellule4$Sub_Fast$1$1$ns=2;s=Defaut');
  });

  it('leaves a NON-OPC-UA reference alone (no connection field to re-point)', () => {
    const proposal = generateModelFromBook(
      book([entry('Temp', 'Float', 'r', 'measure', { sourceType: 'Real', addresses: { s7: 'DB12.DBD0' } })]),
      { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], deviceId: 's71', mode: 's7', bindConnection: 'Four3' }
    );
    expect(proposal.configs['Z01_EQ1.Temp'].address?.reference).toBe('DB12.DBD0');
  });

  it('never marks a NON-OPC-UA address historical (_offset means something else there)', () => {
    const proposal = generateModelFromBook(
      book([entry('Temp', 'Float', 'r', 'measure', { sourceType: 'Real', addresses: { s7: 'DB12.DBD0' }, historized: true })]),
      { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], deviceId: 's71', mode: 's7' }
    );
    expect(proposal.configs['Z01_EQ1.Temp'].address).toBeDefined();
    expect(proposal.configs['Z01_EQ1.Temp'].address).not.toHaveProperty('historical');
  });

  /**
   * The END-TO-END guard: a freshly generated model, WRITTEN and READ BACK, must diff to
   * nothing. Twice now a field was added to the address (the acquisition's poll group and
   * subscription, then the historical flag) and reached the comparison without reaching the
   * read-back — each time turning every address into a permanent "to update". Comparing the
   * generator against the real write/read pair catches the next one at the source.
   */
  it('a generated model reads back with NO diff (polled and subscribed)', () => {
    const proposal = generateModelFromBook(
      book(
        [
          entry('Temp', 'Float', 'r', 'measure', { addresses: { opcua: 'C$$1$1$ns=2;s=T' }, historized: true }),
          entry('Debit', 'Float', 'r', 'measure', { addresses: { opcua: 'C$$1$1$ns=2;s=D' } }),
          entry('Defaut', 'Bool', 'r', 'alarm', { addresses: { opcua: 'C$$1$1$ns=2;s=F' } }),
          entry('Consigne', 'Float', 'rw', 'setpoint', { addresses: { opcua: 'C$$1$1$ns=2;s=S' } })
        ],
        OPCUA_IFACE
      ),
      {
        typeName: 'T',
        zone: 'Z01',
        equipments: ['EQ1'],
        deviceId: 'opc1',
        // The project's own names, as the studio injects them: a poll group for what is
        // sampled, a subscription for what the alarm/state roles push.
        profileContext: { pollGroup: '_Poll_Normal', subscription: 'Sub_Fast', archiveGroup: 'EVENT' }
      }
    );
    const addresses = Object.entries(proposal.configs).filter(([, configs]) => configs.address !== undefined);
    // The fixture is only meaningful if it exercises BOTH acquisitions.
    expect(addresses.some(([, c]) => c.address?.pollGroup !== undefined)).toBe(true);
    expect(addresses.some(([, c]) => c.address?.subscription !== undefined)).toBe(true);
    for (const [dpe, configs] of addresses) {
      // The project resolves the group to its datapoint — system-qualified and dot-terminated.
      const write = buildAddressWrite(dpe, configs.address!, 2, 'System1:_Poll_Normal.');
      const values = CONFIG_READ_ATTRS.map((attr) => {
        const index = write.dpes.indexOf(`${dpe}${attr}`);
        return index === -1 ? null : write.values[index];
      });
      const readBack = configsFromRaw(values);
      expect(readBack?.address, dpe).toBeDefined();
      expect(fingerprint(comparableConfigs({ address: readBack!.address! })), dpe).toBe(
        fingerprint(comparableConfigs({ address: configs.address! }))
      );
    }
  });

  /**
   * The deployment policy is what a MODEL pins once and replays per instance.
   * These four assertions are its whole contract: the defaults, the overrides,
   * the field-by-field merge, and the fact that a range only ever exists when
   * someone stated it.
   */
  it('lets the deployment POLICY override the defaults, field by field', () => {
    const proposal = generateModelFromBook(book(entries, OPCUA_IFACE), {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'opc1',
      policy: {
        // Archive a signal the source does NOT historize, in another group.
        Recette: { archive: { active: true, group: 'ALPHA' } },
        // Disarm the alarm role's default alert, and pin a range.
        Defaut: { alarm: { active: false }, range: { min: 0, max: 1 } },
        // Only the class is pinned: the default (archived, because historized) stays.
        Temp: { alarm: { active: true, alarmClass: 'warning' } }
      }
    });
    expect(proposal.configs['Z01_EQ1.Recette'].archive).toEqual({ group: 'ALPHA', active: true });
    expect(proposal.configs['Z01_EQ1.Defaut'].alarm).toBeUndefined();
    expect(proposal.configs['Z01_EQ1.Defaut'].range).toEqual({ min: 0, max: 1, inclMin: true, inclMax: true });
    expect(proposal.configs['Z01_EQ1.Temp'].alarm).toMatchObject({ alarmClass: 'warning', active: true });
    // The untouched half of a partially-pinned leaf keeps its default.
    expect(proposal.configs['Z01_EQ1.Temp'].archive).toEqual({ group: 'EVENT', active: true });
  });

  /** The same model, two connections: one policy, two identical config sets. */
  it('replays the same policy for a second instance (another device/connection)', () => {
    const options = { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], policy: { Temp: { archive: { active: true, group: 'ALPHA' } } } };
    const first = generateModelFromBook(book(entries, OPCUA_IFACE), { ...options, deviceId: 'opc1' });
    const second = generateModelFromBook(book(entries, OPCUA_IFACE), { ...options, deviceId: 'opc2' });
    expect(first.configs['Z01_EQ1.Temp'].archive).toEqual({ group: 'ALPHA', active: true });
    expect(second.configs['Z01_EQ1.Temp'].archive).toEqual(first.configs['Z01_EQ1.Temp'].archive);
    // Only the device provenance differs — that is what an instance is.
    expect(second.configs['Z01_EQ1.Temp'].address?.deviceId).toBe('opc2');
  });

  it('SUBSCRIBES a leaf the model asked for, with the subscription in the reference', () => {
    const proposal = generateModelFromBook(book(entries, OPCUA_IFACE), {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'opc1',
      policy: { Defaut: { acquisition: { mode: 'spont', subscription: 'Sub_Fast' } } }
    });
    const address = proposal.configs['Z01_EQ1.Defaut'].address;
    // Field 2 of `<Conn>$<Sub>$1$1$<NodeId>` carries the subscription, and the direction is the
    // spontaneous one (2) instead of the polled one (4).
    expect(address?.reference).toBe('Cellule2$Sub_Fast$1$1$ns=2;s=Defaut');
    expect(address?.direction).toBe(2);
    expect(address?.subscription).toBe('Sub_Fast');
    expect(address?.pollGroup).toBeUndefined();
  });

  it('falls back to POLLING when a subscription was asked for but not named, and says so', () => {
    const proposal = generateModelFromBook(book(entries, OPCUA_IFACE), {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'opc1',
      policy: { Defaut: { acquisition: { mode: 'spont' } } }
    });
    const address = proposal.configs['Z01_EQ1.Defaut'].address;
    // An empty subscription field IS polling, so the honest outcome is the polled direction plus
    // a warning — not a reference that pretends to be subscribed.
    expect(address?.direction).toBe(4);
    expect(address?.reference).toBe('Cellule2$$1$1$ns=2;s=Defaut');
    expect(proposal.warnings.map((warning) => warningText(warning)).join(' ')).toMatch(/without a subscription/);
  });

  it('carries the POLL GROUP the model pinned', () => {
    const proposal = generateModelFromBook(book(entries, OPCUA_IFACE), {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'opc1',
      policy: { Temp: { acquisition: { mode: 'poll', pollGroup: '_Poll_Slow' } } }
    });
    expect(proposal.configs['Z01_EQ1.Temp'].address?.pollGroup).toBe('_Poll_Slow');
  });

  it('IGNORES an alarm on an element whose type cannot carry one, and says so', () => {
    const proposal = generateModelFromBook(book(entries, OPCUA_IFACE), {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'opc1',
      // `Recette` is a String: an alert compares a value, and it has none to compare.
      policy: { Recette: { alarm: { active: true, alarmClass: '_alert_high' } } }
    });
    expect(proposal.configs['Z01_EQ1.Recette'].alarm).toBeUndefined();
    expect(proposal.warnings.map((warning) => warningText(warning)).join(' ')).toMatch(/Alarm IGNORED/);
  });

  it('makes a numeric alarm ANALOG as soon as the model pins thresholds', () => {
    const proposal = generateModelFromBook(book(entries, OPCUA_IFACE), {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'opc1',
      // The measure is not an alarm role: the POLICY is what arms it, with its ranges.
      policy: { Temp: { alarm: { active: true, alarmClass: '_alert_high', thresholds: [95, 80], direction: 'ASC' }, range: { min: 0, max: 150 } } }
    });
    expect(proposal.configs['Z01_EQ1.Temp'].alarm).toMatchObject({
      kind: 'analog',
      alarmClass: '_alert_high',
      // Sorted ascending whatever the order they were typed in, and the value range
      // becomes the bounds of the outer ranges.
      thresholds: [80, 95],
      bounds: [0, 150],
      direction: 'ASC'
    });
  });

  it('keeps a BOOL alarm binary even with thresholds, and carries its good range', () => {
    const proposal = generateModelFromBook(book(entries, OPCUA_IFACE), {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'opc1',
      policy: { Defaut: { alarm: { active: true, alarmClass: '_alert_high', goodRange: true, thresholds: [1] } } }
    });
    expect(proposal.configs['Z01_EQ1.Defaut'].alarm).toMatchObject({ kind: 'binary', goodRange: true });
    expect(proposal.configs['Z01_EQ1.Defaut'].alarm?.thresholds).toBeUndefined();
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

describe('a model over SEVERAL catalogs', () => {
  /**
   * The point of a multi-catalog model: one type whose branches read from different
   * sources — and each address written through the driver of ITS OWN catalog, not the
   * model's first one. A TIA export and an OPC UA browse of the same machine is the
   * everyday case, and a single global mode would bind half the type wrongly.
   */
  // The source TYPE NAMES matter: each driver has its own `_datatype` table, so a
  // TIA name (`LReal`) on an S7Plus signal and an OPC UA one (`Int32`) on a browsed
  // signal is what a real pair of catalogs carries.
  const s7Book = book([entry('Mesures.Temp', 'Float', 'r', 'measure', { sourceType: 'LReal', addresses: { s7plus: '"DB".Temp' } })], {
    protocol: 's7plus',
    connection: 'PLC_Four'
  });
  const uaBook: AddressBook = {
    ...book(
      [entry('Status.State', 'Int', 'r', 'state', { sourceType: 'Int32', addresses: { opcua: '<Conn>$$1$1$ns=4;s=State' } })],
      OPCUA_IFACE
    ),
    id: 'book-ua'
  };

  it('resolves each leaf through the catalog it is bound to', () => {
    const proposal = generateModelFromBook(s7Book, {
      typeName: 'STD',
      equipments: ['EQ1'],
      deviceId: 'd1',
      books: [uaBook],
      mapping: {
        structure: {
          name: 'STD',
          type: 'Struct',
          children: [
            { name: 'PV', type: 'Struct', children: [{ name: 'Temperature', type: 'Float' }] },
            { name: 'Etat', type: 'Struct', children: [{ name: 'State', type: 'Int' }] }
          ]
        },
        bindings: {
          // A BARE path resolves against the model's own book (single-catalog models
          // written before this feature keep working)…
          'PV.Temperature': 'Mesures.Temp',
          // …a QUALIFIED one names its catalog.
          'Etat.State': bindingRef('book-ua', 'Status.State')
        }
      }
    });
    const pv = proposal.configs['EQ1.PV.Temperature'];
    const state = proposal.configs['EQ1.Etat.State'];
    expect(pv.address).toMatchObject({ mode: 's7plus', reference: '"DB".Temp' });
    // The OPC UA leaf took the OTHER catalog's mode AND its connection placeholder.
    expect(state.address).toMatchObject({ mode: 'opcua', reference: 'Cellule2$$1$1$ns=4;s=State' });
  });

  it('names a binding whose catalog it cannot find, instead of silently dropping it', () => {
    const proposal = generateModelFromBook(s7Book, {
      typeName: 'STD',
      equipments: ['EQ1'],
      deviceId: 'd1',
      mapping: {
        structure: { name: 'STD', type: 'Struct', children: [{ name: 'State', type: 'Int' }] },
        // The catalog is not among `books` — a re-scoped model, or a deleted catalog.
        bindings: { State: bindingRef('book-gone', 'Status.State') }
      }
    });
    expect(proposal.warnings.map(warningText).join('\n')).toMatch(/book-gone::Status\.State/);
  });

  it('mirrors two catalogs into one structure, each branch bound to its own source', () => {
    const mirror = mirrorStructureFromBooks([{ book: s7Book }, { book: uaBook }], { typeName: 'STD' });
    // Both catalogs' paths are in the type…
    expect(mirror.structure.children?.map((child) => child.name)).toEqual(['Mesures', 'Status']);
    // …and EVERY binding names its catalog, the first one included.
    expect(mirror.bindings['Mesures.Temp']).toBe(bindingRef('b', 'Mesures.Temp'));
    expect(mirror.bindings['Status.State']).toBe(bindingRef('book-ua', 'Status.State'));
    expect(mirror.warnings).toEqual([]);
  });

  it('keeps the FIRST catalog that claims a branch, and reports the collision', () => {
    // The same path in two catalogs: a DPE can only read one signal, so the second is
    // skipped — the point is that it is skipped LOUDLY.
    const twin: AddressBook = {
      ...book([entry('Mesures.Temp', 'Float', 'r', 'measure', { sourceType: 'Int32', addresses: { opcua: 'C$$1$1$x' } })], OPCUA_IFACE),
      id: 'book-twin',
      name: 'Twin'
    };
    const mirror = mirrorStructureFromBooks([{ book: s7Book }, { book: twin }], { typeName: 'STD' });
    // `Mesures` is shared by every mirrored signal, so it is the stripped prefix and the
    // branch is `Temp` — the BINDING still records the source's own full path.
    expect(Object.keys(mirror.bindings)).toEqual(['Temp']);
    expect(mirror.bindings['Temp']).toBe(bindingRef('b', 'Mesures.Temp'));
    expect(mirror.warnings.map((warning) => warningText(warning)).join('\n')).toMatch(/already mirrored/);
  });

  it('mirrors a catalog INTO an existing model, adding its branches', () => {
    const base = {
      structure: { name: 'STD', type: 'Struct', children: [{ name: 'PV', type: 'Struct', children: [{ name: 'Temp', type: 'Float' as const }] }] },
      bindings: { 'PV.Temp': 'Mesures.Temp' }
    };
    const merged = mirrorIntoStructure(base, { book: uaBook }, { typeName: 'STD' });
    // The model's own branch survives, the catalog's is grafted beside it…
    expect(merged.structure.children?.map((child) => child.name)).toEqual(['PV', 'State']);
    expect(merged.bindings['PV.Temp']).toBe('Mesures.Temp');
    // …and the added leaf comes bound, qualified because it is not the primary catalog.
    expect(merged.bindings['State']).toBe(bindingRef('book-ua', 'Status.State'));
  });

  it('leaves a branch the model already has untouched, and says how many', () => {
    const base = {
      // Same path as the catalog's, mapped BY HAND somewhere else.
      structure: { name: 'STD', type: 'Struct', children: [{ name: 'Temp', type: 'Float' as const }] },
      bindings: { Temp: 'AutreChose' }
    };
    const merged = mirrorIntoStructure(base, { book: s7Book }, { typeName: 'STD' });
    expect(merged.structure.children).toHaveLength(1);
    // The hand-made mapping WINS — re-mirroring never overwrites it.
    expect(merged.bindings['Temp']).toBe('AutreChose');
    expect(merged.warnings.map((warning) => warningText(warning)).join('\n')).toMatch(/left untouched/);
  });

  it('removes a catalog FROM the model: its branches and mappings go with it', () => {
    // Two branches from two catalogs, plus one an engineer re-mapped onto the other book.
    const base = {
      structure: {
        name: 'STD',
        type: 'Struct',
        children: [
          { name: 'PV', type: 'Struct', children: [{ name: 'Temp', type: 'Float' as const }] },
          { name: 'Etat', type: 'Struct', children: [{ name: 'State', type: 'Int' as const }] }
        ]
      },
      bindings: { 'PV.Temp': bindingRef('b', 'Mesures.Temp'), 'Etat.State': bindingRef('book-ua', 'Status.State') },
      policy: { 'PV.Temp': { archive: { active: true } } }
    };
    const cleaned = removeSourceFromModel(base, 'b');
    // The leaf that read `b` left, and the group it emptied left with it…
    expect(cleaned.structure.children?.map((child) => child.name)).toEqual(['Etat']);
    // …the other catalog's branch stayed, with its mapping…
    expect(cleaned.bindings).toEqual({ 'Etat.State': bindingRef('book-ua', 'Status.State') });
    // …and the policy followed the leaves.
    expect(cleaned.policy).toEqual({});
    expect(cleaned.removed).toEqual(['PV.Temp']);
  });

  it('keeps a branch that was RE-MAPPED onto another catalog', () => {
    const base = {
      structure: { name: 'STD', type: 'Struct', children: [{ name: 'Temp', type: 'Float' as const }] },
      // The leaf was mirrored from `b` once, then bound by hand to the other book: it is no
      // longer `b`'s branch, so removing `b` must leave it alone.
      bindings: { Temp: bindingRef('book-ua', 'Status.State') }
    };
    const cleaned = removeSourceFromModel(base, 'b');
    expect(cleaned.structure.children).toEqual([{ name: 'Temp', type: 'Float' }]);
    expect(cleaned.removed).toEqual([]);
  });

  it('mirrors only the selected signals of a source', () => {
    const wide = book([
      entry('Mesures.Temp', 'Float', 'r', 'measure', { addresses: { opcua: 'C$$1$1$t' } }),
      entry('Mesures.Debit', 'Float', 'r', 'measure', { addresses: { opcua: 'C$$1$1$d' } })
    ], OPCUA_IFACE);
    const mirror = mirrorStructureFromBooks([{ book: wide, selection: ['Mesures.Temp'] }], { typeName: 'STD' });
    expect(Object.keys(mirror.bindings)).toEqual(['Temp']);
  });

  it('parses both binding shapes', () => {
    expect(parseBindingRef('Mesures.Temp')).toEqual({ path: 'Mesures.Temp' });
    expect(parseBindingRef(bindingRef('b1', 'Mesures.Temp'))).toEqual({ bookId: 'b1', path: 'Mesures.Temp' });
    // A path containing the separator is not ambiguous: the FIRST one splits.
    expect(parseBindingRef('b1::a::b')).toEqual({ bookId: 'b1', path: 'a::b' });
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
    expect(proposal.warnings.map(warningText).join('\n')).toMatch(/1 unqualified signal/);
  });

  it('does not bind a template catalog without a connection', () => {
    // Historized, so the default policy archives it — that is what makes the
    // "an unbound address does not cost the other configs" point visible.
    const template = book([
      entry('Status.StateCurrent', 'Int', 'r', 'state', {
        addresses: { opcua: '<Machine>$$1$1$ns=4;s=Status.StateCurrent' },
        historized: true
      })
    ]);
    const proposal = generateModelFromBook(template, {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'd1',
      mode: 'opcua',
      stripCommonPrefix: false
    });
    expect(proposal.configs['Z01_EQ1.Status.StateCurrent'].address).toBeUndefined();
    // …but the policy's other configs still apply.
    expect(proposal.configs['Z01_EQ1.Status.StateCurrent'].archive).toBeDefined();
    expect(proposal.warnings.map(warningText).join('\n')).toMatch(/from an unbound catalog/);
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

  it('writes the verified Modbus transformation of the source type', () => {
    const modbusBook = book([entry('U_L1_N', 'Float', 'r', 'measure', { sourceType: 'REAL', addresses: { modbus: '40002' } })], {
      protocol: 'modbus',
      connection: 'PAC1'
    });
    const proposal = generateModelFromBook(modbusBook, { typeName: 'T', zone: 'Z02', equipments: ['PAC1'], deviceId: 'd1' });
    expect(proposal.configs['Z02_PAC1.U_L1_N'].address?.datatype).toBe(566); // FLOAT
    expect(proposal.warnings.map((w) => w.code)).not.toContain('modelgen.no-datatype');
  });

  /**
   * The two S7 drivers have DISJOINT transformation tables, so the access mode — not
   * the family — selects the code. Same book, same signal, two modes: two codes.
   */
  it('picks the transformation of the S7 driver the mode names', () => {
    const s7Book = book([entry('Temp', 'Float', 'r', 'measure', { sourceType: 'Real', addresses: { s7: 'DB1.DBD0', s7plus: '"DB_Four".Temp' } })], {
      protocol: 's7',
      connection: 'Four'
    });
    const classic = generateModelFromBook(s7Book, { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], deviceId: 'd1', mode: 's7' });
    const plus = generateModelFromBook(s7Book, { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], deviceId: 'd1', mode: 's7plus' });
    expect(classic.configs['Z01_EQ1.Temp'].address?.datatype).toBe(705); // S7 FLOAT
    expect(plus.configs['Z01_EQ1.Temp'].address?.datatype).toBe(1015); // S7Plus REAL
  });

  /**
   * A type the driver cannot carry gets NO address at all — an address whose
   * transformation is wrong reads a plausible wrong value, which is worse than a
   * DPE an operator can see is unbound.
   */
  it('creates the DPE WITHOUT an address when the driver has no transformation for the type', () => {
    const s7Book = book([entry('Energie', 'Float', 'r', 'measure', { sourceType: 'LReal', addresses: { s7: 'DB1.DBB0' } })], {
      protocol: 's7',
      connection: 'Four'
    });
    const proposal = generateModelFromBook(s7Book, { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], deviceId: 'd1', mode: 's7' });
    expect(proposal.configs['Z01_EQ1.Energie']?.address).toBeUndefined();
    const problem = proposal.warnings.find((w) => w.code === 'modelgen.no-datatype');
    expect(problem?.params).toMatchObject({ mode: 's7', n: 1, types: 'LReal' });
    // The same signal IS addressable through S7Plus, which does have LREAL.
    const plus = generateModelFromBook(book([entry('Energie', 'Float', 'r', 'measure', { sourceType: 'LReal', addresses: { s7plus: '"DB".E' } })], { protocol: 's7plus', connection: 'Four' }), {
      typeName: 'T',
      zone: 'Z01',
      equipments: ['EQ1'],
      deviceId: 'd1',
      mode: 's7plus'
    });
    expect(plus.configs['Z01_EQ1.Energie'].address?.datatype).toBe(1016);
  });

  it('reports a signal with no address for the chosen mode', () => {
    const proposal = generateModelFromBook(
      book([entry('X', 'Float', 'r', 'measure', { addresses: { s7: 'DB1.DBD0' }, historized: true })], OPCUA_IFACE),
      { typeName: 'T', zone: 'Z01', equipments: ['EQ1'], deviceId: 'd1' }
    );
    expect(proposal.configs['Z01_EQ1.X'].address).toBeUndefined();
    expect(proposal.configs['Z01_EQ1.X'].archive).toBeDefined();
    expect(proposal.warnings.map(warningText).join('\n')).toMatch(/no address for mode "opcua"/);
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
      book([entry('X', 'Float', 'r', 'measure', { addresses: { opcua: 'C$$1$1$x' }, historized: true })], OPCUA_IFACE),
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
    expect(proposal.warnings.some((w) => warningText(w).includes('with no mapped signal'))).toBe(true);
  });

  it('reports a binding that points at a signal the book does not have', () => {
    const proposal = generateModelFromBook(SOURCE, {
      typeName: 'STD_Four',
      equipments: ['FOUR001'],
      deviceId: 'd1',
      mapping: { structure: TARGET, bindings: { 'PV.Temp': 'PLC.Disparu' } }
    });
    expect(proposal.warnings.some((w) => warningText(w).includes('point at a signal the book does not have'))).toBe(true);
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
    expect(proposal.warnings.some((w) => warningText(w).includes('DIFFERENT TYPE'))).toBe(true);
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
    expect(proposal.warnings.some((w) => warningText(w).includes('unused by the model'))).toBe(true);
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

