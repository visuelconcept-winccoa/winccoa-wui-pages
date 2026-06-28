// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Demo thermal treatment reports, built against the *real* fleet so the furnace
 * link and the archived temperature curve line up with the Machine Fleet 3D
 * machines already configured. When the fleet has no furnace (type `four`), a
 * couple of placeholder furnaces are fabricated so the page still demos (the
 * temperature curve is then synthesised by the engine, since no DPE resolves).
 */
import type { Atelier } from '@visuelconcept/wui-fleet-core/types.js';
import {
  blankReport,
  tempDpForMachine,
  type Conformity,
  type QualityResult,
  type ReportStatus,
  type ThermalReport,
  type ThermalStep,
  type TreatmentType
} from '../types.js';

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const PAD_LEN = 2;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

/** Local-datetime string (`YYYY-MM-DDTHH:mm`) for an absolute time. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface FurnaceSlot {
  atelierId: string;
  atelierName: string;
  machineId: string;
  machineName: string;
}

/** Furnaces (type `four`) across the fleet, or a fabricated pair as fallback. */
function furnaceSlots(ateliers: Atelier[]): FurnaceSlot[] {
  const slots: FurnaceSlot[] = [];
  for (const atelier of ateliers) {
    for (const machine of atelier.machines) {
      if (machine.type === 'four') {
        slots.push({
          atelierId: atelier.id,
          atelierName: atelier.name,
          machineId: machine.id,
          machineName: machine.name
        });
      }
    }
  }
  if (slots.length > 0) return slots;
  return [
    { atelierId: '', atelierName: 'Traitement thermique', machineId: '', machineName: 'Four de cémentation 1' },
    { atelierId: '', atelierName: 'Traitement thermique', machineId: '', machineName: 'Four de nitruration 2' }
  ];
}

interface DemoTemplate {
  reportNo: string;
  charge: string;
  orderNo: string;
  part: string;
  material: string;
  quantity: number;
  treatment: TreatmentType;
  atmosphere: string;
  quench: ThermalReport['quench'];
  steps: ThermalStep[];
  results: QualityResult[];
  conformity: Conformity;
  status: ReportStatus;
  operator: string;
  /** Cycle start offset from now, in days (negative = past). */
  startOffsetDays: number;
}

const TEMPLATES: DemoTemplate[] = [
  {
    reportNo: 'TTD-2026-0101',
    charge: 'CH-2026-0142',
    orderNo: 'OF-2026-1003',
    part: 'Pignon 24 dents',
    material: '16NiCrMo13',
    quantity: 48,
    treatment: 'cementation',
    atmosphere: 'Endothermique + propane',
    quench: 'oil',
    steps: [
      { label: 'Montée', setpoint: 880, durationMin: 45, tolMinus: 15, tolPlus: 15, atmosphere: 'Endo' },
      { label: 'Cémentation', setpoint: 920, durationMin: 180, tolMinus: 10, tolPlus: 10, atmosphere: 'Endo + C3H8' },
      { label: 'Diffusion', setpoint: 900, durationMin: 60, tolMinus: 10, tolPlus: 10, atmosphere: 'Endo' },
      { label: 'Descente trempe', setpoint: 840, durationMin: 30, tolMinus: 15, tolPlus: 15, atmosphere: 'Endo' }
    ],
    results: [
      { label: 'Dureté surface', value: 61, unit: 'HRC', min: 58, max: 63 },
      { label: 'Profondeur de cémentation (550 HV)', value: 0.85, unit: 'mm', min: 0.7, max: 1 },
      { label: 'Dureté à cœur', value: 38, unit: 'HRC', min: 30, max: 45 }
    ],
    conformity: 'conform',
    status: 'validated',
    operator: 'A. Michon',
    startOffsetDays: -3
  },
  {
    reportNo: 'TTD-2026-0102',
    charge: 'CH-2026-0151',
    orderNo: 'OF-2026-1007',
    part: 'Arbre de transmission',
    material: '42CrMo4',
    quantity: 24,
    treatment: 'nitruration',
    atmosphere: 'NH3 gazeux (Kn régulé)',
    quench: 'none',
    steps: [
      { label: 'Montée', setpoint: 480, durationMin: 60, tolMinus: 10, tolPlus: 10, atmosphere: 'N2' },
      { label: 'Nitruration 1', setpoint: 520, durationMin: 240, tolMinus: 8, tolPlus: 8, atmosphere: 'NH3' },
      { label: 'Nitruration 2', setpoint: 560, durationMin: 180, tolMinus: 8, tolPlus: 8, atmosphere: 'NH3 dilué' }
    ],
    results: [
      { label: 'Dureté de surface', value: 720, unit: 'HV', min: 650, max: 800 },
      { label: 'Profondeur de nitruration', value: 0.42, unit: 'mm', min: 0.35, max: 0.5 },
      { label: 'Épaisseur couche de combinaison', value: 12, unit: 'µm', min: 8, max: 20 }
    ],
    conformity: 'conform',
    status: 'completed',
    operator: 'M. Bernard',
    startOffsetDays: -1
  },
  {
    reportNo: 'TTD-2026-0103',
    charge: 'CH-2026-0158',
    orderNo: '',
    part: 'Bielle forgée Ø40',
    material: '34CrNiMo6',
    quantity: 60,
    treatment: 'trempe',
    atmosphere: 'Neutre (N2)',
    quench: 'polymer',
    steps: [
      { label: 'Montée', setpoint: 600, durationMin: 30, tolMinus: 20, tolPlus: 20, atmosphere: 'N2' },
      { label: 'Austénitisation', setpoint: 850, durationMin: 90, tolMinus: 10, tolPlus: 10, atmosphere: 'N2' }
    ],
    results: [
      { label: 'Dureté après trempe', value: 52, unit: 'HRC', min: 54, max: 58 },
      { label: 'Taille de grain', value: 7, unit: 'ASTM', min: 5, max: 8 }
    ],
    conformity: 'nonconform',
    status: 'rejected',
    operator: 'A. Michon',
    startOffsetDays: -2
  },
  {
    reportNo: 'TTD-2026-0104',
    charge: 'CH-2026-0163',
    orderNo: 'OF-2026-1011',
    part: 'Bride inox 316L',
    material: '316L',
    quantity: 30,
    treatment: 'detente',
    atmosphere: 'Air',
    quench: 'air',
    steps: [
      { label: 'Montée', setpoint: 400, durationMin: 40, tolMinus: 15, tolPlus: 15, atmosphere: 'Air' },
      { label: 'Maintien détente', setpoint: 600, durationMin: 120, tolMinus: 12, tolPlus: 12, atmosphere: 'Air' }
    ],
    results: [{ label: 'Contraintes résiduelles', value: 85, unit: 'MPa', max: 120 }],
    conformity: 'pending',
    status: 'running',
    operator: 'L. Petit',
    startOffsetDays: 0
  }
];

/** Build demo reports mapped onto the supplied fleet's furnaces. */
export function buildDemoReports(ateliers: Atelier[]): ThermalReport[] {
  const slots = furnaceSlots(ateliers);
  const now = Date.now();
  return TEMPLATES.map((tpl, i) => {
    const slot = slots[i % slots.length];
    const totalMin = tpl.steps.reduce((sum, s) => sum + s.durationMin, 0);
    const startMs = now + tpl.startOffsetDays * DAY_MS;
    const endMs = startMs + totalMin * MIN_MS;
    return {
      ...blankReport(),
      id: `ttd-demo-${pad(i + 1)}`,
      reportNo: tpl.reportNo,
      charge: tpl.charge,
      orderNo: tpl.orderNo,
      part: tpl.part,
      material: tpl.material,
      quantity: tpl.quantity,
      treatment: tpl.treatment,
      atmosphere: tpl.atmosphere,
      quench: tpl.quench,
      steps: tpl.steps.map((s) => ({ ...s })),
      atelierId: slot.atelierId,
      atelierName: slot.atelierName,
      machineId: slot.machineId,
      machineName: slot.machineName,
      tempDp: tempDpForMachine(slot.machineId),
      startTime: toLocalInput(startMs),
      endTime: toLocalInput(endMs),
      results: tpl.results.map((r) => ({ ...r })),
      conformity: tpl.conformity,
      status: tpl.status,
      operator: tpl.operator,
      validatedBy: tpl.status === 'validated' ? tpl.operator : '',
      validatedAt: tpl.status === 'validated' ? toLocalInput(endMs + HOUR_MS) : '',
      notes: ''
    };
  });
}
