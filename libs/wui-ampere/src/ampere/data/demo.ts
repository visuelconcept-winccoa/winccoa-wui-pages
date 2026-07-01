// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Offline demo seed — one worked TGBT single-line diagram used when no writable
 * backend is available (see {@link DpJsonStore}). Coordinates are in canvas units
 * (grid-snapped); the datapoint bindings are placeholder names that stay unbound
 * offline (the switchgear then reads as closed, so the whole diagram lights up).
 */
import type { Network } from '../types.js';

const DEMO_TGBT: Network = {
  id: 'demo-tgbt',
  name: 'TGBT — démonstration',
  description: 'Arrivée réseau, disjoncteur général, jeu de barres et trois départs (charge, moteur, départ).',
  updatedAt: '',
  nodes: [
    { id: 'g1', symbol: 'grid-source', label: 'Réseau', x: 200, y: 40, rotation: 0, dp: '', closedValue: 1, source: true },
    { id: 'q0', symbol: 'breaker', label: 'Q0', x: 210, y: 160, rotation: 0, dp: 'Demo:Main.state', closedValue: 1, source: false },
    { id: 'b1', symbol: 'busbar', label: 'Jeu de barres', x: 120, y: 280, rotation: 0, dp: '', closedValue: 1, source: false },
    { id: 'q1', symbol: 'breaker', label: 'Q1', x: 160, y: 360, rotation: 0, dp: 'Demo:Feeder1.state', closedValue: 1, source: false },
    { id: 'l1', symbol: 'load', label: 'Éclairage', x: 160, y: 470, rotation: 0, dp: '', closedValue: 1, source: false },
    { id: 'q2', symbol: 'breaker', label: 'Q2', x: 280, y: 360, rotation: 0, dp: 'Demo:Feeder2.state', closedValue: 1, source: false },
    { id: 'mot1', symbol: 'motor', label: 'Pompe', x: 270, y: 470, rotation: 0, dp: '', closedValue: 1, source: false },
    { id: 'q3', symbol: 'disconnector', label: 'Q3', x: 320, y: 360, rotation: 0, dp: 'Demo:Feeder3.state', closedValue: 1, source: false },
    { id: 'f1', symbol: 'feeder-out', label: 'Départ atelier', x: 320, y: 470, rotation: 0, dp: '', closedValue: 1, source: false }
  ],
  edges: [
    { id: 'e1', from: { nodeId: 'g1', port: 'b' }, to: { nodeId: 'q0', port: 'a' } },
    { id: 'e2', from: { nodeId: 'q0', port: 'b' }, to: { nodeId: 'b1', port: 'p3' } },
    { id: 'e3', from: { nodeId: 'b1', port: 'p2' }, to: { nodeId: 'q1', port: 'a' } },
    { id: 'e4', from: { nodeId: 'q1', port: 'b' }, to: { nodeId: 'l1', port: 'a' } },
    { id: 'e5', from: { nodeId: 'b1', port: 'p5' }, to: { nodeId: 'q2', port: 'a' } },
    { id: 'e6', from: { nodeId: 'q2', port: 'b' }, to: { nodeId: 'mot1', port: 'a' } },
    { id: 'e7', from: { nodeId: 'b1', port: 'p6' }, to: { nodeId: 'q3', port: 'a' } },
    { id: 'e8', from: { nodeId: 'q3', port: 'b' }, to: { nodeId: 'f1', port: 'a' } }
  ],
  measurements: [
    { id: 'mea1', dp: 'Demo:Main.current', label: 'I', unit: 'A', decimals: 1, nodeId: 'q0', x: 60, y: 0 },
    { id: 'mea2', dp: 'Demo:Busbar.voltage', label: 'U', unit: 'V', decimals: 0, nodeId: '', x: 400, y: 288 }
  ]
};

/** Demo networks seeded into the offline fallback. */
export const DEMO_NETWORKS: Network[] = [DEMO_TGBT];
