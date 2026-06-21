/**
 * Demo "SemiFab" atelier — a semiconductor-fab site synoptic reproduced from
 * SemiFab.pptx: a central cleanroom process band surrounded by utility posts,
 * each rendered as a `billboard` (SVG icon facing the camera).
 *
 * Icon assignments are best-guess defaults; change any post's icon via the
 * machine dialog's icon gallery (Général tab, type = billboard).
 */
import { SEMIFAB_ICON_BASE } from './semifab-icons.js';
import {
  DEFAULT_BUILDING,
  DEFAULT_DISPLAY,
  DEFAULT_STATE_MAPPINGS,
  type Atelier,
  type MachineDef,
  type MachineState
} from '../types.js';

function icon(n: number): string {
  return `${SEMIFAB_ICON_BASE}/image${n}.svg`;
}

interface PostSeed {
  id: string;
  name: string;
  iconN: number;
  x: number;
  z: number;
  state?: MachineState;
  size?: number;
}

/** Process band (cleanroom) — centre of the fab. */
const PROCESS: PostSeed[] = [
  { id: 'litho', name: 'Lithographie', iconN: 4, x: -18, z: 0, size: 4 },
  { id: 'deposition', name: 'Déposition', iconN: 6, x: -9, z: 0, size: 4 },
  { id: 'etching', name: 'Gravure (Etching)', iconN: 9, x: 0, z: 0, state: 'warn', size: 4 },
  { id: 'inspection', name: 'Inspection wafer', iconN: 13, x: 9, z: 0, size: 4 },
  { id: 'testing', name: 'Test', iconN: 19, x: 18, z: 0, size: 4 }
];

/** Utility posts — periphery of the site. */
const UTILITIES: PostSeed[] = [
  { id: 'power', name: 'Électricité (HT/distribution)', iconN: 16, x: -24, z: -12, size: 5 },
  { id: 'hvac', name: 'HVAC', iconN: 7, x: -24, z: 0, size: 5 },
  { id: 'chiller', name: 'Chiller', iconN: 5, x: -24, z: 12, size: 5 },
  { id: 'scrubber', name: 'Scrubber', iconN: 10, x: -12, z: -16, size: 5 },
  { id: 'wastewater', name: 'Traitement eaux usées', iconN: 1, x: 0, z: -16, size: 5 },
  { id: 'upw', name: 'Eau ultra-pure (UPW)', iconN: 2, x: 12, z: -16, size: 5 },
  { id: 'bulkchem', name: 'Bulk Chemical', iconN: 23, x: 24, z: -12, size: 5 },
  { id: 'chemsupply', name: 'Chemical supply systems', iconN: 31, x: 24, z: 0, state: 'maint', size: 5 },
  { id: 'gascab', name: 'Armoires à gaz', iconN: 24, x: 24, z: 12, size: 5 },
  { id: 'control', name: 'Salle de contrôle / Bureaux', iconN: 33, x: -12, z: 16, size: 5 },
  { id: 'bulkgas', name: 'Bulk Gases', iconN: 22, x: 0, z: 16, size: 5 },
  { id: 'asp', name: 'ASP – séparation d’air', iconN: 30, x: 12, z: 16, size: 5 }
];

function toMachine(p: PostSeed): MachineDef {
  return {
    id: p.id,
    name: p.name,
    type: 'billboard',
    x: p.x,
    z: p.z,
    state: p.state ?? 'ok',
    billboardUrl: icon(p.iconN),
    billboardW: p.size ?? 7,
    billboardH: p.size ?? 7,
    stateMappingId: 'default'
  };
}

/** Ready-to-import SemiFab demo atelier. */
export const SEMIFAB_ATELIER: Atelier = {
  id: 'semifab',
  name: 'SemiFab (démonstration)',
  building: {
    ...DEFAULT_BUILDING,
    length: 55,
    width: 38,
    height: 12,
    roofType: 'flat',
    floorType: 'concrete-white'
  },
  display: { ...DEFAULT_DISPLAY },
  machines: [...PROCESS, ...UTILITIES].map((p) => toMachine(p)),
  mappings: structuredClone(DEFAULT_STATE_MAPPINGS)
};
