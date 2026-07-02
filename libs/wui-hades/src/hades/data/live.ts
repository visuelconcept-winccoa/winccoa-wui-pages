// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Live datapoint binding of a tunnel's equipment.
 *
 * Collects every bound `state` / `measure` DPE across the tunnel, opens ONE
 * `dpConnect` over the whole list, and routes each emission back to its
 * equipment instance (`state` code, or `measures[pointKey]`). The page hands
 * in a callback invoked after each batch so Lit re-renders and the 3D scene /
 * synoptic recolour. Command points are not subscribed (they are write-only
 * from this page; their feedback comes through the state point).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import { pointsOf } from './catalog.js';
import { normDp, toNumber } from './dp-utils.js';
import type { EquipmentDef, Tunnel } from '../types.js';

interface DpEmission {
  dp: string[];
  value: unknown[];
}

interface Target {
  equipment: EquipmentDef;
  pointKey: string;
  role: 'state' | 'measure';
}

/** One equipment state transition (old → new code), for the logbook feed. */
export interface StateTransition {
  equipment: EquipmentDef;
  previous: number | undefined;
  next: number;
}

export class LiveBinding {
  private subscription = new Subscription();
  private targets = new Map<string, Target[]>();

  constructor(
    private readonly onUpdate: () => void,
    /** Optional edge callback fired once per equipment state CHANGE. */
    private readonly onTransition?: (transition: StateTransition) => void
  ) {}

  /** (Re)subscribe to every bound state/measure DPE of the tunnel. */
  connect(tunnel: Tunnel): void {
    this.disconnect();
    this.subscription = new Subscription();
    this.targets = new Map();

    const dpes: string[] = [];
    for (const equipment of tunnel.equipment) {
      for (const point of pointsOf(equipment.kind)) {
        if (point.role === 'command') continue;
        const dpe = equipment.bindings[point.key]?.trim();
        if (!dpe) continue;
        const key = normDp(dpe);
        const list = this.targets.get(key) ?? [];
        list.push({ equipment, pointKey: point.key, role: point.role });
        this.targets.set(key, list);
        dpes.push(dpe);
      }
    }

    const api = this.resolveApi();
    if (!api || dpes.length === 0) return;
    try {
      this.subscription.add(api.dpConnect(dpes, true).subscribe((data: DpEmission) => this.onEmission(data)));
    } catch {
      // Backend not connected — the page stays on persisted/default states.
    }
  }

  disconnect(): void {
    this.subscription.unsubscribe();
  }

  private onEmission(data: DpEmission): void {
    let touched = false;
    for (const [i, dp] of data.dp.entries()) {
      const targets = this.targets.get(normDp(dp));
      if (!targets) continue;
      const value = toNumber(data.value[i]);
      for (const target of targets) {
        if (target.role === 'state') {
          const next = Math.round(value);
          const previous = target.equipment.state;
          target.equipment.state = next;
          if (previous !== next && this.onTransition) {
            this.onTransition({ equipment: target.equipment, previous, next });
          }
        } else {
          target.equipment.measures = { ...target.equipment.measures, [target.pointKey]: value };
        }
        touched = true;
      }
    }
    if (touched) this.onUpdate();
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}
