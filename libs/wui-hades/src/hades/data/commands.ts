// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Field-command layer: every write towards the plant goes through here.
 *
 * A command is a `dpSet` on the DPE bound to a `command` point of an equipment
 * instance. The UI ALWAYS confirms before calling this layer (single command
 * or whole operating mode), and each write is GxP-traced into the shared
 * `AuditTrail_Hades` DP (action `COMMAND`, item = the target DPE) with the
 * mode/equipment context as reason. Unbound actions are skipped and reported
 * so an operator sees exactly what was (not) driven.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { AuditTrailWriter } from '@visuelconcept/wui-kit/data/audit-trail.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import { HADES_AUDIT_DP } from './hades-store.js';
import type { EquipmentDef, ModeAction, Tunnel } from '../types.js';

/** Outcome of one executed (or skipped) command. */
export interface CommandResult {
  label: string;
  dpe: string;
  ok: boolean;
  /** 'unbound' when the point has no DPE, 'error' when the dpSet failed. */
  reason?: 'unbound' | 'error';
}

export class CommandRunner {
  private readonly audit = new AuditTrailWriter({ dpName: HADES_AUDIT_DP, itemType: 'Command' });

  /** Write one command point of an equipment (already confirmed by the UI). */
  async runCommand(
    equipment: EquipmentDef,
    pointKey: string,
    value: number,
    label: string,
    context: string
  ): Promise<CommandResult> {
    const dpe = equipment.bindings[pointKey]?.trim() ?? '';
    if (!dpe) return { label, dpe: '', ok: false, reason: 'unbound' };
    const api = this.resolveApi();
    if (!api) return { label, dpe, ok: false, reason: 'error' };
    try {
      await firstValueFrom(api.dpSet(dpe, value));
      void this.audit.write({
        action: 'COMMAND',
        item: dpe,
        newval: String(value),
        reason: context ? `${context} — ${label}` : label
      });
      return { label, dpe, ok: true };
    } catch {
      return { label, dpe, ok: false, reason: 'error' };
    }
  }

  /** Execute a mode's reflex sequence in order; never throws. */
  async runActions(tunnel: Tunnel, actions: ModeAction[], context: string): Promise<CommandResult[]> {
    const results: CommandResult[] = [];
    for (const action of actions) {
      const equipment = tunnel.equipment.find((e) => e.id === action.equipmentId);
      if (!equipment) {
        results.push({ label: action.label, dpe: '', ok: false, reason: 'unbound' });
        continue;
      }
      results.push(await this.runCommand(equipment, action.pointKey, action.value, action.label, context));
    }
    return results;
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}
