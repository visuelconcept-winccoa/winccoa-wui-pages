// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Built-in equipment catalog: the tunnel plant kinds Hades can place, render
 * and bind (aligned with the reference equipment lists of EU directive
 * 2004/54/EC annex I, the CETU technical instruction and the PIARC road-tunnels
 * manual). Each kind declares its bindable points (state / measures / commands);
 * labels are resolved against the active WebUI language at call time, so build
 * the catalog inside render paths rather than caching it at module load.
 */
import { localize, ml } from '../i18n.js';
import type { EquipmentKind, EquipmentTypeDef, PointDef } from '../types.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';

/** Localized display label of an equipment kind. */
export function kindLabel(kind: EquipmentKind): string {
  return localize(KIND_LABELS[kind]);
}

const KIND_LABELS: Record<EquipmentKind, MultiLangString> = {
  'jet-fan': ml('Jet fan', 'Accélérateur (jet fan)', 'Strahlventilator'),
  lighting: ml('Lighting section', "Section d'éclairage", 'Beleuchtungsabschnitt'),
  'sos-niche': ml('SOS emergency station', "Niche de sécurité (SOS)", 'Notrufnische (SOS)'),
  'emergency-exit': ml('Emergency exit', 'Issue de secours', 'Notausgang'),
  camera: ml('CCTV camera (AID)', 'Caméra CCTV (DAI)', 'CCTV-Kamera (AID)'),
  'co-sensor': ml('CO sensor', 'Capteur CO', 'CO-Sensor'),
  'no2-sensor': ml('NO₂ sensor', 'Capteur NO₂', 'NO₂-Sensor'),
  'opacity-sensor': ml('Opacity sensor', "Opacimètre", 'Sichttrübungssensor'),
  anemometer: ml('Anemometer', 'Anémomètre', 'Anemometer'),
  'fire-detection': ml('Fire detection (linear)', 'Détection incendie (linéaire)', 'Branddetektion (linear)'),
  vms: ml('Variable message sign', 'Panneau à messages variables (PMV)', 'Wechselverkehrszeichen'),
  'lane-signal': ml('Lane signal', "Signal d'affectation de voie", 'Fahrstreifensignal'),
  barrier: ml('Closure barrier', 'Barrière de fermeture', 'Schrankenanlage'),
  pump: ml('Drainage pump', 'Pompe de relevage', 'Entwässerungspumpe'),
  power: ml('Power supply (UPS)', 'Alimentation secourue', 'Notstromversorgung (USV)'),
  radio: ml('Radio rebroadcast', 'Retransmission radio', 'Funkübertragung'),
  hydrant: ml('Hydrant / water supply', "Poteau incendie", 'Hydrant / Löschwasser')
};

/** All catalog kinds in display order. */
export const CATALOG_KINDS: readonly EquipmentKind[] = Object.keys(KIND_LABELS) as EquipmentKind[];

/**
 * INDICATIVE AKS-CH designation per equipment kind (Swiss ASTRA/OFROU plant
 * classification for operating & safety equipment, BSA). Shown as a naming
 * hint when the tunnel's regulatory profile is `ch-astra` — the project's
 * real AKS-CH structure (levels, numbering) remains the integrator's call.
 */
const AKS_CH: Record<EquipmentKind, string> = {
  'jet-fan': 'LUE',
  lighting: 'BEL',
  'sos-niche': 'SOS',
  'emergency-exit': 'FLW',
  camera: 'VID',
  'co-sensor': 'MES',
  'no2-sensor': 'MES',
  'opacity-sensor': 'MES',
  anemometer: 'MES',
  'fire-detection': 'BMA',
  vms: 'SIG',
  'lane-signal': 'SIG',
  barrier: 'ABS',
  pump: 'ENT',
  power: 'ENE',
  radio: 'FUN',
  hydrant: 'LOE'
};

/** Indicative AKS-CH group of a kind (see {@link AKS_CH}). */
export function aksChOf(kind: EquipmentKind): string {
  return AKS_CH[kind];
}

function statePoint(): PointDef {
  return {
    key: 'state',
    label: localize(ml('State', 'État', 'Zustand')),
    role: 'state'
  };
}

function measure(key: string, label: MultiLangString, unit: string): PointDef {
  return { key, label: localize(label), role: 'measure', unit };
}

function command(key: string, label: MultiLangString, values: { value: number; label: MultiLangString }[]): PointDef {
  return {
    key,
    label: localize(label),
    role: 'command',
    commandValues: values.map((v) => ({ value: v.value, label: localize(v.label) }))
  };
}

const CMD_OFF = ml('Stop', 'Arrêt', 'Aus');
const CMD_ON = ml('Run', 'Marche', 'Ein');
const CMD_OPEN = ml('Open', 'Ouvrir', 'Öffnen');
const CMD_CLOSE = ml('Close', 'Fermer', 'Schließen');

/** Bindable points of one equipment kind. */
export function pointsOf(kind: EquipmentKind): PointDef[] {
  switch (kind) {
    case 'jet-fan':
      return [
        statePoint(),
        command('cmd', ml('Drive command', 'Commande de marche', 'Antriebsbefehl'), [
          { value: 0, label: CMD_OFF },
          { value: 1, label: ml('Forward', 'Sens normal', 'Vorwärts') },
          { value: 2, label: ml('Reverse', 'Sens inverse', 'Rückwärts') }
        ]),
        measure('speed', ml('Speed', 'Vitesse', 'Drehzahl'), 'rpm')
      ];
    case 'lighting':
      return [
        statePoint(),
        command('level', ml('Dimming level', 'Niveau de gradation', 'Dimmstufe'), [
          { value: 0, label: CMD_OFF },
          { value: 25, label: ml('25 %', '25 %', '25 %') },
          { value: 50, label: ml('50 %', '50 %', '50 %') },
          { value: 100, label: ml('100 %', '100 %', '100 %') }
        ]),
        measure('luminance', ml('Luminance', 'Luminance', 'Leuchtdichte'), 'cd/m²')
      ];
    case 'sos-niche':
      return [
        statePoint(),
        measure('callActive', ml('Call active', 'Appel en cours', 'Aktiver Ruf'), '')
      ];
    case 'emergency-exit':
      return [
        statePoint(),
        measure('doorOpen', ml('Door open', 'Porte ouverte', 'Tür offen'), '')
      ];
    case 'camera':
      return [
        statePoint(),
        measure('incident', ml('AID incident', 'Incident DAI', 'AID-Ereignis'), '')
      ];
    case 'co-sensor':
      return [statePoint(), measure('value', ml('CO', 'CO', 'CO'), 'ppm')];
    case 'no2-sensor':
      return [statePoint(), measure('value', ml('NO₂', 'NO₂', 'NO₂'), 'ppm')];
    case 'opacity-sensor':
      return [statePoint(), measure('value', ml('Opacity', 'Opacité', 'Trübung'), '1/km')];
    case 'anemometer':
      return [statePoint(), measure('value', ml('Air speed', "Vitesse d'air", 'Luftgeschwindigkeit'), 'm/s')];
    case 'fire-detection':
      return [
        statePoint(),
        measure('alarmPk', ml('Alarm PK', 'PK en alarme', 'Alarm-PK'), 'm')
      ];
    case 'vms':
      return [
        statePoint(),
        command('page', ml('Displayed page', 'Page affichée', 'Angezeigte Seite'), [
          { value: 0, label: ml('Blank', 'Éteint', 'Leer') },
          { value: 1, label: ml('Slow down', 'Ralentir', 'Langsam fahren') },
          { value: 2, label: ml('Tunnel closed', 'Tunnel fermé', 'Tunnel gesperrt') },
          { value: 3, label: ml('Fire — evacuate', 'Incendie — évacuer', 'Brand — evakuieren') }
        ])
      ];
    case 'lane-signal':
      return [
        statePoint(),
        command('aspect', ml('Aspect', 'Aspect', 'Signalbild'), [
          { value: 0, label: ml('Off', 'Éteint', 'Aus') },
          { value: 1, label: ml('Green arrow', 'Flèche verte', 'Grüner Pfeil') },
          { value: 2, label: ml('Red cross', 'Croix rouge', 'Rotes Kreuz') }
        ])
      ];
    case 'barrier':
      return [
        statePoint(),
        command('cmd', ml('Barrier command', 'Commande barrière', 'Schrankenbefehl'), [
          { value: 0, label: CMD_OPEN },
          { value: 1, label: CMD_CLOSE }
        ])
      ];
    case 'pump':
      return [
        statePoint(),
        command('cmd', ml('Pump command', 'Commande pompe', 'Pumpenbefehl'), [
          { value: 0, label: CMD_OFF },
          { value: 1, label: CMD_ON }
        ]),
        measure('level', ml('Sump level', 'Niveau de bassin', 'Sumpfpegel'), '%')
      ];
    case 'power':
      return [statePoint(), measure('load', ml('Load', 'Charge', 'Last'), '%')];
    case 'radio':
      return [statePoint()];
    case 'hydrant':
      return [statePoint(), measure('pressure', ml('Pressure', 'Pression', 'Druck'), 'bar')];
    default:
      return [statePoint()];
  }
}

/** Full catalog (labels resolved for the current language). */
export function equipmentCatalog(): EquipmentTypeDef[] {
  return CATALOG_KINDS.map((kind) => ({ kind, points: pointsOf(kind) }));
}
