// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A FAKE S7-1500 station for the offline demo — an in-memory TIA program behind
 * the core's `S7PlusBrowsePort`.
 *
 * Same reasoning as `demo-opcua-server.ts`: the online browse is the one studio
 * feature that needs a live machine, and the workflow has to be understandable
 * from the docs and screenshots with **no WinCC OA, no S7Plus driver and no PLC**.
 * The demo therefore implements the very port the `s7plusBrowse` manager
 * implements, and the *same* core walker builds the book — the screenshots show a
 * real walk.
 *
 * What it models beyond "some signals":
 *
 *  - the **two sources** an S7Plus browse can have: the reserved online project
 *    (`S7Plus$Online|Online`, the live PLC) and a TIA export placed under
 *    `data/TIA_Projects` — the second one browses the same program *as engineered*,
 *    which is why a book read from it is a template catalog with no interface;
 *  - the driver's **path grammar**: blocks under a synthetic `Blocks` segment, tag
 *    tables under `Tags`, and members nested inside a block;
 *  - a `Struct` member, an `Array` (expanded element by element), a `String` whose
 *    reported length includes its 2 header bytes, and a datatype the S7 mapping
 *    has no transformation for — each of which the walker has a rule for;
 *  - the **drift** that makes a re-browse worth doing: generation 2 is the same
 *    machine after a program download (one member added, one removed, one retyped);
 *  - a declared but **unreachable** connection, so the failing path is shown too.
 *
 * The program is a plasma furnace exchange block — the shape a French machine
 * builder actually ships: `DB_Echange` with `Consignes` / `Mesures` / `Commandes`,
 * plus an HMI tag table.
 */

import type { S7PlusBrowseNode, S7PlusBrowsePort } from '@visuelconcept-winccoa/wui-eng-core';

/** The TIA project + station of the demo's OFFLINE source (a `.zap` export). */
export const DEMO_S7PLUS_PROJECT = 'Four_Plasma_V17';
export const DEMO_S7PLUS_STATION = `${DEMO_S7PLUS_PROJECT}|PLC_Four`;
/** The reserved pair that means "read the live PLC" (the core exports it too). */
const ONLINE_STATION = 'S7Plus$Online|Online';

/** A leaf: one addressable variable of a block. */
function variable(name: string, valueType: string, comment = '', itemLength = -1): S7PlusBrowseNode {
  return { nodePath: name, systemType: 'Variable', valueType, itemLength, ...(comment === '' ? {} : { comment }) };
}

/** A tag of a PLC tag table (the driver reports these as `Tag`). */
function tag(name: string, valueType: string, comment = ''): S7PlusBrowseNode {
  return { nodePath: name, systemType: 'Tag', valueType, itemLength: -1, ...(comment === '' ? {} : { comment }) };
}

/** A container the walker browses into (`Struct`, `Block`, `ComplexTag`, `Array`). */
function container(name: string, systemType: string, valueType = '', itemLength = -1, comment = ''): S7PlusBrowseNode {
  return { nodePath: name, systemType, valueType, itemLength, ...(comment === '' ? {} : { comment }) };
}

/**
 * The program, per generation, keyed by the EXACT item the driver is asked.
 * Generation 1 is the initial browse; generation 2 is the same station after a
 * program download — that drift is the point of a refresh.
 */
function program(station: string, generation: number): Record<string, S7PlusBrowseNode[]> {
  const consignes: S7PlusBrowseNode[] = [
    variable('Temperature', 'Real', 'Consigne de température four (°C)'),
    variable('Cadence', 'Int', 'Consigne de cadence (pièces/h)'),
    variable('Recette', 'String[32]', 'Nom de la recette courante', 34)
  ];
  const mesures: S7PlusBrowseNode[] = [
    variable('TemperatureFour', 'Real', 'Température four mesurée (°C)'),
    variable('PressionChambre', 'Real', 'Pression chambre (mbar)'),
    variable('PuissanceTorche', 'Real', 'Puissance torche (kW)'),
    container('Zones', 'Array', 'Real', 4, 'Températures par zone (°C)')
  ];
  const commandes: S7PlusBrowseNode[] = [
    variable('Marche', 'Bool', 'Ordre de marche'),
    variable('Arret', 'Bool', 'Ordre d’arrêt'),
    variable('AcquitDefaut', 'Bool', 'Acquittement défaut')
  ];
  const etats: S7PlusBrowseNode[] = [
    variable('EnMarche', 'Bool', 'Four en marche'),
    variable('DefautPresent', 'Bool', 'Défaut présent'),
    variable('HeuresFonctionnement', 'UDInt', 'Compteur horaire (h)'),
    // A datatype the classic/plus mapping has no verified element type for: the
    // walker must catalogue it, flag it `unmapped` and generate NO address.
    variable('Diagnostic', 'Variant', 'Bloc de diagnostic constructeur')
  ];

  if (generation >= 2) {
    // added: a second pressure measurement the program now exposes
    mesures.push(variable('PressionInjection', 'Real', 'Pression injection (mbar)'));
    // removed: the cadence setpoint was dropped from the exchange block
    const dropped = consignes.findIndex((node) => node.nodePath === 'Cadence');
    if (dropped !== -1) consignes.splice(dropped, 1);
    // changed: the hour counter was widened to 64 bits
    const retyped = etats.findIndex((node) => node.nodePath === 'HeuresFonctionnement');
    if (retyped !== -1) etats[retyped] = variable('HeuresFonctionnement', 'ULInt', 'Compteur horaire (h)');
  }

  const blocks = `${station}|Blocks`;
  return {
    // The station's own level: the blocks and the tag tables of the program.
    [station]: [
      container('DB_Echange', 'Block', '', -1, 'Bloc d’échange IHM'),
      container('DB_Etats', 'Block', '', -1, 'États machine'),
      container('Tags_IHM', 'ComplexTag', '', -1, 'Table de variables IHM')
    ],
    [`${blocks}|DB_Echange`]: [
      container('Consignes', 'Struct', '', -1, 'Consignes procédé'),
      container('Mesures', 'Struct', '', -1, 'Mesures procédé'),
      container('Commandes', 'Struct', '', -1, 'Commandes'),
      variable('Version', 'String[16]', 'Version du programme', 18)
    ],
    [`${blocks}|DB_Echange|Consignes`]: consignes,
    [`${blocks}|DB_Echange|Mesures`]: mesures,
    // An array: the driver answers its FIRST element, and the walker completes the
    // rest from the declared length (what the standard panel does).
    [`${blocks}|DB_Echange|Mesures|Zones`]: [variable('Zones[0]', 'Real', 'Température zone (°C)')],
    [`${blocks}|DB_Echange|Commandes`]: commandes,
    [`${blocks}|DB_Etats`]: etats,
    [`${station}|Tags|Tags_IHM`]: [
      tag('Bp_Marche', 'Bool', 'Bouton marche pupitre'),
      tag('Bp_Arret', 'Bool', 'Bouton arrêt pupitre'),
      tag('Voyant_Defaut', 'Bool', 'Voyant défaut')
    ]
  };
}

/**
 * In-memory S7Plus browse port. `advance()` moves the fake station to its next
 * generation, so a second walk of the same station returns a drifted program.
 *
 * The ONLINE and the TIA-export sources answer the SAME program, which is the
 * honest default (an export is normally what was downloaded) — what differs is
 * what the studio may claim from it, and that difference is the core's, not the
 * fake's: an export produces a template catalog with no interface.
 */
export class DemoS7PlusBrowsePort implements S7PlusBrowsePort {
  /** Browse calls made so far (the demo shows the walk is level-by-level). */
  public calls = 0;

  private generation = 1;

  /** Simulate a program download between two walks. */
  public advance(): void {
    this.generation += 1;
  }

  public async browseLevel(connection: string, item: string, _hmiVisibleOnly: boolean): Promise<S7PlusBrowseNode[]> {
    this.calls += 1;
    if (connection === 'Presse_S7') {
      // A declared but unreachable station: the demo must show that path too.
      throw new Error('S7Plus: station injoignable (démo)');
    }
    // The projects level: the exports the driver found, plus the online project.
    if (item === '') {
      return [
        container(DEMO_S7PLUS_PROJECT, 'Project'),
        container('S7Plus$Online', 'Project')
      ];
    }
    // The stations of a project (`Project` -> `Station`).
    if (item === DEMO_S7PLUS_PROJECT) return [container('PLC_Four|S71500', 'Station')];
    if (item === 'S7Plus$Online') return [container('Online|S71500', 'Station')];
    // Anything deeper is a level of the program, under whichever station was asked.
    const station = item.startsWith(ONLINE_STATION) ? ONLINE_STATION : DEMO_S7PLUS_STATION;
    return program(station, this.generation)[item] ?? [];
  }
}

/** The S7Plus connections the demo offers for an online browse. */
export const DEMO_S7PLUS_CONNECTIONS = [
  { name: 'Four2', connected: true, station: DEMO_S7PLUS_STATION, driverNumber: 3, address: '192.168.10.21', connState: 258 },
  /** Declared but unreachable — the demo must show the failing walk too. */
  { name: 'Presse_S7', connected: false, driverNumber: 3, address: '192.168.10.28', connState: 1 }
];
