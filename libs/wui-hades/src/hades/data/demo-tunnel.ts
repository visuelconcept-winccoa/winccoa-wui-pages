// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Demo tunnel seeded in the offline fallback and importable from the overview:
 * the "Tunnel du Styx", a single-tube 2 400 m bidirectional tunnel with a
 * regulation-shaped plant layout (SOS every ~200 m, exits every ~400 m, jet
 * fans, sensors, VMS/barrier at the portals, pump at the low point). Bindings
 * target the `HadesSim_<equipmentId>` datapoints created by the hadesSim
 * manager, so the demo comes alive as soon as the simulator runs.
 */
import {
  type EquipmentDef,
  type EquipmentKind,
  type EquipmentSide,
  type OperatingMode,
  type Tunnel
} from '../types.js';

const TUBE_ID = 'styx-t1';
const LENGTH_M = 2400;

/** DPE bound to a simulated point: hadesSim creates HadesSim_<id> DPs. */
function simDpe(id: string, element: string): string {
  return `HadesSim_${id}.${element}`;
}

interface Placement {
  kind: EquipmentKind;
  idBase: string;
  everyM: number;
  side: EquipmentSide;
  /** Point keys (besides `state`) bound to same-named sim elements. */
  extraPoints?: string[];
  /** Offset of the first unit from the portal. */
  startM?: number;
}

const PLACEMENTS: Placement[] = [
  { kind: 'sos-niche', idBase: 'sos', everyM: 200, side: 'right', extraPoints: ['callActive'] },
  { kind: 'emergency-exit', idBase: 'exit', everyM: 400, side: 'left', extraPoints: ['doorOpen'], startM: 400 },
  { kind: 'jet-fan', idBase: 'jet', everyM: 400, side: 'ceiling', extraPoints: ['cmd', 'speed'], startM: 200 },
  { kind: 'camera', idBase: 'cam', everyM: 300, side: 'ceiling', extraPoints: ['incident'], startM: 150 },
  { kind: 'lighting', idBase: 'light', everyM: 600, side: 'ceiling', extraPoints: ['level', 'luminance'], startM: 100 }
];

/** Singleton equipments placed at a fixed PK. */
const SINGLETONS: { kind: EquipmentKind; id: string; pkM: number; side: EquipmentSide; extraPoints?: string[] }[] = [
  { kind: 'vms', id: 'vms-north', pkM: 10, side: 'right', extraPoints: ['page'] },
  { kind: 'barrier', id: 'barrier-north', pkM: 20, side: 'roadway', extraPoints: ['cmd'] },
  { kind: 'lane-signal', id: 'lane-north', pkM: 40, side: 'ceiling', extraPoints: ['aspect'] },
  { kind: 'co-sensor', id: 'co-mid', pkM: 1200, side: 'left', extraPoints: ['value'] },
  { kind: 'no2-sensor', id: 'no2-mid', pkM: 1210, side: 'left', extraPoints: ['value'] },
  { kind: 'opacity-sensor', id: 'opa-mid', pkM: 1220, side: 'left', extraPoints: ['value'] },
  { kind: 'anemometer', id: 'anemo-mid', pkM: 1230, side: 'ceiling', extraPoints: ['value'] },
  { kind: 'fire-detection', id: 'fire-line', pkM: 1200, side: 'ceiling', extraPoints: ['alarmPk'] },
  { kind: 'pump', id: 'pump-low', pkM: 1300, side: 'roadway', extraPoints: ['cmd', 'level'] },
  { kind: 'power', id: 'power-north', pkM: 60, side: 'right', extraPoints: ['load'] },
  { kind: 'radio', id: 'radio-mid', pkM: 1200, side: 'right' },
  { kind: 'hydrant', id: 'hyd-mid', pkM: 1100, side: 'right', extraPoints: ['pressure'] },
  { kind: 'vms', id: 'vms-south', pkM: LENGTH_M - 10, side: 'left', extraPoints: ['page'] },
  { kind: 'barrier', id: 'barrier-south', pkM: LENGTH_M - 20, side: 'roadway', extraPoints: ['cmd'] }
];

function bindings(id: string, extraPoints: string[] = []): Record<string, string> {
  const map: Record<string, string> = { state: simDpe(id, 'state') };
  for (const point of extraPoints) map[point] = simDpe(id, point);
  return map;
}

function equipment(): EquipmentDef[] {
  const out: EquipmentDef[] = [];
  for (const p of PLACEMENTS) {
    let unit = 1;
    for (let pk = p.startM ?? p.everyM; pk < LENGTH_M; pk += p.everyM) {
      const id = `${p.idBase}-${String(unit).padStart(2, '0')}`;
      out.push({
        id,
        name: `${p.idBase.toUpperCase()}-${String(unit).padStart(2, '0')}`,
        kind: p.kind,
        tubeId: TUBE_ID,
        pkM: pk,
        side: p.side,
        bindings: bindings(id, p.extraPoints)
      });
      unit += 1;
    }
  }
  for (const s of SINGLETONS) {
    out.push({
      id: s.id,
      name: s.id.toUpperCase(),
      kind: s.kind,
      tubeId: TUBE_ID,
      pkM: s.pkM,
      side: s.side,
      bindings: bindings(s.id, s.extraPoints)
    });
  }
  return out;
}

/** Reflex sequences of the demo (fire mode wired to the demo equipment ids). */
function modes(equipmentList: EquipmentDef[]): OperatingMode[] {
  const jets = equipmentList.filter((e) => e.kind === 'jet-fan');
  const barriers = equipmentList.filter((e) => e.kind === 'barrier');
  const vms = equipmentList.filter((e) => e.kind === 'vms');
  const lights = equipmentList.filter((e) => e.kind === 'lighting');
  return [
    {
      id: 'normal',
      name: 'Exploitation normale',
      description: 'Ventilation à l’arrêt, barrières ouvertes, PMV éteints, éclairage 50 %.',
      severity: 'normal',
      actions: [
        ...jets.map((e) => ({ equipmentId: e.id, pointKey: 'cmd', value: 0, label: `${e.name} → arrêt` })),
        ...barriers.map((e) => ({ equipmentId: e.id, pointKey: 'cmd', value: 0, label: `${e.name} → ouverte` })),
        ...vms.map((e) => ({ equipmentId: e.id, pointKey: 'page', value: 0, label: `${e.name} → éteint` })),
        ...lights.map((e) => ({ equipmentId: e.id, pointKey: 'level', value: 50, label: `${e.name} → 50 %` }))
      ]
    },
    {
      id: 'closure',
      name: 'Fermeture du tunnel',
      description: 'Barrières fermées, PMV « tunnel fermé », signaux de voie en croix rouge.',
      severity: 'closure',
      actions: [
        ...vms.map((e) => ({ equipmentId: e.id, pointKey: 'page', value: 2, label: `${e.name} → « tunnel fermé »` })),
        ...barriers.map((e) => ({ equipmentId: e.id, pointKey: 'cmd', value: 1, label: `${e.name} → fermée` }))
      ]
    },
    {
      id: 'fire',
      name: 'Incendie — séquence réflexe',
      description:
        'Fermeture immédiate, PMV « incendie — évacuer », ventilation en régime feu (sens normal), éclairage 100 %.',
      severity: 'fire',
      actions: [
        ...barriers.map((e) => ({ equipmentId: e.id, pointKey: 'cmd', value: 1, label: `${e.name} → fermée` })),
        ...vms.map((e) => ({ equipmentId: e.id, pointKey: 'page', value: 3, label: `${e.name} → « incendie »` })),
        ...jets.map((e) => ({ equipmentId: e.id, pointKey: 'cmd', value: 1, label: `${e.name} → régime feu` })),
        ...lights.map((e) => ({ equipmentId: e.id, pointKey: 'level', value: 100, label: `${e.name} → 100 %` }))
      ]
    }
  ];
}

/** Build a fresh demo tunnel (ids are stable so the simulator can target them). */
export function demoTunnel(): Tunnel {
  const equipmentList = equipment();
  return {
    id: 'styx',
    name: 'Tunnel du Styx (démo)',
    profile: 'eu-2004-54',
    trafficPerLane: 4200,
    tubes: [
      {
        id: TUBE_ID,
        name: 'Tube unique',
        direction: 'bidirectional',
        lanes: 2,
        segments: [
          {
            id: 'seg-1',
            name: 'S1 — tête nord',
            lengthM: 300,
            gradientPct: -2,
            curveRadiusM: 0,
            clearanceM: 4.5,
            lightingZone: 'entrance'
          },
          {
            id: 'seg-2',
            name: 'S2 — transition',
            lengthM: 300,
            gradientPct: -1,
            curveRadiusM: 900,
            clearanceM: 4.5,
            lightingZone: 'transition'
          },
          {
            id: 'seg-3',
            name: 'S3 — section courante',
            lengthM: 1400,
            gradientPct: 0.5,
            curveRadiusM: 0,
            clearanceM: 4.5,
            lightingZone: 'interior'
          },
          {
            id: 'seg-4',
            name: 'S4 — tête sud',
            lengthM: 400,
            gradientPct: 2,
            curveRadiusM: -700,
            clearanceM: 4.5,
            lightingZone: 'exit'
          }
        ]
      }
    ],
    equipment: equipmentList,
    modes: modes(equipmentList)
  };
}
