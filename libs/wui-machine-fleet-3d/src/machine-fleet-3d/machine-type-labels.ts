// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The label of each symbol representation (MachineType), shown instead of its stored code
 * ("cabinet", "glb"…) in the "Add a symbol" wizard, the symbol dialog, the machine list, the
 * popup and the dashboard (i18n.ts `machineTypeLabel`). No dependency, tested by
 * machine-type-labels.spec.ts.
 */
import type { MachineType } from '@visuelconcept-winccoa/wui-fleet-core/types.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';

const l = (en: string, fr: string, de: string): MultiLangString => ({ 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de });

export const MACHINE_TYPE_LABEL: Record<MachineType, MultiLangString> = {
  four: l('Furnace', 'Four', 'Ofen'),
  robot: l('Robot', 'Robot', 'Roboter'),
  positionneur: l('Positioner', 'Positionneur', 'Positionierer'),
  tour: l('Lathe', 'Tour', 'Drehmaschine'),
  fraiseuse: l('Milling machine', 'Fraiseuse', 'Fräsmaschine'),
  scie: l('Saw', 'Scie', 'Säge'),
  brocheuse: l('Broaching machine', 'Brocheuse', 'Räummaschine'),
  ressuage: l('Penetrant testing', 'Ressuage', 'Eindringprüfung'),
  portique: l('Gantry', 'Portique', 'Portal'),
  'portique-table': l('Gantry with table', 'Portique avec table', 'Portal mit Tisch'),
  basculeur: l('Tilter', 'Basculeur', 'Kipper'),
  cabinet: l('Cabinet', 'Armoire', 'Schaltschrank'),
  billboard: l('Icon (2D)', 'Icône (2D)', 'Symbol (2D)'),
  glb: l('3D model (GLB)', 'Modèle 3D (GLB)', '3D-Modell (GLB)')
};

/** The label of a stored representation, undefined for an unknown one. */
export function machineTypeText(type: string): MultiLangString | undefined {
  return (MACHINE_TYPE_LABEL as Record<string, MultiLangString | undefined>)[type];
}
