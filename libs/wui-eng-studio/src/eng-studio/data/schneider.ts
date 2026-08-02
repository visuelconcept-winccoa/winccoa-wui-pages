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

import { buildBookFromSchneiderExport, type AddressBook } from '@visuelconcept/wui-eng-core';
import { M580_STATION_CSV } from '@visuelconcept/wui-eng-core/samples/schneider-fixtures.js';

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
