// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Seed data for the offline demo gateway — a small but realistic plant: a
 * SIMATIC S7-1500 oven cell (bound from a TIA SimaticML export), an OPC UA
 * server, and a Modbus energy meter. Rich enough to show every workflow
 * (browse → pick → mass-edit → diff → check-in) in the docs and screenshots
 * WITHOUT a WinCC OA runtime.
 */

import {
  buildBookFromSimaticMl,
  buildOpcUaReference,
  directionFor,
  opcUaDatatypeCode,
  opcUaLeafType,
  type AddressBook,
  type Device,
  type LiveSnapshot
} from '@visuelconcept/wui-eng-core';
import {
  DB_ECHANGE_STANDARD_XML,
  DB_FOUR_OPTIMIZED_XML,
  UDT_MOTEUR_XML
} from '@visuelconcept/wui-eng-core/samples/simaticml-fixtures.js';

export const DEMO_DEVICES: Device[] = [
  {
    id: 's7-four1',
    name: 'S7_Four1',
    protocol: 's7plus',
    connection: { ip: '192.168.10.21', rack: 0, slot: 1, cpu: 'S7-1500' },
    accessModes: ['s7', 's7plus', 'opcua'],
    driverNumber: 3,
    pollGroup: '_EngStudio_Poll',
    state: 'connected'
  },
  {
    id: 'opc-cellule2',
    name: 'OPC_Cellule2',
    protocol: 'opcua',
    connection: { endpoint: 'opc.tcp://192.168.10.42:4840', security: 'Basic256Sha256' },
    accessModes: ['opcua'],
    driverNumber: 4,
    pollGroup: '_EngStudio_Poll',
    state: 'connected'
  },
  {
    id: 'mb-compteurs',
    name: 'MB_Compteurs',
    protocol: 'modbus',
    connection: { ip: '192.168.10.60', unit: 1, endianness: 'big', base: 0 },
    accessModes: ['modbus'],
    driverNumber: 5,
    pollGroup: '_EngStudio_Poll',
    state: 'disconnected'
  }
];

/** The S7 device's book, generated from the bundled SimaticML fixtures. */
export function s7AddressBook(): AddressBook {
  return buildBookFromSimaticMl({
    deviceId: 's7-four1',
    provenance: { kind: 'simaticml', file: 'Four1_export.zip', generatedAt: '2026-08-01T09:12:00.000Z', detail: 'TIA V17 · CPU PLC_Four' },
    documents: [
      { fileName: 'UDT_Moteur.xml', xml: UDT_MOTEUR_XML },
      { fileName: 'DB_Four.xml', xml: DB_FOUR_OPTIMIZED_XML },
      { fileName: 'DB_Echange.xml', xml: DB_ECHANGE_STANDARD_XML }
    ]
  });
}

/** A small hand-built OPC UA book (as if browsed from the live server). */
export function opcuaAddressBook(): AddressBook {
  const leaf = (path: string, nodeId: string, dt: string, access: 'r' | 'rw' | 'w', comment?: string) => ({
    path,
    sourceType: dt,
    leafType: opcUaLeafType(dt),
    access,
    addresses: {
      opcua: buildOpcUaReference('Cellule2', nodeId)
    },
    comment,
    // carried for the demo's config generation
    _direction: directionFor(access),
    _datatype: opcUaDatatypeCode(dt)
  });
  return {
    deviceId: 'opc-cellule2',
    provenance: { kind: 'opcua-browse', generatedAt: '2026-08-01T10:03:00.000Z', detail: 'browse ns=2;Objects/Cellule2' },
    entries: [
      leaf('Robot.Position', 'ns=2;s=Robot.Position', 'Double', 'r', 'Position axe (mm)'),
      leaf('Robot.Vitesse', 'ns=2;s=Robot.Vitesse', 'Double', 'r', 'Vitesse (mm/s)'),
      leaf('Robot.EnMarche', 'ns=2;s=Robot.EnMarche', 'Boolean', 'r'),
      leaf('Robot.Defaut', 'ns=2;s=Robot.Defaut', 'Boolean', 'r', 'Défaut robot'),
      leaf('Robot.Consigne', 'ns=2;s=Robot.Consigne', 'Double', 'rw', 'Consigne position (mm)'),
      leaf('Convoyeur.Marche', 'ns=2;s=Convoyeur.Marche', 'Boolean', 'rw'),
      leaf('Convoyeur.Cadence', 'ns=2;s=Convoyeur.Cadence', 'Int32', 'rw', 'Cadence (pièces/min)')
    ].map((e) => {
      const { _direction, _datatype, ...entry } = e as typeof e & { _direction: number; _datatype: number };
      return entry;
    }),
    types: [],
    warnings: []
  };
}

/**
 * A pre-existing live project state, so the demo's check-out/diff shows a
 * realistic mix: `Equip_Four` already exists with one datapoint; the studio
 * workspace adds Hygrometrie + a second oven + the addresses/alarms.
 */
export function demoLiveSnapshot(): LiveSnapshot {
  return {
    types: [
      {
        typeName: 'Equip_Four',
        structure: {
          name: 'Equip_Four',
          type: 'Struct',
          children: [
            { name: 'Etat', type: 'Struct', children: [{ name: 'EnChauffe', type: 'Bool' }, { name: 'PorteOuverte', type: 'Bool' }] },
            { name: 'Mesures', type: 'Struct', children: [{ name: 'Temperature', type: 'Float' }] },
            { name: 'Consignes', type: 'Struct', children: [{ name: 'Temperature', type: 'Float' }, { name: 'Rampe', type: 'Float' }] }
          ]
        }
      }
    ],
    dps: [{ dpName: 'Z01_FOUR001', dpType: 'Equip_Four' }],
    configs: {
      'Z01_FOUR001.Mesures.Temperature': {
        archive: { group: 'EVENT', active: true }
      }
    }
  };
}

/** Live values returned by the demo test-read (deterministic, plausible). */
export const DEMO_LIVE_VALUES: Record<string, unknown> = {
  'Z01_FOUR001.Mesures.Temperature': 187.4,
  'Z01_FOUR001.Consignes.Temperature': 190,
  'Z01_FOUR001.Etat.EnChauffe': true,
  'Z01_FOUR001.Etat.PorteOuverte': false,
  'Z01_FOUR002.Mesures.Temperature': 22.1,
  'Z01_FOUR002.Consignes.Temperature': 0
};
