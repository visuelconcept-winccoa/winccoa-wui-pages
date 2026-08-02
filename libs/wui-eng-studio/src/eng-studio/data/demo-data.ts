// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Seed data for the offline demo gateway — a small but realistic plant that
 * exercises the MANY-TO-MANY device↔book relation both ways:
 *
 *  - **aggregation**: `Ligne_Embouteillage` groups TWO OPC UA interfaces
 *    (a filler + a labeller), each seen as its own address book;
 *  - **mutualisation**: `Z01_Pompe1` and `Z01_Pompe2` share ONE catalog book
 *    (`Catalogue_Pompe_KSB`, a file catalog with no live interface).
 *
 * Plus a SIMATIC S7-1500 oven (bound from a TIA SimaticML export) and a Modbus
 * meter. Rich enough for the docs/screenshots WITHOUT a WinCC OA runtime.
 */

import {
  buildBookFromSimaticMl,
  buildOpcUaReference,
  directionFor,
  opcUaDatatypeCode,
  opcUaLeafType,
  type AddressBook,
  type BookEntry,
  type BookInterface,
  type Device,
  type LiveSnapshot
} from '@visuelconcept/wui-eng-core';
import {
  DB_ECHANGE_STANDARD_XML,
  DB_FOUR_OPTIMIZED_XML,
  UDT_MOTEUR_XML
} from '@visuelconcept/wui-eng-core/samples/simaticml-fixtures.js';
import { pac3200Book } from './pac3200.js';
import { packMlBook } from './packml.js';

// --- equipments (logical) — each references one or more books -----------------
export const DEMO_DEVICES: Device[] = [
  {
    id: 's7-four1',
    name: 'S7_Four1',
    protocol: 's7plus',
    connection: { ip: '192.168.10.21', rack: 0, slot: 1, cpu: 'S7-1500' },
    accessModes: ['s7', 's7plus', 'opcua'],
    driverNumber: 3,
    pollGroup: '_EngStudio_Poll',
    state: 'connected',
    bookIds: ['book-s7-four']
  },
  {
    id: 'ligne-embouteillage',
    name: 'Ligne_Embouteillage',
    protocol: 'opcua',
    accessModes: ['opcua'],
    driverNumber: 4,
    pollGroup: '_EngStudio_Poll',
    state: 'connected',
    // AGGREGATION: two machine-specific OPC UA interfaces + the PackML standard
    // interface catalog (itself mutualised with the case packer below).
    bookIds: ['book-opcua-remplisseuse', 'book-opcua-etiqueteuse', 'book-packml-v101']
  },
  {
    id: 'ligne-encaisseuse',
    name: 'Ligne_Encaisseuse',
    protocol: 'opcua',
    connection: { endpoint: 'opc.tcp://192.168.10.44:4840' },
    accessModes: ['opcua'],
    driverNumber: 4,
    pollGroup: '_EngStudio_Poll',
    state: 'connected',
    // MUTUALISATION of a STANDARD interface: the same PackML catalog.
    bookIds: ['book-packml-v101']
  },
  {
    id: 'z01-pompe1',
    name: 'Z01_Pompe1',
    protocol: 's7plus',
    accessModes: ['s7plus', 'opcua'],
    state: 'connected',
    // MUTUALISATION: shares the catalog with Z01_Pompe2.
    bookIds: ['book-catalogue-pompe']
  },
  {
    id: 'z01-pompe2',
    name: 'Z01_Pompe2',
    protocol: 's7plus',
    accessModes: ['s7plus', 'opcua'],
    state: 'disconnected',
    bookIds: ['book-catalogue-pompe']
  },
  // Two SENTRON PAC3200 meters sharing ONE device-type register catalog
  // (Modbus has no browse — the catalog IS the vendor register map).
  {
    id: 'pac-depart1',
    name: 'Z02_PAC3200_Depart1',
    protocol: 'modbus',
    connection: { ip: '192.168.10.61', port: 502, unitId: 1, wordOrder: 'big', zeroBased: false },
    accessModes: ['modbus'],
    driverNumber: 5,
    pollGroup: '_EngStudio_Poll',
    state: 'connected',
    bookIds: ['book-pac3200']
  },
  {
    id: 'pac-depart2',
    name: 'Z02_PAC3200_Depart2',
    protocol: 'modbus',
    connection: { ip: '192.168.10.62', port: 502, unitId: 1, wordOrder: 'big', zeroBased: false },
    accessModes: ['modbus'],
    driverNumber: 5,
    pollGroup: '_EngStudio_Poll',
    state: 'disconnected',
    bookIds: ['book-pac3200']
  }
];

// --- books --------------------------------------------------------------------

/** Small helper to build an OPC UA book (as if browsed from a live server). */
function opcuaBook(
  id: string,
  name: string,
  conn: string,
  rows: [path: string, nodeId: string, dt: string, access: 'r' | 'rw' | 'w', comment?: string][]
): AddressBook {
  const iface: BookInterface = {
    protocol: 'opcua',
    connection: conn,
    params: { endpoint: `opc.tcp://192.168.10.42:4840`, server: conn }
  };
  const entries: BookEntry[] = rows.map(([path, nodeId, dt, access, comment]) => ({
    path,
    sourceType: dt,
    leafType: opcUaLeafType(dt),
    access,
    addresses: { opcua: buildOpcUaReference(conn, nodeId) },
    comment
  }));
  return {
    id,
    name,
    provenance: { kind: 'opcua-browse', generatedAt: '2026-08-01T10:03:00.000Z', detail: `browse ns=2;Objects/${conn}` },
    interface: iface,
    entries,
    types: [],
    warnings: []
  };
}

/** The S7 oven's book, generated from the bundled SimaticML fixtures. */
export function s7FourBook(): AddressBook {
  return buildBookFromSimaticMl({
    bookId: 'book-s7-four',
    name: 'TIA Four1 (DB_Four + DB_Echange)',
    provenance: { kind: 'simaticml', file: 'Four1_export.zip', generatedAt: '2026-08-01T09:12:00.000Z', detail: 'TIA V17 · CPU PLC_Four' },
    interface: { protocol: 's7plus', connection: 'PLC_Four', params: { ip: '192.168.10.21', rack: 0, slot: 1 }, driverNumber: 3 },
    documents: [
      { fileName: 'UDT_Moteur.xml', xml: UDT_MOTEUR_XML },
      { fileName: 'DB_Four.xml', xml: DB_FOUR_OPTIMIZED_XML },
      { fileName: 'DB_Echange.xml', xml: DB_ECHANGE_STANDARD_XML }
    ]
  });
}

/** A shared FILE catalog (no live interface) — mutualised across pumps. */
export function pompeCatalogueBook(): AddressBook {
  const leaf = (path: string, dt: string, access: 'r' | 'rw' | 'w', comment?: string): BookEntry => ({
    path,
    sourceType: dt,
    leafType: opcUaLeafType(dt),
    access,
    // A catalog/template: symbolic path only, bound per equipment at check-in.
    addresses: { s7plus: `"${path.split('.').map((s) => s).join('"."')}"` },
    comment
  });
  return {
    id: 'book-catalogue-pompe',
    name: 'Catalogue_Pompe_KSB',
    provenance: { kind: 'nodeset', file: 'KSB_Etanorm.xml', generatedAt: '2026-07-20T14:00:00.000Z', detail: 'Catalogue type (sans interface) — mutualisé' },
    // interface intentionally absent → file catalog / template.
    entries: [
      leaf('Etat.Marche', 'Boolean', 'r', 'Retour de marche'),
      leaf('Etat.Defaut', 'Boolean', 'r', 'Défaut pompe'),
      leaf('Mesures.Debit', 'Double', 'r', 'Débit (m³/h)'),
      leaf('Mesures.Pression', 'Double', 'r', 'Pression (bar)'),
      leaf('Mesures.Courant', 'Double', 'r', 'Courant moteur (A)'),
      leaf('Commande.Consigne', 'Double', 'rw', 'Consigne vitesse (%)'),
      leaf('Commande.MarcheArret', 'Boolean', 'w', 'Ordre marche/arrêt')
    ],
    types: [],
    warnings: []
  };
}

/** Every demo book, keyed by id. */
export function demoBooks(): AddressBook[] {
  return [
    s7FourBook(),
    opcuaBook('book-opcua-remplisseuse', 'OPC UA Remplisseuse', 'Remplisseuse', [
      ['Remplisseuse.Cadence', 'ns=2;s=Remplisseuse.Cadence', 'Int32', 'r', 'Cadence (bouteilles/min)'],
      ['Remplisseuse.Niveau', 'ns=2;s=Remplisseuse.Niveau', 'Double', 'r', 'Niveau cuve (%)'],
      ['Remplisseuse.EnMarche', 'ns=2;s=Remplisseuse.EnMarche', 'Boolean', 'r'],
      ['Remplisseuse.Defaut', 'ns=2;s=Remplisseuse.Defaut', 'Boolean', 'r', 'Défaut remplisseuse'],
      ['Remplisseuse.Consigne', 'ns=2;s=Remplisseuse.Consigne', 'Int32', 'rw', 'Consigne cadence']
    ]),
    opcuaBook('book-opcua-etiqueteuse', 'OPC UA Étiqueteuse', 'Etiqueteuse', [
      ['Etiqueteuse.Cadence', 'ns=2;s=Etiqueteuse.Cadence', 'Int32', 'r', 'Cadence (étiquettes/min)'],
      ['Etiqueteuse.StockEtiquettes', 'ns=2;s=Etiqueteuse.StockEtiquettes', 'Int32', 'r', 'Stock étiquettes'],
      ['Etiqueteuse.EnMarche', 'ns=2;s=Etiqueteuse.EnMarche', 'Boolean', 'r'],
      ['Etiqueteuse.BourrageDetecte', 'ns=2;s=Etiqueteuse.BourrageDetecte', 'Boolean', 'r', 'Bourrage détecté']
    ]),
    packMlBook(),
    pompeCatalogueBook(),
    pac3200Book('detailed')
  ];
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
