// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * GxP audit-trail persistence for the Poseidon page: a `_AuditTrail` datapoint
 * `AuditTrail_Poseidon` (shared {@link AuditTrailWriter}) — created at page init,
 * one row per equipment command (time · user · host filled by the writer).
 * Writing is best-effort and never throws (must not break the command it traces).
 */
import { AuditTrailWriter } from '@visuelconcept/wui-kit/data/audit-trail.js';
import type { ControlAction } from '../types.js';

const auditWriter = new AuditTrailWriter({ dpName: 'AuditTrail_Poseidon', itemType: 'PoseidonEquipment' });

/** Ensure the backing audit datapoint exists (called once at page init). */
export async function ensureStores(): Promise<void> {
  try {
    await auditWriter.ensure();
  } catch {
    // best-effort
  }
}

/** Record one equipment command into the GxP audit DP. */
export async function traceControl(equipment: string, action: ControlAction, ok: boolean): Promise<void> {
  try {
    await auditWriter.write({
      action: action.toUpperCase(),
      item: equipment,
      newval: action,
      reason: ok ? 'command accepted' : 'command failed'
    });
  } catch {
    // best-effort
  }
}
