// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — the plant behind the game: which datapoint each machine of the levels follows.
 *
 * Read from `RogueLine_Config.json` (edited in PARA; role `configure`):
 *
 * ```json
 * { "machines": [{ "id": 1, "dpe": "Line1.Press.State", "run": [1], "fault": [2, 3] }] }
 * ```
 *
 * `id` is the machine's number in the levels (M1 … M9: M1–M3 in the Intake Hall, M4–M6 in the
 * Paint Shop, M7–M9 in the Control Core). A value is matched against `fault`, then `run`, then
 * `stop` (lists of values; booleans and numbers compared loosely, strings case-insensitively).
 * Defaults: true / 1 / "run" → run, false / 0 / "stop" → stop, ≥ 2 / "fault" / "error" → fault.
 *
 * A machine in fault flashes red and keeps the level's exit shut until the technician repairs it
 * (in the game only: nothing is written to the plant).
 *
 * Without a backend, or without any machine bound: the demo plant (every machine down). A
 * machine left unbound in a live plant is down as in the demo.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { DpSingleJsonStore } from '@visuelconcept-winccoa/wui-kit/data/dp-single-json-store.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import { demoMachineState, type MachineState } from './sim.js';

export interface MachineBinding {
  id: number;
  dpe: string;
  run?: unknown[];
  stop?: unknown[];
  fault?: unknown[];
}

export interface PlantConfig {
  machines: MachineBinding[];
}

export const CONFIG_DP = 'RogueLine_Config';
export const EMPTY_CONFIG: PlantConfig = { machines: [] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A parsed config, keeping only well-formed entries. */
export function parseConfig(raw: unknown): PlantConfig {
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
      id: Number(m.id),
      dpe: typeof m.dpe === 'string' ? m.dpe.trim() : '',
      ...(Array.isArray(m.run) ? { run: m.run } : {}),
      ...(Array.isArray(m.stop) ? { stop: m.stop } : {}),
      ...(Array.isArray(m.fault) ? { fault: m.fault } : {})
    }))
    .filter((m) => Number.isInteger(m.id) && m.id >= 1 && m.id <= 9 && m.dpe !== '');
  return { machines };
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' || typeof b === 'string') return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
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

/** `System1:Line.State.:_online.._value` → `Line.State`. */
export function normDpe(name: string): string {
  let s = name.replace(/^[^:.]+:(?!_)/, '');
  const cfg = s.indexOf(':');
  if (cfg !== -1) s = s.slice(0, cfg);
  return s.replace(/\.$/, '');
}

interface DpEmission {
  dp: string[];
  value: unknown[];
}

function resolve<T>(token: new (...args: never[]) => T): T | null {
  try {
    return container.resolve<T>(token);
  } catch {
    return null;
  }
}

export class PlantLink {
  /** No backend, or no machine bound: the demo plant. */
  demo = true;
  /** Machines bound to a datapoint. */
  bound = 0;
  private readonly api = resolve(OaRxJsApi);
  private readonly store = new DpSingleJsonStore<PlantConfig>(CONFIG_DP, CONFIG_DP, () => ({ ...EMPTY_CONFIG }));
  private readonly states = new Map<number, MachineState>();
  private readonly boundIds = new Set<number>();
  private readonly sub = new Subscription();

  /** Reads the config and follows the bound datapoints; resolves once it knows (demo or live). */
  async start(): Promise<void> {
    if (!this.api) return;
    let config: PlantConfig;
    try {
      config = parseConfig(await this.store.load());
    } catch {
      return;
    }
    if (this.store.offline || config.machines.length === 0) return;
    this.demo = false;
    this.bound = config.machines.length;
    for (const m of config.machines) this.boundIds.add(m.id);
    const dpes = [...new Set(config.machines.map((m) => m.dpe))];
    try {
      this.sub.add(
        this.api.dpConnect(dpes, true).subscribe((data: DpEmission) => {
          const values = new Map(data.dp.map((dp, i) => [normDpe(dp), data.value[i]]));
          for (const m of config.machines) if (values.has(m.dpe)) this.states.set(m.id, machineState(values.get(m.dpe), m));
        })
      );
    } catch {
      // a DPE that does not exist: its machine stays "unknown"
    }
  }

  /** A machine's state now: its datapoint's, or down as in the demo when it is not bound. */
  state(id: number, time: number): MachineState {
    if (this.demo || !this.boundIds.has(id)) return demoMachineState(id, time);
    return this.states.get(id) ?? 'unknown';
  }

  close(): void {
    this.sub.unsubscribe();
  }
}
