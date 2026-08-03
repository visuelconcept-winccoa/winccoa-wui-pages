// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Schneider Modicon M580 station — address book built by the core's
 * Control Expert variables-export generator.
 *
 * Contrast with the PAC3200 catalog: this is a **project book** (it HAS its own
 * Modbus interface — the PLC's connection), whereas the PAC3200 register map is
 * a device-type template mutualised across meters. Same model, two natures.
 *
 * The demo export exercises the generator's engineering checks (unlocated
 * variable, register overlap, topological address, derived type) so the book's
 * warnings are visible in the UI.
 */

import { buildBookFromSchneiderExport, buildBookFromXvm, type AddressBook } from '@visuelconcept/wui-eng-core';
import { M580_PESAGE_XVM, M580_STATION_CSV } from '@visuelconcept/wui-eng-core/samples/schneider-fixtures.js';

/** The M580 station's book (project book: carries the PLC's Modbus interface). */
export function m580StationBook(): AddressBook {
  return buildBookFromSchneiderExport({
    bookId: 'book-m580-station',
    name: 'M580 Station relevage (export Control Expert)',
    text: M580_STATION_CSV,
    provenance: {
      kind: 'csv',
      file: 'M580_Station_variables.csv',
      generatedAt: '2026-07-28T16:45:00.000Z',
      detail: 'Export éditeur de données EcoStruxure Control Expert — variables localisées %M/%MW/%MF/%MD/%IW'
    },
    interface: {
      protocol: 'modbus',
      connection: 'M580_Station',
      params: { ip: '192.168.10.30', port: 502, unitId: 255, cpu: 'BMEP582040' },
      driverNumber: 5
    }
  });
}

/**
 * The same PLC's weighing section, read from an **XVM/XSY** export instead of a
 * CSV one — the second Schneider generator, on the same equipment (a device may
 * hold several books). The book's first warning states that the XVM schema is
 * NOT vendor-verified: no real export could be obtained, so the reader is
 * spelling-tolerant and reports what it encountered (see NOTES.md).
 */
export function m580PesageXvmBook(): AddressBook {
  return buildBookFromXvm({
    bookId: 'book-m580-pesage-xvm',
    name: 'M580 Pesage (export XVM)',
    xml: M580_PESAGE_XVM,
    provenance: {
      kind: 'xvm',
      file: 'M580_Pesage.xvm',
      generatedAt: '2026-07-29T09:20:00.000Z',
      detail: 'Export variables XVM/XSY (XML) — lecteur tolérant, schéma non vérifié constructeur'
    },
    interface: {
      protocol: 'modbus',
      connection: 'M580_Station',
      params: { ip: '192.168.10.30', port: 502, unitId: 255, cpu: 'BMEP582040' },
      driverNumber: 5
    }
  });
}
