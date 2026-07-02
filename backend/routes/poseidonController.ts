// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// PoseidonController
// -----------------------------------------------------------------------------
// HTTP endpoints for the "Poseidon" wastewater-treatment-plant supervision page.
// The page reads the live process values over the dashboard WebSocket (dpConnect)
// directly; this controller adds the operations that are NOT (safely) available
// there for a browser client:
//   - equipment CONTROL (writes .cmd / .mode with a confirmed dpSetWait), and
//   - server-side KPI / regulatory-balance summaries read from the same DPs.
//
// The data model is created and animated by the `poseidon` JavaScript manager
// (backend/managers/poseidon). WsjServerGlobal.winccoa is the shared, server-wide
// WinCC OA API instance (these are HTTP endpoints with no per-connection context).
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { Request, Response } from 'ultimate-express';

const SYS = 'System1:';
const STATION_DP = 'Poseidon_Station';
const EQUIP_PREFIX = 'Poseidon_Equipment_';

/** Motorised devices the page may command (kept in sync with the manager). */
const EQUIPMENT_IDS = [
  'liftPump1', 'liftPump2', 'liftPump3', 'blower1', 'blower2', 'mixer1', 'mixer2',
  'rasPump', 'wasPump', 'scraper', 'uvReactor', 'centrifuge'
] as const;

/** Regulatory discharge limits used for the conformity verdict (secondary treatment). */
const LIMITS = {
  cod: { max: 125, unit: 'mg/L' },
  tss: { max: 35, unit: 'mg/L' },
  nh4: { max: 10, unit: 'mg/L' },
  ph: { min: 6, max: 8.5, unit: '' }
} as const;

/** Flattened sensor DPEs of the station DP (group.field), read in one dpGet. */
const STATION_FIELDS: Record<string, readonly string[]> = {
  inlet: ['flow', 'ph', 'temperature', 'cod', 'bod', 'tss', 'nh4'],
  bio: ['do', 'redox', 'mlss', 'level', 'temperature'],
  clarifier: ['level', 'sludgeBlanket', 'turbidity'],
  outlet: ['flow', 'ph', 'tss', 'turbidity', 'nh4', 'no3', 'cod'],
  sludge: ['flow', 'dryness'],
  energy: ['power', 'energyToday']
};

type ControlAction = 'start' | 'stop' | 'auto' | 'manual';

function toNumber(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/**
 * Controller exposing Poseidon operations as HTTP endpoints. Handlers are arrow
 * functions so they can be passed straight to the router without losing `this`.
 */
export class PoseidonController {
  /** GET /api/poseidon/health -> liveness probe. */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'poseidon' });
  };

  /**
   * GET /api/poseidon/kpi -> live process KPIs derived from the station DP:
   * removal efficiencies, discharge conformity, and specific energy.
   */
  public kpi = async (_req: Request, res: Response): Promise<void> => {
    try {
      const s = await this.readStation();
      res.status(200).json({ ok: true, kpi: this.computeKpi(s), values: s });
    } catch (error) {
      res.status(503).json({ ok: false, error: (error as Error)?.message ?? String(error) });
    }
  };

  /**
   * GET /api/poseidon/report -> a snapshot regulatory balance: inlet vs outlet
   * loads, removal efficiencies and the per-parameter conformity verdict. (A
   * time-averaged balance would read `dpGetPeriod`; this returns the live snapshot.)
   */
  public report = async (_req: Request, res: Response): Promise<void> => {
    try {
      const s = await this.readStation();
      const kpi = this.computeKpi(s);
      res.status(200).json({
        ok: true,
        generatedAt: new Date().toISOString(),
        loads: this.computeLoads(s),
        efficiencies: kpi.efficiencies,
        conformity: kpi.conformity,
        compliant: kpi.conformity.every((c) => c.pass)
      });
    } catch (error) {
      res.status(503).json({ ok: false, error: (error as Error)?.message ?? String(error) });
    }
  };

  /**
   * POST /api/poseidon/control  body { equipment, action }.
   * action: 'start' | 'stop' (writes .cmd) | 'auto' | 'manual' (writes .mode).
   * A manual start/stop also switches the device to manual so the command sticks.
   */
  public control = async (req: Request, res: Response): Promise<void> => {
    const { equipment, action } = (req.body ?? {}) as { equipment?: string; action?: ControlAction };
    if (!equipment || !(EQUIPMENT_IDS as readonly string[]).includes(equipment)) {
      res.status(400).json({ ok: false, error: 'Unknown or missing equipment id' });
      return;
    }
    if (!action || !['start', 'stop', 'auto', 'manual'].includes(action)) {
      res.status(400).json({ ok: false, error: 'action must be start | stop | auto | manual' });
      return;
    }
    const base = `${SYS}${EQUIP_PREFIX}${equipment}`;
    const names: string[] = [];
    const values: number[] = [];
    if (action === 'auto' || action === 'manual') {
      names.push(`${base}.mode`);
      values.push(action === 'auto' ? 1 : 0);
    } else {
      // Explicit start/stop is a manual operator action: pin to manual + set cmd.
      names.push(`${base}.mode`, `${base}.cmd`);
      values.push(0, action === 'start' ? 1 : 0);
    }
    try {
      await WsjServerGlobal.winccoa.dpSetWait(names, values);
      res.status(200).json({ ok: true, equipment, action });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error)?.message ?? String(error) });
    }
  };

  // --- helpers ---------------------------------------------------------------

  /** Read the whole station DP into a nested numeric object. */
  private async readStation(): Promise<Record<string, Record<string, number>>> {
    const groups = Object.keys(STATION_FIELDS);
    const dpes: string[] = [];
    for (const g of groups) for (const f of STATION_FIELDS[g]) dpes.push(`${SYS}${STATION_DP}.${g}.${f}`);
    const raw = await WsjServerGlobal.winccoa.dpGet(dpes);
    const arr = Array.isArray(raw) ? raw : [raw];
    const out: Record<string, Record<string, number>> = {};
    let i = 0;
    for (const g of groups) {
      out[g] = {};
      for (const f of STATION_FIELDS[g]) out[g][f] = toNumber(arr[i++]);
    }
    return out;
  }

  private computeKpi(s: Record<string, Record<string, number>>): {
    efficiencies: { key: string; percent: number }[];
    conformity: { key: string; value: number; limit: number; unit: string; pass: boolean }[];
    specificEnergy: number;
  } {
    const removal = (inVal: number, outVal: number): number =>
      inVal > 0 ? round(clampPct(((inVal - outVal) / inVal) * 100), 1) : 0;
    const efficiencies = [
      { key: 'cod', percent: removal(s.inlet.cod, s.outlet.cod) },
      { key: 'tss', percent: removal(s.inlet.tss, s.outlet.tss) },
      { key: 'nh4', percent: removal(s.inlet.nh4, s.outlet.nh4) }
    ];
    const conformity = [
      { key: 'cod', value: s.outlet.cod, limit: LIMITS.cod.max, unit: LIMITS.cod.unit, pass: s.outlet.cod <= LIMITS.cod.max },
      { key: 'tss', value: s.outlet.tss, limit: LIMITS.tss.max, unit: LIMITS.tss.unit, pass: s.outlet.tss <= LIMITS.tss.max },
      { key: 'nh4', value: s.outlet.nh4, limit: LIMITS.nh4.max, unit: LIMITS.nh4.unit, pass: s.outlet.nh4 <= LIMITS.nh4.max },
      {
        key: 'ph',
        value: s.outlet.ph,
        limit: LIMITS.ph.max,
        unit: LIMITS.ph.unit,
        pass: s.outlet.ph >= LIMITS.ph.min && s.outlet.ph <= LIMITS.ph.max
      }
    ];
    const specificEnergy = s.outlet.flow > 0 ? round(s.energy.power / s.outlet.flow, 3) : 0;
    return { efficiencies, conformity, specificEnergy };
  }

  /** Daily pollutant loads (kg/d) = concentration (mg/L) × flow (m³/h) × 24 / 1000. */
  private computeLoads(s: Record<string, Record<string, number>>): Record<string, { inlet: number; outlet: number }> {
    const load = (conc: number, flow: number): number => round((conc * flow * 24) / 1000, 1);
    return {
      cod: { inlet: load(s.inlet.cod, s.inlet.flow), outlet: load(s.outlet.cod, s.outlet.flow) },
      tss: { inlet: load(s.inlet.tss, s.inlet.flow), outlet: load(s.outlet.tss, s.outlet.flow) },
      nh4: { inlet: load(s.inlet.nh4, s.inlet.flow), outlet: load(s.outlet.nh4, s.outlet.flow) }
    };
  }
}

function clampPct(v: number): number {
  return Math.min(100, Math.max(0, v));
}
