// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Default demo fleet — a representative spread of machine types across the
 * standard 240×160 m hall. Stands in until the page is bound to live WinCC OA
 * datapoints or an edited layout is loaded.
 */
import {
  DEFAULT_BUILDING,
  DEFAULT_DISPLAY,
  DEFAULT_STATE_MAPPINGS,
  type Atelier,
  type Kpi,
  type MachineDef
} from '../types.js';

/** Machining (usinage) parameter set with demo values. */
function usinageKpis(programme: string, outil: string, broche: number, avance: number): Kpi[] {
  return [
    { key: 'programme', label: '# Programme', value: programme },
    { key: 'outil', label: '# Outil', value: outil },
    { key: 'vitesseBroche', label: 'Vitesse broche', value: broche, unit: 'tr/min', showInBubble: true },
    { key: 'vitesseAvance', label: "Vitesse d'avance", value: avance, unit: 'mm/min' }
  ];
}

/** Welding (soudage) parameter set with demo values. */
function soudageKpis(tension: number, intensite: number, vitesse: number): Kpi[] {
  return [
    { key: 'tension', label: 'Tension', value: tension, unit: 'V', showInBubble: true },
    { key: 'intensite', label: 'Intensité', value: intensite, unit: 'A' },
    { key: 'vitesseSoudage', label: 'Vitesse de soudage', value: vitesse, unit: 'cm/min' }
  ];
}

export const DEMO_MACHINES: MachineDef[] = [
  {
    id: 'four-600',
    name: 'FOUR 600T',
    type: 'four',
    variant: 600,
    x: -78,
    z: 36,
    state: 'ok',
    loc: 'C2',
    kpis: [
      { key: 'temp', label: 'Température', value: 852, unit: '°C', showInBubble: true },
      { key: 'cycle', label: 'Cycle', value: 14, unit: 'min', cardOrder: 1 }
    ]
  },
  {
    id: 'four-300',
    name: 'FOUR 300T',
    type: 'four',
    variant: 300,
    x: -78,
    z: -28,
    state: 'warn',
    loc: 'A2',
    kpis: [{ key: 'temp', label: 'Température', value: 610, unit: '°C', showInBubble: true }]
  },
  {
    id: 'robot-mag-1',
    name: 'ROBOT MAG 1',
    type: 'robot',
    process: 'soudage',
    x: -30,
    z: 58,
    state: 'ok',
    loc: 'D3',
    kpis: soudageKpis(24.5, 182, 38)
  },
  {
    id: 'positionneur-1',
    name: 'POSITIONNEUR 1',
    type: 'positionneur',
    process: 'soudage',
    x: -30,
    z: 8,
    state: 'ok',
    loc: 'B3',
    kpis: soudageKpis(23.1, 165, 32)
  },
  {
    id: 'tour-1',
    name: 'TOUR CN L',
    type: 'tour',
    variant: 'L',
    x: 28,
    z: -50,
    state: 'ok',
    loc: 'A6',
    kpis: usinageKpis('O1042', 'T05', 1450, 850)
  },
  {
    id: 'fraiseuse-1',
    name: 'FRAISEUSE',
    type: 'fraiseuse',
    x: 28,
    z: 6,
    state: 'maint',
    loc: 'B6',
    kpis: usinageKpis('O2310', 'T12', 0, 0)
  },
  {
    id: 'scie-1',
    name: 'SCIE',
    type: 'scie',
    x: 78,
    z: 54,
    state: 'ok',
    loc: 'D9',
    kpis: usinageKpis('O0087', 'T01', 320, 140)
  },
  {
    id: 'brocheuse-1',
    name: 'BROCHEUSE',
    type: 'brocheuse',
    x: 78,
    z: 8,
    state: 'stop',
    loc: 'B9',
    kpis: usinageKpis('O3001', 'T08', 0, 0)
  },
  {
    id: 'ressuage-1',
    name: 'TABLE RESSUAGE',
    type: 'ressuage',
    x: 70,
    z: -48,
    state: 'ok',
    loc: 'A9',
    kpis: [{ key: 'parts', label: 'Pièces', value: 56, unit: '', showInBubble: true }]
  }
];

/** A ready-to-use demo atelier (used as seed when importing the demo). */
export const DEMO_ATELIER: Atelier = {
  id: 'demo',
  name: 'Atelier de démonstration',
  building: { ...DEFAULT_BUILDING },
  display: { ...DEFAULT_DISPLAY },
  machines: structuredClone(DEMO_MACHINES),
  mappings: structuredClone(DEFAULT_STATE_MAPPINGS)
};
