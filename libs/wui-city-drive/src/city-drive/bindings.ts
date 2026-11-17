// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Datapoint bindings of City Drive (#79): what in the city follows which datapoint. Pure.
 *
 * Read from `CityDrive_Config.json` (edited in PARA in V1):
 *
 * ```json
 * {
 *   "machines": [{ "building": "machine-1", "dpe": "Line1.Oven.State", "run": [1], "fault": [2, 3] }],
 *   "lights":   [{ "crossroads": "3-3", "dpe": "Plant.EmergencyStop" }]
 * }
 * ```
 *
 * A machine value is matched against `fault`, then `run`, then `stop` (lists of values; booleans
 * and numbers compared loosely, strings case-insensitively). Defaults: true / 1 / "run" → run,
 * false / 0 / "stop" → stop, ≥ 2 / "fault" / "error" → fault. A crossroads is forced all red
 * while its boolean datapoint is true.
 */

export type MachineState = 'run' | 'stop' | 'fault' | 'unknown';

export interface MachineBinding {
  building: string;
  dpe: string;
  run?: unknown[];
  stop?: unknown[];
  fault?: unknown[];
}

export interface LightBinding {
  /** `i-j` of the crossroads. */
  crossroads: string;
  dpe: string;
}

export interface DriveConfig {
  machines: MachineBinding[];
  lights: LightBinding[];
}

export const EMPTY_CONFIG: DriveConfig = { machines: [], lights: [] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A parsed config, keeping only well-formed entries. */
export function parseConfig(raw: unknown): DriveConfig {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = v.trim() === '' ? {} : JSON.parse(v);
    } catch {
      return EMPTY_CONFIG;
    }
  }
  if (!isRecord(v)) return EMPTY_CONFIG;
  const machines = (Array.isArray(v.machines) ? v.machines : [])
    .filter(isRecord)
    .map((m) => ({
      building: str(m.building),
      dpe: str(m.dpe),
      ...(Array.isArray(m.run) ? { run: m.run } : {}),
      ...(Array.isArray(m.stop) ? { stop: m.stop } : {}),
      ...(Array.isArray(m.fault) ? { fault: m.fault } : {})
    }))
    .filter((m) => m.building !== '' && m.dpe !== '');
  const lights = (Array.isArray(v.lights) ? v.lights : [])
    .filter(isRecord)
    .map((l) => ({ crossroads: str(l.crossroads), dpe: str(l.dpe) }))
    .filter((l) => /^\d+-\d+$/.test(l.crossroads) && l.dpe !== '');
  return { machines, lights };
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' || typeof b === 'string') return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) === Number(b);
  return Number(a) === Number(b);
}

/** The state of a machine for a datapoint value. */
export function machineState(value: unknown, b: Pick<MachineBinding, 'run' | 'stop' | 'fault'> = {}): MachineState {
  if (value === null || value === undefined || value === '') return 'unknown';
  if (b.fault?.some((f) => same(value, f))) return 'fault';
  if (b.run?.some((r) => same(value, r))) return 'run';
  if (b.stop?.some((s) => same(value, s))) return 'stop';
  if (b.run || b.stop || b.fault) return 'unknown';
  if (typeof value === 'boolean') return value ? 'run' : 'stop';
  if (typeof value === 'number') return value >= 2 ? 'fault' : value === 1 ? 'run' : value === 0 ? 'stop' : 'unknown';
  const s = String(value).trim().toLowerCase();
  if (['fault', 'error', 'defaut', 'défaut', 'alarm'].includes(s)) return 'fault';
  if (['run', 'running', 'on', 'marche', 'true', '1'].includes(s)) return 'run';
  if (['stop', 'stopped', 'off', 'arret', 'arrêt', 'false', '0'].includes(s)) return 'stop';
  return 'unknown';
}

/** True when a light datapoint value forces its crossroads all red. */
export function lightForced(value: unknown): boolean {
  if (typeof value === 'string') return ['true', '1', 'on'].includes(value.trim().toLowerCase());
  return Boolean(value) && Number(value) !== 0;
}

/** Every DPE to subscribe to, without duplicates. */
export function boundDpes(cfg: DriveConfig): string[] {
  return [...new Set([...cfg.machines.map((m) => m.dpe), ...cfg.lights.map((l) => l.dpe)])];
}
