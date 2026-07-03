// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Demo tunnels — a parametrized plant generator and three importable presets
 * (all named after underworld rivers, keeping Hades company):
 *
 *  - **Styx** — the reference demo: single bidirectional tube, 2 400 m,
 *    EU profile (seeded in the offline fallback).
 *  - **Léthé** — motorway twin-tube, 2 × 3 400 m unidirectional, Swiss
 *    ASTRA profile, dense plant.
 *  - **Achéron** — short urban tunnel, 800 m bidirectional, French CETU
 *    profile, tight spacings.
 *
 * Bindings target the `HadesSim_<equipmentId>` datapoints created by the
 * hadesSim manager, so every demo comes alive as soon as the simulator runs.
 */
import { ml } from '../i18n.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import {
  type EquipmentDef,
  type EquipmentKind,
  type EquipmentSide,
  type OperatingMode,
  type SegmentDef,
  type Tunnel
} from '../types.js';

/** DPE bound to a simulated point: hadesSim creates HadesSim_<id> DPs. */
function simDpe(id: string, element: string): string {
  return `HadesSim_${id}.${element}`;
}

function bindings(id: string, extraPoints: string[] = []): Record<string, string> {
  const map: Record<string, string> = { state: simDpe(id, 'state') };
  for (const point of extraPoints) map[point] = simDpe(id, point);
  return map;
}

interface SeriesSpec {
  kind: EquipmentKind;
  idBase: string;
  everyM: number;
  side: EquipmentSide;
  extraPoints?: string[];
  startM?: number;
}

/** Series intervals of one demo (metres). */
interface PlantDensity {
  sosM: number;
  exitM: number;
  jetM: number;
  cameraM: number;
  lightingM: number;
}

/** Repetitive plant of one tube (SOS / exits / fans / cameras / lighting). */
function seriesFor(density: PlantDensity): SeriesSpec[] {
  return [
    { kind: 'sos-niche', idBase: 'sos', everyM: density.sosM, side: 'right', extraPoints: ['callActive'] },
    {
      kind: 'emergency-exit',
      idBase: 'exit',
      everyM: density.exitM,
      side: 'left',
      extraPoints: ['doorOpen'],
      startM: density.exitM
    },
    { kind: 'jet-fan', idBase: 'jet', everyM: density.jetM, side: 'ceiling', extraPoints: ['cmd', 'speed'], startM: density.jetM / 2 },
    { kind: 'camera', idBase: 'cam', everyM: density.cameraM, side: 'ceiling', extraPoints: ['incident'], startM: density.cameraM / 2 },
    { kind: 'lighting', idBase: 'light', everyM: density.lightingM, side: 'ceiling', extraPoints: ['level', 'luminance'], startM: 100 }
  ];
}

/** Generate the full plant of one tube (`prefix` keeps ids unique per tube). */
function tubePlant(tubeId: string, lengthM: number, prefix: string, density: PlantDensity): EquipmentDef[] {
  const out: EquipmentDef[] = [];
  const make = (
    id: string,
    kind: EquipmentKind,
    pkM: number,
    side: EquipmentSide,
    extraPoints?: string[]
  ): EquipmentDef => ({
    id: `${prefix}${id}`,
    name: `${prefix.toUpperCase()}${id.toUpperCase()}`,
    kind,
    tubeId,
    pkM: Math.round(pkM),
    side,
    bindings: bindings(`${prefix}${id}`, extraPoints)
  });

  for (const spec of seriesFor(density)) {
    let unit = 1;
    for (let pk = spec.startM ?? spec.everyM; pk < lengthM; pk += spec.everyM) {
      out.push(make(`${spec.idBase}-${String(unit).padStart(2, '0')}`, spec.kind, pk, spec.side, spec.extraPoints));
      unit += 1;
    }
  }

  const mid = lengthM / 2;
  out.push(
    make('vms-in', 'vms', 10, 'right', ['page']),
    make('barrier-in', 'barrier', 20, 'roadway', ['cmd']),
    make('lane-in', 'lane-signal', 40, 'ceiling', ['aspect']),
    make('power-in', 'power', 60, 'right', ['load']),
    make('co-mid', 'co-sensor', mid, 'left', ['value']),
    make('no2-mid', 'no2-sensor', mid + 10, 'left', ['value']),
    make('opa-mid', 'opacity-sensor', mid + 20, 'left', ['value']),
    make('anemo-mid', 'anemometer', mid + 30, 'ceiling', ['value']),
    make('fire-line', 'fire-detection', mid, 'ceiling', ['alarmPk']),
    make('radio-mid', 'radio', mid, 'right'),
    make('hyd-mid', 'hydrant', mid - 100, 'right', ['pressure']),
    make('pump-low', 'pump', mid + 100, 'roadway', ['cmd', 'level']),
    make('vms-out', 'vms', lengthM - 10, 'left', ['page']),
    make('barrier-out', 'barrier', lengthM - 20, 'roadway', ['cmd'])
  );
  return out;
}

/** Reflex sequences generated from the tunnel's commandable plant. */
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

function segment(id: string, name: string, part: Partial<SegmentDef>): SegmentDef {
  return {
    id,
    name,
    lengthM: 500,
    gradientPct: 0,
    curveRadiusM: 0,
    clearanceM: 4.5,
    lightingZone: 'interior',
    ...part
  };
}

// --- presets -------------------------------------------------------------------

/** The reference demo (seeded in the offline fallback): Tunnel du Styx. */
export function demoTunnel(): Tunnel {
  const density: PlantDensity = { sosM: 200, exitM: 400, jetM: 400, cameraM: 300, lightingM: 600 };
  const equipment = tubePlant('styx-t1', 2400, '', density);
  return {
    id: 'styx',
    name: 'Tunnel du Styx (démo)',
    profile: 'eu-2004-54',
    trafficPerLane: 4200,
    tubes: [
      {
        id: 'styx-t1',
        name: 'Tube unique',
        direction: 'bidirectional',
        lanes: 2,
        segments: [
          segment('seg-1', 'S1 — tête nord', { lengthM: 300, gradientPct: -2, lightingZone: 'entrance' }),
          segment('seg-2', 'S2 — transition', { lengthM: 300, gradientPct: -1, curveRadiusM: 900, lightingZone: 'transition' }),
          segment('seg-3', 'S3 — section courante', { lengthM: 1400, gradientPct: 0.5 }),
          segment('seg-4', 'S4 — tête sud', { lengthM: 400, gradientPct: 2, curveRadiusM: -700, lightingZone: 'exit' })
        ]
      }
    ],
    equipment,
    modes: modes(equipment)
  };
}

/** Motorway twin-tube, Swiss profile: Tunnel du Léthé. */
function letheTunnel(): Tunnel {
  const density: PlantDensity = { sosM: 150, exitM: 300, jetM: 350, cameraM: 250, lightingM: 500 };
  const tubeSegments = (suffix: string): SegmentDef[] => [
    segment(`${suffix}-1`, `S1${suffix} — portail`, { lengthM: 400, gradientPct: -1.5, lightingZone: 'entrance' }),
    segment(`${suffix}-2`, `S2${suffix} — transition`, { lengthM: 500, gradientPct: -0.5, curveRadiusM: 1200, lightingZone: 'transition' }),
    segment(`${suffix}-3`, `S3${suffix} — courante`, { lengthM: 2000, gradientPct: 0.3 }),
    segment(`${suffix}-4`, `S4${suffix} — sortie`, { lengthM: 500, gradientPct: 1.8, curveRadiusM: -900, lightingZone: 'exit' })
  ];
  const equipment = [
    ...tubePlant('lethe-t1', 3400, 't1-', density),
    ...tubePlant('lethe-t2', 3400, 't2-', density)
  ];
  return {
    id: 'lethe',
    name: 'Tunnel du Léthé (démo bitube)',
    profile: 'ch-astra',
    trafficPerLane: 9000,
    tubes: [
      { id: 'lethe-t1', name: 'Tube nord', direction: 'unidirectional', lanes: 2, segments: tubeSegments('a') },
      { id: 'lethe-t2', name: 'Tube sud', direction: 'unidirectional', lanes: 2, segments: tubeSegments('b') }
    ],
    equipment,
    modes: modes(equipment)
  };
}

/** Short urban bidirectional tunnel, French profile: Tunnel de l'Achéron. */
function acheronTunnel(): Tunnel {
  const density: PlantDensity = { sosM: 150, exitM: 200, jetM: 250, cameraM: 200, lightingM: 300 };
  const equipment = tubePlant('acheron-t1', 800, 'a-', density);
  return {
    id: 'acheron',
    name: 'Tunnel de l’Achéron (démo urbaine)',
    profile: 'fr-cetu',
    trafficPerLane: 6500,
    tubes: [
      {
        id: 'acheron-t1',
        name: 'Tube urbain',
        direction: 'bidirectional',
        lanes: 2,
        segments: [
          segment('u-1', 'S1 — trémie est', { lengthM: 150, gradientPct: -4, lightingZone: 'entrance' }),
          segment('u-2', 'S2 — courante', { lengthM: 500, gradientPct: 0, curveRadiusM: 400 }),
          segment('u-3', 'S3 — trémie ouest', { lengthM: 150, gradientPct: 4, lightingZone: 'exit' })
        ]
      }
    ],
    equipment,
    modes: modes(equipment)
  };
}

/** One importable demo preset. */
export interface DemoPreset {
  id: string;
  name: MultiLangString;
  description: MultiLangString;
  build: () => Tunnel;
}

/** Every importable demo, in display order. */
export function demoCatalog(): DemoPreset[] {
  return [
    {
      id: 'styx',
      name: ml('Styx — reference tunnel', 'Styx — tunnel de référence', 'Styx — Referenztunnel'),
      description: ml(
        'Single bidirectional tube, 2 400 m, EU 2004/54/EC profile — the complete reference demo.',
        'Tube unique bidirectionnel, 2 400 m, référentiel UE 2004/54/CE — la démo de référence complète.',
        'Eine Röhre im Gegenverkehr, 2 400 m, EU-Profil 2004/54/EG — die vollständige Referenzdemo.'
      ),
      build: demoTunnel
    },
    {
      id: 'lethe',
      name: ml('Léthé — motorway twin-tube', 'Léthé — bitube autoroutier', 'Léthé — Autobahn-Doppelröhre'),
      description: ml(
        'Two unidirectional tubes of 3 400 m, Swiss ASTRA profile, dense plant (~180 equipment).',
        'Deux tubes unidirectionnels de 3 400 m, référentiel suisse OFROU/ASTRA, installation dense (~180 équipements).',
        'Zwei Richtungsröhren à 3 400 m, Schweizer ASTRA-Profil, dichte Ausrüstung (~180 Anlagen).'
      ),
      build: letheTunnel
    },
    {
      id: 'acheron',
      name: ml('Achéron — urban tunnel', 'Achéron — tunnel urbain', 'Achéron — Stadttunnel'),
      description: ml(
        'Short urban bidirectional tunnel, 800 m with steep ramps, French CETU profile, tight spacings.',
        'Tunnel urbain court bidirectionnel, 800 m à trémies raides, référentiel France CETU, espacements serrés.',
        'Kurzer städtischer Gegenverkehrstunnel, 800 m mit steilen Rampen, französisches CETU-Profil, enge Abstände.'
      ),
      build: acheronTunnel
    }
  ];
}
