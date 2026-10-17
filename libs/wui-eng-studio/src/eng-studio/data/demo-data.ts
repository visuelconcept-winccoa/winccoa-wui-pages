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
  buildBookFromAwlSources,
  buildBookFromS7Symbols,
  buildBookFromSimaticMl,
  buildOpcUaReference,
  mirrorStructureFromBooks,
  parseS7SymbolTable,
  opcUaLeafType,
  s7LeafType,
  type AddressBook,
  type BookEntry,
  type BookInterface,
  type Device,
  type LiveSnapshot,
  type ModelTemplate
} from '@visuelconcept-winccoa/wui-eng-core';
import {
  DB_ECHANGE_STANDARD_XML,
  DB_FOUR_OPTIMIZED_XML,
  UDT_MOTEUR_XML
} from '@visuelconcept-winccoa/wui-eng-core/samples/simaticml-fixtures.js';
import { AWL_DB_ECHANGE, AWL_UDT_MOTEUR, SYMBOLS_SDF } from '@visuelconcept-winccoa/wui-eng-core/samples/s7-fixtures.js';
import { pac3200Book } from './pac3200.js';
import { packMlBook } from './packml.js';
import { m580PesageXvmBook, m580StationBook } from './schneider.js';

/**
 * The fake project's drivers, as `GET /api/eng/drivers` would report them.
 *
 * Deliberately NOT all running: the device form must show that a driver can be
 * declared and stopped (an equipment is normally declared before its driver is
 * started), and `1` is a driver whose `DT` the runtime could not read — the case
 * the form has to render as "unknown" rather than hide.
 */
export const DEMO_DRIVERS: { number: number; type: string; running: boolean; mode?: string }[] = [
  { number: 1, type: '', running: false },
  { number: 2, type: 'MODBUS', running: true },
  { number: 3, type: 'S7', running: true },
  { number: 4, type: 'OPCUAC', running: true, mode: 'opcua' },
  { number: 7, type: 'OPCUAC', running: false, mode: 'opcua' }
];

/**
 * The project's ALARM CLASSES — `_AlertClass` datapoint names.
 *
 * The defaults of a WinCC OA project, plus one a customer would have added: an alert
 * class is a datapoint, so what the picker offers must look like datapoint names (leading
 * underscore for the built-ins) rather than the tidy words a fixture would invent.
 */
export const DEMO_ALARM_CLASSES: string[] = [
  '_alert_high',
  '_alert_low',
  '_came',
  '_came_ack',
  '_came_went',
  '_warning',
  'Defaut_Process'
];

/**
 * The project's ARCHIVE GROUPS — usable `_NGA_Group` datapoint names.
 *
 * `_NGA_G_ALERT` is deliberately ABSENT: it is specialised for alarms (`isAlert`), and the
 * backend filters it out for exactly that reason — a demo that offered it would document
 * the wrong thing.
 */
export const DEMO_ARCHIVE_GROUPS: string[] = ['_NGA_G_EVENT', '_NGA_G_MEASURE', '_NGA_G_SLOW'];

/**
 * The project's OPC UA SUBSCRIPTIONS — `_OPCUASubscription` datapoints, offered without their
 * leading underscore (that is how a reference names them).
 *
 * Two of them, because that is the real shape of the decision: a fast subscription for states and
 * faults, a slower one with a deadband for measurements. Their publishing interval and deadband
 * live on the subscription itself, not on the item.
 */
export const DEMO_SUBSCRIPTIONS: string[] = ['Sub_Fast', 'Sub_Process'];

// --- connection state (what a driver would report) ----------------------------
/**
 * What a driver would have written in `Common.State.ConnState` for each equipment —
 * the demo's stand-in for the read the backend does (see `engController.withLiveState`).
 *
 * Keyed by device id and deliberately VARIED, because the interesting states are the
 * ones a fixture usually forgets: `3` (inactive — somebody disabled the connection) and
 * `5` (failure) both light the same red lamp as `1` (not connected) yet call for three
 * different actions, which is the whole reason the raw code is shown beside the LED.
 * Two equipments are absent from this map ON PURPOSE: `Z01_Pompe1/2` declare neither a
 * server name nor an address, so nothing can be matched to a connection and their state
 * stays honestly unknown.
 */
export const DEMO_CONN_STATE: Record<string, number> = {
  's7-four1': 257,
  'ligne-embouteillage': 256,
  'ligne-encaisseuse': 5,
  'm580-station': 3,
  'pac-depart1': 256,
  'pac-depart2': 1
};

// --- equipments (logical) — each references one or more books -----------------
/**
 * A DECLARED equipment: everything a stored device carries EXCEPT its connection state.
 *
 * The omission is the point. A connection state is read from the project, never declared
 * (see `DemoEngGateway.withLiveState`, which mirrors the backend), so a fixture must not
 * be able to claim one — what the demo "reads" lives in {@link DEMO_CONN_STATE}.
 */
type DeviceDeclaration = Omit<Device, 'state'>;

/**
 * Where the classic-S7 station answers. Declared once: the equipment dials it and
 * both of its catalogs bind through it, so three copies could drift apart — and a
 * catalog bound to another address is exactly the mistake the online check exists
 * to catch, which would make it a poor thing to demonstrate by accident.
 */
const S7_STATION = { ip: '192.168.0.1', rack: 0, slot: 2 } as const;

/**
 * Catalog ids, named once: a device references a book and a model reads the same
 * one, so a typo in either would silently orphan the pair.
 */
const BOOK_S7_FOUR = 'book-s7-four';
const BOOK_S7_SYM = 'book-s7-symboles';
const BOOK_S7_SRC = 'book-s7-sources';
const BOOK_PACKML = 'book-packml-v101';
const BOOK_POMPE = 'book-catalogue-pompe';

/**
 * Qualify a model's mapping — `catalogue::chemin`, the convention the studio writes.
 *
 * Spelled out here rather than baked into the literals so the demo models cannot drift
 * from that convention when a path is edited.
 */
function boundTo(bookId: string, map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([leaf, path]) => [leaf, `${bookId}::${path}`]));
}

/** The fake plant's equipments. */
export const DEMO_DEVICES: DeviceDeclaration[] = [
  {
    id: 's7-four1',
    name: 'S7_Four1',
    protocol: 's7plus',
    connection: { ip: '192.168.10.21', rack: 0, slot: 1, cpu: 'S7-1500' },
    accessModes: ['s7plus'],
    driverNumber: 3,
    pollGroup: '_EngStudio_Poll',
    bookIds: [BOOK_S7_FOUR]
  },
  {
    // The classic-S7 station: an S7-300 whose catalog can only come from the STEP 7
    // project (the protocol carries no symbols) and is verified against the CPU.
    id: 's7-pompage',
    name: 'S7_Pompage',
    protocol: 's7',
    // Names its connection, so the lamp is read on THAT datapoint rather than by
    // searching the IP — the same exactness an OPC UA equipment gets.
    connection: { connection: 'S7_Pompage', ...S7_STATION },
    accessModes: ['s7'],
    driverNumber: 2,
    pollGroup: '_EngStudio_Poll',
    bookIds: [BOOK_S7_SYM, BOOK_S7_SRC]
  },
  {
    id: 'ligne-embouteillage',
    name: 'Ligne_Embouteillage',
    protocol: 'opcua',
    accessModes: ['opcua'],
    driverNumber: 4,
    pollGroup: '_EngStudio_Poll',
    // AGGREGATION: two machine-specific OPC UA interfaces + the PackML standard
    // interface catalog (itself mutualised with the case packer below).
    bookIds: ['book-opcua-remplisseuse', 'book-opcua-etiqueteuse', BOOK_PACKML]
  },
  {
    id: 'ligne-encaisseuse',
    name: 'Ligne_Encaisseuse',
    protocol: 'opcua',
    connection: { endpoint: 'opc.tcp://192.168.10.44:4840' },
    accessModes: ['opcua'],
    driverNumber: 4,
    pollGroup: '_EngStudio_Poll',
    // MUTUALISATION of a STANDARD interface: the same PackML catalog.
    bookIds: [BOOK_PACKML]
  },
  {
    id: 'z01-pompe1',
    name: 'Z01_Pompe1',
    protocol: 's7plus',
    accessModes: ['s7plus'],
    // MUTUALISATION: shares the catalog with Z01_Pompe2.
    bookIds: [BOOK_POMPE]
  },
  {
    id: 'z01-pompe2',
    name: 'Z01_Pompe2',
    protocol: 's7plus',
    accessModes: ['s7plus'],
    bookIds: [BOOK_POMPE]
  },
  // Schneider Modicon M580 — book generated from a Control Expert variables
  // export (Modbus has no browse; UMAS symbolic browse is proprietary, see NOTES).
  {
    id: 'm580-station',
    name: 'Z03_M580_Station',
    protocol: 'modbus',
    connection: { ip: '192.168.10.30', port: 502, unitId: 255, cpu: 'BMEP582040' },
    accessModes: ['modbus'],
    driverNumber: 5,
    pollGroup: '_EngStudio_Poll',
    // Two generators on the SAME equipment: a CSV variables export and an XVM one.
    bookIds: ['book-m580-station', 'book-m580-pesage-xvm']
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
    bookId: BOOK_S7_FOUR,
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

/**
 * The pumping station's SYMBOL TABLE — the memory areas, and the project's block
 * directory. Built by the real generator from the shared fixture, so the demo
 * shows exactly what an `.sdf` export produces, warnings included: this catalog
 * names two data blocks and holds no signal for either, which is the caveat of the
 * format and is stated rather than hidden.
 */
export function s7SymbolsBook(): AddressBook {
  return buildBookFromS7Symbols({
    bookId: BOOK_S7_SYM,
    name: 'STEP 7 Pompage — symboles',
    provenance: { kind: 's7sym', file: 'Pompage.sdf', generatedAt: '2026-08-01T09:20:00.000Z', detail: 'Simatic Manager · table des symboles' },
    interface: { protocol: 's7', connection: 'S7_Pompage', params: { ...S7_STATION }, driverNumber: 2 },
    text: SYMBOLS_SDF
  });
}

/**
 * The other half: the DB sources. The symbol table's block directory is passed in,
 * which is what paths the members `Echange.*` rather than `DB10.*` — the addresses
 * are identical either way.
 *
 * Its DB10 is deliberately WIDER than the fake CPU reports (`S7_INVENTORY`), so
 * the demo's online check finds a real disagreement — a block shortened since the
 * export — instead of a reassuring green tick.
 */
export function s7SourcesBook(): AddressBook {
  return buildBookFromAwlSources({
    bookId: BOOK_S7_SRC,
    name: 'STEP 7 Pompage — sources DB',
    provenance: { kind: 's7awl', file: 'DB10.awl, UDT_Moteur.awl', generatedAt: '2026-08-01T09:22:00.000Z', detail: 'Simatic Manager · générer source' },
    interface: { protocol: 's7', connection: 'S7_Pompage', params: { ...S7_STATION }, driverNumber: 2 },
    blockNames: parseS7SymbolTable(SYMBOLS_SDF).blocks,
    documents: [
      { fileName: 'UDT_Moteur.awl', text: AWL_UDT_MOTEUR },
      { fileName: 'DB10.awl', text: AWL_DB_ECHANGE }
    ]
  });
}

/**
 * A shared FILE catalog (no live interface) — mutualised across pumps.
 *
 * The source types are the **TIA** ones (`Bool`, `LReal`), not the OPC UA ones: the
 * addresses of this catalog are S7Plus symbolic operands, and the `_datatype`
 * transformation is looked up in the S7Plus table, which speaks IEC names. A
 * catalog whose type names belong to another driver generates DPEs the generator
 * cannot address (and now says so) — see drivers/s7.ts.
 */
export function pompeCatalogueBook(): AddressBook {
  const leaf = (path: string, dt: string, access: 'r' | 'rw' | 'w', comment?: string): BookEntry => ({
    path,
    sourceType: dt,
    leafType: s7LeafType(dt),
    access,
    // A catalog/template: symbolic path only, bound per equipment at check-in.
    addresses: { s7plus: `"${path.split('.').map((s) => s).join('"."')}"` },
    comment
  });
  return {
    id: BOOK_POMPE,
    name: 'Catalogue_Pompe_KSB',
    provenance: { kind: 'nodeset', file: 'KSB_Etanorm.xml', generatedAt: '2026-07-20T14:00:00.000Z', detail: 'Catalogue type (sans interface) — mutualisé' },
    // interface intentionally absent → file catalog / template.
    entries: [
      leaf('Etat.Marche', 'Bool', 'r', 'Retour de marche'),
      leaf('Etat.Defaut', 'Bool', 'r', 'Défaut pompe'),
      leaf('Mesures.Debit', 'LReal', 'r', 'Débit (m³/h)'),
      leaf('Mesures.Pression', 'LReal', 'r', 'Pression (bar)'),
      leaf('Mesures.Courant', 'LReal', 'r', 'Courant moteur (A)'),
      leaf('Commande.Consigne', 'LReal', 'rw', 'Consigne vitesse (%)'),
      leaf('Commande.MarcheArret', 'Bool', 'w', 'Ordre marche/arrêt')
    ],
    types: [],
    warnings: []
  };
}

/** Every demo book, keyed by id. */
export function demoBooks(): AddressBook[] {
  return [
    s7FourBook(),
    // The classic-S7 pair: the symbol table and the DB sources of one station.
    // Two catalogs and not one, because they are re-read independently — merging
    // them would make a re-ingest of either silently drop the other half.
    s7SymbolsBook(),
    s7SourcesBook(),
    // NOTE: `book-opcua-remplisseuse` is NOT declared here. It is produced by the
    // real core walker (`buildBookFromOpcUaBrowse`) against the demo's fake OPC UA
    // server, seeded by DemoEngGateway — so the online-browse path, its warnings
    // and its refresh delta are exercised by the demo and the screenshots, not
    // faked by a literal. See data/demo-opcua-server.ts.
    opcuaBook('book-opcua-etiqueteuse', 'OPC UA Étiqueteuse', 'Etiqueteuse', [
      ['Etiqueteuse.Cadence', 'ns=2;s=Etiqueteuse.Cadence', 'Int32', 'r', 'Cadence (étiquettes/min)'],
      ['Etiqueteuse.StockEtiquettes', 'ns=2;s=Etiqueteuse.StockEtiquettes', 'Int32', 'r', 'Stock étiquettes'],
      ['Etiqueteuse.EnMarche', 'ns=2;s=Etiqueteuse.EnMarche', 'Boolean', 'r'],
      ['Etiqueteuse.BourrageDetecte', 'ns=2;s=Etiqueteuse.BourrageDetecte', 'Boolean', 'r', 'Bourrage détecté']
    ]),
    packMlBook(),
    pompeCatalogueBook(),
    m580StationBook(),
    m580PesageXvmBook(),
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

/**
 * Saved MODELS the demo starts with — the Model tab's first level.
 *
 * A house standard is authored once and applied machine after machine, so an empty
 * library would show the feature's empty state instead of the feature. Two, because
 * the two ways a model comes into being both deserve to be visible:
 *
 *  - `STD_Four` — AUTHORED: a `PV`/`SP`/`Etat` structure that is deliberately NOT the
 *    shape of the TIA book it reads (that is the whole point of a mapping), with its
 *    deployment pinned where it matters — an alert on the fault, archiving on the
 *    temperature, a range nobody has to remember;
 *  - `STD_PackML` — mirroring the mutualised PackML catalog: same structure as its
 *    source, reused across every machine implementing the spec.
 *
 * Their bindings are paths INTO their source catalog, which is what makes the
 * coverage check meaningful when one is loaded against another book.
 */
/** Element types the seeded models use — named so the literals are not repeated. */
const GROUP = 'Struct' as const;
const FLOAT = 'Float' as const;
const BOOL = 'Bool' as const;
const INT = 'Int' as const;

export const DEMO_MODELS: ModelTemplate[] = [
  {
    id: 'std-four',
    name: 'STD_Four',
    description: 'Four de séchage — standard maison : mesures, consignes, état. Mappé sur le DB d’échange de l’automate, non reproduit (la structure est la nôtre, pas celle du DB).',
    typeName: 'STD_Four',
    sourceBookId: BOOK_S7_FOUR,
    sources: [{ bookId: BOOK_S7_FOUR }],
    structure: {
      name: 'STD_Four',
      type: GROUP,
      children: [
        { name: 'PV', type: GROUP, children: [{ name: 'Temperature', type: FLOAT }, { name: 'Hygrometrie', type: FLOAT }] },
        { name: 'SP', type: GROUP, children: [{ name: 'Temperature', type: FLOAT }, { name: 'Rampe', type: FLOAT }] },
        { name: 'Etat', type: GROUP, children: [{ name: 'EnChauffe', type: BOOL }, { name: 'Defaut', type: BOOL }] }
      ]
    },
    bindings: boundTo(BOOK_S7_FOUR, {
      'PV.Temperature': 'DB_Four.Mesures.Temperature',
      'PV.Hygrometrie': 'DB_Four.Mesures.Hygrometrie',
      'SP.Temperature': 'DB_Four.Consignes.Temperature',
      'SP.Rampe': 'DB_Four.Consignes.Rampe',
      'Etat.EnChauffe': 'DB_Four.Etat.EnChauffe',
      'Etat.Defaut': 'DB_Four.Etat.PorteOuverte'
    }),
    // The class and the group are DATAPOINT names of the project (`_AlertClass`,
    // `_NGA_Group`) — the demo pins the ones its own pickers offer, so a screenshot cannot
    // show a value the runtime would reject.
    policy: {
      'PV.Temperature': { archive: { active: true, group: '_NGA_G_EVENT' }, range: { min: 0, max: 450 } },
      'Etat.Defaut': { alarm: { active: true, alarmClass: '_alert_high' } }
    },
    savedAt: '2026-08-03T09:10:00.000Z'
  },
  {
    id: 'std-packml',
    name: 'STD_PackML',
    description: 'Interface PackML v1.01 (état + commandes) — reproduite du catalogue mutualisé, donc identique sur chaque machine qui l’implémente.',
    typeName: 'STD_PackML',
    sourceBookId: BOOK_PACKML,
    sources: [{ bookId: BOOK_PACKML }],
    structure: {
      name: 'STD_PackML',
      type: GROUP,
      children: [
        { name: 'Status', type: GROUP, children: [{ name: 'StateCurrent', type: INT }, { name: 'UnitModeCurrent', type: INT }] },
        { name: 'Command', type: GROUP, children: [{ name: 'Start', type: BOOL }, { name: 'Stop', type: BOOL }] }
      ]
    },
    bindings: boundTo(BOOK_PACKML, {
      'Status.StateCurrent': 'Status.StateCurrent',
      'Status.UnitModeCurrent': 'Status.UnitModeCurrent',
      'Command.Start': 'Command.Start',
      'Command.Stop': 'Command.Stop'
    }),
    savedAt: '2026-08-03T09:12:00.000Z'
  }
];

/**
 * A model over TWO catalogs of the SAME station — the case a single source cannot
 * express, and the reason the sources are a check-list.
 *
 * Its structure is not written here: it is MIRRORED from the two STEP 7 catalogs by the
 * core, exactly as the UI does it (`demoMultiSourceModel`), so the demo cannot show a
 * shape the real mirror would not produce.
 */
export function demoMultiSourceModel(books: AddressBook[]): ModelTemplate {
  const symbols = books.find((book) => book.id === BOOK_S7_SYM);
  const sources = books.find((book) => book.id === BOOK_S7_SRC);
  const mirrored = [sources, symbols].filter((book): book is AddressBook => book !== undefined);
  const mirror = mirrorStructureFromBooks(
    mirrored.map((book) => ({ book })),
    { typeName: 'STD_Pompage' }
  );
  return {
    id: 'std-pompage',
    name: 'STD_Pompage',
    description:
      'Station de pompage — reproduite des DEUX catalogues STEP 7 du même automate : les membres du DB d’échange et les mémentos de la table des symboles. Chaque branche garde le catalogue dont elle vient.',
    typeName: 'STD_Pompage',
    structure: mirror.structure,
    bindings: mirror.bindings,
    sourceBookId: mirrored[0]?.id ?? BOOK_S7_SRC,
    sources: mirrored.map((book) => ({ bookId: book.id })),
    savedAt: '2026-08-03T09:14:00.000Z'
  };
}
