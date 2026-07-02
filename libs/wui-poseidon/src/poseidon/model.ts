// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Poseidon process model — the single source of truth for datapoint names,
 * sensor metadata, the equipment inventory and the regulatory thresholds. Shared
 * by every view so the DP wiring, units and conformity limits stay consistent.
 *
 * The data model is created and animated by the `poseidon` JavaScript manager
 * (backend/managers/poseidon): one `Poseidon_Station` DP (nested sensor structs)
 * and one `Poseidon_Equipment_<id>` DP per motorised device.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { ml } from './i18n.js';

export const STATION_DP = 'Poseidon_Station';
export const EQUIP_PREFIX = 'Poseidon_Equipment_';

/** Equipment run states (mirror the manager). */
export const EQ_STOPPED = 0;
export const EQ_RUNNING = 1;
export const EQ_FAULT = 2;
/** Equipment control modes. */
export const MODE_MANUAL = 0;
export const MODE_AUTO = 1;

/** A single measured value on the station DP. */
export interface SensorField {
  /** Element key inside its group (e.g. "flow"). */
  key: string;
  /** DPE path relative to the station DP (e.g. "inlet.flow"). */
  path: string;
  label: MultiLangString;
  unit: string;
  decimals: number;
}

/** A process group of sensors (a stage of the plant). */
export interface SensorGroup {
  key: string;
  label: MultiLangString;
  fields: SensorField[];
}

function field(group: string, key: string, label: MultiLangString, unit: string, decimals = 1): SensorField {
  return { key, path: `${group}.${key}`, label, unit, decimals };
}

/** The plant's sensor model, grouped by process stage. */
export const SENSOR_GROUPS: SensorGroup[] = [
  {
    key: 'inlet',
    label: ml('Inlet', 'Entrée', 'Zulauf'),
    fields: [
      field('inlet', 'flow', ml('Inflow', 'Débit entrée', 'Zulaufmenge'), 'm³/h', 0),
      field('inlet', 'ph', ml('pH', 'pH', 'pH'), '', 2),
      field('inlet', 'temperature', ml('Temperature', 'Température', 'Temperatur'), '°C'),
      field('inlet', 'cod', ml('COD', 'DCO', 'CSB'), 'mg/L', 0),
      field('inlet', 'bod', ml('BOD₅', 'DBO₅', 'BSB₅'), 'mg/L', 0),
      field('inlet', 'tss', ml('TSS', 'MES', 'AFS'), 'mg/L', 0),
      field('inlet', 'nh4', ml('Ammonium', 'Ammonium', 'Ammonium'), 'mg/L')
    ]
  },
  {
    key: 'bio',
    label: ml('Biology', 'Bassin biologique', 'Biologie'),
    fields: [
      field('bio', 'do', ml('Dissolved O₂', 'O₂ dissous', 'Gelöst-O₂'), 'mg/L', 2),
      field('bio', 'redox', ml('Redox', 'Redox', 'Redox'), 'mV', 0),
      field('bio', 'mlss', ml('MLSS', 'MES bassin', 'TS-Gehalt'), 'mg/L', 0),
      field('bio', 'level', ml('Level', 'Niveau', 'Füllstand'), '%'),
      field('bio', 'temperature', ml('Temperature', 'Température', 'Temperatur'), '°C')
    ]
  },
  {
    key: 'clarifier',
    label: ml('Clarifier', 'Clarificateur', 'Nachklärung'),
    fields: [
      field('clarifier', 'level', ml('Level', 'Niveau', 'Füllstand'), '%'),
      field('clarifier', 'sludgeBlanket', ml('Sludge blanket', 'Voile de boue', 'Schlammspiegel'), 'm', 2),
      field('clarifier', 'turbidity', ml('Turbidity', 'Turbidité', 'Trübung'), 'NTU')
    ]
  },
  {
    key: 'outlet',
    label: ml('Outlet', 'Sortie / rejet', 'Ablauf'),
    fields: [
      field('outlet', 'flow', ml('Outflow', 'Débit sortie', 'Ablaufmenge'), 'm³/h', 0),
      field('outlet', 'ph', ml('pH', 'pH', 'pH'), '', 2),
      field('outlet', 'tss', ml('TSS', 'MES', 'AFS'), 'mg/L'),
      field('outlet', 'turbidity', ml('Turbidity', 'Turbidité', 'Trübung'), 'NTU'),
      field('outlet', 'nh4', ml('Ammonium', 'Ammonium', 'Ammonium'), 'mg/L', 2),
      field('outlet', 'no3', ml('Nitrate', 'Nitrate', 'Nitrat'), 'mg/L'),
      field('outlet', 'cod', ml('COD', 'DCO', 'CSB'), 'mg/L', 0)
    ]
  },
  {
    key: 'sludge',
    label: ml('Sludge', 'Boues', 'Schlamm'),
    fields: [
      field('sludge', 'flow', ml('Sludge flow', 'Débit boues', 'Schlammmenge'), 'm³/h'),
      field('sludge', 'dryness', ml('Dryness', 'Siccité', 'Trockengehalt'), '%')
    ]
  },
  {
    key: 'energy',
    label: ml('Energy', 'Énergie', 'Energie'),
    fields: [
      field('energy', 'power', ml('Power', 'Puissance', 'Leistung'), 'kW'),
      field('energy', 'energyToday', ml('Energy today', 'Énergie du jour', 'Energie heute'), 'kWh', 0)
    ]
  }
];

/** Every station DPE path (group.field), for one bulk dpConnect. */
export const ALL_SENSOR_PATHS: string[] = SENSOR_GROUPS.flatMap((g) => g.fields.map((f) => f.path));

/** Look up a sensor field by its "group.field" path. */
export function sensorByPath(path: string): SensorField | undefined {
  for (const g of SENSOR_GROUPS) {
    const f = g.fields.find((x) => x.path === path);
    if (f) return f;
  }
  return undefined;
}

/** A motorised device. `line` places it on the water or sludge line. */
export interface EquipmentDef {
  id: string;
  label: MultiLangString;
  line: 'water' | 'sludge';
  icon: string;
}

/** The plant's controllable equipment (mirrors the manager & the controller whitelist). */
export const EQUIPMENT: EquipmentDef[] = [
  { id: 'liftPump1', label: ml('Lift pump 1', 'Pompe de relevage 1', 'Hebepumpe 1'), line: 'water', icon: 'cogwheel' },
  { id: 'liftPump2', label: ml('Lift pump 2', 'Pompe de relevage 2', 'Hebepumpe 2'), line: 'water', icon: 'cogwheel' },
  { id: 'liftPump3', label: ml('Lift pump 3', 'Pompe de relevage 3', 'Hebepumpe 3'), line: 'water', icon: 'cogwheel' },
  { id: 'blower1', label: ml('Blower 1', 'Surpresseur 1', 'Gebläse 1'), line: 'water', icon: 'refresh' },
  { id: 'blower2', label: ml('Blower 2', 'Surpresseur 2', 'Gebläse 2'), line: 'water', icon: 'refresh' },
  { id: 'mixer1', label: ml('Mixer 1', 'Agitateur 1', 'Rührwerk 1'), line: 'water', icon: 'refresh' },
  { id: 'mixer2', label: ml('Mixer 2', 'Agitateur 2', 'Rührwerk 2'), line: 'water', icon: 'refresh' },
  { id: 'rasPump', label: ml('RAS pump', 'Pompe de recirculation', 'Rücklaufpumpe'), line: 'sludge', icon: 'cogwheel' },
  { id: 'wasPump', label: ml('WAS pump', 'Pompe d’extraction', 'Überschusspumpe'), line: 'sludge', icon: 'cogwheel' },
  { id: 'scraper', label: ml('Clarifier scraper', 'Pont racleur', 'Räumer'), line: 'water', icon: 'refresh' },
  { id: 'uvReactor', label: ml('UV disinfection', 'Désinfection UV', 'UV-Desinfektion'), line: 'water', icon: 'star-filled' },
  { id: 'centrifuge', label: ml('Dewatering centrifuge', 'Centrifugeuse', 'Zentrifuge'), line: 'sludge', icon: 'cogwheel' }
];

/** Equipment DPEs (id → the run/mode/feedback/current DPE paths) for one dpConnect. */
export function equipPaths(): string[] {
  return EQUIPMENT.flatMap((e) => {
    const base = `${EQUIP_PREFIX}${e.id}`;
    return [`${base}.state`, `${base}.mode`, `${base}.feedback`, `${base}.current`, `${base}.runningHours`];
  });
}

/** Direction a limit is checked against. */
export type LimitKind = 'max' | 'range';

/** A threshold used for both discharge-conformity and the alarm engine. */
export interface Threshold {
  path: string;
  kind: LimitKind;
  /** For 'max': upper limit. For 'range': [min, max]. */
  max?: number;
  min?: number;
  label: MultiLangString;
  unit: string;
}

/** Regulatory discharge limits (secondary treatment) + key operating bands. */
export const THRESHOLDS: Threshold[] = [
  { path: 'outlet.cod', kind: 'max', max: 125, label: ml('COD', 'DCO', 'CSB'), unit: 'mg/L' },
  { path: 'outlet.tss', kind: 'max', max: 35, label: ml('TSS', 'MES', 'AFS'), unit: 'mg/L' },
  { path: 'outlet.nh4', kind: 'max', max: 10, label: ml('Ammonium', 'Ammonium', 'Ammonium'), unit: 'mg/L' },
  { path: 'outlet.ph', kind: 'range', min: 6, max: 8.5, label: ml('pH', 'pH', 'pH'), unit: '' },
  { path: 'bio.do', kind: 'range', min: 1, max: 4, label: ml('Dissolved O₂', 'O₂ dissous', 'Gelöst-O₂'), unit: 'mg/L' }
];

/** The subset of thresholds that are legal discharge limits (for the conformity panel). */
export const DISCHARGE_LIMITS = THRESHOLDS.filter((t) => t.path.startsWith('outlet.'));
