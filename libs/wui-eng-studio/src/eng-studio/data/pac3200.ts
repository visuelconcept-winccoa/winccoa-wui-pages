// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SENTRON PAC3200 (Siemens) — Modbus register-map catalog.
 *
 * A DEVICE-TYPE catalog: Modbus has no browse/discovery, so the book comes from
 * the vendor register table. It therefore has **no `interface`** of its own —
 * it is a template MUTUALISED across every PAC3200 of the installation, each
 * meter supplying its own Modbus connection at check-in (this is the
 * many-to-many book relation at work).
 *
 * SOURCE OF THE OFFSETS (verified, not from memory): Siemens SENTRON PAC3200
 * manual **A5E01168664B-04 §3.9.3** "Modbus measured variables with function
 * codes 0x03 and 0x04", as transcribed in the Visuel Concept knowledge base
 * fiche `templates-import-tags-modbus-pac3200` (Industrial Edge Modbus TCP
 * connector import templates, profiles SIMPLE 15 tags / DETAILED 72 tags).
 * The `offset` below is the manual's **1-based table offset**; the notations
 * `40002` / `%MW2` are derived by `drivers/modbus.ts`.
 *
 * Device notes carried from the same source:
 *  - byte AND word order are **Big-Endian (ABCD)** → no word swap;
 *  - energy counters exist at several offset blocks: 801–820 cumulated
 *    (LREAL), 2801–2820 tariff **T1** (REAL), 2821–2840 tariff T2. This catalog
 *    targets the T1 counters (the usual industrial sub-metering case);
 *  - watch the connector's `Zero based addressing` option: if every value is
 *    shifted by one register, toggle it.
 */

import {
  modbusHoldingRef,
  modbusLeafType,
  modbusWordRef,
  type AddressBook,
  type BookEntry,
  type ModbusDataType
} from '@visuelconcept/wui-eng-core';

/** One row of the vendor register table. */
interface Pac3200Row {
  /** Signal name (as in the VC import templates). */
  name: string;
  /** 1-based offset of the PAC3200 manual table §3.9.3. */
  offset: number;
  type: ModbusDataType;
  unit?: string;
  comment: string;
  /** Present in the SIMPLE (15-tag) profile too. */
  simple?: boolean;
}

/**
 * The register map. Rows flagged `simple` form the SIMPLE profile (essential
 * energy supervision); all rows together form the DETAILED profile subset.
 */
const PAC3200_MAP: Pac3200Row[] = [
  // --- phase-to-neutral voltages ---------------------------------------------
  { name: 'U_L1_N', offset: 1, type: 'REAL', unit: 'V', comment: 'Tension L1-N', simple: true },
  { name: 'U_L2_N', offset: 3, type: 'REAL', unit: 'V', comment: 'Tension L2-N', simple: true },
  { name: 'U_L3_N', offset: 5, type: 'REAL', unit: 'V', comment: 'Tension L3-N', simple: true },
  // --- phase-to-phase voltages ------------------------------------------------
  { name: 'U_L1_L2', offset: 7, type: 'REAL', unit: 'V', comment: 'Tension L1-L2' },
  { name: 'U_L2_L3', offset: 9, type: 'REAL', unit: 'V', comment: 'Tension L2-L3' },
  { name: 'U_L3_L1', offset: 11, type: 'REAL', unit: 'V', comment: 'Tension L3-L1' },
  // --- currents ---------------------------------------------------------------
  { name: 'I_L1', offset: 13, type: 'REAL', unit: 'A', comment: 'Courant L1', simple: true },
  { name: 'I_L2', offset: 15, type: 'REAL', unit: 'A', comment: 'Courant L2', simple: true },
  { name: 'I_L3', offset: 17, type: 'REAL', unit: 'A', comment: 'Courant L3', simple: true },
  // --- per-phase powers -------------------------------------------------------
  { name: 'S_L1', offset: 19, type: 'REAL', unit: 'VA', comment: 'Puissance apparente L1' },
  { name: 'S_L2', offset: 21, type: 'REAL', unit: 'VA', comment: 'Puissance apparente L2' },
  { name: 'S_L3', offset: 23, type: 'REAL', unit: 'VA', comment: 'Puissance apparente L3' },
  { name: 'P_L1', offset: 25, type: 'REAL', unit: 'W', comment: 'Puissance active L1' },
  { name: 'P_L2', offset: 27, type: 'REAL', unit: 'W', comment: 'Puissance active L2' },
  { name: 'P_L3', offset: 29, type: 'REAL', unit: 'W', comment: 'Puissance active L3' },
  { name: 'Q_L1', offset: 31, type: 'REAL', unit: 'var', comment: 'Puissance réactive L1' },
  { name: 'Q_L2', offset: 33, type: 'REAL', unit: 'var', comment: 'Puissance réactive L2' },
  { name: 'Q_L3', offset: 35, type: 'REAL', unit: 'var', comment: 'Puissance réactive L3' },
  { name: 'PF_L1', offset: 37, type: 'REAL', comment: 'Facteur de puissance L1' },
  { name: 'PF_L2', offset: 39, type: 'REAL', comment: 'Facteur de puissance L2' },
  { name: 'PF_L3', offset: 41, type: 'REAL', comment: 'Facteur de puissance L3' },
  // --- power quality ----------------------------------------------------------
  { name: 'THD_U_L1', offset: 43, type: 'REAL', unit: '%', comment: 'THD tension L1' },
  { name: 'THD_U_L2', offset: 45, type: 'REAL', unit: '%', comment: 'THD tension L2' },
  { name: 'THD_U_L3', offset: 47, type: 'REAL', unit: '%', comment: 'THD tension L3' },
  { name: 'THD_I_L1', offset: 49, type: 'REAL', unit: '%', comment: 'THD courant L1' },
  { name: 'THD_I_L2', offset: 51, type: 'REAL', unit: '%', comment: 'THD courant L2' },
  { name: 'THD_I_L3', offset: 53, type: 'REAL', unit: '%', comment: 'THD courant L3' },
  { name: 'Frequency', offset: 55, type: 'REAL', unit: 'Hz', comment: 'Fréquence réseau', simple: true },
  // --- averages / totals ------------------------------------------------------
  { name: 'U_avg_LN', offset: 57, type: 'REAL', unit: 'V', comment: 'Tension moyenne L-N' },
  { name: 'U_avg_LL', offset: 59, type: 'REAL', unit: 'V', comment: 'Tension moyenne L-L' },
  { name: 'I_avg', offset: 61, type: 'REAL', unit: 'A', comment: 'Courant moyen' },
  { name: 'S_total', offset: 63, type: 'REAL', unit: 'VA', comment: 'Puissance apparente totale', simple: true },
  { name: 'P_total', offset: 65, type: 'REAL', unit: 'W', comment: 'Puissance active totale', simple: true },
  { name: 'Q_total', offset: 67, type: 'REAL', unit: 'var', comment: 'Puissance réactive totale', simple: true },
  { name: 'PF_total', offset: 69, type: 'REAL', comment: 'Facteur de puissance total', simple: true },
  { name: 'Unbal_U', offset: 71, type: 'REAL', unit: '%', comment: 'Déséquilibre tension' },
  { name: 'Unbal_I', offset: 73, type: 'REAL', unit: '%', comment: 'Déséquilibre courant' },
  // --- statuses / counters (UDINT) -------------------------------------------
  { name: 'DI_status', offset: 209, type: 'UDINT', comment: 'État entrées digitales' },
  { name: 'DO_status', offset: 207, type: 'UDINT', comment: 'État sorties digitales' },
  { name: 'Active_tariff', offset: 211, type: 'UDINT', comment: 'Tarif actif (T1/T2)' },
  { name: 'Op_hours', offset: 213, type: 'UDINT', unit: 'h', comment: 'Compteur horaire' },
  // --- tariff T1 energy counters (REAL, block 2801–2820) ----------------------
  { name: 'Eact_import_T1', offset: 2801, type: 'REAL', unit: 'kWh', comment: 'Énergie active importée T1', simple: true },
  { name: 'Eact_export_T1', offset: 2805, type: 'REAL', unit: 'kWh', comment: 'Énergie active exportée T1', simple: true },
  { name: 'Ereact_import_T1', offset: 2809, type: 'REAL', unit: 'kvarh', comment: 'Énergie réactive importée T1', simple: true },
  { name: 'Eapp_T1', offset: 2817, type: 'REAL', unit: 'kVAh', comment: 'Énergie apparente T1', simple: true }
];

/** Profiles offered by the VC import templates. */
export type Pac3200Profile = 'simple' | 'detailed';

function entryOf(row: Pac3200Row): BookEntry {
  return {
    // The catalog is register-based: the "path" is the signal name of the map.
    path: row.name,
    sourceType: row.type,
    leafType: modbusLeafType(row.type),
    // Measured values are read-only; the PAC3200 exposes no writable measurement.
    access: 'r',
    addresses: { modbus: modbusHoldingRef(row.offset) },
    comment: row.comment,
    unit: row.unit
  };
}

/**
 * The PAC3200 catalog book. No `interface`: it is a device-type template, bound
 * to each meter's own Modbus connection at check-in.
 */
export function pac3200Book(profile: Pac3200Profile = 'detailed'): AddressBook {
  const rows = profile === 'simple' ? PAC3200_MAP.filter((r) => r.simple) : PAC3200_MAP;
  return {
    id: 'book-pac3200',
    name: `SENTRON PAC3200 (Modbus, profil ${profile})`,
    provenance: {
      kind: 'csv',
      file: `PAC3200_${profile}.txt`,
      generatedAt: '2026-07-15T08:00:00.000Z',
      detail: 'Cartographie registres — manuel SENTRON PAC3200 A5E01168664B-04 §3.9.3 (Big-Endian/Big-Endian)'
    },
    // interface intentionally absent → device-type catalog, mutualised.
    entries: rows.map((row) => entryOf(row)),
    types: [],
    warnings: [
      'Modbus : aucun browse possible — carnet issu de la cartographie de registres du constructeur.',
      `Notations équivalentes du même registre : ${modbusHoldingRef(1)} (standard, affiché ici) = ${modbusWordRef(1)} (templates Industrial Edge) = offset ${1} du manuel.`,
      "Vérifier l'option « Zero based addressing » du connecteur : un décalage d'un registre inverse toutes les mesures.",
      'Compteurs d’énergie : ce carnet cible le tarif T1 (bloc 2801-2820) ; le bloc 801-820 expose les compteurs cumulés en LREAL.'
    ]
  };
}
