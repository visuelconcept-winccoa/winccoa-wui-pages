// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A FAKE OPC UA server for the offline demo — an in-memory address space behind
 * the core's `OpcUaBrowsePort`.
 *
 * Why it exists: the online browse is the one studio feature that needs a live
 * machine, and the decoupling mandate says the workflow must be understandable
 * from the docs and screenshots with **no WinCC OA and no PLC**. So the demo
 * implements the same port the backend implements, and the *same* core walker
 * builds the book. What you see in the screenshots is the real walk.
 *
 * It also models what makes a re-browse worth doing: the address space **drifts**.
 * The second browse (`generation` 2) adds two signals, drops one and retypes
 * another, so the demo shows a real delta — added / removed / changed — instead of
 * a no-op refresh.
 *
 * The address space is a bottle filler exposing a PackML-ish interface, which is
 * the archetype the studio's mutualised catalogs target.
 */

import { OPCUA_OBJECTS_FOLDER, type OpcUaBrowseNode, type OpcUaBrowsePort } from '@visuelconcept/wui-eng-core';

const NS = 'ns=4';

/** A container node (Object/Folder) — the walker recurses into these. */
function folder(name: string, id: string): OpcUaBrowseNode {
  return { displayName: name, nodeId: `${NS};i=${id}`, nodeClass: 'Object' };
}

/** A variable node — the walker turns these into book entries. */
function variable(name: string, key: string, dataType: string, valueRank = -1): OpcUaBrowseNode {
  return { displayName: name, nodeId: `${NS};s=${key}`, nodeClass: 'Variable', dataType, valueRank };
}

/**
 * The demo address space, per generation.
 * Generation 1 is the initial browse; generation 2 is the SAME machine after a
 * PLC program update — that drift is the point.
 */
function addressSpace(generation: number): Record<string, OpcUaBrowseNode[]> {
  const status: OpcUaBrowseNode[] = [
    variable('StateCurrent', 'Status.StateCurrent', 'Int32'),
    variable('UnitModeCurrent', 'Status.UnitModeCurrent', 'Int32'),
    variable('CurMachSpeed', 'Status.CurMachSpeed', 'Float'),
    variable('MachSpeed', 'Status.MachSpeed', 'Float'),
    variable('EquipmentInterlock_Blocked', 'Status.Blocked', 'Boolean'),
    variable('EquipmentInterlock_Starved', 'Status.Starved', 'Boolean')
  ];
  const measures: OpcUaBrowseNode[] = [
    variable('TemperatureProduit', 'Mes.TempProduit', 'Double'),
    variable('PressionCuve', 'Mes.PressionCuve', 'Double'),
    variable('NiveauCuve', 'Mes.NiveauCuve', 'Float'),
    variable('DebitRemplissage', 'Mes.Debit', 'Float')
  ];
  const setpoints: OpcUaBrowseNode[] = [
    variable('ConsigneTemperature', 'Cons.Temp', 'Double'),
    variable('ConsigneVolume', 'Cons.Volume', 'Float'),
    variable('ConsigneCadence', 'Cons.Cadence', 'Float')
  ];
  const admin: OpcUaBrowseNode[] = [
    variable('ProdProcessedCount', 'Admin.ProdCount', 'UInt32'),
    variable('ProdDefectiveCount', 'Admin.DefectCount', 'UInt32'),
    variable('AlarmActive', 'Admin.AlarmActive', 'Boolean'),
    variable('AlarmHistory', 'Admin.AlarmHistory', 'String', 1) // array → flagged
  ];
  const commands: OpcUaBrowseNode[] = [
    variable('CmdStart', 'Cmd.Start', 'Boolean'),
    variable('CmdStop', 'Cmd.Stop', 'Boolean'),
    variable('CmdReset', 'Cmd.Reset', 'Boolean')
  ];

  if (generation >= 2) {
    // --- the drift a re-browse must reveal -----------------------------------
    // added: a new interlock and a new measure
    status.push(variable('EquipmentInterlock_Ready', 'Status.Ready', 'Boolean'));
    measures.push(variable('TemperatureCuve', 'Mes.TempCuve', 'Double'));
    // removed: the obsolete speed setpoint was dropped from the program
    const dropped = setpoints.findIndex((n) => n.displayName === 'ConsigneCadence');
    if (dropped !== -1) setpoints.splice(dropped, 1);
    // changed: the defect counter was widened from UInt32 to UInt64
    const retyped = admin.findIndex((n) => n.displayName === 'ProdDefectiveCount');
    if (retyped !== -1) admin[retyped] = variable('ProdDefectiveCount', 'Admin.DefectCount', 'UInt64');
  }

  return {
    [OPCUA_OBJECTS_FOLDER]: [folder('Remplisseuse', '100')],
    [`${NS};i=100`]: [
      folder('Status', '110'),
      folder('Mesures', '120'),
      folder('Consignes', '130'),
      folder('Admin', '140'),
      folder('Commandes', '150'),
      { displayName: 'Reset', nodeId: `${NS};i=160`, nodeClass: 'Method' }
    ],
    [`${NS};i=110`]: status,
    [`${NS};i=120`]: measures,
    [`${NS};i=130`]: setpoints,
    [`${NS};i=140`]: admin,
    [`${NS};i=150`]: commands
  };
}

/**
 * In-memory browse port. `advance()` moves the fake machine to its next
 * generation, so a second browse of the same server returns a drifted space.
 */
export class DemoOpcUaBrowsePort implements OpcUaBrowsePort {
  private generation = 1;
  /** Browse calls made so far (the demo shows the walk is level-by-level). */
  public calls = 0;

  /** Simulate a PLC program update between two browses. */
  public advance(): void {
    this.generation += 1;
  }

  public async browseLevel(connection: string, nodeId: string): Promise<OpcUaBrowseNode[]> {
    this.calls += 1;
    if (connection === 'Injecteuse') {
      // A declared but unreachable server: the demo must show that path too.
      throw new Error('BadSessionClosed: serveur injoignable (démo)');
    }
    return addressSpace(this.generation)[nodeId] ?? [];
  }
}

/** The connections the demo offers for an online browse. */
export const DEMO_CONNECTIONS = [
  { name: 'Remplisseuse', connected: true },
  /** Declared but unreachable — the demo must show the failing browse too. */
  { name: 'Injecteuse', connected: false }
];
